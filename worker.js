// =====================================================================
// The save path.
//
// This is the only part of Mixtape that is not a static file. Its whole
// job is to let the curator tool put a file into the repo without the
// curator ever seeing GitHub.
//
// It runs on Cloudflare Workers (free). It is not built or bundled —
// paste this file into the Cloudflare dashboard and save. It lives in
// the repo so it has version history like everything else.
//
// It needs two secrets, set in the Cloudflare dashboard, never here:
//   GITHUB_TOKEN      a fine-grained token, THIS REPO ONLY,
//                     Contents: read and write, nothing else
//   CURATOR_PASSWORD  the password the curators type into the tool
//
// SECURITY, in one paragraph. The password is effectively a key that
// can write to a public repo, and GitHub Pages will serve whatever
// lands there. So the limits below are enforced HERE, in the only
// place a curator's browser cannot reach. The tool is not trusted.
// =====================================================================

const REPO_OWNER = "ralph-hawkins";
const REPO_NAME = "mixtape";
const BRANCH = "main";

// Where the tool is served from. Anything else is refused a CORS
// answer. Not a security control on its own — a non-browser client
// ignores CORS entirely — but it stops other websites quietly using
// this from someone else's browser.
const ALLOWED_ORIGINS = [
  "https://ralph-hawkins.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];

// Nothing bigger than this goes up. A voice memo is about 1 MB.
const MAX_BYTES = 15 * 1024 * 1024;

// The only two places in the repo this key can ever write.
//
// This is the most important rule in the file. Without it the password
// could write .github/workflows/, which would let anyone who has it run
// code inside Ralph's GitHub account. Deriving the path from the
// request is not enough on its own — it is checked again, literally,
// against these two patterns before anything is sent to GitHub.
const ALLOWED_PATHS = [
  /^assets\/audio\/[A-Za-z0-9][A-Za-z0-9._-]*$/,
  /^trail\.js$/
];

// Sound files only. If an .html or .js file could be uploaded into the
// site, whoever uploaded it would have a page on Ralph's domain — so
// the extension is an allowlist, not a blocklist.
const AUDIO_EXTENSIONS =
  ["m4a", "mp3", "wav", "ogg", "aac", "flac", "opus"];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    // The browser's "may I?" question before a real POST.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return reply(405, { error: "Only POST is allowed here." }, cors);
    }
    if (!env.GITHUB_TOKEN || !env.CURATOR_PASSWORD) {
      return reply(500, {
        error: "This save service is not set up yet — its keys are " +
               "missing. Ralph needs to add them."
      }, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return reply(400, { error: "That request was not readable." }, cors);
    }

    // The password. Compared without giving away, through how long the
    // comparison takes, how much of a guess was right.
    if (!sameSecret(body.password, env.CURATOR_PASSWORD)) {
      return reply(401, {
        error: "That password is not right."
      }, cors);
    }

    const who = cleanName(body.who) || "a curator";
    const route = new URL(request.url).pathname.replace(/\/+$/, "");

    if (route.endsWith("/audio")) {
      return await saveAudio(body, who, env, cors);
    }
    if (route.endsWith("/trail")) {
      return await saveTrail(body, who, env, cors);
    }
    return reply(404, { error: "No such address." }, cors);
  }
};

// ---------------------------------------------------------------------
// Adding a sound
// ---------------------------------------------------------------------
async function saveAudio(body, who, env, cors) {
  const name = safeFileName(body.name);
  if (!name) {
    return reply(400, {
      error: "That file needs a simpler name — letters, numbers, " +
             "dashes and a full stop before the file type."
    }, cors);
  }

  const extension = name.split(".").pop().toLowerCase();
  if (AUDIO_EXTENSIONS.indexOf(extension) === -1) {
    return reply(400, {
      error: "Only sound files can be added (" +
             AUDIO_EXTENSIONS.join(", ") + "). That one is a ." +
             extension + " file."
    }, cors);
  }

  const base64 = String(body.contentBase64 || "");
  if (!base64) {
    return reply(400, { error: "That file arrived empty." }, cors);
  }
  // Four base64 characters carry three bytes — near enough to check a
  // size without unpacking the whole thing.
  const bytes = Math.floor(base64.length * 3 / 4);
  if (bytes > MAX_BYTES) {
    const asMB = function (n) { return Math.round(n / (1024 * 1024)); };
    return reply(413, {
      error: "That file is too big (" + asMB(bytes) +
             " MB). The limit is " + asMB(MAX_BYTES) + " MB."
    }, cors);
  }

  return await commit(
    "assets/audio/" + name,
    base64,
    who + " added the sound " + name,
    env, cors
  );
}

// ---------------------------------------------------------------------
// Saving the trail
// ---------------------------------------------------------------------
async function saveTrail(body, who, env, cors) {
  const text = String(body.content || "");
  if (!text.trim()) {
    return reply(400, { error: "The trail arrived empty." }, cors);
  }
  if (text.length > MAX_BYTES) {
    return reply(413, { error: "That trail is implausibly large." }, cors);
  }
  return await commit(
    "trail.js",
    base64FromText(text),
    who + " changed the trail",
    env, cors
  );
}

// ---------------------------------------------------------------------
// The one place that talks to GitHub
// ---------------------------------------------------------------------
async function commit(path, base64, message, env, cors) {
  // The allowlist, checked literally, immediately before use — not
  // where the path was built. This is the line that matters.
  const allowed = ALLOWED_PATHS.some(function (pattern) {
    return pattern.test(path);
  });
  if (!allowed) {
    return reply(403, {
      error: "That is not somewhere this tool is allowed to write."
    }, cors);
  }

  const api = "https://api.github.com/repos/" + REPO_OWNER + "/" +
              REPO_NAME + "/contents/" + path;
  const headers = {
    "Authorization": "Bearer " + env.GITHUB_TOKEN,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    // GitHub refuses requests that do not say who is calling.
    "User-Agent": "mixtape-curator-tool"
  };

  // Replacing a file needs the id of the version being replaced. A 404
  // here simply means the file is new.
  let sha;
  const existing = await fetch(api + "?ref=" + BRANCH, { headers });
  if (existing.status === 200) {
    sha = (await existing.json()).sha;
  } else if (existing.status === 401 || existing.status === 403) {
    return reply(502, { error: keyProblem(existing.status) }, cors);
  }

  const put = await fetch(api, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: message,
      content: base64,
      branch: BRANCH,
      sha: sha
    })
  });

  if (put.status === 200 || put.status === 201) {
    return reply(200, {
      ok: true,
      path: path,
      message: message
    }, cors);
  }
  if (put.status === 401 || put.status === 403) {
    return reply(502, { error: keyProblem(put.status) }, cors);
  }
  if (put.status === 409 || put.status === 422) {
    return reply(409, {
      error: "Someone else saved a change a moment ago. Reload the " +
             "page and try again — otherwise their work would be lost."
    }, cors);
  }

  let detail = "";
  try { detail = (await put.json()).message || ""; } catch (error) {}
  return reply(502, {
    error: "GitHub refused that (" + put.status + ")." +
           (detail ? " It said: " + detail : "")
  }, cors);
}

// The expiry trap, said plainly. A fine-grained token stops working on
// its expiry date, and the failure that follows looks like nothing in
// particular unless it is named.
function keyProblem(status) {
  return "The key that lets this tool save has expired or been " +
         "withdrawn (GitHub said " + status + "). Nothing you did is " +
         "wrong — Ralph needs to renew it.";
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

// Strip a name back to something that cannot escape the audio folder.
// Any path in front of it is thrown away, so "../../evil" arrives as
// "evil".
function safeFileName(raw) {
  const lastPart = String(raw || "").split(/[\\/]/).pop();

  // Split the file type off before trimming. Shortening the whole name
  // would eat the ".m4a" off the end of a long one, and it would then
  // be turned away for having no file type — the wrong reason, and a
  // baffling one for whoever chose the file.
  const dot = lastPart.lastIndexOf(".");
  const tidy = function (part) {
    return part.replace(/[^A-Za-z0-9._-]/g, "-");
  };
  const stem = tidy(dot > 0 ? lastPart.slice(0, dot) : lastPart)
    .replace(/^[.\-]+/, "")
    .slice(0, 80);
  const extension = tidy(dot > 0 ? lastPart.slice(dot + 1) : "").slice(0, 10);

  const cleaned = stem + "." + extension;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(cleaned)
    ? cleaned : "";
}

// A curator's name, for the commit message. Kept short and plain so it
// cannot smuggle anything odd into the repository history.
function cleanName(raw) {
  return String(raw || "").replace(/[^\w \-'.]/g, "").trim().slice(0, 60);
}

// Compare two secrets in the same amount of time whatever they are, so
// nothing can be learned by guessing one character at a time.
function sameSecret(given, real) {
  if (typeof given !== "string" || typeof real !== "string") {
    return false;
  }
  if (given.length !== real.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < given.length; i++) {
    difference |= given.charCodeAt(i) ^ real.charCodeAt(i);
  }
  return difference === 0;
}

// Text to base64, the way GitHub wants file contents. Handles accents
// and anything else outside plain ASCII.
function base64FromText(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.indexOf(origin) !== -1
    ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function reply(status, payload, cors) {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, cors)
  });
}

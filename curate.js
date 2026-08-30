// =====================================================================
// The bits every curator page needs.
//
// The tool is several small pages rather than one long one, so the
// half-finished trail has to survive walking between them. It lives in
// the browser's session store: edits on any page change the same
// working copy, and nothing reaches the repository until somebody
// presses Save.
//
// Loaded with an ordinary script tag, like everything else here. No
// modules, no build step.
// =====================================================================

const Curate = (function () {

  const SAVE_SERVICE = "https://mixtape-save.ralph-026.workers.dev";
  const REPO = "ralph-hawkins/mixtape";
  // Bumped when the shape of what is stored changes, so a copy left
  // over from an older version of the tool is ignored rather than
  // misread.
  const WORKING = "mixtape-working-copy-4";

  // Kept in localStorage, not sessionStorage, so half-finished work
  // survives closing the tab or the browser. That is also what lets the
  // "leave site?" warning go: there is nothing to lose by leaving, so
  // there is nothing to interrupt anyone about.
  const store = window.localStorage;

  // -------------------------------------------------------------------
  // Who is using it
  // -------------------------------------------------------------------
  function who() { return localStorage.getItem("mixtape-who") || ""; }
  function password() { return localStorage.getItem("mixtape-password") || ""; }

  function signIn(name, secret) {
    localStorage.setItem("mixtape-who", name);
    localStorage.setItem("mixtape-password", secret);
  }

  function signedIn() { return who().trim() !== "" && password() !== ""; }

  // Every page except the first one needs a name and a password, and
  // sends people back to get them rather than failing later at the
  // moment they try to save.
  function needsSignIn() {
    if (signedIn()) { return false; }
    location.replace("curate.html?then=" +
      encodeURIComponent(location.pathname.split("/").pop() + location.search));
    return true;
  }

  // -------------------------------------------------------------------
  // The working copy
  // -------------------------------------------------------------------
  function working() {
    try { return JSON.parse(store.getItem(WORKING)); }
    catch (error) { return null; }
  }

  function putWorking(copy) {
    store.setItem(WORKING, JSON.stringify(copy));
  }

  // Deliberately NOT called `trails`. trail.js declares a global of
  // that name, and a function here with the same name would hide it —
  // so loading the trail would read this function instead of the file
  // and quietly come back with nothing.
  function allTrails() {
    const copy = working();
    return copy ? copy.trails : {};
  }

  // Every page edits the trail through here.
  function update(change) {
    const copy = working();
    if (!copy) { return; }
    change(copy.trails);
    putWorking(copy);
    showUnsavedBanner();
  }

  // Is there anything to save?
  //
  // Worked out by asking what would actually be written and comparing
  // it with what arrived — NOT by a flag set whenever something edits
  // the trail. A flag is wrong twice over: opening a question and
  // confirming the same answer would set it, and once set nothing could
  // clear it. This way an edit that changes nothing is not a change,
  // and adding a zone then removing it again leaves no trace.
  function changed() {
    const copy = working();
    if (!copy || !copy.original) { return false; }
    return trailsToFile(copy.trails) !== trailsToFile(copy.original);
  }

  // Which trails are different, by name, so the warning can say what it
  // is talking about. A warning nobody can look into is just nagging.
  function whatChanged() {
    const copy = working();
    if (!copy || !copy.original) { return []; }
    const named = [];
    const ids = new Set(Object.keys(copy.trails)
      .concat(Object.keys(copy.original)));
    ids.forEach(function (id) {
      const before = copy.original[id];
      const after = copy.trails[id];
      if (!before) { named.push((after.name || id) + " (new)"); return; }
      if (!after) { named.push((before.name || id) + " (removed)"); return; }
      if (trailsToFile({ x: after }) !== trailsToFile({ x: before })) {
        named.push(after.name || id);
      }
    });
    return named;
  }

  // Put everything back the way it arrived. Faster and safer than
  // throwing the whole working copy away, which would mean fetching it
  // all again and could fail with no connection.
  function revert() {
    const copy = working();
    if (!copy || !copy.original) { return; }
    copy.trails = JSON.parse(JSON.stringify(copy.original));
    putWorking(copy);
    showUnsavedBanner();
  }

  // Throw the working copy away, so the next page starts from whatever
  // is really in the repository.
  function discard() { store.removeItem(WORKING); }

  // -------------------------------------------------------------------
  // Getting started on any page
  //
  // If there is already a working copy, use it — someone is part way
  // through. Otherwise fetch the real trail and the version it is, so
  // saving later can tell whether anyone else has been editing.
  // -------------------------------------------------------------------
  function start(ready, failed) {
    if (needsSignIn()) { return; }

    const copy = working();

    // A copy that cannot say which version it came from can never be
    // saved: the service refuses a save that does not say, because a
    // save like that could bury somebody else's work. Keeping such a
    // copy would trap whoever holds it — every save refused, and
    // reloading handing back the same unsaveable copy. So it goes, and
    // the trail is fetched again.
    if (copy && !copy.baseSha) { discard(); loadFresh(ready, failed); return; }

    // Unsaved work is kept whatever the file says now. Saving will
    // notice if somebody else has been editing in the meantime.
    if (copy && changed()) { showUnsavedBanner(); ready(); return; }

    // A copy with nothing unsaved in it has nothing worth keeping, and
    // it now outlives the tab — so check it is still the current trail
    // rather than showing one somebody else has since changed.
    //
    // If the file cannot be reached, keep the copy and carry on. It is
    // no worse than it was a moment ago, the curator can still work,
    // and saving is the thing that finds out whether it is still
    // current — the save service refuses a stale one outright.
    if (copy) {
      fetchTrail(function (text, sha) {
        if (sha && sha === copy.baseSha) { ready(); return; }
        discard();
        adopt(text, sha, ready, failed);
      }, function () { ready(); });
      return;
    }

    loadFresh(ready, failed);
  }

  // Which version of trail.js we are holding.
  //
  // Git names a file after the SHA-1 of its contents, with a short
  // header in front. So the version is not something to be asked for —
  // it can be worked out from the file itself, here, for nothing.
  //
  // It used to be a question put to GitHub, and GitHub rations
  // anonymous questions: 60 an hour, shared by everyone on the same
  // connection. This tool asked one on every page load, and adding a
  // single zone is seven or eight pages. An afternoon of curating ran
  // the allowance out, and the tool then stopped with "Could not check
  // the trail version" — no reason anyone could act on, and no hint
  // that waiting an hour would fix it.
  //
  // Working it out here closes a hole as well. The version came from
  // GitHub, which is current the instant a save lands, while the trail
  // itself is read from the published site, which runs a minute or two
  // behind. In that gap a second curator was handed OLD contents
  // wearing a NEW version number — and their next save would write the
  // old trail over the new one, with nothing refused and nobody told.
  // A version worked out from the contents in hand cannot describe
  // anything else.
  function versionOf(text) {
    const encoder = new TextEncoder();
    const content = encoder.encode(text);
    // The header git puts in front before hashing. This has to match
    // byte for byte, or every save would be refused as somebody else's
    // work.
    const header = encoder.encode("blob " + content.length + "\0");
    const whole = new Uint8Array(header.length + content.length);
    whole.set(header, 0);
    whole.set(content, header.length);
    return crypto.subtle.digest("SHA-1", whole).then(function (hash) {
      return Array.from(new Uint8Array(hash)).map(function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  // Web Crypto only exists in a secure context — https, or localhost.
  // Served any other way (a phone reading a laptop's copy over wi-fi)
  // it is missing, so fall back to asking, which is what this always
  // used to do. Rationed, but better than a tool nobody can save from.
  function versionOfFile(text) {
    const subtle = (typeof crypto !== "undefined") && crypto.subtle;
    if (subtle && subtle.digest) {
      return versionOf(text).catch(askGitHubVersion);
    }
    return askGitHubVersion();
  }

  // The old way. Public, so it needs no password — and rationed
  // because of it.
  function askGitHubVersion() {
    return fetch("https://api.github.com/repos/" + REPO + "/contents/trail.js" +
        "?ref=main", { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (info) { return info ? info.sha : null; })
      .catch(function () { return null; });
  }

  // Fetch trail.js and work out which version it is — the two things
  // every page needs before it can show anything, and now one journey
  // rather than two.
  function fetchTrail(ok, failed) {
    fetch("trail.js?t=" + Date.now(), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) { throw new Error("trail.js " + response.status); }
        return response.text();
      })
      .then(function (text) {
        return versionOfFile(text).then(function (sha) { return [text, sha]; });
      })
      // Two handlers rather than a catch on the end, so that a fault in
      // whatever `ok` goes on to draw is not reported as "you are
      // offline".
      .then(function (both) { ok(both[0], both[1]); },
            function () {
              failed("Could not load the trail. Check you are online, " +
                "then reload this page.");
            });
  }

  // Take the file on as the working copy.
  //
  // The very text that was hashed is what gets run, as a script, the
  // same way the walker's page runs it — so the tool can never
  // disagree with the engine about what the file means, and the
  // version can never be describing different contents from the ones
  // in hand.
  function adopt(text, sha, ready, failed) {
    const script = document.createElement("script");
    script.textContent = text;
    document.head.appendChild(script);
    if (typeof trails === "undefined") {
      failed("The trail file could not be read. It may have a typo in it.");
      return;
    }
    // `trails` here is the global the file declares. Copied, so editing
    // the working copy never touches what was loaded.
    const loaded = JSON.parse(JSON.stringify(trails));
    // Keep the trail exactly as it arrived, to compare against and to
    // put back if somebody changes their mind.
    putWorking({ baseSha: sha || "", trails: loaded,
      original: JSON.parse(JSON.stringify(loaded)) });
    ready();
  }

  function loadFresh(ready, failed) {
    fetchTrail(function (text, sha) { adopt(text, sha, ready, failed); },
      failed);
  }

  // -------------------------------------------------------------------
  // The sounds that exist. Public repository, so no password needed.
  // -------------------------------------------------------------------
  function sounds(ready) {
    fetch("https://api.github.com/repos/" + REPO +
        "/contents/assets/audio", { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : []; })
      .then(function (files) {
        ready(files
          .filter(function (file) { return file.type === "file"; })
          .map(function (file) { return "assets/audio/" + file.name; })
          .sort());
      })
      .catch(function () { ready([]); });
  }

  // -------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------

  // Put the working copy back in step after a save: it now holds
  // exactly what the file holds, sitting on the version just written.
  //
  // The rule: never hold a version we cannot vouch for. One we cannot
  // establish is erased rather than left sitting there looking
  // current, and `start` throws such a copy away next time rather than
  // letting it walk into a refusal. Erasing it is free here — this
  // runs the moment a save succeeded, so the copy holds nothing that
  // is not already in the file.
  function settle(sha, sent, done) {
    function fix(version) {
      const held = working();
      if (held) {
        held.baseSha = version || "";
        // What was just saved is now what the file says, so there is
        // nothing left to save until something else changes.
        held.original = JSON.parse(JSON.stringify(held.trails));
        putWorking(held);
      }
      done();
    }
    if (sha) { fix(sha); return; }
    // No version in the reply, which means an older save service is
    // still deployed. We can still vouch for one without asking
    // anybody: the write succeeded, so the file now holds exactly the
    // text we sent, and a version is only ever the name of some
    // contents.
    versionOfFile(sent).then(fix, function () { fix(""); });
  }

  function save(onDone) {
    const copy = working();
    if (!copy) { onDone({ error: "There is nothing to save." }); return; }

    // Only what would actually break a walker stops a save. An
    // unfinished walk is the curator's business, not a reason to
    // refuse work they have done somewhere else.
    const problems = savingProblems(copy.trails);
    if (problems.length > 0) { onDone({ problems: problems }); return; }

    // Held on to, not just sent: if the save service is too old to say
    // which version it wrote, this text is the answer.
    const sending = trailsToFile(copy.trails);

    fetch(SAVE_SERVICE + "/trail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: password(), who: who(),
        content: sending,
        baseSha: copy.baseSha
      })
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, status: response.status, body: body };
        });
      })
      .then(function (answer) {
        if (!answer.ok) {
          // A refusal because somebody else saved first is a dead end
          // otherwise: the stale copy stays in this browser, so
          // reloading changes nothing and every retry fails the same
          // way. Flagged, so the page can offer a way out.
          onDone({ error: answer.body.error, conflict: answer.status === 409 });
          return;
        }
        // Saved. The file has moved on, so this copy must move on with
        // it, and the version it now sits on has to be right.
        //
        // The save service sends that version back, because GitHub
        // told it outright which one the write created. Going and
        // asking instead is a second question with its own answer, and
        // if it comes back wrong — or does not come back — this
        // browser is left holding a version that no longer exists.
        // Nothing looks wrong at the time. The NEXT save is refused,
        // and the refusal blames another curator who was never there,
        // while the only way out it offers throws the work away.
        settle(answer.body.sha, sending, function () {
          showUnsavedBanner();
          onDone({ saved: true, warning: answer.body.warning });
        });
      })
      .catch(function () {
        onDone({ error: "Could not reach the save service. Check you " +
          "are online, then try again." });
      });
  }


  // Somebody else saved first. Retrying can never work — this browser
  // is still holding the older version — so offer the only thing that
  // does. Shared, because more than one page can save now.
  function offerDiscard(into) {
    const escape = document.createElement("button");
    escape.className = "danger";
    escape.textContent = "Discard my changes and get the latest";
    escape.addEventListener("click", function () {
      const sure = window.confirm(
        "Discard your unsaved changes and take whatever the other " +
        "person saved?");
      if (!sure) { return; }
      discard();
      location.reload();
    });
    into.appendChild(escape);
  }

  // -------------------------------------------------------------------
  // A quiet strip at the top of every page while work is unsaved, so
  // nobody closes the tab thinking it went in.
  // -------------------------------------------------------------------
  // Under the masthead, not above it. Putting it first in the page left
  // a yellow strip sitting on top of the black brand bar, which looked
  // like something had gone wrong with the page rather than a notice
  // about the work.
  function putStripOnPage(strip) {
    const masthead = document.querySelector(".masthead");
    if (masthead && masthead.parentNode === document.body) {
      masthead.insertAdjacentElement("afterend", strip);
    } else {
      document.body.insertBefore(strip, document.body.firstChild);
    }
  }

  function showUnsavedBanner() {
    const there = document.getElementById("unsavedBanner");
    if (!changed()) { if (there) { there.remove(); } return; }
    if (there) { return; }
    const named = whatChanged();
    const strip = document.createElement("div");
    strip.id = "unsavedBanner";
    strip.className = "notice strip";

    const says = document.createElement("span");
    says.textContent = named.length
      ? "Unsaved changes to " + named.join(", ") + ". "
      : "You have changes that are not saved yet. ";
    strip.appendChild(says);

    // A way out. Being told there is unsaved work with no way to see
    // what it is or get rid of it is worse than not being told.
    const undo = document.createElement("a");
    undo.href = "#";
    undo.textContent = "Discard them";
    undo.addEventListener("click", function (event) {
      event.preventDefault();
      const sure = window.confirm(
        "Discard everything you have changed since opening the tool?\n\n" +
        "Anything you have changed since then will be lost.");
      if (!sure) { return; }
      revert();
      location.reload();
    });
    strip.appendChild(undo);
    putStripOnPage(strip);
  }

  // There is deliberately no "leave site?" warning.
  //
  // The tool is several pages, so the browser fires that on every step
  // between them — four questions to add one zone, and every Back. A
  // warning that appears constantly gets dismissed without reading,
  // which makes it worse than none at all. The strip above does the
  // job instead: it is on every page, it names what is unsaved, and it
  // can be acted on. And because the work now outlives the tab, there
  // is nothing to lose by closing it.

  // Running from a copy on your own machine is useful — no waiting for
  // the site to rebuild — but it is only the PAGES that are local. The
  // trail is read from the file next to them, while saving writes to
  // the real repository. Get those out of step and saving would put an
  // old trail over a newer one, so say so plainly.
  function warnIfLocal() {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { return; }
    if (document.getElementById("localNotice")) { return; }
    const strip = document.createElement("div");
    strip.id = "localNotice";
    strip.className = "notice strip";
    strip.textContent = "Running from your own machine. The trail shown " +
      "is the file on this computer, but saving writes to the live one — " +
      "so run git pull first.";
    putStripOnPage(strip);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", warnIfLocal);
  } else {
    warnIfLocal();
  }

  // -------------------------------------------------------------------
  // Odds and ends
  // -------------------------------------------------------------------
  function ask(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function go(where) { location.href = where; }

  // Show a list of problems at the top of the page, the way a form
  // ought to: everything wrong in one place, before the fields.
  function showProblems(into, problems) {
    into.innerHTML = "";
    if (!problems || problems.length === 0) { into.hidden = true; return; }
    into.hidden = false;
    into.className = "problem";
    const heading = document.createElement("h2");
    heading.textContent = problems.length === 1
      ? "There is a problem" : "There are problems";
    const list = document.createElement("ul");
    problems.forEach(function (problem) {
      const item = document.createElement("li");
      const words = problem.says || problem;
      // Where we know which zone and which question is at fault, take
      // them there. A list of faults you then have to go and find is
      // only half a message.
      if (problem && problem.trail && problem.field !== undefined &&
          problem.zone !== undefined) {
        const link = document.createElement("a");
        link.href = "zone-edit.html?trail=" + encodeURIComponent(problem.trail) +
          "&zone=" + problem.zone + "&field=" + problem.field;
        link.textContent = words;
        item.appendChild(link);
      } else {
        item.textContent = words;
      }
      list.appendChild(item);
    });
    into.appendChild(heading);
    into.appendChild(list);
    // Take them to it, not just near it. Somebody using a screen reader
    // is otherwise left at the bottom of a form with no idea anything
    // was said.
    into.setAttribute("tabindex", "-1");
    into.focus();
    into.scrollIntoView();
  }

  return { who, password, signIn, signedIn, needsSignIn,
           start, trails: allTrails, update, changed, whatChanged, revert,
           discard, working, sounds, save, ask, go, showProblems,
           version: versionOfFile,
           offerDiscard, showUnsavedBanner };
})();

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
  const WORKING = "mixtape-working-copy-2";

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
    try { return JSON.parse(sessionStorage.getItem(WORKING)); }
    catch (error) { return null; }
  }

  function putWorking(copy) {
    sessionStorage.setItem(WORKING, JSON.stringify(copy));
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
  // it with what was loaded — NOT by a flag set whenever something
  // edits the trail. A flag is wrong twice over: opening a question and
  // confirming the same answer would set it, and once set nothing could
  // clear it, so the tool nagged about unsaved work that did not exist.
  // This way an edit that changes nothing is not a change, and adding a
  // zone then removing it again leaves no trace.
  function changed() {
    const copy = working();
    if (!copy || typeof copy.asLoaded !== "string") { return false; }
    return trailsToFile(copy.trails) !== copy.asLoaded;
  }

  // Throw the working copy away, so the next page starts from whatever
  // is really in the repository.
  function discard() { sessionStorage.removeItem(WORKING); }

  // -------------------------------------------------------------------
  // Getting started on any page
  //
  // If there is already a working copy, use it — someone is part way
  // through. Otherwise fetch the real trail and the version it is, so
  // saving later can tell whether anyone else has been editing.
  // -------------------------------------------------------------------
  function start(ready, failed) {
    if (needsSignIn()) { return; }
    if (working()) { showUnsavedBanner(); ready(); return; }

    let loadedTrails = null;
    let sha = null;
    let waiting = 2;
    let broken = false;

    function done() {
      waiting = waiting - 1;
      if (waiting > 0 || broken) { return; }
      // Keep what the file said when it arrived, to compare against.
      putWorking({ baseSha: sha, trails: loadedTrails,
        asLoaded: trailsToFile(loadedTrails) });
      ready();
    }
    function giveUp(message) {
      if (broken) { return; }
      broken = true;
      (failed || function () {})(message);
    }

    // Loaded exactly as the walker's page loads it, so the tool can
    // never disagree with the engine about what the file means.
    const script = document.createElement("script");
    script.src = "trail.js?t=" + Date.now();
    script.onload = function () {
      if (typeof trails === "undefined") {
        giveUp("The trail file has nothing in it.");
        return;
      }
      // `trails` here is the global from trail.js. Copied, so editing
      // the working copy never touches what was loaded.
      loadedTrails = JSON.parse(JSON.stringify(trails));
      done();
    };
    script.onerror = function () {
      giveUp("Could not load the trail. Check you are online, then " +
        "reload this page.");
    };
    document.head.appendChild(script);

    // Which version that is. The repository is public, so this needs
    // no password.
    fetch("https://api.github.com/repos/" + REPO + "/contents/trail.js" +
        "?ref=main", { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (info) {
        if (!info) { giveUp("Could not check the trail version."); return; }
        sha = info.sha;
        done();
      })
      .catch(function () { giveUp("Could not reach GitHub."); });
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
  function save(onDone) {
    const copy = working();
    if (!copy) { onDone({ error: "There is nothing to save." }); return; }

    const problems = trailProblems(copy.trails);
    if (problems.length > 0) { onDone({ problems: problems }); return; }

    fetch(SAVE_SERVICE + "/trail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: password(), who: who(),
        content: trailsToFile(copy.trails),
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
        // Saved, so this copy is now clean — and the version it is
        // based on has moved on.
        refreshVersion(function () {
          // What was just saved is now what the file says, so there is
          // nothing left to save until something else changes.
          const fresh = working();
          if (fresh) {
            fresh.asLoaded = trailsToFile(fresh.trails);
            putWorking(fresh);
          }
          showUnsavedBanner();
          onDone({ saved: true, warning: answer.body.warning });
        });
      })
      .catch(function () {
        onDone({ error: "Could not reach the save service. Check you " +
          "are online, then try again." });
      });
  }

  function refreshVersion(ready) {
    fetch("https://api.github.com/repos/" + REPO + "/contents/trail.js" +
        "?ref=main", { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (info) {
        const copy = working();
        if (info && copy) { copy.baseSha = info.sha; putWorking(copy); }
        ready();
      })
      .catch(ready);
  }

  // -------------------------------------------------------------------
  // A quiet strip at the top of every page while work is unsaved, so
  // nobody closes the tab thinking it went in.
  // -------------------------------------------------------------------
  function showUnsavedBanner() {
    const there = document.getElementById("unsavedBanner");
    if (!changed()) { if (there) { there.remove(); } return; }
    if (there) { return; }
    const strip = document.createElement("div");
    strip.id = "unsavedBanner";
    strip.className = "unsaved";
    strip.textContent = "You have changes that are not saved yet.";
    document.body.insertBefore(strip, document.body.firstChild);
  }

  window.addEventListener("beforeunload", function (event) {
    if (changed()) { event.preventDefault(); event.returnValue = ""; }
  });

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
      item.textContent = problem.says || problem;
      list.appendChild(item);
    });
    into.appendChild(heading);
    into.appendChild(list);
    into.scrollIntoView();
  }

  return { who, password, signIn, signedIn, needsSignIn,
           start, trails: allTrails, update, changed,
           discard, working, sounds, save, ask, go, showProblems,
           showUnsavedBanner };
})();

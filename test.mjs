// =====================================================================
// Tests for the parts that are not just a web page.
//
// Run them:   node test.mjs
//
// No installing anything, no build step, nothing to set up. They never
// touch the real GitHub or the real save service — a pretend GitHub
// answers instead, so these can be run as often as you like.
//
// Two things are checked here because both can fail silently and
// neither shows up by looking at the page:
//
//   1. worker.js — the save service. It holds a key that can write to
//      a public repository, so what it refuses matters more than what
//      it allows. Anything weakened here should fail loudly.
//
//   2. trail-file.js — the code that writes trail.js and decides
//      whether a trail is fit to save. If it ever drops a setting, a
//      curator saving the trail would quietly delete part of it.
// =====================================================================

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const workerSource = readFileSync(new URL("worker.js", import.meta.url), "utf8");

// trail-file.js is a plain script the pages load with a script tag, and
// it hands its functions out to Node as well — so these tests run the
// very code the tool runs, not a copy of it.
const require = createRequire(import.meta.url);
const { trailsToFile, ZONE_FIELDS, QUESTION_SETS, isUsableNumber, trailId,
        zoneProblems, trailProblems, readPosition,
        soundFileName, ZONE_FAULTS } = require("./trail-file.js");

// Load worker.js as a module without renaming it or adding a
// package.json, by handing its text straight to the importer.
const workerModule = await import(
  "data:text/javascript;base64," +
  Buffer.from(workerSource).toString("base64"));
const worker = workerModule.default;
const putFile = workerModule.putFileForTests;

const env = { GITHUB_TOKEN: "pretend-token", CURATOR_PASSWORD: "correct horse" };

let failures = 0;
let heading = "";

function section(title) {
  heading = title;
  console.log("\n" + title);
}

function check(label, passed, detail) {
  if (!passed) { failures = failures + 1; }
  console.log("  " + (passed ? "ok  " : "FAIL") + " " + label +
    (detail ? "  — " + String(detail).slice(0, 70) : ""));
}

// ---------------------------------------------------------------------
// A pretend GitHub. `already` lists the paths it should claim exist;
// every write it is asked to make is recorded in `writes`.
//
// It keeps a version number per file and CHANGES IT on every write,
// exactly as GitHub does. That matters: a fake that always reports the
// same version can only ever model one save, and the fault this was
// built to catch needs two in a row.
// ---------------------------------------------------------------------
let writes = [];
let versions = new Map();
function pretendGitHub(already = []) {
  versions = new Map();
  already.forEach(function (path) { versions.set(path, "version-of-" + path); });
  writes = [];
  let made = 0;
  globalThis.fetch = async function (url, options = {}) {
    const path = decodeURIComponent(
      String(url).split("/contents/")[1].split("?")[0]);
    if ((options.method || "GET") === "GET") {
      return new Response(JSON.stringify({ sha: versions.get(path) }),
        { status: versions.has(path) ? 200 : 404 });
    }
    const sent = JSON.parse(options.body);
    writes.push({ path, sent });
    // The real GitHub refuses a write that claims to replace a version
    // that is no longer the current one.
    if (sent.sha && sent.sha !== versions.get(path)) {
      return new Response(JSON.stringify({ message: "sha did not match" }),
        { status: 409 });
    }
    // A write makes a new version, and GitHub says which in its reply.
    made = made + 1;
    const now = "version-" + made + "-of-" + path;
    versions.set(path, now);
    return new Response(JSON.stringify({ content: { sha: now } }),
      { status: sent.sha ? 200 : 201 });
  };
}

function post(route, body) {
  return new Request("https://save.example" + route, {
    method: "POST",
    headers: { "Content-Type": "application/json",
               Origin: "https://ralph-hawkins.github.io" },
    body: JSON.stringify(body)
  });
}

const sound = (changes = {}) => ({
  password: "correct horse", who: "Jamie", name: "bass.m4a",
  contentBase64: Buffer.from("pretend audio").toString("base64"), ...changes
});

async function send(request) {
  const response = await worker.fetch(request, env);
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (error) { /* no body */ }
  return { status: response.status, body, text };
}

// =====================================================================
section("Who is allowed in");
// =====================================================================
pretendGitHub();

let r = await worker.fetch(new Request("https://save.example/audio", {
  method: "OPTIONS", headers: { Origin: "https://ralph-hawkins.github.io" } }), env);
check("a browser's preflight question is answered", r.status === 204);
check("only this site is allowed to ask",
  r.headers.get("access-control-allow-origin") === "https://ralph-hawkins.github.io");

r = await send(new Request("https://save.example/audio", {
  headers: { Origin: "https://ralph-hawkins.github.io" } }));
check("visiting it in a browser does nothing", r.status === 405);

r = await send(post("/audio", sound({ password: "guess" })));
check("a wrong password is refused", r.status === 401);
r = await send(post("/audio", sound({ password: undefined })));
check("no password at all is refused", r.status === 401);
check("nothing was written on a refusal", writes.length === 0);

r = await send(post("/nowhere", sound()));
check("an address that does not exist is refused", r.status === 404);

r = await worker.fetch(post("/audio", sound()), {});
check("with no keys set up, it says so plainly", r.status === 500);

// =====================================================================
section("Where it is allowed to write");
// This is the most important section in the file. The curator password
// is effectively a key to a public repository, and GitHub Pages serves
// whatever lands there. Everything below must stay refused.
// =====================================================================
// The allowlist itself, tested directly against the patterns rather
// than through an upload.
//
// It has to be tested this way. Every path the service builds is made
// from a name that has already been cleaned, so in normal running the
// allowlist never catches anything — break it and every other test
// still passes. It is the last line of defence, there for the day
// somebody refactors and lets a raw path through, and a last line of
// defence nobody checks is not a defence.
const { ALLOWED_PATHS } = new Function(
  workerSource.match(/const ALLOWED_PATHS = \[[\s\S]*?\n\];/)[0] +
  "; return { ALLOWED_PATHS };")();
const allows = (path) => ALLOWED_PATHS.some((pattern) => pattern.test(path));

check("the allowlist permits a sound", allows("assets/audio/bass.m4a"));
check("the allowlist permits the trail", allows("trail.js"));
for (const path of [".github/workflows/ci.yml", "index.html", "worker.js",
  "curate.html", "assets/audio/sub/deeper.m4a", "assets/audio/../trail.js",
  "CNAME", "", "assets/audio/", "../trail.js"]) {
  check("the allowlist refuses " + (path || "an empty path"), !allows(path));
}

// And the check itself, called directly with paths it must turn away —
// the thing that would still be standing if everything upstream of it
// were rewritten badly.
for (const path of [".github/workflows/evil.yml", "index.html",
  "assets/audio/../../evil.js", "CNAME"]) {
  pretendGitHub();
  const refused = await putFile(path, "AAAA", "a message", undefined, {}, env, {});
  check("asked outright to write " + path + ", it refuses",
    refused.status === 403 && writes.length === 0);
}
pretendGitHub();
const permitted = await putFile("assets/audio/fine.m4a", "AAAA", "a message",
  undefined, {}, env, {});
check("and still writes the things it should", permitted.status === 200 ||
  permitted.status === 201, String(permitted.status));

const mustRefuse = [
  ["a workflow file — would run code in Ralph's account",
    "../../.github/workflows/evil.yml"],
  ["a page on Ralph's own domain", "evil.html"],
  ["a script on Ralph's own domain", "evil.js"],
  ["climbing out of the audio folder", "../../index.html"],
  ["overwriting the trail through the audio door", "../trail.js"],
  ["a hidden server config file", ".htaccess"],
  ["the domain name file", "CNAME"],
  ["a site settings file", "_config.yml"],
  ["a page dressed up as a sound", "evil.m4a.html"],
  ["no name at all", ""],
  ["nothing but dots", "....m4a"]
];
for (const [why, name] of mustRefuse) {
  pretendGitHub();
  const result = await send(post("/audio", sound({ name })));
  check("refused: " + why, result.status === 400 && writes.length === 0,
    result.body.error);
}

pretendGitHub();
r = await send(post("/audio", sound({ name: "a/b/../../../escape.m4a" })));
check("a path is stripped to a plain name, not followed",
  writes[0] && writes[0].path === "assets/audio/escape.m4a",
  writes[0] && writes[0].path);

pretendGitHub();
r = await send(post("/audio", sound({ name: "Voice Memo 3.m4a" })));
check("an awkward but honest name is tidied, not rejected",
  r.body.savedName === "Voice-Memo-3.m4a", r.body.savedName);
check("tidying is not reported as a clash", r.body.nameWasTaken === false);

pretendGitHub();
r = await send(post("/audio", sound({ name: "x".repeat(300) + ".m4a" })));
check("a very long name keeps its file type and is accepted",
  r.status === 200 && r.body.savedName.endsWith(".m4a"), r.body.savedName);

pretendGitHub();
r = await send(post("/audio", sound({ contentBase64: "" })));
check("an empty file is refused", r.status === 400);
pretendGitHub();
r = await send(post("/audio", sound({
  contentBase64: "A".repeat(21 * 1024 * 1024) })));
check("an enormous file is refused", r.status === 413, r.body.error);

// =====================================================================
section("A new sound never replaces an old one");
// Phone voice memos arrive called things like "New Recording 3.m4a",
// so two curators colliding is a matter of time. A lost recording is
// far worse than an untidy file name.
// =====================================================================
pretendGitHub([]);
r = await send(post("/audio", sound()));
check("a free name is used as it is", r.body.savedName === "bass.m4a");
check("the write claims no previous version, so GitHub refuses if one " +
  "appeared meanwhile", writes[0].sent.sha === undefined);

pretendGitHub(["assets/audio/bass.m4a"]);
r = await send(post("/audio", sound()));
check("a taken name becomes bass-2.m4a", r.body.savedName === "bass-2.m4a",
  r.body.savedName);
check("it is reported as a clash", r.body.nameWasTaken === true);
check("the sound already there is left alone",
  !writes.some(w => w.path === "assets/audio/bass.m4a"));
check("the commit message explains itself",
  /was already taken/.test(r.body.message), r.body.message);

pretendGitHub(["assets/audio/bass.m4a", "assets/audio/bass-2.m4a",
  "assets/audio/bass-3.m4a"]);
r = await send(post("/audio", sound()));
check("it keeps counting up", r.body.savedName === "bass-4.m4a",
  r.body.savedName);

pretendGitHub(["assets/audio/bass.m4a",
  ...Array.from({ length: 19 }, (_, i) => `assets/audio/bass-${i + 2}.m4a`)]);
r = await send(post("/audio", sound()));
check("it gives up rather than trying forever", r.status === 409);
check("and writes nothing when it does", writes.length === 0);

// =====================================================================
section("Two curators cannot bury each other's work");
// The page must say which version of the trail it started from.
// Looking it up here instead would be worthless — the answer would
// always be current, so every save would succeed and the second
// curator's change would vanish without trace.
// =====================================================================
const trailSave = (changes = {}) => post("/trail", {
  password: "correct horse", who: "Simon",
  content: "const trails = {};", ...changes });

pretendGitHub(["trail.js"]);
r = await send(trailSave());
check("a save that does not say where it started is refused",
  r.status === 400, r.body.error);
check("and writes nothing", writes.length === 0);

pretendGitHub(["trail.js"]);
r = await send(trailSave({ baseSha: "version-of-trail.js" }));
check("saving from the current version works", r.status === 200);
check("it sends the page's version, not one it looked up itself",
  writes[0].sent.sha === "version-of-trail.js");
// The page has to know which version its save created, or its NEXT
// save claims one that no longer exists and is refused. GitHub says so
// in its reply to the write, so there is nothing to go and ask.
check("it hands back the version the save just created",
  r.body.sha === versions.get("trail.js"), r.body.sha);
check("and that is not the version it replaced",
  r.body.sha && r.body.sha !== "version-of-trail.js", r.body.sha);

pretendGitHub(["trail.js"]);
r = await send(trailSave({ baseSha: "an-older-version" }));
check("saving from a stale version is refused", r.status === 409,
  r.body.error);

pretendGitHub(["trail.js"]);
r = await send(trailSave({ content: "   ", baseSha: "version-of-trail.js" }));
check("an empty trail is refused", r.status === 400);

// =====================================================================
section("Nothing secret ever comes back");
// =====================================================================
pretendGitHub();
const everyReply = [
  await send(post("/audio", sound())),
  await send(post("/audio", sound({ password: "guess" }))),
  await send(post("/audio", sound({ name: "evil.html" }))),
  await send(trailSave({ baseSha: "x" }))
];
check("no reply contains the repository key",
  !everyReply.some(x => x.text.includes(env.GITHUB_TOKEN)));
check("no reply contains the curator password",
  !everyReply.some(x => x.text.includes(env.CURATOR_PASSWORD)));

// =====================================================================
section("The key expiry is announced before it bites");
// A warning that only appears once things are broken is not a warning.
// =====================================================================
globalThis.fetch = async () => new Response(
  JSON.stringify({ message: "Bad credentials" }), { status: 401 });
r = await send(post("/audio", sound()));
check("an expired key is named, not left a mystery",
  r.status === 502 && /expired/.test(r.body.error), r.body.error);

// =====================================================================
section("Saving the trail never loses a setting");
// The serialiser inside curate.html writes trail.js. If it dropped a
// setting, a curator saving the trail would quietly delete part of it.
// The real code is lifted out of the page rather than copied, so this
// cannot drift away from what actually runs.
// =====================================================================
const everySetting = {
  name: "A zone", lat: 51.4, lon: 0.01, radius: 40,
  audio: "assets/audio/a.m4a", loop: true, exit: "finish",
  plays: 2, fadeIn: 5, fadeOut: 10
};
const written = trailsToFile({
  "a-trail": { name: "A trail", zones: [everySetting] } });

const readBack = new Function("location", written + "; return { trail, trails };")(
  { search: "" });
check("every setting survives being written and read again",
  JSON.stringify(readBack.trail.zones[0]) === JSON.stringify(everySetting));
check("the engine still gets a `trail` with a name and zones",
  readBack.trail.name === "A trail" && readBack.trail.zones.length === 1);
check("saving twice changes nothing", trailsToFile(readBack.trails) === written);

// Zones collect working parts as the tool is used — map circles, audio
// players, table cells. None of that may reach the file.
const polluted = Object.assign({}, everySetting, {
  circle: { leaflet: "object" }, player: {}, marker: {}, row: {}
});
polluted.circle.itself = polluted.circle;   // circular, as Leaflet's is

// Wrapped, because getting this wrong does not fail politely: a real
// Leaflet circle refers back to itself, and trying to write one into
// the file throws. That must be reported as a failed test, not as the
// tests themselves falling over.
let cleaned = null;
let pollutionError = "";
try {
  cleaned = new Function("location",
    trailsToFile({ t: { name: "T", zones: [polluted] } }) + "; return trail;")(
    { search: "" });
} catch (error) {
  pollutionError = error.message;
}
check("working parts are left out of the file",
  cleaned !== null &&
  Object.keys(cleaned.zones[0]).every(k => ZONE_FIELDS.includes(k)),
  pollutionError || Object.keys(cleaned.zones[0]).join(","));

const sparse = { name: "Bare", lat: 51.4, lon: 0.01, radius: 20,
  audio: "assets/audio/a.m4a" };
const bare = new Function("location",
  trailsToFile({ t: { name: "T", zones: [sparse] } }) + "; return trail;")(
  { search: "" });
check("a zone with no levers set does not gain empty ones",
  JSON.stringify(bare.zones[0]) === JSON.stringify(sparse),
  JSON.stringify(bare.zones[0]));

const twoTrails = trailsToFile({
  "one": { name: "One", zones: [sparse] },
  "two": { name: "Two", zones: [sparse] } });
for (const [search, expected] of [["", "One"], ["?trail=two", "Two"],
  ["?trail=nonsense", "One"], ["?lat=1&trail=two", "Two"]]) {
  const picked = new Function("location", twoTrails + "; return trail;")(
    { search });
  check("?trail picks the right one" + (search ? " (" + search + ")" : " (none)"),
    picked.name === expected, picked.name);
}

// =====================================================================
section("Knowing whether there is anything to save");
// The tool warns before you close a tab with unsaved work. It got this
// wrong by tracking a flag that anything editing the trail switched on:
// opening a question and confirming the same answer set it, and nothing
// could ever clear it, so it nagged about work that did not exist.
// It now asks the only question that matters — would saving write a
// different file?
// =====================================================================
{
  const shelf = () => {
    const kept = new Map();
    return { getItem: (k) => kept.has(k) ? kept.get(k) : null,
             setItem: (k, v) => kept.set(k, String(v)),
             removeItem: (k) => kept.delete(k) };
  };
  // Just enough of an element for curate.js to build its banner
  // against. Anything it reaches for and does not find would throw, so
  // this doubles as a check that the banner code stays simple.
  const nothing = () => ({ id: "", className: "", textContent: "",
    href: "", hidden: false, firstChild: null,
    appendChild() {}, remove() {}, setAttribute() {}, scrollIntoView() {},
    insertBefore() {}, addEventListener() {} });
  globalThis.localStorage = shelf();
  globalThis.sessionStorage = shelf();
  // The working copy lives in localStorage now, so it outlives
  // the tab and there is nothing to warn about on the way out.
  globalThis.window = { addEventListener() {}, localStorage: null };
  globalThis.document = { getElementById: () => null,
    // The strip is placed relative to the masthead now, so the pretend
    // browser has to be able to be asked for one.
    querySelector: () => null,
    createElement: nothing, body: nothing() };
  globalThis.window.localStorage = globalThis.localStorage;
  // curate.js checks where it is being served from as it loads, to warn
  // when the pages are local but saving is not.
  globalThis.location = { hostname: "ralph-hawkins.github.io",
    search: "", pathname: "/mixtape/trail.html", href: "" };

  const curateSource = readFileSync(new URL("curate.js", import.meta.url), "utf8");
  const Curate = new Function("trailsToFile", "trailProblems", "trailId",
    curateSource + "; return Curate;")(trailsToFile, trailProblems, trailId);

  const zone = { name: "West", lat: 51.4, lon: 0.01, radius: 40,
    audio: "assets/audio/a.m4a" };
  const loaded = { park: { name: "The Park", zones: [zone] } };
  localStorage.setItem("mixtape-working-copy-4", JSON.stringify(
    { baseSha: "abc", trails: JSON.parse(JSON.stringify(loaded)),
      original: JSON.parse(JSON.stringify(loaded)) }));

  check("straight after loading, there is nothing to save", !Curate.changed());

  Curate.update((t) => { t.park.name = "The Park"; });
  check("setting a name to the name it already had is not a change",
    !Curate.changed());

  // The zone editor refuses to write a lever that was not there when
  // the answer means the same as leaving it out — so opening a
  // question and confirming it unchanged really is no change. That
  // rule lives in zone-edit.html; this is the same rule, checked.
  const ABSENT_MEANS = { loop: false, exit: "stop", plays: "always",
    fadeIn: 0, fadeOut: 0 };
  const confirmUnchanged = (zone, setting, answer) => {
    if (zone[setting] === undefined && answer === ABSENT_MEANS[setting]) {
      return;
    }
    zone[setting] = answer;
  };
  Curate.update((t) => confirmUnchanged(t.park.zones[0], "fadeIn", 0));
  check("confirming a lever without touching it is not a change",
    !Curate.changed());
  Curate.update((t) => confirmUnchanged(t.park.zones[0], "exit", "stop"));
  check("nor is confirming another one", !Curate.changed());
  Curate.update((t) => confirmUnchanged(t.park.zones[0], "fadeIn", 4));
  check("but actually setting one is", Curate.changed());
  Curate.update((t) => { delete t.park.zones[0].fadeIn; });
  check("and taking it away again leaves nothing to save", !Curate.changed());

  Curate.update((t) => { t.park.name = "Somewhere else"; });
  check("a real change is a change", Curate.changed());

  Curate.update((t) => { t.park.name = "The Park"; });
  check("undoing it by hand leaves nothing to save", !Curate.changed());

  Curate.update((t) => { t.park.zones.push({ radius: 30 }); });
  check("adding a zone is a change", Curate.changed());
  Curate.update((t) => { t.park.zones.pop(); });
  check("adding a zone then removing it again leaves no trace",
    !Curate.changed());

  // The warning has to be able to say what it is talking about, and
  // has to be clearable — otherwise it is just nagging with no way out,
  // which is what it was before.
  Curate.update((t) => { t.park.name = "Renamed"; });
  check("it can say which trail changed",
    Curate.whatChanged().join(",") === "Renamed", Curate.whatChanged().join(","));
  Curate.update((t) => { t.other = { name: "Brand new", zones: [] }; });
  check("and notices a whole new trail",
    Curate.whatChanged().includes("Brand new (new)"),
    Curate.whatChanged().join(","));

  Curate.revert();
  check("discarding puts everything back", !Curate.changed());
  check("and nothing is left to describe", Curate.whatChanged().length === 0);
  check("the original trail is intact after discarding",
    Curate.trails().park.name === "The Park" && !Curate.trails().other,
    Curate.trails().park.name);

  Curate.discard();
  check("with nothing stored, there is nothing to save", !Curate.changed());

  // Saving from a local copy still writes to the live trail, so the
  // tool has to say so. Checked by counting what it puts on the page.
  let added = [];
  globalThis.document.body.insertBefore = (node) => added.push(node.id);

  const loadCurate = (hostname) => {
    globalThis.location = { hostname, search: "", pathname: "/curate.html" };
    globalThis.document.getElementById = () => null;
    globalThis.document.querySelector = () => null;
    added = [];
    new Function("trailsToFile", "trailProblems", "trailId",
      curateSource + "; return Curate;")(
      trailsToFile, trailProblems, trailId);
    return added;
  };
  check("served from the real site, it says nothing about being local",
    !loadCurate("ralph-hawkins.github.io").includes("localNotice"));
  check("served from localhost, it warns that saving is not local",
    loadCurate("localhost").includes("localNotice"));
  check("and the same from the numeric address",
    loadCurate("127.0.0.1").includes("localNotice"));
}

// =====================================================================
section("Saving twice in a row");
// The fault this was written for: after a save, the tool went and
// asked GitHub which version the file was now. That question can fail
// — it is swallowed silently — and when it did, the browser was left
// holding the version from BEFORE the save, with nothing marked
// unsaved. Nothing looked wrong. The next save was then refused as a
// clash with another curator who did not exist, and the only way out
// offered was to throw the work away.
//
// The service now hands back the version its write created, because
// GitHub told it outright. The rule underneath: never hold a version
// we cannot vouch for.
// =====================================================================
{
  const shelf = () => {
    const kept = new Map();
    return { getItem: (k) => kept.has(k) ? kept.get(k) : null,
             setItem: (k, v) => kept.set(k, String(v)),
             removeItem: (k) => kept.delete(k) };
  };
  // Just enough of an element for the unsaved-work strip to be built
  // against, the same as the block above.
  const nothing = () => ({ id: "", className: "", textContent: "",
    href: "", firstChild: null, appendChild() {}, remove() {},
    setAttribute() {}, insertBefore() {}, addEventListener() {} });
  globalThis.localStorage = shelf();
  globalThis.window = { addEventListener() {},
    localStorage: globalThis.localStorage };
  globalThis.document = { getElementById: () => null,
    querySelector: () => null,
    createElement: nothing, body: nothing() };
  globalThis.location = { hostname: "ralph-hawkins.github.io",
    search: "", pathname: "/mixtape/trail.html", href: "" };

  const curateSource = readFileSync(new URL("curate.js", import.meta.url), "utf8");
  const Curate = new Function("trailsToFile", "trailProblems", "trailId",
    curateSource + "; return Curate;")(trailsToFile, trailProblems, trailId);
  Curate.signIn("Jamie", "correct horse");

  // The tool and the save service wired together: curate.js's fetch
  // reaches worker.fetch, and the Worker's own fetch reaches the
  // pretend GitHub. A save is exercised the whole way down, which is
  // the only way this fault shows up — each half on its own is fine.
  pretendGitHub(["trail.js"]);
  const github = globalThis.fetch;
  const wire = (saveService) => {
    globalThis.fetch = async function (url, options = {}) {
      if (String(url).indexOf("api.github.com") !== -1) {
        return github(url, options);
      }
      return saveService(url, options);
    };
  };
  const realService = (url, options) => worker.fetch(
    new Request(String(url), options), env);

  const zone = { name: "West", lat: 51.4, lon: 0.01, radius: 40,
    audio: "assets/audio/a.m4a" };
  // Back to the beginning: a curator who has just opened the tool, and
  // a repository holding the version they were given. Both, or the
  // copy starts out stale and every check below is measuring the wrong
  // thing.
  const start = () => {
    versions.set("trail.js", "version-of-trail.js");
    const loaded = { park: { name: "The Park", zones: [zone] } };
    localStorage.setItem("mixtape-working-copy-4", JSON.stringify(
      { baseSha: "version-of-trail.js",
        trails: JSON.parse(JSON.stringify(loaded)),
        original: JSON.parse(JSON.stringify(loaded)) }));
  };
  const save = () => new Promise((done) => Curate.save(done));

  wire(realService);
  start();

  Curate.update((t) => { t.park.name = "Renamed once"; });
  let saved = await save();
  check("the first save goes in", saved.saved === true, saved.error);
  check("the copy moves on to the version that save created",
    Curate.working().baseSha === versions.get("trail.js"),
    Curate.working().baseSha);
  check("and there is nothing left to save", !Curate.changed());

  Curate.update((t) => { t.park.name = "Renamed twice"; });
  saved = await save();
  check("a second save, without reloading, goes in too",
    saved.saved === true, saved.error);
  check("nobody is blamed for a clash that did not happen",
    !saved.conflict);
  check("and the copy moves on again",
    Curate.working().baseSha === versions.get("trail.js"),
    Curate.working().baseSha);

  // The one that bites.
  //
  // Everything above passes with the old code too, because a pretend
  // GitHub always answers. The fault only appears when the version
  // check FAILS — and the check the tool makes is anonymous, which is
  // exactly the one GitHub rate limits: 60 an hour for every curator
  // sharing an address. The Worker's own calls carry a key and are
  // unaffected, so saving works while asking does not.
  //
  // Old behaviour here: the first save leaves the version from before
  // it, nothing looks wrong, and the second save is refused as a clash
  // with a curator who does not exist.
  start();
  wire(realService);
  const anonymous = globalThis.fetch;
  globalThis.fetch = async function (url, options = {}) {
    const asking = new Headers((options || {}).headers || {});
    if (String(url).indexOf("api.github.com") !== -1 &&
        !asking.get("Authorization")) {
      return new Response("rate limited", { status: 403 });
    }
    return anonymous(url, options);
  };

  Curate.update((t) => { t.park.name = "Once"; });
  saved = await save();
  check("with the version check rate limited, the save still goes in",
    saved.saved === true, saved.error);
  Curate.update((t) => { t.park.name = "Twice"; });
  saved = await save();
  check("and the save after it is not refused as somebody else's work",
    saved.saved === true && !saved.conflict, saved.error);

  // An older save service, still deployed, that does not say which
  // version it wrote. The tool falls back to asking — what it used to
  // do every time — so a page that goes live ahead of the service is
  // no worse off than it was.
  start();
  wire(async () => new Response(JSON.stringify({ ok: true, path: "trail.js" }),
    { status: 200 }));
  Curate.update((t) => { t.park.name = "Older service"; });
  await save();
  check("with a service too old to say, it falls back to asking",
    Curate.working().baseSha === versions.get("trail.js"),
    Curate.working().baseSha);

  // And when neither can say — an old service AND GitHub refusing to
  // answer — the copy is left holding no version at all rather than a
  // stale one. `start` throws a copy like that away and fetches the
  // trail again, which is the safe end: it has just been saved, so it
  // holds nothing the file does not.
  start();
  globalThis.fetch = async function (url, options = {}) {
    if (String(url).indexOf("api.github.com") !== -1) {
      return new Response("rate limited", { status: 403 });
    }
    return new Response(JSON.stringify({ ok: true, path: "trail.js" }),
      { status: 200 });
  };
  Curate.update((t) => { t.park.name = "Nobody can say"; });
  await save();
  check("a version it cannot vouch for is erased, not left looking current",
    !Curate.working().baseSha,
    JSON.stringify(Curate.working().baseSha));
}

// =====================================================================
section("Reading a position, however it is written");
// Nobody should have to know which sort of coordinate they are holding.
// Google Maps alone gives decimal degrees from a right-click, degrees
// and minutes on a place card, and something else again in the address
// bar.
// =====================================================================
{
  const near = (got, lat, lon) => !!got &&
    Math.abs(got.lat - lat) < 0.001 && Math.abs(got.lon - lon) < 0.001;
  const PARK = [51.46162, 0.010941];

  for (const [label, written] of [
    ["decimal with a comma",   "51.461620, 0.010941"],
    ["decimal with a space",   "51.461620 0.010941"],
    ["decimal, no space",      "51.46162,0.010941"],
    ["degree signs",           "51.46162\u00b0 N, 0.010941\u00b0 E"],
    ["letters, no degrees",    "51.46162N 0.010941E"],
    ["degrees minutes seconds","51\u00b027\'41.8\"N 0\u00b000\'39.4\"E"],
    ["curly quotes",           "51\u00b027\u203241.8\u2033N 0\u00b000\u203239.4\u2033E"],
    ["degrees and minutes",    "51\u00b027.697\'N 0\u00b00.656\'E"],
    ["a map link",             "https://www.google.com/maps/@51.46162,0.010941,17z"],
    ["a link with a dropped pin",
      "https://maps.google.com/x/@51.1,0.1,17z/data=!3d51.46162!4d0.010941"],
    ["the same, written backwards",
      "https://maps.google.com/x/@51.1,0.1,17z/data=!4d0.010941!3d51.46162"],
    ["messy whitespace",       "  51.461620 , 0.010941  "]]) {
    check(label, near(readPosition(written), PARK[0], PARK[1]),
      JSON.stringify(readPosition(written)));
  }

  check("south and west come out negative",
    near(readPosition("33\u00b051\'54\"S 151\u00b012\'36\"E"), -33.865, 151.21),
    JSON.stringify(readPosition("33\u00b051\'54\"S 151\u00b012\'36\"E")));
  check("minus signs work too",
    near(readPosition("-33.865, 151.209"), -33.865, 151.209));
  check("longitude written first is put the right way round",
    near(readPosition("0.010941E, 51.46162N"), PARK[0], PARK[1]),
    JSON.stringify(readPosition("0.010941E, 51.46162N")));

  // Refusing is the right answer for anything it cannot be sure of. A
  // misread number would put the zone somewhere real, just nowhere near
  // the right place — far worse than saying so.
  for (const [label, written] of [
    ["nothing", ""],
    ["only one number", "51.46162"],
    ["a place name", "Priory Park"],
    ["an impossible latitude", "191.5, 0.01"],
    ["an impossible longitude", "51.4, 999"],
    ["words", "north a bit"],
    ["null", null],
    ["undefined", undefined]]) {
    check("refuses " + label, readPosition(written) === null,
      JSON.stringify(readPosition(written)));
  }
}

// =====================================================================
section("Naming a trail, and knowing when one is not finished");
// =====================================================================
for (const [name, expected] of [
  ["Priory Park", "priory-park"],
  ["High Street!", "high-street"],
  ["  Spaces  Everywhere  ", "spaces-everywhere"],
  ["Caf\u00e9 corner", "caf-corner"],
  ["!!!", ""],
  ["", ""]]) {
  check(`"${name}" becomes "${expected}"`, trailId(name) === expected,
    trailId(name));
}
check("a very long name is cut short", trailId("x".repeat(200)).length <= 40);

const goodZone = { name: "West", lat: 51.4, lon: 0.01, radius: 40,
  audio: "assets/audio/a.m4a" };
check("a finished zone has nothing wrong with it",
  zoneProblems(goodZone).length === 0);
for (const [missing, expected] of [
  ["name", "name"], ["audio", "sound"], ["lat", "where"],
  ["lon", "where"], ["radius", "size"]]) {
  const broken = { ...goodZone };
  delete broken[missing];
  const found = zoneProblems(broken);
  check(`a zone with no ${missing} is caught, pointing at "${expected}"`,
    found.length === 1 && found[0].field === expected,
    found.map(f => f.field).join(","));
}
check("a zone whose position is a word, not a number, is caught",
  zoneProblems({ ...goodZone, lat: "north" }).length === 1);
check("a trail with no zones is caught",
  trailProblems({ t: { name: "Empty", zones: [] } }).length === 1);
check("a finished trail passes",
  trailProblems({ t: { name: "Fine", zones: [goodZone] } }).length === 0);

// A problem has to carry enough to link straight to the question at
// fault. A list of faults you then have to go and find is half a
// message.
{
  const found = trailProblems({ park: { name: "The Park",
    zones: [{ name: "West", lat: 51.4, lon: 0.01, radius: 40 }] } });
  check("a problem says which trail, which zone and which question",
    found.length === 1 && found[0].trail === "park" &&
    found[0].zone === 0 && found[0].field === "sound",
    JSON.stringify(found[0]));
}

// One fault, one wording. The questions and the validator used to
// describe a missing name two different ways depending on where you
// met it.
check("the same fault is worded the same everywhere",
  zoneProblems({}).find((p) => p.field === "name").says === ZONE_FAULTS.name);

for (const [name, original, expected] of [
  ["Jimmy on the market", "New Recording 3.m4a", "jimmy-on-the-market.m4a"],
  ["The bells", "bells.MP3", "the-bells.mp3"],
  ["  spaced   out  ", "a.wav", "spaced-out.wav"],
  ["Already-fine", "a.m4a", "already-fine.m4a"],
  ["!!!", "a.m4a", ""],
  ["", "a.m4a", ""],
  ["No file type", "nodot", ""],
  ["x".repeat(80), "a.m4a", "x".repeat(40) + ".m4a"]]) {
  check(`"${name.slice(0, 22)}" + ${original} becomes ` +
    (expected ? `"${expected.slice(0, 26)}"` : "refused"),
    soundFileName(name, original) === expected,
    soundFileName(name, original));
}
check("the file type is kept, not the name the phone chose",
  soundFileName("Jimmy", "New Recording 3.m4a").endsWith(".m4a"));

// =====================================================================
section("Every question writes to a setting that exists");
//
// The fault this is here for: the "How big is this zone?" question
// wrote to `size`, and a zone's setting is called `radius`. So the
// answer landed on a name nothing reads, was dropped on the way to the
// file, and the tool said "Saved" over a value it had not changed.
//
// Nothing complained, because the two lists were never compared. They
// are now.
// =====================================================================
const questions = Object.keys(QUESTION_SETS);
const settingsWritten = questions.reduce(function (all, question) {
  return all.concat(QUESTION_SETS[question]);
}, []);

questions.forEach(function (question) {
  QUESTION_SETS[question].forEach(function (setting) {
    check('"' + question + '" writes ' + setting + ', which is a real setting',
      ZONE_FIELDS.indexOf(setting) !== -1, setting);
  });
});

// The other way round, or a setting could quietly become unreachable —
// there with a default nobody can ever change.
ZONE_FIELDS.forEach(function (setting) {
  check(setting + " can be set by some question",
    settingsWritten.indexOf(setting) !== -1);
});

check("no two questions fight over the same setting",
  new Set(settingsWritten).size === settingsWritten.length);

// The four a zone cannot be saved without must all be askable, or a
// curator meets a fault they have no way to clear.
const mustHave = {};
zoneProblems({}).forEach(function (problem) { mustHave[problem.field] = true; });
Object.keys(mustHave).forEach(function (question) {
  check('"' + question + '" is refused when missing, so it must be askable',
    QUESTION_SETS[question] !== undefined);
});

// =====================================================================
console.log("\n" + (failures === 0
  ? "All tests passed."
  : failures + " test" + (failures === 1 ? "" : "s") + " FAILED."));
process.exit(failures === 0 ? 0 : 1);

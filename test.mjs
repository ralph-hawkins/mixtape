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
const { trailsToFile, ZONE_FIELDS, isUsableNumber, trailId,
        zoneProblems, trailProblems } = require("./trail-file.js");

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
// ---------------------------------------------------------------------
let writes = [];
function pretendGitHub(already = []) {
  const there = new Set(already);
  writes = [];
  globalThis.fetch = async function (url, options = {}) {
    const path = decodeURIComponent(
      String(url).split("/contents/")[1].split("?")[0]);
    if ((options.method || "GET") === "GET") {
      return new Response(JSON.stringify({ sha: "version-of-" + path }),
        { status: there.has(path) ? 200 : 404 });
    }
    const sent = JSON.parse(options.body);
    writes.push({ path, sent });
    // The real GitHub refuses a write that claims to replace a version
    // that is no longer the current one.
    if (sent.sha && sent.sha !== "version-of-" + path) {
      return new Response(JSON.stringify({ message: "sha did not match" }),
        { status: 409 });
    }
    return new Response("{}", { status: sent.sha ? 200 : 201 });
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
  const nothing = () => ({ id: "", className: "", textContent: "",
    hidden: false, firstChild: null, appendChild() {}, remove() {},
    setAttribute() {}, scrollIntoView() {}, insertBefore() {} });
  globalThis.localStorage = shelf();
  globalThis.sessionStorage = shelf();
  globalThis.document = { getElementById: () => null,
    createElement: nothing, body: nothing() };
  globalThis.window = { addEventListener() {} };

  const curateSource = readFileSync(new URL("curate.js", import.meta.url), "utf8");
  const Curate = new Function("trailsToFile", "trailProblems", "trailId",
    curateSource + "; return Curate;")(trailsToFile, trailProblems, trailId);

  const zone = { name: "West", lat: 51.4, lon: 0.01, radius: 40,
    audio: "assets/audio/a.m4a" };
  const loaded = { park: { name: "The Park", zones: [zone] } };
  const asLoaded = trailsToFile(loaded);
  sessionStorage.setItem("mixtape-working-copy-2", JSON.stringify(
    { baseSha: "abc", trails: JSON.parse(JSON.stringify(loaded)), asLoaded }));

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

  Curate.discard();
  check("with nothing stored, there is nothing to save", !Curate.changed());
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

// =====================================================================
console.log("\n" + (failures === 0
  ? "All tests passed."
  : failures + " test" + (failures === 1 ? "" : "s") + " FAILED."));
process.exit(failures === 0 ? 0 : 1);

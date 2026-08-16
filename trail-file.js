// =====================================================================
// Reading and writing trail.js.
//
// Nothing in here touches the page, on purpose. It is the one part of
// the curator tool that can quietly destroy a curator's work — drop a
// setting here and saving the trail would silently delete part of it —
// so it is kept separate and tested directly by test.mjs.
// =====================================================================

// The only settings a zone is allowed to have.
//
// Everything written back to trail.js is copied from this list, in this
// order, and never from the zone object itself. Zones collect working
// parts as the tool is used — map circles, audio players, table cells —
// and writing one of those into the trail file would ruin it. Copying
// only what is named here makes that impossible.
const ZONE_FIELDS = ["name", "lat", "lon", "radius", "audio",
  "loop", "exit", "plays", "fadeIn", "fadeOut"];

const FILE_HEADER =
  "// =================================================================\n" +
  "// The trail definition.\n" +
  "//\n" +
  "// Written by the curator tool:\n" +
  "//   https://ralph-hawkins.github.io/mixtape/curate.html\n" +
  "//\n" +
  "// It can still be edited by hand, but the tool rewrites the whole\n" +
  "// file whenever anyone saves, so comments added here will not\n" +
  "// survive.\n" +
  "// =================================================================\n" +
  "\nconst trails = ";

const FILE_FOOTER =
  ";\n\n" +
  "// Which trail this page is playing. Add ?trail=<name> to the web\n" +
  "// address to choose one; without that, the first in the file.\n" +
  "const trail = trails[new URLSearchParams(location.search).get(\"trail\")]\n" +
  "           || trails[Object.keys(trails)[0]];\n";

// Copy out just a zone's settings, leaving everything else behind.
function zoneToPlain(zone) {
  const plain = {};
  ZONE_FIELDS.forEach(function (setting) {
    if (zone[setting] !== undefined) { plain[setting] = zone[setting]; }
  });
  return plain;
}

function trailsToFile(all) {
  const tidy = {};
  Object.keys(all).forEach(function (id) {
    tidy[id] = {
      name: all[id].name,
      zones: (all[id].zones || []).map(zoneToPlain)
    };
  });
  return FILE_HEADER + JSON.stringify(tidy, null, 2) + FILE_FOOTER;
}

// The same test the walker's page applies when it loads a trail.
function isUsableNumber(value) {
  return value !== null && value !== "" &&
         Number.isFinite(Number(value));
}

// Turn a name into something safe to put in a web address.
function trailId(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// What is wrong with one zone, in plain words. An empty list means it
// is fine.
//
// This is the check that stops the tool writing a trail the walker's
// page could not read. Better caught here, where somebody can fix it,
// than in a park.
function zoneProblems(zone) {
  const problems = [];
  if (!zone.name || !String(zone.name).trim()) {
    problems.push({ field: "name", says: "Give this zone a name" });
  }
  if (!zone.audio) {
    problems.push({ field: "sound", says: "Choose a sound for this zone" });
  }
  if (!isUsableNumber(zone.lat) || !isUsableNumber(zone.lon)) {
    problems.push({ field: "where", says: "Say where this zone is" });
  }
  if (!isUsableNumber(zone.radius)) {
    problems.push({ field: "size", says: "Say how big this zone is" });
  }
  return problems;
}

// What is wrong with the whole set of trails, ready to list at the top
// of a page the way an error summary does.
function trailProblems(all) {
  const problems = [];
  Object.keys(all).forEach(function (id) {
    const one = all[id];
    const zones = one.zones || [];
    if (!one.name || !String(one.name).trim()) {
      problems.push({ trail: id, says: "One of the trails has no name" });
    }
    if (zones.length === 0) {
      problems.push({ trail: id,
        says: one.name + " has no zones yet — add at least one" });
    }
    zones.forEach(function (zone, index) {
      zoneProblems(zone).forEach(function (problem) {
        problems.push({
          trail: id, zone: index,
          says: (zone.name || "Zone " + (index + 1)) + " in " + one.name +
                ": " + problem.says.toLowerCase()
        });
      });
    });
  });
  return problems;
}

// Available to the pages as plain globals, and read straight off the
// file by test.mjs. Deliberately not a module: the pages load it with
// an ordinary script tag, exactly as they load trail.js.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ZONE_FIELDS, trailsToFile, zoneToPlain,
    isUsableNumber, trailId, zoneProblems, trailProblems };
}

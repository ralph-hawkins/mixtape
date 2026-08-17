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

// Which settings each of the tool's questions writes to.
//
// Most questions are named after their setting, but not all: "size"
// writes `radius`, "sound" writes `audio`, and "where" writes both
// halves of a position at once.
//
// This lives here, next to the list above it has to agree with, rather
// than in the page that uses it — because getting it wrong is silent.
// A question that writes to a name nothing reads loses the curator's
// answer on the way to the file, leaves the old value in place, and
// still lets the tool say "Saved". That is exactly what "size" did.
// test.mjs now checks the two lists against each other.
const QUESTION_SETS = {
  name: ["name"],
  sound: ["audio"],
  where: ["lat", "lon"],
  size: ["radius"],
  loop: ["loop"],
  exit: ["exit"],
  plays: ["plays"],
  fadeIn: ["fadeIn"],
  fadeOut: ["fadeOut"]
};

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

// Make sense of a position, however it arrives.
//
// Nobody should have to know which of these they have. Google Maps
// gives you decimal degrees from a right-click, but degrees, minutes
// and seconds on a place card, and something else again in the address
// bar. Other maps differ again. All of these mean the same place:
//
//   51.461620, 0.010941
//   51.461620 0.010941
//   51.4616° N, 0.0109° E
//   51°27'41.8"N 0°00'39.4"E
//   51°27.697'N 0°0.656'E
//   https://www.google.com/maps/@51.46162,0.010941,17z
//
// Returns { lat, lon }, or null if it cannot be read.
function readPosition(text) {
  let s = String(text === undefined || text === null ? "" : text)
    // Phones and web pages love a curly quote. Flatten them all first,
    // or a perfectly good position fails for invisible reasons.
    .replace(/[′’ʹ´`]/g, "'")
    .replace(/[″”“ʺ]/g, '"')
    .replace(/[º˚]/g, "°")
    .replace(/−/g, "-")
    .trim();
  if (!s) { return null; }

  // A map link. The !3d/!4d pair is the pin someone actually dropped;
  // the @ pair is only where the map happened to be centred, so it is
  // the second choice.
  // Looked for one at a time, not as a pair, because they do not
  // always appear in that order — and a link whose pin was missed
  // would quietly fall back to the map centre, which looks like a
  // perfectly good position and is the wrong place.
  const pinLat = s.match(/!3d(-?\d+(?:\.\d+)?)/);
  const pinLon = s.match(/!4d(-?\d+(?:\.\d+)?)/);
  if (pinLat && pinLon) {
    return asPosition(Number(pinLat[1]), Number(pinLon[1]));
  }
  const centred = s.match(/[@=](-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (centred) {
    return asPosition(Number(centred[1]), Number(centred[2]));
  }

  const found = [];
  if (/[°'"]/.test(s)) {
    // Degrees, minutes and seconds — in any of its half-finished
    // forms, since minutes and seconds are both optional.
    const parts = /(-?\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*'\s*)?(?:(\d+(?:\.\d+)?)\s*"\s*)?\s*([NSEW])?/gi;
    let piece;
    while ((piece = parts.exec(s)) !== null) {
      if (!piece[0].trim()) { break; }
      const degrees = Number(piece[1]);
      let value = Math.abs(degrees) + Number(piece[2] || 0) / 60 +
                  Number(piece[3] || 0) / 3600;
      if (degrees < 0) { value = -value; }
      found.push({ value: value, side: (piece[4] || "").toUpperCase() });
    }
  } else {
    // Plain numbers. Only treated as degrees, minutes and seconds when
    // the symbols are actually there — otherwise "51.4616 0.0109"
    // would read the longitude as minutes of latitude.
    const parts = /(-?\d+(?:\.\d+)?)\s*([NSEW])?/gi;
    let piece;
    while ((piece = parts.exec(s)) !== null) {
      if (!piece[0].trim()) { break; }
      found.push({ value: Number(piece[1]),
                   side: (piece[2] || "").toUpperCase() });
    }
  }
  if (found.length < 2) { return null; }

  let first = found[0];
  let second = found[1];
  // Some places write longitude first. If the letters say so, believe
  // them rather than the order.
  if ((first.side === "E" || first.side === "W") &&
      (second.side === "N" || second.side === "S")) {
    const swap = first; first = second; second = swap;
  }
  const lat = (first.side === "S") ? -Math.abs(first.value) : first.value;
  const lon = (second.side === "W") ? -Math.abs(second.value) : second.value;
  return asPosition(lat, lon);
}

// Only hand back a position that could exist on Earth. A misread
// number is worse than an honest refusal — it would put a zone
// somewhere real, just nowhere near the right place.
function asPosition(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) { return null; }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { return null; }
  // Six decimal places is about 10 centimetres, which is far finer than
  // any phone can tell. Converting from degrees and seconds otherwise
  // lands sixteen digits in the trail file, claiming a precision that
  // does not exist and making it horrible to read.
  return { lat: toSixPlaces(lat), lon: toSixPlaces(lon) };
}

function toSixPlaces(n) {
  return Math.round(n * 1e6) / 1e6;
}

// Turn a name into something safe to put in a web address.
function trailId(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Turn what a curator calls a sound into a filename, keeping the file
// type from whatever they picked.
//
// Without this, a recording made on a phone is called "New Recording
// 3.m4a" for the rest of its life, and the list of sounds tells nobody
// anything. Uses the same tidying as trail names, so both behave the
// same way.
function soundFileName(name, original) {
  const dot = String(original || "").lastIndexOf(".");
  const extension = dot > 0
    ? String(original).slice(dot + 1).replace(/[^A-Za-z0-9]/g, "") : "";
  const stem = trailId(name);
  if (!stem || !extension) { return ""; }
  return stem + "." + extension.toLowerCase();
}

// What is wrong with one zone, in plain words. An empty list means it
// is fine.
//
// This is the check that stops the tool writing a trail the walker's
// page could not read. Better caught here, where somebody can fix it,
// than in a park.
//
// These are also the words the questions themselves use when an answer
// is missing, so the same fault is never described two different ways
// depending on where you meet it.
const ZONE_FAULTS = {
  name: "Enter a name for this zone",
  sound: "Choose a sound for this zone",
  where: "Enter where this zone is",
  size: "Enter how big this zone is"
};

function zoneProblems(zone) {
  const problems = [];
  if (!zone.name || !String(zone.name).trim()) {
    problems.push({ field: "name", says: ZONE_FAULTS.name });
  }
  if (!zone.audio) {
    problems.push({ field: "sound", says: ZONE_FAULTS.sound });
  }
  if (!isUsableNumber(zone.lat) || !isUsableNumber(zone.lon)) {
    problems.push({ field: "where", says: ZONE_FAULTS.where });
  }
  if (!isUsableNumber(zone.radius)) {
    problems.push({ field: "size", says: ZONE_FAULTS.size });
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
          // The field travels with it so the page can offer a link
          // straight to the question, rather than leaving somebody to
          // hunt through eight zones for the one that is wrong.
          trail: id, zone: index, field: problem.field,
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
  module.exports = { ZONE_FIELDS, QUESTION_SETS, trailsToFile, zoneToPlain,
    isUsableNumber, trailId, zoneProblems, trailProblems,
    readPosition, soundFileName, ZONE_FAULTS };
}

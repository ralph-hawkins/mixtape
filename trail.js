// =================================================================
// The trail definition.
//
// Written by the curator tool:
//   https://ralph-hawkins.github.io/mixtape/curate.html
//
// It can still be edited by hand, but the tool rewrites the whole
// file whenever anyone saves, so comments added here will not
// survive.
// =================================================================

const trails = {
  "test-trail": {
    "name": "Test trail",
    "zones": [
      {
        "name": "Priory park - west",
        "lat": 51.46162,
        "lon": 0.010941,
        "radius": 40,
        "audio": "assets/audio/test-001.m4a",
        "loop": false,
        "exit": "stop",
        "plays": "always",
        "fadeIn": 5,
        "fadeOut": 5
      },
      {
        "name": "Priory Park (Stop D)",
        "lat": 51.461737,
        "lon": 0.009928,
        "radius": 20,
        "audio": "assets/audio/test-002.m4a",
        "loop": false,
        "exit": "stop",
        "plays": "always",
        "fadeIn": 0,
        "fadeOut": 10
      },
      {
        "name": "Priory Park - east",
        "lat": 51.46182,
        "lon": 0.012042,
        "radius": 50,
        "audio": "assets/audio/test-005.m4a",
        "loop": true,
        "exit": "finish",
        "plays": 2,
        "fadeIn": 10,
        "fadeOut": 0
      },
      {
        "name": "Foo",
        "lat": 51.461151,
        "lon": 0.009809,
        "radius": 30,
        "audio": "assets/audio/test-004-2.m4a"
      },
      {
        "name": "South St",
        "lat": 51.215153,
        "lon": 0.796845,
        "radius": 30,
        "audio": "assets/audio/golden-synth-drone.mp3"
      }
    ]
  },
  "second-trail-2": {
    "name": "Second trail",
    "zones": [
      {
        "name": "friend zone",
        "lat": 51.476306,
        "lon": -0.022861,
        "radius": 300,
        "audio": "assets/audio/test-003-foo.m4a"
      }
    ]
  },
  "my-bones-my-flute": {
    "name": "My bones, my flute",
    "zones": [
      {
        "name": "South St",
        "lat": 51.21507,
        "lon": -0.796782,
        "radius": 30,
        "audio": "assets/audio/golden-synth-drone.mp3",
        "exit": "finish"
      },
      {
        "name": "The Borough",
        "lat": 51.21526,
        "lon": -0.79844,
        "radius": 40,
        "audio": "assets/audio/edgar-interview.mp3",
        "loop": true,
        "exit": "finish"
      },
      {
        "name": "West St",
        "lat": 51.214406,
        "lon": -0.800768,
        "radius": 30,
        "audio": "assets/audio/flute-1-jam-01.mp3"
      },
      {
        "name": "Arndell Place",
        "lat": 51.213981,
        "lon": -0.80231,
        "radius": 50,
        "audio": "assets/audio/juanita-finds-mittelholzer-01.mp3"
      },
      {
        "name": "Farnham Library",
        "lat": 51.213433,
        "lon": -0.80308,
        "radius": 30,
        "audio": "assets/audio/set-up-of-haunted-flute-01.mp3"
      },
      {
        "name": "Library gardens",
        "lat": 51.212783,
        "lon": -0.802734,
        "radius": 30,
        "audio": "assets/audio/flute-3-jam-01.mp3"
      }
    ]
  }
};

// Which trail this page is playing. Add ?trail=<name> to the web
// address to choose one; without that, the first in the file.
const trail = trails[new URLSearchParams(location.search).get("trail")]
           || trails[Object.keys(trails)[0]];

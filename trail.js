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
      }
    ]
  }
};

// Which trail this page is playing. Add ?trail=<name> to the web
// address to choose one; without that, the first in the file.
const trail = trails[new URLSearchParams(location.search).get("trail")]
           || trails[Object.keys(trails)[0]];

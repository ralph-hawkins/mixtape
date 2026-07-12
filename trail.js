// =====================================================================
// Trail editor
//
// To get coordinates for a spot – stand there with the diagnostic page
// running and copy the Position numbers – the first is lat, the
// second is lon. (Or right-click the spot in Google Maps.)
//
// To add a zone: copy an existing block, from its opening { to its
// closing }, paste it below the last one, and change the values.
// Every zone needs a comma after its closing } — except the last.
// =====================================================================

const trail = {

  // A name for the whole trail.
  name: "Test trail",

  // The zones. Each { } block is one zone.
  zones: [

    {
      name: "Priory park - west",
      lat: 51.461620,
      lon: 0.010941,
      radius: 40,
      audio: "assets/audio/test-001.m4a"
    },

    {
      name: "Priory Park (Stop D)",
      lat: 51.461737,
      lon: 0.009928,
      radius: 25,
      audio: "assets/audio/test-002.m4a"
    },

    {
      name: "Priory Park - east",
      lat: 51.461820,
      lon: 0.012042,
      radius: 10,
      audio: "assets/audio/test-003.m4a"
    }

  ]
};

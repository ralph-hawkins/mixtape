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
      // A name for the zone. Only people reading this file see it.
      name: "Trafalgar Square",

      // Where the zone is centred.
      lat: 51.50772,
      lon: -0.12794,

      // How close you must be, in metres, before the track plays.
      radius: 25,

      // The recording that plays there.
      audio: "assets/audio/test-001.m4a"
    },

    {
      name: "St Martin-in-the-Fields",
      lat: 51.50888,
      lon: -0.12662,
      radius: 25,
      audio: "assets/audio/test-002.m4a"
    }

  ]
};

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
      audio: "assets/audio/test-001.m4a",

      // loop: should the track repeat for as long as someone stands
      // in the zone? true = repeat, false = play once then go quiet.
      loop: false,

      // exit: what happens if they walk out mid-sound.
      //   "stop"   = go quiet straight away
      //   "finish" = let the current play-through end naturally
      // Note the quote marks — both values need them.
      exit: "stop",

      // plays: how many times the track may start from the top.
      //   "always" = starts again on every return, no limit
      //   1        = plays once, ever
      //   3        = up to three plays, then the zone stays quiet
      // Returning mid-track doesn't use up a play — only a start
      // from the beginning counts.
      plays: "always",

      // fadeIn: seconds for the sound to rise from silent to full
      // when it starts. 0 = starts at full volume straight away.
      fadeIn: 5,

      // fadeOut: seconds for the sound to sink to silence after
      // walking out of a "stop" zone. 0 = cuts off straight away.
      // "finish" zones ignore this — they end naturally instead.
      fadeOut: 5
    },

    {
      name: "Priory Park (Stop D)",
      lat: 51.461737,
      lon: 0.009928,
      radius: 20,
      audio: "assets/audio/test-002.m4a",
      loop: false,
      exit: "stop",
      plays: "always",
      fadeIn: 0,
      fadeOut: 10
    },

    {
      name: "Priory Park - east",
      lat: 51.461820,
      lon: 0.012042,
      radius: 50,
      audio: "assets/audio/test-005.m4a",
      loop: true,
      exit: "finish",
      plays: 2,
      fadeIn: 10,
      fadeOut: 0
    }

  ]
};

# Mixtape

A walking trail of sound. You open a web page on your phone, tap
Start, and as you walk, audio plays in the right places. There is
no app to install — it works in Safari and Chrome.

This guide explains what the app does and how to change the trail
yourself. You do not need any tools installed. You edit one file on
this website (github.com) and the live trail updates about a minute
later.

## What the app does

The trail is a set of **zones**. A zone is three things:

- a spot on the map
- a radius in metres around it
- an audio track

Walk into a zone and its track plays. What happens while you stand
there, and when you walk out, is up to the zone's settings — see
the table below.

The page shows a map of the trail. Each zone is a circle:

- **blue** — quiet
- **green** — playing
- **grey** — finished (it has used up its plays)
- **orange, with a dashed edge** — broken: its track will not load,
  so this zone will stay silent until it is fixed

Grey and orange are worth telling apart. Grey is a zone that has
done its job. Orange is a zone that never could.

The red dot is you. The faint red ring around it is how sure the
phone is about where you are — everything inside the ring is
"maybe here". GPS is honest but wobbly.

Below the map are diagnostic read-outs, a table showing every
zone's state, and a log that records everything that happens,
newest first. When something sounds wrong, the log usually knows
why.

## The trail is one file

Everything about the trail lives in [`trail.js`](trail.js). Each
zone is a block like this:

```js
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
```

What each setting means:

| Setting   | What it does |
|-----------|--------------|
| `name`    | The label on the map and in the log. |
| `lat`, `lon` | Where the zone is. Right-click a spot in Google Maps to copy these, or stand there and read them off the app's Position line. |
| `radius`  | Size of the zone in metres. |
| `audio`   | The track to play. The file lives in the `assets/audio` folder. |
| `loop`    | `true` — the track repeats while someone stands in the zone. `false` — it plays once then goes quiet. |
| `exit`    | What happens when someone walks out mid-sound. `"stop"` — quiet straight away. `"finish"` — the current play-through ends naturally. |
| `plays`   | How many times the track may start from the top. "always" — no limit. A number — that many plays, then the zone stays quiet and its circle turns grey. Walking back in mid-track never uses up a play. |
| `fadeIn`  | Seconds for the sound to rise from silence when it starts. 0 — starts at full volume. |
| `fadeOut` | Seconds for the sound to die away after leaving a "stop" zone. 0 — cuts off at once. "finish" zones ignore this. |

## How to make a change

1. Open [`trail.js`](trail.js) and click the pencil icon (top
   right of the file) to edit it.
2. Change a value — a radius, a fade, a track.
3. Scroll down and select **Commit changes**. A short note about
   what you changed is helpful but not required.
4. Wait about a minute while the site republishes.
5. Refresh the page on your phone. Check the **Page published**
   time near the top — if it is from before your change, refresh
   again.
6. Tap Start and listen.

That is the whole loop: edit, wait a minute, refresh, hear the
difference.

## Adding a new zone

Copy an existing zone — from its opening `{` to its closing `}` —
paste it below the last one, and change the values. Every zone
needs a comma after its closing `}` except the last one.

To add a new audio track: open the `assets/audio` folder, select
**Add file → Upload files**, and upload it. Voice memos (`.m4a`)
work well. Then point a zone's `audio` setting at it.

Please do not upload commercial music — the repository is public.

## When something goes wrong

The page tells you in one of two ways.

A mistake that stops the whole trail **replaces the map with a
message**. Nothing runs until it is fixed.

A mistake affecting one zone **adds a line to the log** at the
bottom of the page, newest first. The rest of the trail carries on.

### Messages that replace the map

**"trail.js failed to load — check the file for typos"**

Something in the file is not valid. Nearly always a missing comma,
quote mark or curly bracket. Check your last edit. Remember every
zone needs a comma after its closing `}` except the last one.

**"trail.js has no zones — a trail needs at least one"**

The list of zones is empty — usually the last zone was deleted by
accident.

**"Priory Park - east — its lat is missing or is not a number"**

That zone has no `lat`, `lon` or `radius`, or has something that is
not a number where one should be. The message names the zone and
the setting. A zone with no `name` is called by its place in the
file, so "zone 2" is the second one down.

### Lines in the log

**"track will not load"**

The `audio` setting points at a file that is not there. Check the
spelling, including capital letters, and check the file really was
uploaded to `assets/audio`. This one appears as soon as you open the
page — you do not need to tap Start or walk anywhere to see it.

The zone's circle turns orange and dashed, and its row in the Zones
table says "track will not load". Walking in does nothing and does
not use up one of the zone's plays.

**"play failed" or "could not be unlocked"**

The track exists but the phone would not play it. Usually a weak
signal: the file had not finished downloading by the time you
walked in. Try again on a better connection.

If a zone stays silent and the log says nothing at all, the zone was
probably never entered. Check the distance in the Zones table
against the zone's radius.

## Things worth knowing

- Values like `"stop"`, `"finish"` and `"always"` need their quote
  marks. Numbers and `true`/`false` do not.
- GPS is accurate to roughly 5–20 metres and wobbles at zone
  boundaries. Keep radii generous — 20 metres is about as small
  as is reliable. Fades make the wobble much less noticeable.
- The audio only starts after the Start tap. That is a phone
  browser rule, not a choice — sound must begin with a touch.
- [`map.html`](map.html) shows the trail on a map without starting
  any audio — useful for a quick look at where the zones are.
- Play counts reset when the page is refreshed. "Plays once, ever,
  across days" is not a thing the app does yet.

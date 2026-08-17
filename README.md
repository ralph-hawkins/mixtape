# Mixtape

A walking trail of sound. You open a web page on your phone, tap Start,
and as you walk, audio plays in the right places. There is no app to
install — it works in Safari and Chrome.

A static site: no build step, no database. The only moving part is a
small save service, so that people who curate walks never have to touch
this repository.

## The addresses

| To | Go to |
|---|---|
| Choose a walk | `https://ralph-hawkins.github.io/mixtape/` |
| Open one walk straight away | `https://ralph-hawkins.github.io/mixtape/index.html?trail=<name>` |
| Build a walk | `https://ralph-hawkins.github.io/mixtape/curate.html` |
| See a walk on a map, no audio | `https://ralph-hawkins.github.io/mixtape/map.html?trail=<name>` |

Without a `?trail=` the walker's page hands over to the chooser rather
than guessing which walk was meant.

## If you are here to curate a walk

**Use the tool, not this repository.** Everything a curator needs —
adding sounds, placing zones, changing settings, publishing — is at
`curate.html`, on a phone, with a password and no GitHub account.

Do not edit `trail.js` by hand and do not upload audio through
github.com. Earlier versions of this file explained how to do both.
That route is a dead end for a curator: GitHub does not offer uploads
to people who are not collaborators, a curator hit exactly that wall,
and there is no way round it from inside GitHub. The tool exists so
that wall is never met.

`trail.js` is now written by the tool. Anything you hand-edit there,
including comments, is overwritten the next time anybody saves.

## How a walk works

A walk is a set of **zones**. A zone is a spot, a radius in metres, and
a sound. Walk into it and the sound plays. Zones may overlap, and two
sounds playing at once is a thing you can do on purpose.

Each zone has five settings beyond its place, size and sound:

| Setting | What it does |
|---|---|
| `loop` | `true` — repeats while somebody stands in the zone. `false` — plays once, then quiet. |
| `exit` | What happens when they walk out mid-sound. `"stop"` — quiet at once. `"finish"` — the current play-through ends naturally. |
| `plays` | How many times the sound may start from the top. `"always"` — no limit. A number — that many, then the zone stays quiet and its circle turns grey. Rejoining part way through never uses one up. |
| `fadeIn` | Seconds to rise from silence. `0` — starts at full volume. |
| `fadeOut` | Seconds to die away after leaving a `"stop"` zone. `0` — cuts off at once. `"finish"` zones ignore it. |

Fades are worth using. GPS wobbles at the edge of a zone, and a hard cut
makes that wobble audible.

### What the walker sees

The map draws a circle per zone, and a dot for the walker with a faint
ring showing how sure the phone is. The circles change colour:

- **blue** — quiet
- **green** — playing
- **grey** — finished; it has used up its plays
- **orange, dashed** — its sound will not load, so it will stay silent

Grey and orange are worth telling apart. Grey is a zone that has done
its job. Orange is one that never could.

Below the map are read-outs, a table of every zone's state, and a log of
everything that happened, newest first. When a walk does not sound
right, the log usually knows why.

## When something goes wrong

A fault that stops the whole walk **replaces the map with a message**:

- **"trail.js failed to load — check the file for typos"** — the file is
  not valid JavaScript.
- **"trail.js has no zones — a trail needs at least one"** — the list is
  empty.
- **"Cattle Market — its lat is missing or is not a number"** — that
  zone has no `lat`, `lon` or `radius`, or has something that is not a
  number. The message names the zone and the setting.

A fault affecting one zone **adds a line to the log**, and the rest of
the walk carries on:

- **"track will not load"** — the `audio` setting points at a file that
  is not there. Appears as the page opens, before anybody walks
  anywhere.
- **"play failed"** or **"could not be unlocked"** — the file exists but
  the phone would not play it. Usually a weak signal.
- **"position failed: …"** — the phone would not say where it is. The
  message names which of the three reasons it was.

If a zone stays silent and the log says nothing about it, it was never
entered. Compare the distance in the zone table against its radius.

## The files

| File | What it is |
|---|---|
| `index.html` | The walker's page: map, read-outs, log, and the playback engine. |
| `walks.html` | The chooser. Reads the same trail file and lists every walk that can be heard. |
| `map.html` | The trail on a map with no audio and no Start. |
| `trail.js` | Every walk and every zone. Written by the tool. |
| `curate.html` … `zone-edit.html` | The curator tool: sign in, trails, trail, zone, zone setting, add a sound. One question per page. |
| `curate.js` | The bits every tool page needs — the working copy, saving, the unsaved-changes strip. |
| `trail-file.js` | Reading and writing `trail.js`, and deciding whether a walk is fit to save. Shared by the tool, the chooser and the tests. |
| `worker.js` | The save service. |
| `test.mjs` | The tests. |
| `layers.html` | A test rig for layered songs. Not part of the walk. |

`index.html` and `map.html` load Leaflet from unpkg. Everything else has
no dependencies.

## Running it locally

Serve the folder over HTTP — opening the files directly will not work,
because the pages load `trail.js` with a script tag.

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Geolocation needs either
`localhost` or https, which is why the live site is on GitHub Pages.

The curator tool notices it is running locally and says so: the trail it
shows is the file on your machine, but saving writes to the live
repository. Run `git pull` first, or you will save an old trail over a
newer one.

## Tests

```
node test.mjs
```

Nothing to install, no build step, and a pretend GitHub instead of the
real one. It covers `worker.js`, `curate.js` and `trail-file.js` — the
parts that can fail silently and do not show on the page.

Run it after any change to those files, or to how the trail is written.

Every check was confirmed to bite by breaking the thing it guards and
watching it fail. Keep that habit: a test that cannot fail is worse than
no test, because it reads like reassurance.

## The save service

`worker.js` is a Cloudflare Worker holding a GitHub token. It is the
only thing that can write to this repository, and it is what lets a
curator publish without an account.

Deploy it from this folder:

```
npx wrangler deploy
```

Not the dashboard editor. Pasting by hand lets the running service drift
out of step with `worker.js` while nothing says so.

Its secrets live in Cloudflare, not in `wrangler.toml`, and survive
every deploy.

**The GitHub token expires on 16 November 2026.** Saving stops working
that day. `KEY_EXPIRES` in `worker.js` carries the date, and from
21 days out every successful save warns the curator. Renewing the token
means changing that date and deploying again, or the warning lies.

### Rules that must not be weakened

All enforced in the Worker, never in the browser:

- **Path allowlist** — `assets/audio/*` and `trail.js`, nothing else.
  Without it the curator password could write `.github/workflows/`,
  which is code execution in the repository owner's account. This is the
  most important line in the project.
- **Audio file extensions only** — an uploaded `.html` would be a page
  hosted on this domain.
- Filenames stripped of any path, and a 15 MB ceiling.

Preview URLs are off on purpose. They would give every past version of
the Worker a permanent public address with the same keys.

## Things worth knowing

- GPS is accurate to roughly 5–20 metres and wobbles at zone boundaries.
  Twenty metres is about as small as a radius can usefully be.
- Audio can only start after a tap. That is a phone browser rule, not a
  choice, which is why every walk starts with a Start button.
- iPhones ignore volume set directly on an audio element, so fades go
  through the Web Audio API. If that is missing, a zone plays at full
  volume with hard cuts and the log names it — degraded, never silent
  without a suspect.
- Play counts live in the page. A refresh resets them. "Once ever,
  across days" would need storage on the device and is not built.
- Do not commit commercial music. This repository is public.

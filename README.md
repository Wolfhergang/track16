# STEP16 — mobile-first MIDI step sequencer PWA

React + Next.js (App Router, static export). Up to 5 tracks (4 by default) × 16 steps, 1–10 memory slots **per track** with a song
mode that cycles them, chords per step, Web MIDI
out/in, offline-capable, installable. Note input comes from an external MIDI controller — there
is no on-screen keyboard.

## Run

```bash
npm install
npm run dev       # http://localhost:3000 (also served on your LAN IP)
npm run build     # next build (static export) -> out/ , then bakes sw.js
npm run start     # serve the production build from out/
```

Deploy `out/` to any static host. On Vercel there is nothing to configure: it detects Next.js,
runs `npm run build` and serves `out/`.

### Vercel

```bash
git init && git add -A && git commit -m "init"   # if not already a repo
npx vercel        # preview deploy
npx vercel --prod # production
```

`vercel.json` only sets headers: `sw.js` and the manifest are served
`max-age=0, must-revalidate` so worker updates are never answered from the HTTP cache.

**Secure context matters:** Web MIDI, service workers and install prompts require HTTPS or
`localhost`. Testing on a phone over a plain LAN IP gives you the app and the audio preview,
but no MIDI and no install. Use an HTTPS tunnel (e.g. `npx localtunnel --port 3000`) or deploy.

## Layout

| Zone | What it does |
| --- | --- |
| Top bar | Play/Stop, Record arm, **SONG** mode toggle, **TAP** tempo, `▼`/`▲` tempo nudge (±1 BPM, auto-repeats while held), BPM, swing %, settings. BPM/swing are digits-only text fields (non-numeric keystrokes are dropped, the value is clamped on blur/Enter). |
| Track rows | The dot next to `CH n` lights for ~160 ms whenever a note arrives on **that MIDI channel** — every track set to it lights, whether or not it is the selected one. Notes record into the track(s) on that channel. Each track has its own always-visible row of memory slots above its 16 pads — tap a slot to switch that track instantly (filled slots are brighter); tapping one also selects the track. `+` adds a slot copied from the last one (max 10), a double tap on a slot deletes it (a track always keeps one). Tap a pad to select it and hear what it holds — the whole chord, at the step's velocity, gate and note lengths. Each sounding pad draws a block in the track colour: its **width is gate** (200% fills the pad) and its **height is velocity**. Drag on a pad to resize the block — X sets gate, Y sets velocity; a tap that never moves 5 px stays a plain select. Two quick taps on a pad (within 300 ms) clear its notes. Tap the track header to select the track. `M` mutes; `🔓`/`🔒` locks recording into add-only for that track; `CLR` clears that track's current slot on a **double tap** — the first tap turns it red and reads `SURE?`, a second within 700 ms wipes the slot, otherwise it disarms. |
| Step editor | Chord chips for the selected step (tap a chip to pick and hear it, double-tap it to remove that note, `×3` marks a held note), with a read-only `VEL` / `GATE` readout next to the title — those are set by dragging the pad's block. Pitches come from the controller: play them in with `●` armed. |

`Space` toggles play/stop whenever focus is not in a text field, select or open dialog.

## Steps hold chords

A step is `{ notes: [{ note, len }], velocity, gate }` — any number of notes fire together, sharing
that step's velocity and gate. There is **no on/off switch**: every step is live, and what it holds
decides whether it makes a sound. A step with no notes is a rest; pads light when they hold notes
and show the note count above one.

`len` is how many steps a note is held for. A note with `len` 3 is sent as **one** Note On and one
Note Off three steps later — no retrigger in between — and the steps it reaches over show a
sustain bar. Its sounding length is `(len − 1 + gate/100)` steps, so gate still shapes the tail.
Lengths are captured by holding a key during live record; a chip shows `×3` when its note is held
across steps.

**Notes never wrap.** A note is cut at step 16 rather than ringing into step 1 of the next pass:
its length is capped at `16 − startStep` wherever it is set (recording, fill, load), and playback
also truncates the note-off at the end of the pattern. So holding a key past the loop point ends
the note at the loop point and leaves step 1 alone.

**Replace or overdub.** By default a recorded note **replaces** what the step held — tap a pad to
put the cursor there, play a note on that track's channel, and the step becomes that note. Notes
played together (inside the 140 ms chord window) still stack, so chords record in one gesture.

The lock button in each track's header (`🔓`/`🔒`, next to `CLR`) flips that **for that track**:
locked, recorded notes keep what the step holds and pile on, pass after pass. It persists with the
rest of the state.

Erasing is always explicit: a double tap on the pad, a double tap on a chip (removing the last note
leaves a rest), or `CLR` for the whole slot.

Recording notes within 140 ms of each other keeps them on the same step instead of advancing to
the next one.

## Recording

All notes come from the MIDI in port (Settings → MIDI in), and they are recorded, not played back.

**Notes are routed by channel.** A note recorded on channel _n_ lands on every track whose MIDI
channel is _n_ (and selects the first of them); a note on a channel no track listens to is
dropped. Set per-track channels in Settings.

Record arm (`●`) plus transport state decides the mode:

- **Step record** — `●` on, transport stopped. Incoming notes write at the red cursor and advance.
  `REST` (in the step editor header) skips a step, `◀` steps back. Tapping any pad moves the cursor.
  Notes are written one step long — with no clock running there is nothing to measure a hold
  against.
- **Live record** — `●` on, transport playing. Incoming notes are quantized to the nearest 16th and
  replace that step (or add to it with the lock on). **Holding a key sustains**: the note's length is
  set on release from how many steps it was held for, so a key held across four steps records one
  four-step note instead of four repeats.
- **Off** — notes are ignored (the channel light still blinks).

Incoming notes are never echoed to the MIDI out or the preview synth — you hear your controller's
own instrument. Auditioning is UI-driven only: a pad tap, `♪`, or a chord chip.

Editing while the sequence runs is applied on the next step.

## MIDI

An external controller is required for note entry. Settings → pick MIDI out / MIDI in. Per-track name and MIDI channel (1–16) live in Settings too,
along with **+ Add track** and a per-track `✕` (double-tap, it drops that track's 10 patterns).
The rack holds 1–5 tracks; it starts with 4.
Optional 24 ppqn MIDI clock + Start/Stop out for slaving hardware. Without a MIDI out (or on
iOS Safari, which has no Web MIDI) the built-in WebAudio preview synth still plays everything.

Scheduling uses a 25 ms lookahead loop that hands `performance.now()` timestamps to
`MIDIOutput.send()`, so timing does not depend on React renders or `setTimeout` jitter.

## Slots

Slots are **per track**: every track owns 1–10 patterns of 16 steps and its own current slot, and
its bank sits above its pads so all banks are visible at once. A track starts with a single slot;
`+` appends **a copy of the last slot** and selects it — so a song is built by duplicating a
pattern and varying it. A double tap on a slot deletes it, and the last slot can't be deleted. Track config (channel, name, mute, note lock) is not per slot. Clearing a slot's contents
is the track's own `CLR` button.

## Song mode

`SONG` in the top bar (red when on) makes every track walk its own bank: at the top of each 16-step
pass each track moves to its next slot and wraps at the end of its bank. Because banks can be
different lengths, tracks drift against each other — a 3-slot track over a 2-slot one repeats every
6 passes — which is the point.

The engine owns the song position, so pattern changes land exactly on the bar even though steps are
scheduled ahead of time. Starting the transport begins the song wherever each track's slot is
selected; the slot currently sounding is outlined in red.

**The selection follows the song.** As each track moves to its next slot, that slot also becomes
the selected one — so with `●` armed you record straight through the whole arrangement, one pass
per slot, without touching anything. The step editor and pads always show the slot you are hearing.
The swap is applied at the moment the new pass is *heard*, not when it is scheduled, so notes
played just before the bar line still land in the outgoing slot.

Selecting a slot by hand while a song runs does not move the song position — the engine stays
authoritative, and the next wrap pulls the selection back. Stop first to pick a starting point; a
stopped song resumes from wherever the selection sits.

On load a bank is trimmed back to its last slot holding notes (minimum one), so a save from when
every track carried a fixed bank of 10 opens with just the slots you actually used.

Everything persists to `localStorage` (`step16.v2`). Older saves are migrated on load: a
`step16.v1` bank fans out so slot _n_ becomes slot _n_ of every track, and steps saved back when
they still had an on/off flag keep their notes if they were on and become rests if they were off.

## PWA / offline

`npm run build` runs `next build` (which static-exports to `out/`) and then `scripts/gen-sw.js`,
which rewrites `out/sw.js` with
the build's real (hashed) asset names and a version derived from their content. The worker
**precaches the whole build at install** — HTML, JS, CSS, manifest, icons — so once the app has
been opened on a device it launches with no network at all: installed PWA in airplane mode, dead
Wi-Fi, whatever. Nothing it needs at runtime comes off the network; patterns live in
`localStorage`, and `navigator.storage.persist()` is requested so the browser doesn't evict them.

**Serving is cache-first for everything.** If a request is in the cache the network is never
consulted — no revalidation, no background refresh — so a launch costs nothing and behaves
identically on a dead connection, a captive portal or a good link. Navigations resolve to the one
cached `index.html`; only a genuine miss goes to the network, and a miss with no network returns a
503 rather than throwing.

Updates therefore do not ride on page loads. The browser revalidates `sw.js` itself, and the app
calls `registration.update()` once after registering; a build with a different `VERSION` installs,
precaches the new assets and prompts. Serve `sw.js` with `Cache-Control: no-cache` so that check
isn't answered from the HTTP cache.

Two things keep this working on iOS specifically. Precaching never uses `new Request(url, {cache:
'reload'})` — older WebKit throws on the `cache` init option, which would leave the cache empty
while looking like a clean install; the fallback is a query-busted `fetch` stored under the clean
URL. And every `fetch` handler is guaranteed to settle with a `Response` (a 503 as the last
resort), because resolving `respondWith()` to `undefined` is what produces Safari's
"FetchEvent.respondWith received an error". The worker also refills any missing shell entry on
activation, since iOS evicts caches under storage pressure.

Updates install quietly and **do not** take over a running session — swapping the JS mid-pattern
would reload the app while you are recording. When a new build is ready you get a prompt; accepting
it messages the waiting worker (`skip-waiting`) and reloads once it takes control. Otherwise it
applies on the next launch. Old caches are deleted on activation.

Deploy the whole `out/` (including `sw.js` at its root). The worker's shell URLs are relative to
its own scope, so it precaches whatever `next build` emitted, hashed `_next/static/` chunks
included.

The app itself is loaded through `next/dynamic` with `ssr: false`: the first render reads
`localStorage` and the engine touches Web MIDI/WebAudio, so there is nothing to prerender and no
hydration mismatch to avoid.

- `public/manifest.webmanifest` + `public/sw.js` (source; the built copy is generated).
- Install card appears on the first visit, as soon as Chrome/Edge fire `beforeinstallprompt`;
  iOS gets Add-to-Home-Screen instructions instead. Dismissal is remembered
  (`step16.installDismissed` in `localStorage`).

## Files

```
app/layout.jsx             <html>/<body>, metadata, viewport, global CSS
app/page.jsx               static route -> client-only app
app/client-app.jsx         dynamic(App, { ssr: false })
app/service-worker.jsx     sw.js registration + update prompt
src/engine.js              clock, scheduler, Web MIDI I/O, preview synth (no React)
src/model.js               state shape, reducer, persistence, v1 migration
src/App.jsx                wiring: engine <-> UI, record logic, spacebar transport
src/components/            Transport, Slots, TrackRow, StepEditor, Settings, InstallPrompt
public/                    manifest, service worker, icons
scripts/gen-sw.js          post-build: bakes the asset list + version into out/sw.js
legacy-vite/               the old Vite entry files, kept for reference (unused)
```

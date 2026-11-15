# Generative sequencer: Organic (Max for Live MIDI Effect)

A generative drum sequencer for Ableton Live 12 / Max 9. This is the first of several
generator modes ("organic"; irregular, mathematical and physical are planned). All
musical and timing logic is a pure JavaScript engine that runs in Node and in Max's
`[v8]`. The Max device is a thin adapter around it.

```
engine/                 pure JS, deterministic, no dependencies, no host APIs
  index.js              createEngine(), public API
  params.js             the 9 exposed parameters (single source of truth)
  lanes.js              lanes and roles (kick-like, snare-like, hat-like, perc)
  meter.js              meter, soft metric weight, rhythmic attractors, swing warp
  prng.js               seeded hash + PRNG
  modulators/           shared signals any mode can use
    noise.js            smooth correlated (1/f-style) noise
    breath.js           phrase-level breathing envelope
  generators/
    index.js            mode registry + the generator interface
    organic/            mode 1: motif memory, fills, per-note rendering
  timeline.js           window logic shared by all modes
  scheduler.js          look-ahead scheduler (host-agnostic)
max/
  src/adapter.js        the v8 adapter (source)
  organic.js            BUILT: engine + adapter in one file, load with [v8 organic.js]
  organic.maxpat        BUILT: the device patcher
  Organic.amxd          BUILT, experimental: the patcher wrapped as a MIDI Effect
cli/
  simulate.js           N bars -> .mid + text / HTML piano roll
  compare.js            timing of a clip recorded in Live vs. the reference .mid
examples/               BUILT: four 32-bar performances to audition
tools/                  bundler, patch generator, build script
test/                   node:test suites (no dependencies)
```

Requires Node 18+ for the tools and tests. There is nothing to install.

```sh
cd generative-sequencer
npm test                                         # unit, simulation, bundle and patch tests
npm run sim -- --bars 16 --seed 7                # text piano roll in the terminal
npm run sim -- --bars 32 --seed 7 --bpm 110 --out out/seed7.mid --html out/seed7.html
npm run build                                    # regenerate max/ and examples/
```

`npm run sim -- --help` lists all options. Every parameter can be passed as
`--density 70` etc., in the same units as the device.

## What "organic" means here

| Requirement | How it is done |
|---|---|
| No step grid | Events are float beats. When inventing a figure the generator aims at *attractors* from several subdivisions at once (16ths, triplets, 16th triplets, quintuplets, weighted by role and Looseness), adds an intentional displacement that stays with the figure, then applies swing, drift and jitter. Fills use continuously accelerating or relaxing spacing that follows no subdivision. Nothing is ever snapped to a slot. Tested: most notes are off the 16th grid and positions are continuous. |
| Correlated microtiming | `modulators/noise.js`: cubic B-spline value noise summed over octaves (persistence 0.6, between pink 1/f and a random walk). Timing = ensemble drift (whole kit rushes and drags) + per-lane drift + the role's push/pull bias (kick slightly ahead, snare behind), which itself wanders slowly. Only a small jitter term is uncorrelated. |
| Swing that varies | A continuous time warp (8th and 16th level) whose amount wanders around the Swing setting with a slow noise field. |
| Breathing density | `modulators/breath.js`: phrases of 2, 4 or 8 bars shaped build / arch / steady / fade, many ending in a rest. Each lane plays the candidates of its figure whose priority is below its current density, so figures thin out and fill in while keeping their identity. Hats keep time through rests more than the other lanes. |
| Memory | A bank of up to 4 one-bar figures. Each bar the player recalls the current figure (or, at phrase starts, an older one) and varies it in timing, accents and omissions, or develops or invents a new one. Memory sets the recall rate and how small the variations are; low memory also lets variations overwrite the stored figure, so figures drift. |
| Velocity | Soft metric emphasis (gaussian fall-off around metric positions) scaled by Accent, accents per figure, ghost notes (Ghosts), flams (soft grace 14–36 ms early, Ghosts), phrase dynamics and a slow velocity wander. |
| Reproducible | Integer-hash PRNG keyed by (seed, bar, note), so it is bit-exact across JS engines. A performance starts when the transport starts: the same seed, settings and tempo give the same notes in the CLI and in the device, from whatever bar you start (bar phase is kept). |

### Parameters

All are `live.dial` objects (Seed is a `live.numbox`), saved with the set and automatable.

| Name | Range | Default | Effect |
|---|---|---|---|
| Density | 0–100 % | 55 | How many notes play. 0 is silence. |
| Looseness | 0–100 % | 35 | Per-note timing scatter; how often figures use triplets and quintuplets. |
| Drift | 0–100 % | 30 | Slow correlated drift and per-lane push/pull. 0 with Looseness 0 is metronomic. |
| Swing | 0–100 % | 20 | Average swing; 100 is a triplet feel. The amount wanders over time. |
| Breath | 0–100 % | 50 | Depth of phrase breathing: builds, thinning out, rests. |
| Memory | 0–100 % | 65 | 0 invents every bar; 100 repeats with only small variations. |
| Accent | 0–100 % | 50 | Velocity contrast. |
| Ghosts | 0–100 % | 35 | Ghost notes and flams. |
| Seed | 0–9999 | 1 | Random seed. |

Knob changes take effect within about 1–2 beats: the timeline renders up to a beat ahead and
never changes notes it has already rendered (see below).

### Lanes

| Lane | Note | Role |
|---|---|---|
| Kick | 36 (C1) | `anchor`: strong beats, anticipations |
| Snare | 38 (D1) | `backbeat`: backbeats, ghosts, flams, fills |
| Hat | 42 (F#1) | `pulse`: subdivisions, carries swing |
| Perc | 37 (C#1) | `color`: syncopation, triplets |

These match a standard Drum Rack layout. To change them, edit `DEFAULT_LANES` in
`engine/lanes.js` and run `npm run build`.

## Architecture

**Generator interface** (`engine/generators/index.js`). A mode is an object with
`id`, `maxDeviation`, `init(state)`, optional `reseed(state)` and
`generate(startBeat, endBeat, state) -> Event[]`, where
`Event = { beat, lane, note, velocity, duration }` (beats). `generate` is called on
consecutive anchor windows and returns the events *aimed* inside the window. Their `beat`
may land up to `maxDeviation` earlier or later. Modes read shared modulators from
`state.mods` (breath envelope, named noise fields) and keep private state in `state.gen`.
To add a mode: create `engine/generators/<mode>/index.js`, register it in
`generators/index.js`, and select it with `createEngine({ mode })`.

**Timeline** (`engine/timeline.js`) turns that into the public contract:
`engine.generate(start, end)` returns every event with `start <= beat < end`, exactly
once, however the timeline is cut. It renders 1-beat anchor chunks ahead (far enough that
nothing still unrendered can land before the window end) and latches them. Parameter
changes therefore only affect chunks not yet rendered, and moving a knob can't duplicate or
drop a note at a window boundary. It also merges same-lane onsets closer than 0.02 beats
and clips durations so a lane never overlaps itself.

**Scheduler** (`engine/scheduler.js`) is host-agnostic, so Node can test it with a
simulated transport (`cli/lib/simhost.js`). It keeps three timelines:
- song: Live's position, which jumps back at loop wraps
- U: unrolled play time, which never jumps back; delays are computed in U
- E: engine time, which advances with U and keeps the song's bar phase

When the look-ahead crosses the loop end, the next pass is planned *before* the transport
wraps, so the first notes of every pass are on time. Because E keeps advancing, the
performance keeps evolving across passes instead of replaying identical bars.

**Max adapter** (`max/src/adapter.js`, about 140 lines) forwards transport readings,
LOM loop data and parameter changes to the scheduler, and scheduler commands to outlets.

### Transport sync

| Event | Behaviour |
|---|---|
| Play | New performance at the play position. If the first tick sees the transport within 80 ms after a 16th, playback is assumed to have started on that 16th, and its notes play immediately (a few ms late) instead of being lost. |
| Stop | `clear` to `[pipe]` (cancels everything pending) plus note-off for every lane note and every note in flight. |
| Tempo change | Delays already queued were computed at the old tempo. Above a 2 % change, the delay line is cleared and every pending note-on/off is re-issued at the new tempo. |
| Arrangement loop | Read from the LOM (`loop`, `loop_start`, `loop_length`) and planned ahead, so wraps are seamless. A loop that isn't a whole number of bars skips engine time forward by less than a bar to keep the bar phase. |
| Jump (click elsewhere while playing), loop edit that invalidates queued notes, meter change | Clear, release, and start a new performance at the new position. |
| Same pitch twice within 0.02 beats in play time (loop seams that aren't whole bars, late notes after a stall) | Merged into one note; an earlier note is released before a later one starts. |

## Building the device in Live

### 1. Check that you have `[v8]`

`[v8]` is new in Max 9. Live bundles Max 9 from **Live 12.2** on; Live 12.0 and 12.1
bundled Max 8.6, which has no `[v8]`. To check, open any Max for Live device's editor,
put a new object in an empty spot and type `v8`. A solid box means you have it; a dashed
or red box means you are on Max 8. In that case, update Live, or point Live at a separate
Max 9 install (Live Settings, File & Folder, Max Application). No legacy `[js]` (ES5)
build is provided: the engine uses ES2015+ syntax.

### 2. Make the device (manual route, recommended)

1. Create a folder for the device, e.g.
   `~/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/Organic/`,
   and copy `max/organic.js` into it.
2. In Live, create a MIDI track. From the browser, drag *Max for Live > Max MIDI Effect*
   onto it. Put a Drum Rack after it.
3. Click the device's Edit button. The Max editor opens with `[midiin] -> [midiout]`.
4. In the editor: *File > Save As...*, save as `Organic.amxd` in the folder from step 1.
   Saving first matters: Max looks for `organic.js` next to the device.
5. *File > Open...* `max/organic.maxpat` (from this repo). In that window, unlock
   (Cmd/Ctrl-E), *Select All*, *Copy*, then close it without saving.
6. Back in the device editor: unlock, *Select All*, *Delete*, *Paste*.
7. Open the patcher inspector (*View > Inspector* with nothing selected, or right-click
   the background) and tick **Open in Presentation**.
8. Save and close the editor. The device shows nine controls.
9. In the Max Console (*Window > Max Console*) you should see
   `organic: engine 0.1.0 (organic) ready`. If you see that `organic.js` can't be found,
   the script isn't in the same folder as the `.amxd` (step 1).
10. To share the device or move it around, click **Freeze Device** (snowflake icon at the
    bottom of the editor) and save. This embeds `organic.js` in the `.amxd`.

### 2b. Experimental shortcut

`max/Organic.amxd` is the same patcher behind the binary header Live uses for MIDI
Effects (`ampf` / `mmmm` / `meta` / `ptch`). That layout is reverse-engineered, not
documented, and **untested**. Copy `Organic.amxd` and `organic.js` into the same folder
and drag the `.amxd` onto a MIDI track. If Live refuses it, use the manual route.

### After changing the engine

Run `npm run build`, then copy the new `max/organic.js` over the one next to the device.
`autowatch` reloads it while the editor is open. A frozen device keeps its embedded copy
until you re-freeze.

## Timing: the approach and why

**The constraint.** Both `[js]` and `[v8]` run on Max's low-priority main thread. Messages
arriving from the high-priority scheduler thread are deferred to it, and it stalls during
UI work, so JavaScript can't play notes "now" without picking up that jitter. I found no
equivalent of legacy js's per-function `immediate` property for `[v8]`. Running the engine
on the audio or scheduler thread would also risk dropouts.

**What the device does.**
1. A `[qmetro 10]` (low priority, so ticks never queue up) bangs `[t b b]`. The right
   outlet reads `[transport]` (in Max for Live the global transport follows Live) into the
   script; the left outlet then ticks it.
2. The scheduler asks the engine for everything due in the next **150 ms** and computes
   each note's delay **relative to that transport reading**. The reading, the computation
   and the hand-off to `[pipe]` happen in one synchronous call, so a stall *before* the
   tick doesn't matter. Only notes due beyond the look-ahead can be affected.
3. `[pipe]` schedules each note on Max's high-priority scheduler, which in Max for Live
   runs with the audio processing. Note-ons and note-offs both go through it.

**Remaining error sources.**
- The scheduler only runs once per signal vector: about ±0.7 ms at 64 samples / 44.1 kHz.
- Tempo changes inside the look-ahead window are bounded by the 2 % reschedule rule.
- A main-thread stall longer than the look-ahead makes notes late. Up to 30 ms they are
  played late; beyond that they are dropped (counted). Raise the look-ahead with
  `lookahead 250` if your set stalls a lot.
- Whatever Live does with MIDI arriving from `[midiout]` within an audio buffer. This is
  unknown, and step 2 below measures it.
- The very first note after pressing Play: Max only sees the start on the next tick.

**Alternatives considered.**
- Emitting notes directly from JS: jitter equals main-thread latency (several to tens of
  ms).
- `[metro @quantize]` / `[timepoint]`: tight but grid-bound, which contradicts the brief.
- Signal-domain triggering (`[plugphasor~]` + `[seq~]`): potentially sample-accurate, but
  the event list changes continuously and would still come from the main thread. This is
  a possible later upgrade if measurements show `[pipe]` isn't tight enough.

## How to test timing

**1. Built-in probe (inside Max).** When each note leaves `[pipe]`, the patch reads the
transport again on the high-priority thread and reports how far it was from where the
note was aimed. In the device editor (patching view, locked), click the `verbose 4`
message box to get a line every 4 seconds in the Max Console, or `stats` for one line.
The format (numbers here are illustrative, not a measurement):

```
organic: notes 1290, late 2, dropped 0, merged 0, starts 1, resyncs 0, wraps 12, reschedules 0 | probe n 1290 mean 0.31 ms, sd 0.42 ms, min -0.70, max 1.50
```

What to look for:
- probe mean near 0 and sd around a millisecond or two: notes leave Max where they were
  aimed.
- `late` and `dropped` stay at 0 apart from a start or two. If they climb, raise
  `lookahead`.
- Looping a 2-bar region: `wraps` counts up and `resyncs` stays 0.
- Tempo automation: `reschedules` counts up with no audible hiccup.
- Clicking elsewhere while playing: `resyncs` +1.
- Stop: no hanging notes.

**2. Record and compare (end to end, including Live).**
1. Put Organic on a MIDI track with no instrument (track A). On track B, put the Drum Rack
   and set *MIDI From: A, Post FX*. Arm B. Set *Edit > Record Quantization > None*.
2. Leave all knobs at their defaults (or note them) and set the tempo, e.g. 120.
3. Record at least 16 bars, starting playback from bar 1.
4. Right-click the clip, *Export MIDI Clip...*, e.g. to `recorded.mid`.
5. Write the same performance from the CLI, then compare:

```sh
npm run sim -- --bars 16 --seed 1 --bpm 120 --out out/ref.mid   # same knobs as the device
npm run compare -- recorded.mid out/ref.mid
```

`compare` pairs notes by pitch and prints the constant offset (latency, harmless) and the
jitter around it (sd, p95, max), per note. It also prints the files' tick size, because
very coarse export resolution would hide small errors. For the default settings you can
also compare against `examples/organic-defaults-seed1-120bpm.mid` directly. Flam spacing
depends on tempo, so keep `--bpm` equal to Live's tempo.

**3. Stress.** While playing, resize windows, open heavy plug-in UIs and load samples, and
watch `late` and `dropped`.

## Untested assumptions (inside Max and Live)

Everything in `engine/` and the adapter logic is tested in Node, including the built
bundle running in an empty JS context with stand-ins for Max's globals and a randomized
transport test (play, stop, seek, loop and tempo changes). None of it
has run inside Max or Live. These assumptions need checking there:

1. **v8 availability**: Live 12.2+ bundles Max 9 (from release notes and press coverage).
2. **v8 script semantics** match js: top-level `function` declarations are message
   handlers; `inlets`, `outlets`, `autowatch`, `post`, `messagename`, `outlet(n, array)`
   (as a list) behave as in js; `Date.now()` exists. Message names `transport`, `lom`,
   `param`, `probe` etc. don't clash with any v8 built-in.
3. **`[transport]` outlets**: resolution 4th, tempo 5th, time signature 6th, state 7th,
   ticks 8th. In Max for Live it follows Live (including play state), and a reading from
   the low-priority thread is current to within one vector.
4. A transport reading on the main thread and `[pipe]`'s clock share the same "now" (both
   derive from Max's scheduler time).
5. **`[pipe 0 0 0. 0.]`**: three data inlets plus a float delay in the 4th inlet, mixed
   int/float data, `clear` cancels all pending output, and output fires on the
   high-priority thread in Max for Live.
6. **LOM**: `live.observer` takes `property loop` (etc.) on the left and the id from
   `[live.path live_set]` on the right; it outputs the value on binding and on change; Song
   `loop_start` / `loop_length` are in beats. The adapter accepts the value with or without
   the property name in front.
7. **Live's loop** behaves as modelled: the position jumps from loop end to loop start,
   and playback started after the loop end runs on.
8. **Live's handling of MIDI from `[midiout]`**: whether it keeps sub-buffer timing or
   quantizes to the audio buffer. Test 2 above measures it.
9. **Parameters**: the generated `live.dial` / `live.numbox` attributes (range, initial
   value, % unit style, info text) load as intended and survive copy/paste;
   `live.thisdevice` fires after the device is ready; a bang makes each dial re-send its
   value.
10. **Files**: Max finds `organic.js` next to the saved `.amxd`, and Freeze embeds it.
11. **The experimental `Organic.amxd` header.**
12. **CPU**: about 100 ticks per second. In Node a tick takes 0.3 µs median and 45 µs at
    p99; Max's v8 should be similar.
13. **Float determinism between Node and Max's V8**: the PRNG is integer-exact. The
    transcendental functions (`exp`, `tanh`, `sin`, `pow`, `log`) are assumed to give the
    same results in both V8s, which is true in practice for the same engine.

## Known limitations

- 4/4 is the primary target; other meters work (3/4, 6/8 compound, 7/8, 5/4 tested in
  Node), but a time-signature change *inside* an arrangement isn't followed. The meter is
  read when playback starts, and a change restarts the performance.
- Manual jumps and loop edits that invalidate queued notes restart the performance (the
  memory resets).
- Knob changes have about 1–2 beats of latency (rendered chunks are latched).
- Lanes are configured in code, not from the device.

## References

Research behind the v8 and timing decisions. The Cycling '74 and Ableton docs couldn't be
fetched from the build environment, so these were read through search results.
Re-check them against your installed versions.

- Cycling '74, [JavaScript and threading](https://docs.cycling74.com/max8/vignettes/jsthreading) (js runs on the low-priority thread) and [JS require guide](https://docs.cycling74.com/max8/vignettes/jsrequire)
- Cycling '74, [Introducing Max 9](https://cycling74.com/products/max-9) and [Max 9.0.0 release notes](https://cycling74.com/releases/max/9.0.0) (the v8 object, modern JS)
- Cycling '74 forum, [Are Max for Live's JavaScript functions, which run in the low-priority thread, latency compensated?](https://cycling74.com/forums/are-max-for-live's-javascript-functions-which-run-in-the-low-priority-thread-latency-compensated) (js and v8 are both low priority)
- Cycling '74, [Event priority in Max (scheduler vs. queue)](https://cycling74.com/articles/event-priority-in-max-scheduler-vs-queue) and [Advanced Max: learning about threading](https://cycling74.com/articles/advanced-max-learning-about-threading)
- Cycling '74, [transport reference](https://docs.cycling74.com/reference/transport/) (outlet layout)
- Cycling '74 forum, [Best method for tight syncing to Live transport in M4L](https://cycling74.com/forums/best-method-for-tight-syncing-to-live-transport-in-m4l) and [midi jitter](https://cycling74.com/forums/midi-jitter)
- Ableton, [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/) (bundled Max versions); CDM, [Live 12.2 hands-on](https://cdm.link/live-12-2-hands-on-guide/) (Max 9 bundled from 12.2)

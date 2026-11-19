# Generative sequencer: Organic (Max for Live device and VST3/AU plugin)

A generative drum sequencer, available two ways:

- a **Max for Live MIDI Effect** for Ableton Live 12 / Max 9 (`max/`), and
- a **native plugin** for any DAW: VST3, plus an AU MIDI FX for Logic (`plugin/`).

Four pattern modes, chosen with the **Mode** parameter: **Organic** (a drifting player with
memory), **Irregular** (odd groupings that reshape the bar), **Mathematical** (Euclidean
rhythms and polymeters) and **Physical** (pendulums and bouncing balls). The engine is pure JavaScript (Node and Max's `[v8]`), with a
C++ port for the plugin. Both play the same performance for the same seed and settings,
and a parity test keeps them in step.

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
    shared.js           bar-plan cache and per-note rendering, used by every mode
    organic/            mode 1: motif memory, fills
    irregular/          mode 2: groupings of 2/3/4/5 units, cycles across the bar line
    mathematical/       mode 3: Euclidean rhythms E(k, n), polymeters
    physical/           mode 4: pendulums and bouncing balls
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
examples/               BUILT: 32-bar performances to audition
preview/                BUILT organic-preview.html: in-browser groove lab (src/ is the source)
tools/                  bundler, patch generator, build script
test/                   node:test suites (no dependencies)
plugin/                 native plugin (C++17, JUCE 8)
  engine/organic.*      C++ port of engine/ (same output, checked by test/plugin.test.js)
  engine/block_scheduler.*  sample-accurate scheduling from the host transport
  src/                  JUCE processor and editor
  tests/                engine dump, scheduler tests, headless VST3 host test
  CMakeLists.txt        builds Organic (VST3) and, on macOS, Organic MIDI FX (AU)
  INSTALL.txt           install and routing notes shipped with the download
```

Requires Node 18+ for the tools and tests. There is nothing to install.

```sh
cd generative-sequencer
npm test                                         # unit, simulation, bundle and patch tests
npm run sim -- --bars 16 --seed 7                # text piano roll in the terminal
npm run sim -- --bars 32 --seed 7 --bpm 110 --out out/seed7.mid --html out/seed7.html
npm run build                                    # regenerate max/ and examples/
```

**Preview page**: `preview/organic-preview.html` (built from `preview/src/`) runs the same engine
in the browser with placeholder drum sounds: play it, turn the knobs, switch modes, then save a
MIDI clip for Ableton or copy the settings into the device. Opened locally in Chrome it can also
send live MIDI (on a Mac via the IAC Driver). `node tools/build.js --artifact` writes the version
published as a claude.ai artifact.

`npm run sim -- --help` lists all options. To hear it without a DAW,
`npm run render -- --mode irregular --bars 16 --out out/irregular.wav --mp3` plays the
performance through a small synthesized drum kit. Every parameter can be passed as
`--density 70` etc., in the same units as the device.

## What "organic" means here

| Requirement | How it is done |
|---|---|
| No step grid | Events are float beats. When inventing a figure the generator aims at *attractors* from several subdivisions at once (16ths, triplets, 16th triplets, quintuplets, weighted by role and Looseness), adds an intentional displacement that stays with the figure, then applies swing, drift and jitter. Fills use continuously accelerating or relaxing spacing that follows no subdivision. Nothing is ever snapped to a slot. Tested: most notes are off the 16th grid and positions are continuous. |
| Correlated microtiming | `modulators/noise.js`: cubic B-spline value noise summed over octaves (persistence 0.6, between pink 1/f and a random walk). Timing = ensemble drift (whole kit rushes and drags) + per-lane drift + the role's push/pull bias (kick slightly ahead, snare behind), which itself wanders slowly. Only a small jitter term is uncorrelated. |
| Swing that varies | A continuous time warp (8th and 16th level) whose amount wanders around the Swing setting with a slow noise field. |
| Breathing density | `modulators/breath.js`: phrases of 2, 4 or 8 bars shaped build / arch / steady / fade, many ending in a rest. Density is set per bar (rests can start mid-bar). Each figure's notes are ranked by importance for their role, and a lane plays the ones below its current density. So thinning drops 16ths and syncopations first, while backbeats, the downbeat kick and quarter-note hats go last. Hats keep time through rests more than the other lanes. |
| Memory | A bank of up to 4 one-bar figures, locked to phrases. A figure holds for the whole phrase: most bars replay it exactly (timing and velocity are still humanised), some get a light variation, and the phrase's last bar carries the bigger variation, often with a fill. Switching to another figure (back to an older one, a development of the current one, or a new idea) is decided at phrase starts. Memory sets how often figures switch and how much bars vary; at low Memory figures also switch mid-phrase and drift. Flams belong to a note, so a repeated figure flams the same way each time. |
| Velocity | Soft metric emphasis (gaussian fall-off around metric positions) scaled by Accent, accents per figure, ghost notes (Ghosts), flams (soft grace 14–36 ms early, Ghosts), phrase dynamics and a slow velocity wander. |
| Reproducible | Integer-hash PRNG keyed by (seed, bar, note), so it is bit-exact across JS engines. A performance starts when the transport starts: the same seed, settings and tempo give the same notes in the CLI and in the device, from whatever bar you start (bar phase is kept). |

### Parameters

All are `live.dial` objects (Seed is a `live.numbox`), saved with the set and automatable.

| Name | Range | Default | Effect |
|---|---|---|---|
| Density | 0–100 % | 55 | How many notes play. 0 is silence. |
| Looseness | 0–100 % | 25 | Per-note timing scatter; how often figures use triplets and quintuplets. |
| Drift | 0–100 % | 25 | Slow correlated drift and per-lane push/pull. 0 with Looseness 0 is metronomic. |
| Swing | 0–100 % | 20 | Average swing; 100 is a triplet feel. The amount wanders over time. |
| Breath | 0–100 % | 40 | Depth of phrase breathing: builds, thinning out, rests. |
| Memory | 0–100 % | 65 | 0 changes figure almost every bar; 100 locks the groove (with Breath at 0, about 90 % of bars repeat exactly). |
| Accent | 0–100 % | 50 | Velocity contrast. |
| Ghosts | 0–100 % | 35 | Ghost notes and flams. |
| Seed | 0–9999 | 1 | Random seed. |
| Mode | Organic / Irregular / Mathematical / Physical | Organic | Pattern type (see below). A tab in the Max device, a drop-down in the plugin. |

Knob changes take effect within about 1–2 beats: the timeline renders up to a beat ahead and
never changes notes it has already rendered (see below).

## Irregular mode

The bar is counted in units (16ths in x/4, 8ths in x/8). A **grouping** splits a cycle of
units into groups of 2, 3, 4 and occasionally 5, e.g. `3+3+2`, `2+3+2+2+3+2+2` or `2+2+3`.
- **Accents follow the groups, not the beat.** The kick takes group starts, the snare
  answers on alternate groups, hats accent every group start, and perc plays pickups into
  the next group.
- **The cycle can be longer or shorter than the bar.** For example, 17 units over 16-unit
  bars slides one unit per bar against the bar line, and realigns at every phrase start.
- **The knobs mean the same things where they can.** Swing, Drift, Ghosts, Accent, Breath
  and Density work as in Organic, through the shared renderer.
  - *Looseness* also sets how often groupings cross the bar line and how often 5s appear:
    about 28% of bars at 25%, 57% at 80%.
  - *Memory* sets how long a grouping holds. Changes happen at phrase starts: back to an
    earlier grouping, a variation (3+2 becomes 2+3, 4 becomes 2+2, 3+3 becomes 2+2+2), or a
    new one. With low Memory, changes also happen mid-phrase.
- **Phrase ends** get a roll through the last group.
- **A bar-aligned grouping repeats exactly**, because the notes at each cycle position
  depend only on the seed, the grouping and the position.

Try it: `npm run sim -- --mode irregular --bars 16 --seed 3 --looseness 80`, or the
`examples/irregular-*.mid` files. Switching Mode mid-performance takes effect within a
beat or two.

## Mathematical mode

Each lane plays a **Euclidean rhythm** E(k, n): k hits spread as evenly as possible over a
cycle of n units (16ths in x/4, 8ths in x/8), rotated by r. E(3,8) is the tresillo,
E(5,16) the bossa.
- **Density sets k** per lane (kick about a quarter of the steps, hats about 60 %).
- **Looseness gives lanes their own cycle length** (polymeter): e.g. perc on 13 against 16.
  Cycles count from the start of the performance and keep running across bar lines, so
  lanes drift in and out of phase with each other and with the bar.
- **Memory** sets how long a configuration holds. Changes happen at phrase starts: back to
  an earlier set, a nudge (rotate a lane, add or drop a hit, change a cycle by one), or a
  new set.
- **Accents** fall on each lane's cycle start; the snare gets ghosts just before its hits.
- **Phrase ends** may get an E(5..7, 8) snare fill.

Try it: `npm run sim -- --mode mathematical --bars 16 --seed 2 --looseness 70`, or
`examples/mathematical-polymeter-seed2-118bpm.mid`. The preview page shows each lane's
E(k, n) under the roll and highlights the polymetric ones.

## Physical mode

Notes come from a small simulation that runs through the performance.
- **Pendulums** (kick and hats) swing with a period slightly detuned from the beat and get
  pulled back towards it on every swing. *Memory* sets how strongly they lock to the grid:
  with low Memory they wander, slip and catch up. *Looseness* sets how far they are
  detuned. A stroke far from the grid is softer.
- **Bouncing balls** (snare and perc) are dropped around the backbeats (snare) and on the
  off-beats (perc). Each drop is a train of impacts whose spacing shrinks and whose loudness
  fades: an accelerating roll. *Density* sets how many drops land; at the default density
  the backbeat drops always land.
- **Phrase ends** get a big drop that rolls into the next phrase. A roll started near the
  bar line finishes in the next bar.
- Swing does not apply: physics ignores the grid. Each note's loudness comes from the
  simulation, and *Accent* scales the contrast.

Try it: `npm run sim -- --mode physical --bars 16 --seed 2`, or
`examples/physical-defaults-seed2-120bpm.mid`.

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

**Generator interface** (`engine/generators/index.js`). Adding a mode means writing the
bar planner; `generators/shared.js` provides the plan cache and the renderer. Each of
Irregular, Mathematical and Physical is 200–300 lines. A mode is an object with
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

## The plugin (VST3 / AU)

**Download**: every push builds it on GitHub Actions (workflow `organic-plugin`). Open the
latest run under the repository's *Actions* tab and download the **Organic-macOS**
artifact. It contains `Organic.vst3`, `Organic MIDI FX.component` and `INSTALL.txt`.
The binaries are universal (Apple Silicon and Intel) and ad-hoc signed, not notarised;
`INSTALL.txt` has the one Terminal command that clears the download quarantine.

**Which one where**
- **Ableton Live**: Live has no slot for third-party MIDI effects and can't take MIDI out of
  AU plugins. Load `Organic.vst3` on a MIDI track as an instrument, then on your Drum Rack
  track set *MIDI From* to that track and choose *Organic* as the source.
- **Logic Pro**: `Organic MIDI FX` in the MIDI FX slot of the drum track.
- **Bitwig, Reaper, Cubase, Studio One**: `Organic.vst3`, with its MIDI output routed to
  the drums.

**Differences from the Max device**
- Timing is sample-accurate. The host gives the position of every audio block, so notes go
  out at exact sample offsets: no look-ahead, no delay line, no main-thread jitter.
- A loop the host reports is split exactly at the loop end. A jump while playing (including
  a loop the host doesn't report) continues the performance at the new position, so loops
  keep evolving.
- The editor has the same knobs, a Mode drop-down and a status line (waiting / ready / playing, bar,
  note count).

**Build it yourself**

```sh
cd generative-sequencer/plugin
cmake -B build -DCMAKE_BUILD_TYPE=Release            # fetches JUCE 8.0.15
cmake --build build --config Release
# macOS universal: add -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" to the first command
```

**How it's tested**
- `npm test` builds the C++ engine and compares it with the JS engine event by event
  (seeds, extreme settings, knob changes mid-run, mid-bar start, other meters; identical to
  1e-12).
- It also runs the block-scheduler tests against a simulated host: timing within one sample
  for fixed and random block sizes, loops with and without host loop info, tempo changes,
  stop, and a randomized run that checks no note hangs or retriggers while sounding.
- `-DORGANIC_HOST_TEST=ON` builds a headless JUCE host that loads the *built* VST3, plays it
  through a simulated transport with a loop and a parameter change set through the host,
  and requires its MIDI to equal the engine's sample for sample. CI runs this on Linux and
  macOS, and validates the AU with `auval`.

**Not tested in a real DAW yet**: how each host reports loops and positions. Live may not
report its loop to plugins, which the jump handling covers. Also untested: Live's VST3
MIDI-out routing and Logic's MIDI FX slot with this build. The engine allocates memory
while it generates (bar plans, the event cache); that's a small amount once per beat, but
not strictly real-time safe.

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
   `organic: engine 0.4.0 (organic) ready`. If you see that `organic.js` can't be found,
   the script isn't in the same folder as the `.amxd` (step 1).
10. To share the device or move it around, click **Freeze Device** (snowflake icon at the
    bottom of the editor) and save. This embeds `organic.js` in the `.amxd`.

### Troubleshooting: read the status line

The device has a status line under the knobs. Its saved text is a failure message;
the script replaces it the moment it runs.

| Status line says | Meaning | Fix |
|---|---|---|
| `organic.js is NOT running ...` | `[v8]` never started. Either Live is using Max 8, or `organic.js` isn't next to the `.amxd`. | Open the device editor and look at the `v8 organic.js` box. A dashed or red box means no `[v8]`: use Live 12.2+, or point Live at Max 9. A normal box means the file wasn't found: the Max Console says so; put `organic.js` in the device's folder. |
| `ready - press play in Live` | The script runs; the transport is stopped. | Press play. |
| `playing - bar N - M notes` | Generating. M should keep rising. | If M rises but you hear nothing: the Drum Rack must come *after* the device and have pads on 36/37/38/42. |
| `Density 70 %` (briefly, while you turn a knob) | The knob reached the script. | Changes are audible within 1-2 beats. |
| `error: ...` | The engine threw. | Send the Max Console text. |

A MIDI clip on the same track passes through the device unchanged, so the knobs can't
affect it. Audition the generator with no clip on its track.

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

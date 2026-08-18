# Sound Physics — technical spec

A single-file browser instrument (~3000 lines, no dependencies, no build step).
Record a short sound with the mic; physical/generative systems replay it.
Seven scenes ("tabs") share one recorder, one master chain, one simulated world.

Target: modern Chrome/Safari, desktop + iOS. Also shipped as a Capacitor iOS app.

---

## 1. Architecture

**Two independent clocks — this is the core design decision.**

- **Simulation**: `setInterval(tick, 33)` with catch-up sub-stepping
  (`dt` clamped to 0.033, up to 2 s of backlog). NOT requestAnimationFrame:
  rAF halts in background tabs, which killed audio. All physics and all
  sound triggering happen here.
- **Rendering**: `requestAnimationFrame`, frame-limited (30 fps mobile /
  60 desktop), skipped entirely when `document.hidden`.

State lives in `scenes[tabName] = { items: [], ripples: [] }`. Every scene
steps every tick regardless of which tab is visible (skipped when empty),
so all engines keep sounding while you look at one of them. Only drawing is
per-tab.

Global mutable config: `S` (all knob values), `WORLD`/`WX` (world state and
its live modifiers). Knobs are declared as data in `KNOBS[tab]` and rendered
into a strip that swaps with the tab.

## 2. Audio graph

```
                                    ┌── per-tab volume buses ──┐
sources ── per-scene FX ────────────┤ balls pendulum shape     ├── masterGain
                                    │ ambient ambient2 disint  │
                                    │ rhythm                   │
                                    └──────────────────────────┘
                                          │ (ambient/ambient2/disint
                                          │  route via scBus = sidechain)
masterGain ── hazeLP ── hazeOut ── masterTrim(0.8) ── softClip(tanh, 4x) ── destination
                 └── hazeVerb ──┘                          └── sessionDest (MediaStreamDestination)
```

Key points:

- **Master soft clipper is mandatory.** Web Audio is float internally; the DAC
  hard-clamps at ±1.0, producing harsh clipping audible on speakers but absent
  from recordings. Trim + tanh fixes both.
- **Session recording taps post-clip**, so recordings match what you hear.
- **Haze** is a global veil: master → lowpass (18 kHz → 600 Hz) + reverb send +
  slight level duck, on a ~2 min (±30 s) cosine-eased open/close cycle.
- **Freeze** deliberately contains NO feedback path. Early versions recirculated
  a convolver and ran away (dangerous volume). Current design: record 3 s of the
  mix via MediaRecorder, loop it as a fixed, level-capped, lowpassed bed.
  Any freeze/infinite-sustain implementation must be provably non-growing.

## 3. Recording pipeline

`getUserMedia` → `MediaRecorder` (prefers `audio/mp4`, falls back to webm) →
`decodeAudioData` → `analyzeAndTrim()`:

- trims silence at 0.005 threshold with small margins
- **no loudness gate** — if a take is too quiet to trim, the whole buffer is kept
- returns `{ buffer, duration, rms }`; duration/rms drive object size everywhere

`addSound(result)` dispatches to the active scene's spawn function.
Files can also be loaded (button + drag-drop), capped at 30 s.

Every scene item carries `{ buffer, vol, hue }`. A mixer panel lists items of
the active tab with a per-item volume fader and a "save as WAV" button
(`bufferToWav`, 16-bit PCM).

## 4. Scenes

### balls
Bouncing circles in a rect. Wall hit → play buffer, volume from speed.
`MIN_HIT_GAP_MS = 150` suppresses the corner double-hit (two walls within a
frame or two produces a stuttering re-trigger). Radius from duration+loudness;
larger = slower. Tap to pop. FX: tape delay (340 ms, dark feedback, wow) + reverb.

### pendulum
Phase-integrated (`phase += 2π/period·dt`) so period changes never jump.
**Sound is scheduled sample-accurately**: solve for the next time
`phase mod π == π/2` and call `playBuffer(..., when=tCross)` up to 120 ms ahead.
Frame-quantized triggering was audibly sloppy. Visuals stay frame-based.
Each new pendulum is longer (z-ordering illusion); per-item mute toggles
render as dots on the right edge.

### shape
3D Gielis supershape via spherical product:
`x = r1(θ)cosθ·r2(φ)cosφ, y = r1(θ)sinθ·r2(φ)cosφ, z = r2(φ)sinφ`
where `r(φ) = (|cos(mφ/4)/a|^n2 + |sin(mφ/4)/b|^n3)^(-1/n1)`.
Exponents drift on slow incommensurate sines (`morphClock` is integrated so
speed changes don't jump the shape). Rendered as a dashed wireframe with slow
rotation + mild perspective.

Dots travel the *drawn wireframe*: they ride a latitude ring and may turn onto
a longitude line at intersections (random walk on the lattice, poles excluded).
Trails are stored in surface coords (θ,φ) and reprojected each frame so they
cling to the morphing shape.

Sound: local maxima of 3D radius = "spike tips" trigger, filtered by prominence
(0.07) with a 2 s starvation override. Notes are quantized to a **swung 8th
grid** (`nextGridTime`, swing 0.5–0.75) and pitched to a minor pentatonic
(`[0,3,5,7,10,12,15]`) by spike height. Per-dot drifting attack (4–90 ms) and
±12 cents drift so no two hits are identical. Visual ripples are delayed to
land with the scheduled audio.

### ambient / ambient2 ("daydream")
Granular drone engines. Each voice sprouts overlapping grains:
looped source, own pitch, own envelope (att/sus/rel in seconds), random pan,
own slow pitch-warble LFO. Grain length scales with source duration; density
breathes on an LFO × knob × weather.

Loop seams matter: `makeLoopableBuffer()` equal-power crossfades head with tail
and sets `loopEnd` before the tail. Without this, slow/stretched playback
produces periodic clicks that read as metallic buzz.

**Keylock time-stretch** (`timeStretchBuffer`): Hann-windowed 90 ms grains,
50 % overlap-add, ±12 ms input jitter (the jitter is what removes the robotic
periodicity). Cached per 0.25× step. Slower without pitch drop, Traktor-style.

Daydream additions vs ambient: brighter chain (9–10 kHz vs 5.5 kHz), highpass
160 Hz, +1.5 dB presence at 2 kHz, sun-soaked chorus, dual-deck flange
(second deck 12–26 ms late, ±4 cents, at 55 % — unequal levels keep comb
notches shallow, otherwise it sounds metallic), gentle dropouts, dust layer
(hiss + sparse crackle, one shared texture, level following voice activity),
tape saturation (pre-emph +4.5 dB@3.2 k → asymmetric tanh with DC bias →
DC block → de-emph → makeup), and a per-voice tape delay whose time (0.1–0.6 s),
feedback (0.25–0.55) and reverb send all drift independently.

Pitch palette is intentionally narrow: within one step (unison / major third /
fifth). Octave-down grains read as ominous; octave-up as glassy.

### disint ("loops", Basinski model)
A fixed loop repeats; decay is **cumulative and irreversible**. "Flakes" spawn
at fixed angles on the loop and only ever widen/deepen, so the same scars recur
every pass. Playback ducks where the flake is (`gapDepthAt(angle)`), lowpass
closes 8 kHz → 600 Hz with wear, level thins, wow deepens; at wear=1 the loop
fades and removes itself. `Pendant` toggle freezes decay and substitutes slow
multi-minute filter/wow arcs (hypnosis instead of death).
Visual = the same data: a ring eroded exactly where the audio drops, playhead
dot circling. New loops fade in over 10 s (first entrance only).

### rhythm
One recording → 3-piece kit by analysis: loudest frame = kick, highest
zero-crossing×energy = hat, strongest frame ≥100 ms from the kick = snare.
Slices get 4 ms attack + exponential decay + normalization.
Patterns are Euclidean `euclid(k,n,rot)`, one per voice, with mixed lengths
(12 vs 16) for polymeter. Swung 16ths, ±4 ms humanization, ghost notes,
occasional half-pitch kick.
**Bounded mutation**: each bar may flip one step (never step 0), but a healing
rule pulls patterns back toward their original Euclidean base if they drift
more than 3 steps. Evolves forever without becoming chaos.
Visual: concentric step mandalas.

## 5. The world

A simulation layer above all scenes, inspired by murmur.living ("worlds, not
prompts"). One day = 1 hour of listening; weather fronts (clear/breeze/
overcast/rain) crossfade over 30 s every 2–6 min. Weather never plays sounds —
it multiplies engine parameters: `WX.dens`, `WX.dust`, `WX.wow`, `WX.mut`,
`WX.hazeAdd` (night adds haze). Knob values are always respected; the world
only scales them.

An event log murmurs state changes in prose ("a front of rain moves in",
"the tape lost another flake"), throttled to one line per 4 s, fading over 60 s.

**Field recordings**: optional bed from the radio aporee collection mirrored on
archive.org (`advancedsearch.php` → `metadata/{id}` → mp3). Search terms map to
weather. Recording is capped at 90 s, RMS-normalized to a bed level, given a 3 s
loop crossfade, lowpassed (4.5 kHz), sent 40 % into the ambient reverb, and
cross-faded over ~30–40 s when the weather changes or every ~3.5 min.

## 6. Rendering

2D canvas for everything except daydream, which uses a single-pass WebGL
fragment shader implementing an After Effects-style stack:
gradient blobs → turbulent displace (3-octave fbm, plus a slower global domain
warp shared by all blobs = "lava lamp") → barrel lens warp → glow.
Rendered at 0.34× (mobile) / 0.5× resolution — the blur hides it and fragment
cost scales with area. Blobs never shrink below a visible floor; envelope
follower for visuals has fast rise / slow fall so nothing steps.

## 7. Gotchas discovered the hard way

1. `rAF` stops in background tabs → decouple sim from render.
2. Naming a global `W` collided with local `W = canvas width` in several
   functions → `NaN` propagated into the grain scheduler and silently killed
   all audio. Namespace globals (`WX`).
3. Convolver in a feedback loop = runaway gain (IR had 3× gain inside).
   Don't build freeze/infinite reverb from feedback.
4. Equal-level doubled signals with a fixed short delay = comb filtering =
   "metallic". Unequal levels + wider spacing fixes it.
5. Loop seams click; crossfade every looped buffer.
6. `MediaRecorder` mp4 support varies; feature-detect and fall back to webm.
7. Mic requires a secure context — `file://` silently fails with no prompt.
8. Simulating empty scenes wastes real CPU on phones; guard on `items.length`.

## 8. File map

Single file `sound-balls.html`. Companion artifacts:
- `manifest.json`, `icon.png` — PWA/home-screen install
- `soundphysics-ios/` — Capacitor shell + GitHub Actions cloud build (no local Xcode)
- `soundphysics-core/` — framework-free C++17 port of the daydream engine
  (`sp/dsp.h`, `sp/daydream.h`, `sp/wav.h`, CLI harness rendering test WAVs),
  intended for a future native app / AUv3 / Daisy Seed firmware.

# Sound Physics — C++ core

Framework-free port of the Daydream granular engine. No dependencies,
plain C++17. The same DSP compiles for iOS (AVAudioEngine), macOS,
AUv3 plugins, and Daisy Seed.

## Build & run (Mac or Linux)

    make
    ./daydream                  # synthesized test chord, 30s render
    ./daydream myvoice.wav 45   # your own recording, 45s render

Output: `daydream_out.wav` — stereo 48k.

## What's inside

- sp/dsp.h       biquads (RBJ), fractional delays, tape curve, FDN reverb, RNG
- sp/daydream.h  grain voices, chorus, per-voice drifting tape delay,
                 dropouts, shimmer, dual-deck flange, dust, tape chain
- sp/wav.h       minimal wav I/O
- main.cpp       CLI harness

All constants mirror the web app (the tuned spec):
chorus 18ms @0.8-1.4Hz, delay drift 0.1-0.6s, fb 0.25-0.55,
grain rates unison/maj3/5th + octave shimmer, wow ±0.6%, flutter 5-8Hz,
tape: pre-emph +4.5dB@3.2k -> asym tanh (bias .12) -> de-emph, etc.

## Differences from the web version (deliberate)

- Reverb is an 8-line FDN instead of convolution (cheaper, darker, more tape)
- Keylock stretch not ported yet
- Per-voice filters are shared L/R in places (CPU headroom for Daisy)

## Params (DaydreamParams)

density, shimmer, delayMix, verbWet, dust, satDrive, volume —
same ranges and defaults as the web knobs.

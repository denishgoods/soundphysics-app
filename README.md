# Sound Physics

Physics that plays your sounds — balls, pendulums, supershapes, tape loops, ambient worlds.
Record a short sound with the mic; physical/generative systems replay it.

## What's in this repo

- **`sound-balls.html`** — the app itself. Single file, no dependencies, no build step.
  Open it locally (needs to be served over HTTP for mic access — see `start-sound-balls.command`)
  or host it anywhere as a static file / PWA (`manifest.json`, `icon.png` included).
- **`soundphysics-core/`** — framework-free C++17 port of the granular DSP engine
  (the "Daydream" system). Same tuned constants as the web app; compiles standalone,
  and is meant to be portable to iOS (AVAudioEngine), macOS, AUv3, or a Daisy Seed.
- **`soundphysics-ios/`** — native iOS shell (Capacitor + WKWebView) that bundles the
  web app into a real offline iPhone app, with a GitHub Actions workflow
  (`.github/workflows/ios.yml`) to build it in the cloud without needing Xcode.
- **`SPEC.md`** — technical spec: audio graph, the two-clock (sim/render) architecture,
  and the design reasoning behind trickier parts (soft clipping, freeze/sustain, haze).
- **`INSTALL-GUIDE.md`** — plain-language setup guide.
- **`start-sound-balls.command`** — double-click launcher that serves the app on
  `localhost:8765` (mic access requires HTTP, not `file://`).

## Quick start

```bash
./start-sound-balls.command
```

or manually:

```bash
python3 -m http.server 8765
open http://localhost:8765/sound-balls.html
```

For the iOS app and C++ core, see the READMEs in their respective folders.

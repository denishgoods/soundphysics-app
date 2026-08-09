# Sound Physics — iOS app

Native iOS shell (Capacitor + WKWebView) around the Sound Physics app.
The whole app is bundled inside — works fully offline, real icon, real mic permission.

## Requirements

- Mac with Xcode installed (App Store, free)
- Node.js (`brew install node`)
- An Apple ID. Free account = install on your own iPhone (re-sign every 7 days).
  Paid ($99/yr) = TestFlight / App Store, no expiry.

## Build steps (one time, ~10 minutes)

```bash
cd soundphysics-ios
npm install
npx cap add ios
npx cap sync ios
```

Then add the microphone permission — open `ios/App/App/Info.plist` and add inside the top `<dict>`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Sound Physics records short sounds to turn them into instruments.</string>
```

Open the project:

```bash
npx cap open ios
```

In Xcode:
1. Click the "App" project → Signing & Capabilities → pick your Team (your Apple ID).
2. Plug in your iPhone, select it as the run target (top bar).
3. Press ▶. First run: on the phone go to Settings → General → VPN & Device
   Management → trust your developer certificate. Run again.

The app is now on your home screen.

## After changing the app

Edit `www/index.html`, then:

```bash
npx cap sync ios
```

and press ▶ in Xcode again.

## Notes

- Field recordings (archive.org) need internet; everything else is offline.
- Audio pauses when the app is fully backgrounded (WebView limitation).
  Keeping the screen on while it plays works indefinitely.
- Session recordings save via the iOS share sheet into Files.

## Building WITHOUT Xcode (cloud build)

This repo includes `.github/workflows/ios.yml`. Push the folder to a GitHub
repo and GitHub's Mac servers build the app for you:

1. github.com -> new repo -> upload this whole folder (or `git push`)
2. Repo -> Actions tab -> the "build-ios" workflow runs (~10 min)
3. Download `SoundPhysics-ipa` from the run's Artifacts

Installing the IPA on your iPhone (no Xcode, free Apple ID):
- Install AltStore (altstore.io): run AltServer on the Mac (small utility,
  not Xcode), install AltStore to the phone over USB/WiFi
- Open the IPA with AltStore -> it signs with your Apple ID and installs
- Free accounts: app re-signs every 7 days (AltStore does it automatically
  when the phone is on the same WiFi as AltServer)

For permanent installs + auto-updates: Apple Developer account ($99/yr)
and TestFlight - the workflow can upload there directly, no Xcode either.

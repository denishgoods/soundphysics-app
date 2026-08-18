# Sound Physics on your iPhone — step by step

No Xcode. Pick one path.

---

# PATH A — Home screen app (5 minutes, free, easiest)

Same app, launches fullscreen with its own icon. Needs internet the first time.

### 1. Make a GitHub account
- Go to **github.com** → Sign up (free). Skip if you have one.

### 2. Create a repository
- Top right **+** → **New repository**
- Name: `soundphysics`
- Select **Public**
- Click **Create repository**

### 3. Upload 3 files
On the new empty repo page click **uploading an existing file**, then drag in:

| File from your outputs folder | Rename it to |
|---|---|
| `sound-balls.html` | **`index.html`** ← important |
| `manifest.json` | (keep name) |
| `icon.png` | (keep name) |

Click **Commit changes**.

### 4. Turn on GitHub Pages
- Repo → **Settings** (top bar) → **Pages** (left sidebar)
- Under "Build and deployment" → Source: **Deploy from a branch**
- Branch: **main**, folder: **/ (root)** → **Save**
- Wait ~1 minute. The page shows your URL:
  `https://YOURNAME.github.io/soundphysics/`

### 5. Install on the iPhone
- Open that URL **in Safari** (must be Safari, not Chrome)
- Tap the **Share** button (square with an arrow, bottom middle)
- Scroll down → **Add to Home Screen** → **Add**
- Open it from the home screen. When it asks for the microphone → **Allow**

Done. To update later: replace `index.html` in the repo (repo → the file →
pencil icon → paste new content → Commit). The app updates on next launch.

---

# PATH B — Real installed app, cloud-built (~30 min, free)

A true .ipa app. Free Apple ID = must re-sign every 7 days (automatic if
your phone and Mac share WiFi).

### 1. Put the project on GitHub
- Unzip `soundphysics-ios.zip`
- github.com → **+** → **New repository** → name `soundphysics-app` → Public → Create
- On the repo page → **uploading an existing file**
- Drag in **everything inside** the `soundphysics-ios` folder
  (package.json, capacitor.config.json, README.md, the `www` folder,
  and the `.github` folder — if drag-drop hides `.github`, see note below)
- **Commit changes**

> If the `.github` folder doesn't upload (Finder hides dot-folders):
> in the repo click **Add file → Create new file**, and in the name box type
> `.github/workflows/ios.yml` — the slashes create the folders. Paste the
> contents of that file from the zip, then Commit.

### 2. Let GitHub build the app
- Repo → **Actions** tab → if asked, click **I understand my workflows, enable them**
- Click the **build-ios** workflow → **Run workflow** → **Run workflow**
- Wait ~10 minutes (yellow dot → green check)
- Click the finished run → scroll to **Artifacts** → download **SoundPhysics-ipa**
- Unzip it → you have `SoundPhysics-unsigned.ipa`

### 3. Install AltStore (this is NOT Xcode, ~50 MB)
- On the Mac: go to **altstore.io** → Download AltServer for Mac
- Open AltServer (it lives in the menu bar, top right)
- Plug the iPhone into the Mac with a cable, unlock the phone, tap **Trust**
- Menu bar AltServer icon → **Install AltStore** → pick your iPhone
- Enter your Apple ID + password (free account is fine — it's Apple's login,
  AltStore uses it to sign the app)
- On the iPhone: **Settings → General → VPN & Device Management** →
  tap your Apple ID email → **Trust**

### 4. Install the app
- AirDrop or copy `SoundPhysics-unsigned.ipa` to the iPhone (Files app)
- Open **AltStore** on the phone → **My Apps** tab → **+** (top left)
- Choose the .ipa → it installs (takes a minute)
- Allow the microphone when asked

Done — real app on the home screen, works offline.

### Keeping it alive (free accounts only)
The signature expires after 7 days. Keep AltServer running on the Mac; when
the phone is on the same WiFi, AltStore refreshes it automatically. You can
also refresh manually: AltStore → My Apps → **Refresh All**.

---

# PATH C — Permanent app + auto updates ($99/year)

Only differences from Path B: no weekly expiry, updates arrive by themselves,
and you can publish to the App Store later.

1. **developer.apple.com** → Account → **Enroll** → Apple Developer Program
   ($99/yr, approval usually within a day)
2. **appstoreconnect.apple.com** → Users and Access → **Integrations** →
   **App Store Connect API** → generate a key. Download the `.p8` file,
   note the **Key ID** and **Issuer ID**
3. In the GitHub repo → **Settings → Secrets and variables → Actions** →
   add secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (paste file contents)
4. Tell me it's done — I'll swap the workflow to upload straight to TestFlight
5. On the iPhone: install **TestFlight** from the App Store → the app appears
   there → Install. Every new build arrives automatically.

---

## Which should you pick?

- **Just want it on the phone today** → Path A
- **Want a real installed app, free** → Path B
- **Want it to just work forever, and maybe publish it** → Path C

Paths A and B can both be done — they don't conflict.

# 🐥 ChickPence

**Batch-Centric Relational Database System for Poultry Cost and Profitability Analysis**
*Thesis Documentation — BS Computer Science, Pamantasan ng Lungsod ng Maynila (PLM)*

An offline-first web app (PWA) for broiler farms: record expenses, feed, mortality and sales per batch, see cost and profit per batch, export reports, and scan the paper logbook with a local AI.

---

## Contents

1. [Features](#-features)
2. [Dependencies](#-dependencies)
3. [How to run the app](#-how-to-run-the-app)
4. [Local AI for logbook scanning (Ollama)](#-local-ai-for-logbook-scanning-ollama)
5. [Voice typing (Whisper in the browser)](#-voice-typing-whisper-in-the-browser)
6. [Cloud sync (Supabase): local or hosted](#-cloud-sync-supabase-local-or-hosted)
7. [Environment variables](#-environment-variables)
8. [npm scripts](#-npm-scripts)
9. [Project structure](#-project-structure)
10. [Troubleshooting](#-troubleshooting)

---

## 📋 Features

- **Multiple open batches** at the same time, each with its own chick count, chick cost and optional mortality threshold. Batches are **Open** while running and **Closed** (read-only) when finished.
- **Farm-level expenses** (feed and other costs) are entered once and **allocated automatically** to the batches that were alive that day, by head count. An allocation preview shows each batch's share before saving.
- **Feed** (kg), **mortality** (deaths per day, running rate) and **sales** (buyer, heads, kg, price/kg) per batch.
- **Dashboard** with open-batch KPIs, mortality warnings and a net profit trend for closed batches.
- **History** and a read-only **Batch Summary** report per batch.
- **Export** a detailed batch report, the whole history or the farm expenses to **Excel, PDF or CSV**.
- **Import file:** bring logs in from Excel (.xlsx, .xls), OpenDocument (.ods), CSV or PDF files, including ChickPence's own exports; the entries are reviewed before saving.
- **Scan logbook:** take a photo of the paper logbook; a **local AI** (Ollama) reads it and drafts the entries for you to review. Nothing is saved until you confirm, and photos never leave the computer.
- **Voice typing:** say an entry in Filipino, Taglish or English and the entry form fills itself. Speech is turned into text by Whisper inside the browser, so recordings never leave the device.
- **AI suggestions:** advice on the Dashboard and each Batch Summary, written by the local AI from the app's own computed numbers (can be set to automatic, on request, or off).
- **Offline-first:** data lives in the browser (IndexedDB via Dexie) and syncs to **Supabase** (PostgreSQL + Auth) when configured and online. Without Supabase the app runs in **Demo Mode** with 8 sample batches.

---

## 🧩 Dependencies

Only **Node.js** and a **browser** are required. Everything else is optional and adds one feature.

### Programs to install

| Program | Needed for | Required? | Version (tested) | Install |
|---|---|---|---|---|
| [Node.js](https://nodejs.org/) (includes npm) | Installing packages, running the app, tests and builds | **Yes** | Node **20, 22 or 24+** (tested on 25.9), npm 10+ (tested on 11.12) | `winget install OpenJS.NodeJS.LTS` · `brew install node` |
| Chrome or Edge | Running the app | **Yes** | any current version | other current browsers work, but voice typing was tested only in Chrome and Edge |
| [Git](https://git-scm.com/) | Downloading the code | Recommended (or download the ZIP from GitHub) | any (tested on 2.53) | `winget install Git.Git` · `brew install git` |
| [Ollama](https://ollama.com/) | Logbook scanning, AI suggestions, AI reading of unrecognised import lines and voice sentences | Optional | **0.30+** (tested on 0.40.10) | `winget install Ollama.Ollama` · `brew install ollama` · Linux: `curl -fsSL https://ollama.com/install.sh \| sh` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Running Supabase on your own computer | Only for local Supabase | tested on 4.96 (Docker 29.9) | `winget install Docker.DockerDesktop`; Windows also needs WSL 2 (`wsl --update --web-download`) |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | Starting local Supabase | Only for local Supabase | tested on 2.122 | nothing to install: run it with `npx supabase …` |
| A [Supabase](https://supabase.com/) project | Real accounts and cloud sync | Optional | hosted (free plan) **or** local with Docker | see [Cloud sync](#-cloud-sync-supabase-local-or-hosted) |

### AI models

| Model | Used for | Size | How it gets there |
|---|---|---|---|
| `glm-ocr` (Ollama) | Reading a logbook photo into text | ≈ 2.7 GB | `ollama pull glm-ocr` |
| `qwen3.5:4b` (Ollama) | Lines the rules can't read, AI suggestions | ≈ 3.3 GB | `ollama pull qwen3.5:4b` |
| `onnx-community/whisper-small` (Hugging Face) | Voice typing (default, accurate in Filipino) | ≈ 240 MB | downloaded by the browser the first time you tap **🎤 Speak**, then kept for offline use |
| `onnx-community/whisper-base` (Hugging Face) | Voice typing (faster, weaker in Filipino; choose it in ⚙) | ≈ 73 MB | same as above |

Other Ollama vision/chat models can be chosen in **⚙ Local AI settings**.

### npm packages

All installed by `npm install` from `package.json` (exact versions are pinned in `package-lock.json`). Nothing to install by hand.

**Runtime** (shipped with the app)

| Package | Version | Used for |
|---|---|---|
| `dexie` | 4.4.6 | IndexedDB database in the browser (offline storage, sync outbox, scan queue, suggestions) |
| `@supabase/supabase-js` | 2.117.2 | Supabase Auth and PostgreSQL sync |
| `chart.js` | 4.5.1 | Dashboard profit chart |
| `write-excel-file` | 4.1.1 | Excel (.xlsx) export |
| `jspdf` | 4.2.1 | PDF export |
| `jspdf-autotable` | 5.0.9 | Tables in PDF export |
| `read-excel-file` | 9.3.12 | Importing Excel (.xlsx) files |
| `xlsx` (SheetJS Community Edition) | 0.20.3 | Importing old Excel (.xls) and OpenDocument (.ods) files. Installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, because the npm registry copy is no longer updated |
| `pdfjs-dist` | 6.4.299 | Importing PDF files |
| `@huggingface/transformers` | 4.3.1 | Running Whisper (voice typing) in the browser; brings `onnxruntime-web`, whose WebAssembly files are served by the app itself |

Chart.js, the export, import and voice libraries are loaded only when used, so the app starts fast. They are stored by the service worker, so they also work offline.

**Development** (only for building and testing)

| Package | Version | Used for |
|---|---|---|
| `vite` | 6.4.5 | Dev server and bundler |
| `@vitejs/plugin-basic-ssl` | 2.3.0 | Self-signed https for `npm run dev:lan` / `preview:lan` |
| `vite-plugin-pwa` | 0.21.2 | Service worker and web app manifest (offline PWA) |
| `workbox-window` | 7.4.1 | Service worker updates |
| `tailwindcss` + `@tailwindcss/vite` | 4.3.3 | CSS framework |
| `postcss`, `autoprefixer` | 8.5.28 / 10.6.1 | CSS processing |
| `vitest` | 4.1.12 | Unit tests (needs Node 20+) |

### Downloaded while the app runs

| What | From | When |
|---|---|---|
| Poppins font | Google Fonts | page load (falls back to the system font offline) |
| Whisper model files | huggingface.co | first use of voice typing only |
| Noto Sans (for ₱ in PDFs) | bundled in the app (`src/assets/fonts/`) | nothing to download |

### What works without the optional parts

| Setup | What you get |
|---|---|
| Node + browser only | The full app in **Demo Mode**: batches, expenses, feed, mortality, sales, dashboard, history, export, file import, voice typing (after the one-time model download) |
| + Ollama and its 2 models | Logbook photo scanning, AI suggestions, AI reading of lines the rules can't read |
| + Supabase (local with Docker, or hosted) | Sign-in with real accounts and sync to PostgreSQL |

---

## 🚀 How to run the app

### First time only

1. **Install Node.js** (LTS) and check it is 20 or newer:

   ```bash
   winget install OpenJS.NodeJS.LTS
   ```
   ```bash
   node -v
   ```

   On macOS use `brew install node`; on Linux, your package manager or [nodejs.org](https://nodejs.org/).

2. **Get the code** (or download the ZIP from GitHub and unzip it):

   ```bash
   git clone https://github.com/jersy26/ChickPence.git
   ```
   ```bash
   cd ChickPence
   ```

3. **Install the npm packages** (a few minutes the first time):

   ```bash
   npm install
   ```

4. *(Optional)* **Settings file.** Only needed for Supabase or a non-default Ollama setup:

   ```bash
   cp .env.example .env
   ```

### Start the app

```bash
npm run dev
```

Open **http://localhost:3000** in Chrome or Edge. If port 3000 is busy, the terminal shows the address it used instead (e.g. 3001).

On Windows you can instead double-click **`start.bat`**: it installs the packages if they are missing, starts the app and opens the browser.

Leave the terminal open while you use the app; press **Ctrl + C** in it to stop.

### Use it without an account (Demo Mode)

On the login screen click **Instant Demo Mode**. The app creates 8 realistic batches (`Batch 2025-08` to `Batch 2026-09`) in the browser. Nothing is sent anywhere and no internet is needed.

To start the demo data over, clear the site data (DevTools → Application → Storage → Clear site data) and reload. When a real Supabase account logs in on the same browser, the demo data is cleared and that account's own records are downloaded; records not uploaded yet are never cleared.

### Turn on the local AI (optional)

1. Install and open Ollama (it then runs in the background), and download the two models once:

   ```bash
   ollama pull glm-ocr
   ```
   ```bash
   ollama pull qwen3.5:4b
   ```

2. In the app: **Open Batches → ⚙** (next to 📷 Scan logbook) → **Test connection** → pick the models → **Save**.

Details, hardware and other models: [Local AI](#-local-ai-for-logbook-scanning-ollama).

### Turn on accounts and sync (optional)

Local Supabase, with Docker Desktop running:

```bash
npx supabase start -x realtime,storage-api,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor
```

Then put its URL and anon key in `.env` (or in **⚙ Connect Supabase Cloud** on the login screen), restart `npm run dev`, create a user in Supabase Studio (http://127.0.0.1:54323) and log in. Full steps, and the hosted option: [Cloud sync](#-cloud-sync-supabase-local-or-hosted).

### Every day, with everything turned on

1. Start **Docker Desktop**, then `npx supabase start -x …` (only if you use local Supabase).
2. Make sure **Ollama** is running (tray icon; only if you use the AI features).
3. `npm run dev` (or `start.bat`) and open http://localhost:3000.

### Production build (offline install)

The offline service worker only works in the production build:

```bash
npm run build
```
```bash
npm run preview
```

Open **http://localhost:4173**. To host the built `dist/` folder on another server, that server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (voice typing is about 5× slower without them).

### On a phone or another computer

On the farm PC, start the app on the local network over https:

```bash
npm run dev:lan
```

On the phone (same Wi-Fi), open the `https://<PC's IP>:3000` address the terminal prints and accept the certificate warning once (**Advanced → Proceed**). See [Scanning from a phone](#scanning-from-a-phone-or-another-computer).

### Run the tests

```bash
npm test
```

### Stop everything

- The app: **Ctrl + C** in its terminal.
- Local Supabase (data is kept): `npx supabase stop`.
- Ollama: quit it from the tray icon, or leave it running (it frees the model's memory after a few idle minutes).

---

## 🤖 Local AI for logbook scanning (Ollama)

**Scan logbook** (Open Batches page, next to **+ Add New Log**) runs entirely on your computer with [Ollama](https://ollama.com/). No API key and no internet connection are needed once the models are downloaded.

How a photo is read:

1. **`glm-ocr`** (vision model, 0.9B) reads the photo into text.
2. Built-in rules turn common logbook lines into entries instantly, for example `Okt 26 Batch 2026-09 patay 4`, `feeds 5 sako P12,500`, `benta Aling Nena 120 hds 245.5 kg @118/kg`, `patuka 150 kg`.
3. Only lines the rules can't read go to **`qwen3.5:4b`** (text model).
4. You review every draft, fix anything marked **?**, then save.

### Hardware

| | Minimum | Notes |
|---|---|---|
| RAM | 8 GB | With 8 GB and no GPU, one logbook page takes about 2 minutes. Close other apps for the first scan. |
| Disk | ~6 GB free | `glm-ocr` ≈ 2.7 GB, `qwen3.5:4b` ≈ 3.3 GB |
| GPU | Not needed | A supported NVIDIA/AMD GPU or Apple Silicon makes it much faster |

### 1. Install Ollama

```bash
# Windows (or download the installer from https://ollama.com/download)
winget install Ollama.Ollama
```
```bash
# macOS (or download the app from https://ollama.com/download)
brew install ollama
```
```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

Check the version (must be 0.30 or newer):

```bash
ollama --version
```

### 2. Start Ollama

- **Windows / macOS:** open the **Ollama** app once. It keeps running in the system tray / menu bar and starts with your computer.
- **Linux** (or if you prefer a terminal):

```bash
ollama serve
```

Ollama listens on **http://localhost:11434**. Check that it is running:

```bash
curl http://localhost:11434/api/version
```

### 3. Download the two models

```bash
ollama pull glm-ocr
```
```bash
ollama pull qwen3.5:4b
```

Check they are installed:

```bash
ollama list
```

### 4. Connect the app

1. Run the app (`npm run dev`) and open **Open Batches**.
2. Click **⚙** next to **📷 Scan logbook**.
3. Click **Test connection**. The two model fields become dropdowns of your installed models.
4. Pick `glm-ocr` as the reading model and `qwen3.5:4b` as the sorting model, then **Save**.

If the button shows **· AI off**, hover over it to see why (Ollama not running, or a model missing). You can still take photos: they wait in a queue and are scanned the next time you open Open Batches with Ollama running.

You can use other models: any Ollama **vision** model for reading, any **chat** model for sorting. Set them in the ⚙ dialog or with the `VITE_OLLAMA_*` variables below.

### Scanning from a phone or another computer

Ollama stays as it is (only reachable from the farm PC). The app's own server passes `/ollama` on to it, so a phone talks to Ollama through the app's address: no `OLLAMA_HOST` / `OLLAMA_ORIGINS` setup.

1. On the computer that runs Ollama, start the app on the network over **https** (phones allow the microphone only on https pages):

   ```bash
   npm run dev:lan
   ```

   or, for the production build (`npm run build` first):

   ```bash
   npm run preview:lan
   ```

2. On the phone (same Wi-Fi), open the `https://<this computer's IP>:3000` address the command prints (`:4173` for `preview:lan`). The certificate is self-signed, so the browser warns once: choose **Advanced → Proceed**.

3. The Ollama address is `/ollama` by default when the app is opened from another device (check it in **⚙**).

Plain `npm run dev -- --host` (http) also works for scanning, but then the microphone is hidden on the phone.

The `/ollama` pass-through exists only in `npm run dev` / `npm run preview`, and it passes on only the two calls the app makes (`/api/tags` and `/api/chat`), so devices on the Wi-Fi cannot pull or delete models through it. If you host the built app elsewhere, give that server the same pass-through (only those two paths, to `http://localhost:11434`, without the `Origin` header), or set `OLLAMA_HOST` and `OLLAMA_ORIGINS` on the farm PC and use `http://<IP>:11434` (that opens all of Ollama to the network).

---

## 🎤 Voice typing (Whisper in the browser)

In **+ Add New Log** (new entries), tap **🎤 Speak**, say one entry, and pause. The recording stops by itself, is turned into text **on this device**, and the form fills in: the right tab, the batch, the date and the amounts. Check the highlighted fields and tap **Save**. Example: *"May tatlong patay sa batch siyam kahapon"* → Mortality, Batch 2026-09, yesterday, 3.

- **Nothing to install.** The first time, the browser downloads the Whisper model (≈ 240 MB, about a minute); after that it works **offline**.
- **Language:** Filipino or English (PH), picked next to the mic. **⚙ Local AI settings → Voice typing model** switches to the faster but weaker `whisper-base`.
- The text box under the mic shows what was heard; fix a word and press **Fill form**, or type a sentence without the mic.
- Sentences the built-in rules can't read go to the Ollama text model, if it is running.
- **Microphone access** needs `localhost` or an **https** page. On a phone use `npm run dev:lan` (see [Scanning from a phone](#scanning-from-a-phone-or-another-computer)).
- **Speed:** a sentence takes about 10–18 s on a CPU-only PC. The app must be served with the COOP/COEP headers (`npm run dev` and `npm run preview` do this) to use several CPU threads.

---

## ☁ Cloud sync (Supabase): local or hosted

Supabase is optional. Without it the app runs in Demo Mode and keeps data only in the browser.

The database schema is in `supabase/migrations/` and is applied in order:

| File | What it does |
|---|---|
| `20260930000000_init_chickpence.sql` | Tables `batch`, `daily_cost`, `feed_log`, `mortality_log`, `sale`, row-level security |
| `20260930000001_v2_multi_batch.sql` | Multi-batch model: status `Open`/`Closed`, new farm-level `expense` table, drops `cost_budget` and `feed_type` |
| `20261028000000_v3_feed_grams.sql` | Feed quantity in whole grams (`feed_log.quantity_g`), like the app stores it; converts existing `quantity_kg` rows |

### Option A: run Supabase locally (Docker)

Runs PostgreSQL, Auth, the REST API and Supabase Studio on your computer. Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/), about 5 GB of free disk for the images and about 2–3 GB of free RAM. The Supabase config (`supabase/config.toml`) is already in the repository, so there is no `supabase init` step.

Tested on Windows 11 21H2 with 8 GB RAM, Docker Desktop 4.96 and Supabase CLI 2.122.

1. **Windows only:** Docker Desktop runs on WSL 2, which needs its Linux kernel installed. Open **PowerShell as Administrator** and run the command below, then restart the computer if it asks:

   ```bash
   wsl --update --web-download
   ```

   `--web-download` gets WSL straight from Microsoft instead of the Microsoft Store. Plain `wsl --update` goes through the Store and can silently do nothing when Store or Windows updates are restricted (seen on Windows 11 21H2).

   Check it worked: `wsl --version` must print version numbers (e.g. `WSL version: 3.0.3.0`). If it says *"Invalid command line option"*, the old built-in WSL is still active and Docker will show *"WSL needs updating"* / *"Docker Desktop is unable to start"*.

2. Start Docker Desktop and wait until it says **Engine running** (the first start takes 1–3 minutes). Check that the engine, not just the program, is up:

   ```bash
   docker info
   ```

3. Start Supabase with only the services ChickPence uses (database, login, REST API, gateway, Studio). The first run downloads about 3 GB of images. The migrations in `supabase/migrations/` are applied automatically:

   ```bash
   npx supabase start -x realtime,storage-api,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor
   ```

   `npx` asks to install the Supabase CLI the first time; answer **y**. Plain `npx supabase start` also works, but it downloads and runs every Supabase service; on an 8 GB PC that made Docker Desktop shut down mid-download (*"unexpected EOF"*). If a download fails, run the command again: finished images are kept.

   When it is done it prints `Applying migration ...` for each file and then the URLs and keys.

4. Get the **API URL** and the **anon key**:

   ```bash
   npx supabase status -o env
   ```

   Use `API_URL` (`http://127.0.0.1:54321`) and `ANON_KEY` (the long value starting with `eyJ`).

5. Create a user: open **Supabase Studio** at http://127.0.0.1:54323 → **Authentication** → **Users** → **Add user** → **Create new user**. Enter an email and password; **Auto confirm user?** is ticked by default, so leave it on. Click **Create user**.

6. Connect the app (see [Connecting the app](#connecting-the-app)): put `API_URL` and `ANON_KEY` in `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and restart `npm run dev`, or paste them in **⚙ Connect Supabase Cloud** on the login screen. Then log in with the user from step 5.

7. Check sync: create a batch or add a log. The sidebar sync status should return to **All synced**, and the row appears in Studio → **Table Editor**.

Other useful commands:

```bash
# Stop Supabase (data is kept)
npx supabase stop
```
```bash
# Apply migrations added since you last started
npx supabase migration up
```
```bash
# Wipe the local database and re-apply all migrations (deletes users and data)
npx supabase db reset
```

**Freeing disk space afterwards.** Docker keeps its images in one disk file (`%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx` on Windows) that grows but never shrinks on its own. Images the `-x` command doesn't use can be removed with `docker rmi` (e.g. `realtime`, `logflare`, `vector`, `mailpit`); keep `storage-api`, which `supabase start` downloads even when excluded. To give the space back to Windows, quit Docker Desktop, run `wsl --shutdown`, then in an Administrator `diskpart`:

```
select vdisk file="C:\Users\<you>\AppData\Local\Docker\wsl\disk\docker_data.vhdx"
attach vdisk readonly
compact vdisk
detach vdisk
```

### Option B: hosted Supabase project

1. Create a free project at [supabase.com](https://supabase.com).
2. In the **SQL Editor**, run the three files in `supabase/migrations/` in order. Read the comments at the top of the v2 file first if the project already has data. A project set up before October 2026 needs only `20261028000000_v3_feed_grams.sql`; without it, feed logs don't sync.
3. **Authentication** → **Sign In / Providers**: turn **off** "Allow new users to sign up". Every signed-in user can read and change all farm records, and the anon key is inside the app, so with sign-ups on anyone could make an account and get them. (Local Supabase has sign-ups off in `supabase/config.toml`.) Then **Authentication** → **Users** → **Add user**.
4. **Project Settings** → **API**: copy the **Project URL** and the **anon public** key into `.env`.

### Working offline with a Supabase account

- **Demo Mode** never needs a login or a connection.
- **The first login** on a device needs Supabase to be reachable (local: `npx supabase start`; hosted: internet).
- **After that, no login is needed offline.** The login is saved on the device. When the app starts without a connection, it waits up to 3 seconds for Supabase, then opens your records from the device. This also works after the saved login has expired (more than an hour offline).
- **Entries made offline** wait in the sync queue. When Supabase is reachable again, the app renews the login and uploads them within a few seconds; nothing to do.
- **Don't log out while offline.** Logging in again needs Supabase. Logging out keeps entries that are not uploaded yet.

### Connecting the app

Either:

- **`.env` file** (recommended): see below, then restart `npm run dev`.
- **In the app:** on the login screen click **⚙ Connect Supabase Cloud**, paste the URL and anon key, and click **Save & Connect**. This is stored in the browser and overrides `.env`.

---

## 🔧 Environment variables

Copy the example file and fill in what you use. Every variable is optional.

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | *(empty → Demo Mode)* | Supabase API URL, e.g. `http://127.0.0.1:54321` (local) or `https://xyz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | *(empty)* | Supabase anon (public) key |
| `VITE_OLLAMA_URL` | `http://localhost:11434` on the farm PC, `/ollama` from other devices | Ollama address |
| `VITE_OLLAMA_OCR_MODEL` | `glm-ocr` | Vision model that reads the photo |
| `VITE_OLLAMA_TEXT_MODEL` | `qwen3.5:4b` | Text model for lines the rules can't read |

Vite reads `.env` only when the dev server starts, so restart `npm run dev` after changing it. Settings saved in the app (⚙ dialogs) override these values for that browser. `.env` is in `.gitignore`; never commit real keys.

---

## 📜 npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload on http://localhost:3000 |
| `npm test` | Run the unit tests once (Vitest) |
| `npm run build` | Production build into `dist/` (includes the service worker for offline use) |
| `npm run preview` | Serve the production build locally on http://localhost:4173 |
| `npm run dev:lan` / `npm run preview:lan` | Same, on the local network over https (self-signed certificate) for phones |

The offline service worker is only active in the production build, so test offline behaviour with `npm run build` then `npm run preview`.

---

## 📁 Project structure

```
ChickPence/
├── public/                     # Icons for the PWA
├── src/
│   ├── assets/fonts/           # Noto Sans for PDFs (₱ sign), SIL OFL licence
│   ├── db/
│   │   ├── dexie.js            # IndexedDB schema and upgrades
│   │   ├── localData.js        # Whose records the browser holds (demo vs. account)
│   │   └── seed.js             # Demo Mode sample batches
│   ├── services/
│   │   ├── repository.js       # All reads and writes (single write path)
│   │   ├── allocationEngine.js # Expense allocation by head count, batch metrics
│   │   ├── allocationService.js
│   │   ├── calculations.js     # Formatting and dashboard averages
│   │   ├── syncEngine.js       # Outbox and Supabase sync
│   │   ├── supabaseClient.js   # Supabase client and credentials
│   │   ├── auth.js             # Supabase Auth or Demo session
│   │   ├── exportService.js    # Excel / PDF / CSV reports
│   │   ├── fileImport.js       # Excel / CSV / PDF / .xls / .ods → draft entries
│   │   ├── localLlm.js         # Ollama client and settings
│   │   ├── logbookParser.js    # Rule-based logbook and spoken-sentence reader
│   │   ├── aiParseService.js   # Scan flow: photo → drafts, scan queue
│   │   ├── speechInput.js      # Recording and the Whisper worker client
│   │   ├── whisperWorker.js    # Whisper (Transformers.js) in a Web Worker
│   │   └── insightsService.js  # AI suggestions from computed facts
│   ├── ui/
│   │   ├── dashboardView.js, batchesView.js, historyView.js, summaryView.js, loginView.js, shell.js
│   │   ├── exportMenu.js       # Export modal
│   │   ├── importReviewModal.js# Review scanned / imported entries, scan progress
│   │   ├── localAiModal.js     # Local AI and voice settings
│   │   ├── insightsCard.js     # Suggestions card
│   │   ├── syncProblemsModal.js# Changes the server refused
│   │   └── modals.js, toast.js
│   ├── main.js                 # App start-up and view router
│   └── style.css
├── supabase/
│   ├── config.toml             # Local Supabase settings (npx supabase start)
│   └── migrations/             # PostgreSQL schema
├── tests/                      # Vitest unit tests
├── docs/SESSION_HANDOFF.md     # Development notes and decisions
├── .env.example
├── start.bat                   # Windows: start the dev server and open the browser
├── index.html
├── package.json
└── vite.config.js
```

---

## 🛟 Troubleshooting

| Problem | Fix |
|---|---|
| `npm test` fails with an engine or syntax error | Use Node 20 or newer (`node -v`) |
| Port 3000 already in use | Vite uses the next free port; check the terminal for the address |
| **Scan logbook** shows **· AI off** | Hover to see the reason. Start the Ollama app (or `ollama serve`), check `ollama list` shows both models, then click **⚙ → Test connection** |
| Scan is very slow | Normal on a CPU-only PC (about 2 min per page with 8 GB RAM). Close other apps; the first scan after start-up also loads the model |
| "Cannot reach the local AI" from a phone | Start the app with `npm run dev:lan` and set the Ollama address in ⚙ to `/ollama` (see [Scanning from a phone](#scanning-from-a-phone-or-another-computer)) |
| Login says invalid credentials with Supabase | Create the user in Supabase (Studio → Authentication → Add user, with Auto Confirm) |
| `npx supabase start` fails | Make sure the Docker engine is running (`docker info` must not show an error). If downloads stop with *"unexpected EOF"*, Docker ran out of memory: use the `-x ...` command from Option A step 3 and run it again |
| Feed logs never finish syncing (`Could not find the 'quantity_g' column`) | Run `20261028000000_v3_feed_grams.sql` on the database (`npx supabase migration up` locally, SQL Editor when hosted) |
| Docker Desktop says "unable to start" or "WSL needs updating" (Windows) | Run `wsl --update --web-download` in PowerShell as Administrator, check `wsl --version` prints a version, restart, then start Docker Desktop again |
| No 🎤 Speak button | The page must be `localhost` or https, and the browser must allow the microphone. On a phone use `npm run dev:lan` |
| Voice typing is very slow | The app must be served with the COOP/COEP headers (`npm run dev` / `npm run preview` do); the first use also downloads the model |
| `npm install` fails on the `xlsx` package | It downloads from `cdn.sheetjs.com`: check the internet connection or a firewall/proxy blocking that site |
| Changes to `.env` have no effect | Restart `npm run dev`; also check the in-app ⚙ settings, which override `.env` |
| Some records stay "pending sync" | A record Supabase rejects is retried on every sync, and other records keep uploading. Records of a rejected batch wait for it. The browser console shows `Sync error on …` with the reason |

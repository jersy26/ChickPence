# 🐥 ChickPence

**Batch-Centric Relational Database System for Poultry Cost and Profitability Analysis**
*Thesis Documentation — BS Computer Science, Pamantasan ng Lungsod ng Maynila (PLM)*

An offline-first web app (PWA) for broiler farms: record expenses, feed, mortality and sales per batch, see cost and profit per batch, export reports, and scan the paper logbook with a local AI.

---

## Contents

1. [Features](#-features)
2. [Dependencies at a glance](#-dependencies-at-a-glance)
3. [Quick start (app only)](#-quick-start-app-only)
4. [Local AI for logbook scanning (Ollama)](#-local-ai-for-logbook-scanning-ollama)
5. [Cloud sync (Supabase): local or hosted](#-cloud-sync-supabase-local-or-hosted)
6. [Environment variables](#-environment-variables)
7. [npm scripts](#-npm-scripts)
8. [npm packages](#-npm-packages)
9. [Project structure](#-project-structure)
10. [Troubleshooting](#-troubleshooting)

---

## 📋 Features

- **Multiple open batches** at the same time, each with its own chick count, chick cost and optional mortality threshold. Batches are **Open** while running and **Closed** (read-only) when finished.
- **Farm-level expenses** (feed and other costs) are entered once and **allocated automatically** to the batches that were alive that day, by head count. An allocation preview shows each batch's share before saving.
- **Feed** (kg), **mortality** (deaths per day, running rate) and **sales** (buyer, heads, kg, price/kg) per batch.
- **Dashboard** with open-batch KPIs, mortality warnings and a net profit trend for closed batches.
- **History** and a read-only **Batch Summary** report per batch.
- **Export** a detailed batch report or the whole history to **Excel, PDF or CSV**.
- **Scan logbook:** take a photo of the paper logbook; a **local AI** (Ollama) reads it and drafts the entries for you to review. Nothing is saved until you confirm, and photos never leave the computer.
- **Offline-first:** data lives in the browser (IndexedDB via Dexie) and syncs to **Supabase** (PostgreSQL + Auth) when configured and online. Without Supabase the app runs in **Demo Mode** with 8 sample batches.

---

## 🧩 Dependencies at a glance

| Dependency | Needed for | Required? | Version used |
|---|---|---|---|
| [Node.js](https://nodejs.org/) + npm | Installing packages, running the dev server, tests and builds | **Yes** | Node **20, 22 or 24+** (tested on 25.9), npm 10+ |
| A modern browser | Running the app | **Yes** | Chrome or Edge recommended (camera, IndexedDB, service worker) |
| [Git](https://git-scm.com/) | Cloning the repository | Recommended | any |
| [Ollama](https://ollama.com/) + 2 models | **Scan logbook** (local AI) | Optional | Ollama **0.30+** (tested on 0.40.10), models `glm-ocr` and `qwen3.5:4b` |
| [Supabase](https://supabase.com/) | Cloud sync and real user accounts | Optional | Hosted project, **or** locally with the Supabase CLI + Docker |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Running Supabase locally | Only for local Supabase | any recent version |

Everything else is an npm package and is installed by `npm install` (see [npm packages](#-npm-packages)).

What works without the optional parts:

| Setup | What you get |
|---|---|
| Node only | The full app in Demo Mode: batches, expenses, feed, mortality, sales, dashboard, history, exports |
| + Ollama | Logbook scanning |
| + Supabase | Sign-in with real accounts and sync to PostgreSQL |

---

## 🚀 Quick start (app only)

### 1. Install Node.js

Install the **LTS** version from [nodejs.org](https://nodejs.org/), or with a package manager:

```bash
# Windows
winget install OpenJS.NodeJS.LTS
```
```bash
# macOS
brew install node
```

Check it (Node must be 20 or newer):

```bash
node -v
```

### 2. Get the code and install packages

```bash
git clone https://github.com/jersy26/ChickPence.git
```
```bash
cd ChickPence
```
```bash
npm install
```

### 3. Run the app

```bash
npm run dev
```

Open **http://localhost:3000**. If port 3000 is busy, Vite picks the next free port and prints it in the terminal.

On Windows you can also double-click **`start.bat`**: it opens the browser and starts the dev server.

### 4. Try it in Demo Mode

On the login screen click **Instant Demo Mode**. The app creates 8 realistic batches (`Batch 2025-08` to `Batch 2026-09`) in the browser's IndexedDB. Nothing is sent anywhere.

To start the demo data over, clear the site data in the browser (DevTools → Application → Storage → Clear site data) and reload.

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

By default Ollama only accepts requests from the same computer (`localhost`). To scan from a phone on the same Wi-Fi, on the computer that runs Ollama:

1. Set two environment variables, then **restart Ollama**:
   - `OLLAMA_HOST=0.0.0.0` (listen on the network)
   - `OLLAMA_ORIGINS=http://<this computer's IP>:3000` (allow the app's address)

   ```bash
   # Windows (PowerShell), then quit and reopen the Ollama app
   setx OLLAMA_HOST 0.0.0.0
   ```
   ```bash
   setx OLLAMA_ORIGINS http://192.168.1.10:3000
   ```
   ```bash
   # macOS
   launchctl setenv OLLAMA_HOST 0.0.0.0
   ```
   ```bash
   launchctl setenv OLLAMA_ORIGINS http://192.168.1.10:3000
   ```
   On Linux, add both to the `ollama` systemd service (`sudo systemctl edit ollama`) as `Environment=` lines, then `sudo systemctl restart ollama`.

2. Start the app on the network:

   ```bash
   npm run dev -- --host
   ```

3. On the phone, open `http://<this computer's IP>:3000`, then in **⚙** set the Ollama address to `http://<this computer's IP>:11434`.

The app must be opened over **http** for this. Browsers block an **https** page from calling `http://<IP>:11434`.

---

## ☁ Cloud sync (Supabase): local or hosted

Supabase is optional. Without it the app runs in Demo Mode and keeps data only in the browser.

The database schema is in `supabase/migrations/` and is applied in order:

| File | What it does |
|---|---|
| `20260930000000_init_chickpence.sql` | Tables `batch`, `daily_cost`, `feed_log`, `mortality_log`, `sale`, row-level security |
| `20260930000001_v2_multi_batch.sql` | Multi-batch model: status `Open`/`Closed`, new farm-level `expense` table, drops `cost_budget` and `feed_type` |

### Option A: run Supabase locally (Docker)

Runs PostgreSQL, Auth and Supabase Studio on your computer. Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/) running and about 4 GB of free RAM.

1. Start Docker Desktop, then check it:

   ```bash
   docker --version
   ```

2. Create the Supabase config (first time only; answer **N** to the editor-settings questions). This adds `supabase/config.toml` and keeps the existing migrations:

   ```bash
   npx supabase init
   ```

3. Start Supabase. The first run downloads several Docker images and takes a few minutes. The migrations in `supabase/migrations/` are applied automatically:

   ```bash
   npx supabase start
   ```

4. Copy the **API URL** (`http://127.0.0.1:54321`) and the **anon key** from the output. To see them again:

   ```bash
   npx supabase status
   ```

5. Create a user: open **Supabase Studio** at http://127.0.0.1:54323 → **Authentication** → **Add user** → enter an email and password, and tick **Auto Confirm User**.

6. Put the URL and anon key in `.env` (see [Environment variables](#-environment-variables)), restart `npm run dev`, and log in with that user.

Other useful commands:

```bash
# Stop Supabase (data is kept)
npx supabase stop
```
```bash
# Wipe the local database and re-apply all migrations
npx supabase db reset
```

### Option B: hosted Supabase project

1. Create a free project at [supabase.com](https://supabase.com).
2. In the **SQL Editor**, run `supabase/migrations/20260930000000_init_chickpence.sql`, then `20260930000001_v2_multi_batch.sql`. Read the comments at the top of the v2 file first if the project already has data.
3. **Authentication** → **Users** → **Add user**.
4. **Project Settings** → **API**: copy the **Project URL** and the **anon public** key into `.env`.

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
| `VITE_OLLAMA_URL` | `http://localhost:11434` | Ollama address |
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

The offline service worker is only active in the production build, so test offline behaviour with `npm run build` then `npm run preview`.

---

## 📦 npm packages

Installed by `npm install` from `package.json`. Versions are the ones in `package-lock.json`.

**Runtime**

| Package | Version | Used for |
|---|---|---|
| `dexie` | 4.4 | IndexedDB database in the browser (offline storage, sync outbox, scan queue) |
| `@supabase/supabase-js` | 2.117 | Supabase Auth and PostgreSQL sync |
| `chart.js` | 4.5 | Dashboard charts |
| `write-excel-file` | 4.1 | Excel (.xlsx) export |
| `jspdf` | 4.2 | PDF export |
| `jspdf-autotable` | 5.0 | Tables in PDF export |

The export libraries are loaded only when you export, so the main app stays small.

**Development**

| Package | Version | Used for |
|---|---|---|
| `vite` | 6.4 | Dev server and bundler |
| `vite-plugin-pwa` + `workbox-window` | 0.21 / 7.3 | Service worker and web app manifest (offline PWA) |
| `tailwindcss` + `@tailwindcss/vite` | 4.3 | CSS framework |
| `postcss`, `autoprefixer` | 8.5 / 10.4 | CSS processing |
| `vitest` | 4.1 | Unit tests (requires Node 20+) |

---

## 📁 Project structure

```
ChickPence/
├── public/                     # Icons for the PWA
├── src/
│   ├── db/
│   │   ├── dexie.js            # IndexedDB schema (v4) and upgrades
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
│   │   ├── localLlm.js         # Ollama client and settings
│   │   ├── logbookParser.js    # Rule-based logbook line reader
│   │   └── aiParseService.js   # Scan flow: photo → drafts, scan queue
│   ├── ui/
│   │   ├── dashboardView.js, batchesView.js, historyView.js, summaryView.js, loginView.js, shell.js
│   │   ├── exportMenu.js       # Export modal
│   │   ├── importReviewModal.js# Review scanned entries, scan progress
│   │   ├── localAiModal.js     # Local AI settings
│   │   └── modals.js, toast.js
│   ├── main.js                 # App start-up and view router
│   └── style.css
├── supabase/migrations/        # PostgreSQL schema
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
| "Cannot reach the local AI" from a phone | Set `OLLAMA_HOST` and `OLLAMA_ORIGINS` and open the app over `http` (see [Scanning from a phone](#scanning-from-a-phone-or-another-computer)) |
| Login says invalid credentials with Supabase | Create the user in Supabase (Studio → Authentication → Add user, with Auto Confirm) |
| `npx supabase start` fails | Make sure Docker Desktop is running (`docker ps` should work) |
| Changes to `.env` have no effect | Restart `npm run dev`; also check the in-app ⚙ settings, which override `.env` |

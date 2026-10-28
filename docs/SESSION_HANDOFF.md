# ChickPence — Session Handoff

**Date:** 2026-10-28
**Branch:** `main` (last feature merge `5b27fd0`, voice input; not pushed yet)
**Tests:** 123 passing (`npm test`)

---

## 1. Goal of this workstream

ChickPence is mainly a reporting system, so we are adding four features:

| Phase | Feature | Status |
|---|---|---|
| 1 | Export reports (Excel, PDF, CSV) | ✅ Done, merged, pushed |
| 2 | Logbook photo scanning with a **local LLM (Ollama)** + draft review modal | ✅ Done and tested end to end on this PC |
| 3 | Voice input in the entry form | ✅ Done, merged (tested by typing; real speech not tested yet) |
| 3b | Voice privacy decision (online Web Speech vs local Whisper) | ⏳ Open |
| 4 | AI suggestions | ⏳ Planned (use the local LLM too) |

### Architecture (updated: local LLM, no cloud AI)

```
Logbook photo ─► Ollama OCR model (glm-ocr) ─► text ─┐
Voice → text ────────────────────────────────────────┼─► logbookParser rules ─► Draft review modal ─┐
                       lines the rules can't read ───┘   └► Ollama text model (fallback)          │
Manual form (existing "+ Add New Log") ────────────────────────────────────────────────────────────┤
                                                                                                   ▼
                                   Repository.save* + calcBatchMetrics (single write path)
                                         │                    │                     │
                                   Dexie + outbox       Export module        AI suggestions (local LLM)
                                   → Supabase sync      xlsx / pdf / csv     → Suggestions card
```
The user asked for a local LLM instead of Claude, so the Supabase Edge Function `ai-parse` was removed. The browser talks to Ollama directly; photos never leave the computer and no internet or API key is needed.

**Core rule:** AI never writes to the database. OCR and voice only produce *drafts*. The user confirms them, and they are saved through the existing `Repository.saveExpense / saveFeedLog / saveMortalityLog / saveSale`, so allocation, validation, the outbox and sync keep working unchanged.

---

## 2. Done: Phase 1 export

### What the user sees
- A single **⤓ Export** button on **History** and on every **Batch Summary** page opens a modal:
  1. **Detailed batch report:** summary + every expense, feed, mortality and sale record for one batch, picked from a dropdown (preselects the newest batch on History, or the batch being viewed on its Summary page).
  2. **Whole history:** every batch side by side, one row each. It ignores the History search/status filter (intentional, per the user).
- Formats: **Excel / PDF / CSV**, with a hint line explaining what each format contains.

### Files
| File | Role |
|---|---|
| `src/services/exportService.js` | Pure report builders (`buildBatchReport`, `buildBatchListReport`, `buildBatchLedger`), renderers (`renderReportBlob`), download (`exportBatch`, `exportBatchList`) |
| `src/ui/exportMenu.js` | `renderExportButton`, `attachExportButton`, `renderExportModal` (pure), `openExportModal` |
| `src/main.js` | `openExport(allBatches, defaultBatchId)`: one handler for both pages |
| `src/services/repository.js` | Added `getExpensesByIds(ids)` → `Map` (expense entry dates for the export) |
| `src/ui/historyView.js`, `src/ui/summaryView.js` | Export button wiring; `filterHistoryBatches` extracted |
| `src/style.css` | `.export-*` styles |
| `tests/exportService.test.js`, `tests/exportMenu.test.js` | Unit tests (incl. writing a real .xlsx in Node) |

### Decisions and gotchas
- **Excel uses `write-excel-file` v4, not `xlsx`.** The npm `xlsx` package is frozen at 0.18.5 with security advisories. The v4 API is `writeXlsxFile([{ data, sheet, columns }]).toBlob()`, which differs from older docs.
- **PDF uses `jspdf` + `jspdf-autotable` v5** (`import { autoTable } from 'jspdf-autotable'; autoTable(doc, {...})`).
- **The PDF prints "PHP" instead of "₱"** because jsPDF's built-in fonts have no peso glyph. Embedding a font (~300 KB) would fix it if wanted.
- **Libraries are lazy-loaded** (`await import(...)`) and precached by the service worker, so the main bundle stays small and export works offline.
- **The Expenses section shows each batch's *allocated share*,** with an "Allocation basis" column (e.g. `11,000 / 11,000 heads`) for traceability.
- **CSV:** UTF-8 BOM (so Excel reads ₱/ñ) and a formula-injection guard (text starting with `= + - @` gets a `'` prefix).
- **File names use the *local* date** (`ChickPence_<batch>_YYYY-MM-DD.ext`). UTC would show yesterday before 8 AM PH time.
- Excel dates are written as UTC-midnight `Date`s, because write-excel-file converts with `getTime()`.
- `feed_type` was intentionally dropped in the v2 migration. It is not exported.

### Commits (on `main`)
```
03c1a7a Merge branch 'feature/export-modal' into main
c366267 feat(export): choose a detailed batch report or the whole history
568ec77 Merge branch 'feature/export-reports' into main
7fe369c feat(export): export batch reports to Excel, PDF and CSV
```
Local branches `feature/export-reports` and `feature/export-modal` still exist (not pushed; already merged).

---

## 3. Done: Phase 2 (logbook photo scanning, local LLM)

### What the user sees
- A **📷 Scan logbook** button next to **+ Add New Log** on the Batches page, plus a **⚙** button for the local AI settings. The button opens the camera (or file picker) and shrinks the photo to ≤1600px.
- A **Scanning the logbook** progress window with the current step, a timer and **Cancel**. On this PC a full page takes about 2 minutes.
- A **Review Scanned Entries** modal: one row per draft, every field editable, a confidence badge (red below 70%), and a "?" on fields that were unclear or are missing. Rows can be unticked. **Save selected** validates first, then saves through `Repository.save*`. If a save fails, only the failed rows stay in the modal, so nothing is saved twice.
- **Local AI off** (Ollama not running or a model missing): the button shows "· AI off" with the reason as its tooltip, but still works. The photo waits in the queue and is scanned the next time the Batches page opens with Ollama running; then **Review scanned (N)** appears. A failed scan keeps the photo so the user can retry or delete it.
- Works in **Demo Mode** too (no Supabase or internet needed).

### How a photo is read
1. **OCR model** (`glm-ocr`, 0.9B, vision) turns the photo into plain text, one logbook line per line.
2. `splitRecords` joins continuation lines (a line that doesn't start with a date belongs to the record above, e.g. the second line of a sale).
3. **`logbookParser` rules** read the usual lines instantly: Filipino/English months (including OCR's "Ok+"), M/D dates, kahapon/ngayon, the date carried down from the line above, "Batch 2026-09" / "B-07" / "batch 9", patay, benta … hds … kg @price/kg, patuka … kg / sako, and ₱/P amounts (feed words → feed expense, otherwise other expense).
4. Only records the rules don't recognise go to the **text model** (`qwen3.5:4b`, `think: false`, JSON-schema `format`), with their original line numbers. Anything still unread is listed in the notes.

**Why rules first** (measured on this PC: 7.2 GB RAM, Intel UHD, no GPU, Ollama 0.40.10):

| Setup | Time for a 6-record page | Result |
|---|---|---|
| glm-ocr → qwen2.5:3b | ~4.5 min | Skipped 3 records, labeled the sale as an expense |
| glm-ocr → qwen3.5:4b | ~12 min | All records, but dates off by 2 days, 150 kg read as 7,500 kg, 2 batches missing, every field flagged |
| **glm-ocr → rules (current)** | **~2 min** | **All 6 correct** |

### Files
| File | Role |
|---|---|
| `src/services/localLlm.js` | Ollama client: settings (`getLlmSettings` / `setLlmSettings`, localStorage `chickpence_local_llm`, env defaults `VITE_OLLAMA_URL`, `VITE_OLLAMA_OCR_MODEL`, `VITE_OLLAMA_TEXT_MODEL`), `listModels`, `checkLocalLlm` (cached 15 s), `transcribeImage`, `extractEntries`, `splitRecords`, `buildExtractPrompt`, `DRAFT_SCHEMA`, `EXTRACT_SYSTEM_PROMPT`. 10-minute request timeout, cancel via `AbortSignal` |
| `src/services/logbookParser.js` | Pure rule-based parser: `parseRecord`, `parseRecords`, `parseDate`, `parseBatch` |
| `src/services/aiParseService.js` | `aiUnavailableReason` (async), `resizeImage`, `parseImage` (OCR → extract, with `onProgress`), `parseText`; pure `normalizeDrafts`, `matchBatch`, `validateDraft`, `draftToSave`, `localToday`; queue (`queueImageJob`, `processQueuedJobs`, `getReadyJobs`, `retryJob`, `deleteJob`) |
| `src/ui/importReviewModal.js` | `renderImportReviewModal` (pure), `openImportReviewModal`, `openScanProgressModal`, `escapeHtml` |
| `src/ui/localAiModal.js` | Local AI settings: Ollama address, reading model, sorting model; **Test connection** fills dropdowns with the installed models |
| `src/ui/batchesView.js` | `renderScanActions(importState)`; `onScanPhoto` / `onReviewScans` / `onAiSettings` callbacks |
| `src/main.js` | `scanLogbookPhoto`, `reviewNextScan`, `processQueue` (at start-up and when the Batches page has waiting photos) |
| `src/db/dexie.js` | **v4**: `import_jobs: '++id, status, created_at'` (local only, not synced) |
| `src/style.css` | `.import-*`, `.scan-*`, `.ai-hint` styles |
| `tests/aiImport.test.js`, `tests/localAi.test.js` | 35 unit tests (parser on the real OCR output, model fallback with mocked `fetch`, availability, normalization, validation, HTML escaping, settings modal) |

### Decisions and gotchas
- **Expenses never get a batch.** They are farm-level and allocated by the existing engine. Feed, mortality and sale drafts get a batch from `batch_hint`, matched to open batch names; with only one open batch it is used automatically.
- **Sacks of feed** are converted at 50 kg/sack and flagged as uncertain.
- **Filipino "may 3 patay"** ("there are 3 dead") is not read as May 3: a bare "may" only counts as a month at the start of a line.
- **Dates are never in the future:** a month/day after today goes to last year.
- Small models flag every field as uncertain; `normalizeDrafts` keeps only flags on fields the entry type uses.
- **AI text is HTML-escaped** before it goes into the modal.
- **"Today" comes from the client in local time,** so "kahapon" resolves correctly before 8 AM PH time.
- `import_jobs.status`: `queued` → `ready` (drafts stored, photo dropped) or `failed` (photo kept for retry). A job is deleted once its drafts are saved or discarded.
- **CORS:** Ollama accepts `http://localhost:*` by default, so the dev server works as is. A phone or another computer reaching the farm PC needs `OLLAMA_HOST=0.0.0.0` and `OLLAMA_ORIGINS=<app origin>` set on that PC, and the app must be served over plain `http` on the LAN (browsers block an `https` page from calling `http://<LAN IP>:11434`).
- The PC is short on memory: with the browser open only ~250–750 MB stay free, so the first scan after start-up is slower while the model loads.
- The Claude Edge Function (`supabase/functions/ai-parse`) was deleted; no API key is needed any more.

### Setup on another computer
```bash
ollama pull glm-ocr
ollama pull qwen3.5:4b
```
Then open **⚙** next to Scan logbook → **Test connection** → pick the models → **Save**.

### Commits (on `main`)
```
6a77785 Merge branch 'feature/local-llm' into main
4020140 feat(ai): scan logbooks with a local LLM (Ollama) instead of Claude
fdf678a Merge branch 'feature/ai-parse' into main
5df8893 feat(ai): scan logbook photos into reviewable draft entries
```
Local branches `feature/ai-parse` and `feature/local-llm` still exist (not pushed; already merged).

---

## 4. Done: Phase 3 voice input

### What the user sees
- In the **+ Add New Log** modal (new entries only, not when editing): **🎤 Speak**, a language picker (Filipino / English (PH), remembered in localStorage `chickpence_voice_lang`), and a text box with the transcript plus **Fill form**.
- Say one entry → the words appear live → the form switches to the right tab (Expenses / Feed / Mortality / Sales), picks the batch and fills the fields. Fields to check are highlighted, and a line says which ones. The user taps **Save** as usual, so the form is the review step and saving goes through the existing `Repository.save*` code.
- A misheard word can be fixed in the text box and read again with **Fill form** (Enter works too). The same box lets you type a sentence without the mic.
- A spoken expense runs the allocation preview automatically, so **Save Expense** is ready.
- The mic is hidden where the browser has no speech recognition (Firefox) and disabled offline. A line under it says the browser's speech service sends audio online and nothing is saved until Save.

### How a sentence is read
1. `normalizeSpoken` (`logbookParser.js`) rewrites speech into logbook wording: Filipino/English number words → digits ("isang daan at limampu" → 150, "dalawampu't lima" → 25, "labing-dalawa" → 12, "12k" → 12000), kilo → kg, "118 pesos per kilo" / "tig 118" → price per kg, "850 pesos" → ₱850, "ika-26 ng Oktubre" → "Oktubre 26", "batch 2026 9" → "Batch 2026-09", and a leading "May 3 patay" ("there are 3 dead") is not read as May 3.
2. The same `parseRecord` rules as the logbook, with **today** as the default date. Rules added for speech (they also help logbook lines): more verbs (namatay, nagpakain, kumain, nagbenta, sold…), "3 ang namatay" / "patay … ay 5" word order, buyer after "kay"/"to", "at" read as "and" in "120 heads at 245 kg", the batch number is never counted as deaths, and a cost said without "pesos" after bayad/bumili/gastos/paid/bought.
3. Only when the rules fail, the local text model (`extractEntries`). If the local AI is off, the user is told why and fills the form by hand. Only the first entry is used.

### Files
| File | Role |
|---|---|
| `src/services/speechInput.js` | Web Speech wrapper: `isSpeechSupported`, `startDictation` (interim + final text, keeps interim words when stopped early), `speechErrorMessage`, language setting |
| `src/services/logbookParser.js` | `normalizeSpoken` + the spoken rules above |
| `src/services/aiParseService.js` | `parseSpokenEntry` (rules → local AI fallback), `draftToFormPrefill` (draft → tab, batch, form values, fields to check) |
| `src/ui/batchesView.js` | `renderVoiceBar`, prefill + highlight in the entry form, mic listeners |
| `src/main.js` | `state.voice`, `fillFormFromVoice`, `buildExpensePreview` (shared by the Preview button and voice) |
| `src/style.css` | `.voice-*` styles, `.form-field .is-uncertain` |
| `tests/voiceInput.test.js` | 26 tests: number words, spoken sentences of every type, written lines unchanged, AI fallback with mocked `fetch`, prefill mapping, dictation with a fake recognizer, rendering |

### Tested
- Unit tests and a production build pass.
- In the app (Demo Mode): typed sentences for a sale, an expense (preview ran, Save enabled) and a mortality entry (batch highlighted when two batches are open); a saved entry reached the database, and the modal and voice bar were cleared. Phone width (375 px) fits.
- **Not tested yet:** real speech through a microphone (the browser pane used for testing cannot speak). Try it in Chrome or Edge on the farm PC or a phone.

### Still open
- **Privacy:** Chrome/Edge Web Speech sends audio to Google/Microsoft, unlike the local-only photo scanning. It is stated in the app; it still needs a line in the PRD privacy section, or a switch to a local speech model (e.g. Whisper on a local server; `startDictation` is the only part to replace).
- Web Speech needs internet. Offline, the mic is disabled but typing a sentence still works.
- **Phones:** browsers only allow the microphone on `https` pages or `localhost`, but reaching Ollama from a phone needs the app on plain `http` (section 3). Using both from a phone needs an `https` proxy in front of Ollama.

### Commits (on `main`)
```
5b27fd0 Merge branch 'feature/voice-input' into main
226efa9 feat(voice): fill the entry form from a spoken sentence
```
Local branch `feature/voice-input` still exists (not pushed; already merged).

---

## 5. Phase 4: AI suggestions
- Use the local LLM (`localLlm.js`) instead of an Edge Function. Send **only computed metrics** (cost breakdown, FCR, mortality trend, margins, `calcDashboardAverages`). No buyer names.
- Returns 3–5 suggestions, each tied to a specific number. They show in a "Suggestions" card on the Dashboard and Summary, labeled AI-generated. Cache them in Dexie (`ai_insights` table).
- Generation is slow on CPU (minutes), so run it in the background and only when the metrics change.
- The existing rule-based warning flags stay as they are. AI is advisory only.

---

## 6. Done: local Supabase and sync fixes

### Decision: Supabase is local for now
The user chose to keep Supabase local (2026-10-28); no hosted project is used. `.env` (git-ignored) points the app to `http://127.0.0.1:54321` with the standard local anon key. Start Supabase before using a real account:

```bash
npx supabase start -x realtime,storage-api,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor
```

Stop it with `npx supabase stop` (data is kept). The test login is in `supabase/test-user.local` (git-ignored). If a hosted project is added later, run all three files in `supabase/migrations/` there, including `20261028000000_v3_feed_grams.sql`, or feed logs won't sync.

### Setup on this PC (tested 2026-10-28)
- WSL updated with `wsl --update --web-download` (now WSL 3.0.3). Plain `wsl --update` did nothing on Windows 11 21H2, and Docker Desktop then failed with "WSL needs updating".
- Docker Desktop 4.96. Starting the full Supabase stack made Docker shut down mid-download (8 GB RAM), so only the services ChickPence uses are started (`-x ...` above).
- `supabase/config.toml` is committed, so no `supabase init` step is needed.
- Docker cleanup: removed the unused realtime, logflare, vector and mailpit images and compacted `docker_data.vhdx` (10.6 → 9.2 GB). C: had 17 GB free afterwards.

### Bugs found by running sync end to end, all fixed
| Problem | Fix |
|---|---|
| New batches were saved with the demo user id, so Supabase rejected them (`batch_user_id_fkey`) | `Repository.createBatch` uses the signed-in user |
| Feed logs failed: the database had `quantity_kg`, the app sends integer `quantity_g` | Migration `20261028000000_v3_feed_grams.sql` switches `feed_log` to grams and converts existing rows (tested: 150.25 kg → 150,250 g; safe to re-run) |
| One failed upload stopped the whole queue | `pushOutbox` (`syncEngine.js`) keeps going; only records of a rejected batch and later edits of a rejected record wait. The error and attempt count are saved on the outbox item (`last_error`, `attempts`) |
| Downloading with an empty queue skipped recomputing expense allocations (cost to date missed expenses) | Recompute after every download that changed something |
| Demo batches showed up for real accounts | `src/db/localData.js`: the browser tracks whose records it holds (`app_state.data_owner`); Demo Mode seeds the 8 sample batches; a real account clears demo or unknown data and downloads its own. Records not uploaded yet are never cleared (`keep-unsynced`) |
| Offline with an expired login: ~30 s blank screen, then the login screen (locked out of local records) | `auth.js`: with a saved login, start-up waits at most 3 s (`OFFLINE_LOGIN_WAIT_MS`) and opens the saved user (`offline: true`) |
| After reconnecting, a sync could upload without the user's login (401 / row-level security) | `ensureSession` renews the login before uploading (or skips the sync and keeps the queue); `watchAuth` syncs on `TOKEN_REFRESHED` / `SIGNED_IN`; demo records are never uploaded |
| Login screen didn't refresh after saving Supabase settings | Re-render after the settings dialog closes |

Tested in the app against local Supabase: login, upload of every record type, download to a fresh browser, offline open in 3.1 s, queued entries uploaded within 5 s of the server returning.

### Still open
- A record Supabase rejects for good (e.g. bad data) is retried on every sync and is only visible in the browser console and the pending count. There is no screen to see or discard it.

### Commits (on `main`)
```
1de555b Merge branch 'feature/local-supabase-sync' into main
307c946 docs: tested local Supabase setup, offline use and Docker cleanup
83a8688 fix(sync): make Supabase sync work end to end, locally and offline
c9f3ae5 docs: list all dependencies and how to run them locally
```
Local branch `feature/local-supabase-sync` still exists (not pushed; already merged).

---

## 7. Environment notes
- Dev server: `.claude/launch.json` → `npm run dev` (port 3000, falls back to the next free port). `.claude/launch.json` is committed (dev-server config only).
- **Demo Mode** on the login screen seeds 8 realistic batches locally (no credentials needed, no Supabase); use it to test exports and logbook scanning.
- **Supabase:** local only, see section 6. Docker Desktop must be running before `npx supabase start`.
- **Ollama** is installed and running on this PC with glm-ocr, qwen3.5:4b, qwen2.5:3b, qwen2.5:1.5b, llama3.2:3b, phi4-mini and nomic-embed-text.
- An old stash (`stash@{0}`, from before the multi-batch work) still exists locally; it was left alone.
- `npm audit` reports advisories in existing dev tooling (vitest, vite deps), not in the new export packages. `npm audit fix` is a separate cleanup.
- Main JS chunk is ~565 KB (Chart.js, Supabase, Dexie), separate from the export libraries. Code-splitting could be a later optimization.

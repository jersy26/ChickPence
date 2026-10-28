# ChickPence — Session Handoff

**Date:** 2026-10-29 (second session)
**Branch:** `main` (last merge: `fix/todo-items`), pushed to GitHub.
**Tests:** 189 passing (`npm test`); the production build passes.

> **Next session: start with section 0 (To do).** The code to-do list is finished (section 9).

---

## 0. To do

### Not finished (code work)
- Nothing left from the previous list; see section 9 for what was done.
- Optional: try `npm run dev:lan` from a real phone (only checked with curl on this PC: https page, `/ollama` through the proxy, COOP/COEP headers).

### Needs the user (cannot be done from here)
- **Speak into a real microphone** in Chrome or Edge on the farm PC, in Filipino and Taglish, ideally in the shed. All voice tests used text-to-speech recordings.
- **Hosting:** whatever serves the built app must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, or Whisper runs about 5× slower. For phones it must also pass `/ollama` on to Ollama on the farm PC (as `vite.config.js` does), or the Ollama address must be set by hand.

### Known limits (no fix planned)
- AI suggestion wording is sometimes generic (small model); the numbers and the better/worse direction come from code.
- Whisper sometimes drops part of a buyer's name ("aling" for "Aling Nena"); the review form catches it.
- `npm audit` still lists 4 low advisories (`deepmerge` via `vite-plugin-pwa` → `workbox-build`); the only offered fix is `--force`, which downgrades the PWA plugin to 0.2.1.
- `.numbers` (Apple Numbers) files are not imported; the user is told to export as `.xlsx` or CSV.

---

## 1. Goal of this workstream

ChickPence is mainly a reporting system, so we are adding these features:

| Phase | Feature | Status |
|---|---|---|
| 1 | Export reports (Excel, PDF, CSV) | ✅ Done, merged, pushed |
| 2 | Logbook photo scanning with a **local LLM (Ollama)** + draft review modal | ✅ Done and tested end to end on this PC |
| 3 | Voice input in the entry form | ✅ Done, merged; tested with Filipino/Taglish recordings through Edge's mic path and offline (a real person speaking not tested yet) |
| 3b | Voice privacy: Web Speech (sent audio to Google/Microsoft) replaced by Whisper running in the browser | ✅ Done, merged; audio never leaves the device |
| 4 | AI suggestions (local LLM) | ✅ Done, merged, tested in the app with Ollama on this PC |
| 5 | Import logs from a file (Excel, CSV, PDF, photo) | ✅ Done, merged, tested in the app with sample files |
| — | Open-item fixes (2026-10-29): ₱ in PDFs, suggestions setting, Sync screen, AI for unrecognised import lines | ✅ Merged, pushed (section 8) |
| — | To-do list (2026-10-29, second session): AI import tested with Ollama, .xls/.ods, farm expenses export, phones via /ollama + https, audit, bundle split | ✅ Merged, pushed (section 9) |

### Architecture (updated: local LLM, no cloud AI)

```
Logbook photo ─► Ollama OCR model (glm-ocr) ─► text ─┐
Voice ─► Whisper in the browser ─► text ─────────────┼─► logbookParser rules ─► Draft review modal ─┐
                       lines the rules can't read ───┘   └► Ollama text model (fallback)          │
Manual form (existing "+ Add New Log") ────────────────────────────────────────────────────────────┤
                                                                                                   ▼
                                   Repository.save* + calcBatchMetrics (single write path)
                                         │                    │                     │
                                   Dexie + outbox       Export module        AI suggestions (local LLM)
                                   → Supabase sync      xlsx / pdf / csv     → Suggestions card
```
The user asked for a local LLM instead of Claude, so the Supabase Edge Function `ai-parse` was removed. The browser talks to Ollama directly; photos never leave the computer and no internet or API key is needed. Voice is turned into text by Whisper inside the browser (Transformers.js), so recordings never leave the device either.

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
- **PDF currency:** fixed on 2026-10-29; PDFs embed Noto Sans and print ₱ (section 8).
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
- **CORS:** Ollama accepts `http://localhost:*` by default, so the dev server works as is. Since section 9, a phone or another computer goes through the app's own `/ollama` pass-through (no `OLLAMA_HOST` / `OLLAMA_ORIGINS`, works from an `https` page).
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

## 4. Done: Phase 3 voice input (Whisper on the device)

### What the user sees
- In the **+ Add New Log** modal (new entries only, not when editing): **🎤 Speak**, a language picker (Filipino / English (PH), remembered in localStorage `chickpence_voice_lang`), and a text box with the transcript plus **Fill form**.
- Tap Speak, say one entry, pause → the recording stops by itself (or tap **■ Stop**) → "Turning your voice into text on this device…" → the form switches to the right tab (Expenses / Feed / Mortality / Sales), picks the batch and fills the fields. Fields to check are highlighted, and a line says which ones. The user taps **Save** as usual, so the form is the review step and saving goes through the existing `Repository.save*` code.
- A misheard word can be fixed in the text box and read again with **Fill form** (Enter works too). The same box lets you type a sentence without the mic.
- A spoken expense runs the allocation preview automatically, so **Save Expense** is ready.
- The first time, "Loading the voice model… 45%" shows while the model downloads (about 240 MB). After that it works **offline**. Offline before the first download, the mic is disabled with a note; typing still works.
- The line under the mic says the recording never leaves the device. The mic is hidden where the browser cannot record (no `MediaRecorder`, or a plain-`http` page on a LAN address).
- **⚙ Local AI settings → Voice typing model:** whisper-small (default, accurate) or whisper-base (fast, weak in Filipino); localStorage `chickpence_voice_model`.

### How it works
1. **Recording** (`speechInput.js`): `getUserMedia` + `MediaRecorder`. A Web Audio level meter feeds `createSilenceDetector`, which stops after speech followed by 1.5 s of quiet, gives up after 7 s without speech (Whisper is not called), and caps a recording at 20 s. Tapping Stop always reads what was recorded.
2. **Speech → text** (`whisperWorker.js`): the recording is decoded into a 16 kHz context (that resamples it), mixed to mono, and sent to a Web Worker that runs **Whisper with Transformers.js** (`@huggingface/transformers` 4.3.1, pinned), `dtype: 'q8'`, on WebAssembly. `language` is `tagalog` for Filipino and `english` for English (PH).
3. **Vocabulary prompt** (`buildVoicePrompt`): a short sample of farm-log words is given to Whisper before the recording (its "initial prompt", passed as `decoder_input_ids` because Transformers.js has no prompt option), with the open batches as they are said ("batch pito, batch siyam"). It never names buyers or amounts. `stripPrompt` removes it from the answer, and an answer that is only an echo of it (what Whisper writes for silence or noise) counts as nothing said.
4. **Speed:** the page is **cross-origin isolated** (COOP `same-origin` + COEP `credentialless`, set in `vite.config.js` for dev and preview), so ONNX can use several threads; it uses all CPU threads but 2. An already downloaded model is loaded when the entry form opens (`warmUpVoiceModel`), not during the recording, and is released after 10 idle minutes.
5. **Files:** the model comes from Hugging Face (`onnx-community/whisper-small` or `-base`) the first time. The ONNX runtime (26 MB `.wasm`) is served by the app itself: `whisperWorker.js` points `wasmPaths` at `node_modules/onnxruntime-web` so Vite bundles it, instead of Transformers.js's default jsDelivr CDN. Both are kept in the browser's Cache Storage (`transformers-cache`); `isVoiceModelCached` checks it.
6. `cleanTranscript` drops Whisper's tags (`[BLANK_AUDIO]`, `(music)`), the final period, and splits "3-Dead" into "3 Dead".
7. **Reading the sentence:** `normalizeSpoken` (`logbookParser.js`) first evens out Filipino spelling the way Whisper writes it: o/u ("tatlung", "limampong", "walung"), split or joined words ("limang pu", "apatnaput", "walungdaan", "Nagbentakay", "kayaling"), -ng said as -m before p/b ("tatlumpatay"), and digits mixed with words ("isang daan at 20" → 120, "2 daan at 45" → 245); a polite "po" is left alone ("apat na po" stays 4). Then number words → digits, kilo → kg, prices, pesos and dates as before, the same `parseRecord` rules as the logbook with today as the default date, and only when they fail the local text model (`extractEntries`).

### Tested on this PC (CPU only, 8 threads, 7 GB RAM, Intel UHD Gen 9)
- **Test recordings:** 8 Filipino and Taglish farm sentences made with Google's Filipino text-to-speech voice (mortality, feed, sale, expense, sacks of feed; Taglish mortality, sale, expense).
- **Model choice (Node, same recordings):** whisper-base read 3 of 8 into usable entries even with the prompt; whisper-small with the prompt and the spelling rules read 7 of 8 (the eighth lost its count). So small is the default.
- **Real browser path:** Edge driven over DevTools with its fake-microphone option (`--use-file-for-fake-audio-capture`) playing the recordings into the production build (`vite preview`), so `getUserMedia`, `MediaRecorder`, silence detection, the worker and the form all ran for real.

| Recording | Form filled | Reading time |
|---|---|---|
| "May tatlong patay sa batch siyam kahapon" | Mortality, Batch 2026-09, yesterday, 3 | 10.8 s |
| Filipino sale (13.6 s long) | Sale, Batch 2026-09, 120 heads, 245 kg, ₱118/kg; buyer "aling" instead of "Aling Nena" | 17.1 s |
| Taglish sale | Sale, Batch 2026-07, Mang Jun, 80 heads, 160 kg, ₱120/kg | 11.6 s |
| Filipino expense | Expense, other costs ₱850 | 17.8 s |
| Filipino feed, **offline** (server stopped, internet blocked, browser offline) | Feed, Batch 2026-07, 150 kg | 10.0 s |

- Before the fixes it took 53–64 s per sentence (one or 4 threads); with all 8 threads it took 17 s but the recorder lost the start of the sentence, hence 6 threads.
- First use: the 240 MB download took 50–70 s here; loading the model from the cache takes ~30 s after the browser starts (hidden behind opening the form).
- The same recording can come out slightly differently from run to run (noise suppression and compression in the mic path).

### Files
| File | Role |
|---|---|
| `src/services/speechInput.js` | Recording, `createSilenceDetector`, Whisper worker client (`transcribe`, `preloadVoiceModel`, `warmUpVoiceModel`, idle unload), `buildVoicePrompt`, `stripPrompt`, `cleanTranscript`, `micErrorMessage`, `isVoiceModelCached`, language and model settings |
| `src/services/whisperWorker.js` | Transformers.js pipeline in a Web Worker, prompt tokens, threads, download progress, local ONNX runtime, timing |
| `src/services/logbookParser.js` | `normalizeSpoken` with `standardizeFilipino` and `joinSpokenParts` + the spoken rules |
| `src/services/aiParseService.js` | `parseSpokenEntry` (rules → local AI fallback), `draftToFormPrefill` |
| `src/ui/batchesView.js` | `renderVoiceBar` (offline / first-download notes), prefill + highlight, mic listeners, warm-up when the form opens |
| `src/ui/localAiModal.js` | Voice typing model picker |
| `src/main.js` | `state.voice`, `fillFormFromVoice`, `buildExpensePreview`; passes `isVoiceModelCached()` to the Batches page |
| `vite.config.js` | `worker.format: 'es'`; COOP/COEP headers for dev and preview |
| `.claude/launch.json` | `preview` configuration (production build on port 4173) |
| `tests/voiceInput.test.js` | Number words incl. Whisper's Filipino spellings, spoken sentences, recorder with fake mic/recorder/Whisper (auto stop, no speech, Stop, abort, errors, batches passed on), silence detector, prompt and echo stripping, Whisper output through the rules, model cache check, voice bar states |

### Decisions and gotchas
- **Why in the browser, not a Whisper server:** nothing to install or start on the PC, works offline after the first download, and on a phone the phone does the work.
- **Hosting:** whatever serves the built app must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`; without them voice still works but on one thread (about 5× slower). Browsers without `credentialless` (Safari) also fall back to one thread.
- A browser that cached the app before the headers existed keeps the old worker file until the next update; a fresh install is fine.
- The console shows one `Whisper …` info line per sentence (audio length, load and reading time, threads) for checking speed on another PC.
- No live words while speaking (Whisper reads the whole recording at the end).
- The loaded model takes several hundred MB of browser memory; with Ollama's text model also loaded (2 GB) this PC had under 1 GB free.
- The first Vite dev run after installing re-optimizes dependencies and reloads the page once.

### Still open
- **A real person speaking into a real microphone is still untested**, especially in a noisy shed. All tests used text-to-speech recordings. whisper-base in ⚙ is faster but much weaker in Filipino.
- **Phones:** the microphone only works on `https` pages (or `localhost`). Fixed in section 9: `npm run dev:lan` serves https on the LAN and the Ollama fallback goes through `/ollama`. Not tried on a real phone yet; a phone may also be too slow for whisper-small.

### Commits (on `main`)
```
5b27fd0 Merge branch 'feature/voice-input' into main
226efa9 feat(voice): fill the entry form from a spoken sentence
```
Local branch `feature/voice-input` still exists (not pushed; already merged).

---

## 5. Done: Phase 4 AI suggestions

### What the user sees
- A **Suggestions** card (badge **AI-generated**) on the **Dashboard** (under Open Batch Warnings) and at the bottom of every **Batch Summary** page.
- 3–5 suggestions, each with a short title, one or two sentences, and a **Based on:** line showing the number it is about (e.g. `Batch 2026-09: deaths in the last 7 days: 28`). That number comes from the app's own data, not from the model.
- While new suggestions are written: a spinner and "Writing suggestions from the latest numbers…". The user can keep working; the card updates by itself when done (only the card is redrawn, not the page). Older suggestions stay visible, faded, marked "from older numbers".
- **↻ Refresh** writes them again; **Try again** after a failure. Local AI off → the reason (e.g. Ollama not running) and the last suggestions, if any.
- A footer line: written by the local AI on this computer from computed numbers only (no buyer names), advice only.

### How it works
1. `buildDashboardFacts` / `buildBatchFacts` (`insightsService.js`, pure) turn the records into a list of facts `{ id, label, value, text, note?, attention? }`, e.g. `open1.deaths_last_7_days | Batch 2026-09: deaths in the last 7 days | 28 | ATTENTION: up from 4 in the 7 days before`:
   - per batch: age, chicks, birds alive, mortality rate, **deaths in the last 7 days vs the 7 days before** (open batches), cost to date. Closed batches add cost shares, feed used, revenue, net profit, margin, cost and price per kg, weight per bird and FCR. Open batches leave those out (a half-finished batch compared with finished ones misled the model); with sales so far they get price and weight per bird.
   - farm averages of the **last 5 closed batches** (same rule as `calcDashboardAverages`), plus the last closed batch on the Dashboard. A Summary page compares the batch with the *other* closed batches.
   - No buyer names, dates of single records or amounts of single records are sent.
2. **The comparisons are rule-based, not left to the model** (same lesson as the logbook rules in Phase 2). Each fact can carry a note worked out in code: `higher/lower than the farm average (X): better/worse` (under 5% difference = "about the same"), the farmer's mortality limit (above, or within 80% of it for an open batch), and the weekly death trend (≥ 5 deaths and at least double the week before = rising). Worse ones are marked `attention` and listed first in the prompt.
3. `factsHash` (FNV-1a over the shown values and notes, the model name and `PROMPT_VERSION`) decides whether the cached suggestions still match.
4. If not, a background worker asks the text model once (`askTextModelJson` in `localLlm.js`, `think: false`, temperature 0.2). The JSON schema's `fact_id` is an **enum of the fact ids**, so every suggestion is tied to a real number. `suggestableFacts` narrows that enum to facts with a clear better/worse note when there are at least 2 (else any note, else all facts), and the model may write fewer than 5 rather than pad. `normalizeSuggestions` drops unknown ids, empty or duplicate titles and second suggestions about the same fact, clips long text and keeps at most 5. The **Based on** line shows the fact's own value and note; suggestions about a problem get a red edge.
5. The result is stored in Dexie **v5** `ai_insights` (`scope` = `'dashboard'` or `'batch:<batch_id>'`, local only, not synced, cleared with the other records when another account logs in). A failure is stored too (not retried by itself, so a broken model does not loop); it keeps the last good suggestions.

### Files
| File | Role |
|---|---|
| `src/services/insightsService.js` | Facts, hash, prompt + schema, `normalizeSuggestions`, `generateSuggestions`, background queue (`loadInsights`, `onInsightsChange`), `insightsUnavailableReason` (only the text model is needed, not the OCR model) |
| `src/services/localLlm.js` | `askTextModelJson` (generic JSON call), `hasModel` exported |
| `src/ui/insightsCard.js` | `renderInsightsCard` (pure, escapes AI text), `attachInsightsCard`, `replaceInsightsCard` |
| `src/ui/dashboardView.js`, `src/ui/summaryView.js` | Card placement (extra `insights` argument) |
| `src/main.js` | `showInsights`, `refreshInsightsCard`; `state.insights` remembers which card is on screen |
| `src/db/dexie.js`, `src/db/localData.js` | v5 `ai_insights`; cleared on account switch |
| `src/style.css` | `.insights-*`, `.insight-*`, `.ai-badge` |
| `tests/insights.test.js` | 22 tests: comparison notes, allowed facts, facts and averages, no buyer names in the prompt, hash, schema enum, normalization, model call with mocked `fetch`, cache/background/stale/failure, card rendering and escaping |

### Prompt testing on this PC (qwen3.5:4b, CPU only)
| Version | Time | Result |
|---|---|---|
| Plain facts, model compares | ~4 min | Missed deaths jumping 4 → 28; called 38.1% "lower" than 28.6%; compared feed per bird with FCR; filler about totals |
| + rule-based notes, ATTENTION first | ~3.7 min | Led with the death spike, mortality limit and FCR, directions right; 2 of 5 were filler (birds alive, "harvest early" from age alone) |
| + only clearly better/worse facts allowed (current) | ~4 min in the app | 4 suggestions, all correct and tied to the right number (Demo Mode data) |

### Decisions and gotchas
- Generation starts only when a page with the card is opened and its numbers changed, not on every saved record, so the CPU is not busy while the user is entering logs. One run at a time; if the numbers change during a run, the newest numbers run next (older queued requests are replaced).
- Facts that depend on today (age, live birds, last-7-days deaths) change daily, so the Dashboard suggestions are rewritten about once a day when opened.
- The rule-based mortality warnings are unchanged; the card is separate and advisory.
- Ollama's default context is 4096 tokens here; a Dashboard with 2 open batches is ~50 facts (~1,500 tokens), so many more open batches could get close to the limit.
- Suggestions and photo scans share the same Ollama; a scan started while suggestions are being written waits for them (and the other way round).

### Still open
- Fixed 2026-10-29: ⚙ Local AI settings → AI suggestions can be automatic, on request, or off (section 8).
- The model is small: wording is sometimes generic ("check feed quality"). The numbers and the better/worse direction come from code, so they are always right.

---

## 5b. Done: import logs from a file (Excel, CSV, PDF, photo)

### What the user sees
- **📄 Import file** next to 📷 Scan logbook on the Batches page (accepts `.xlsx`, `.csv`, `.pdf` and images).
- The entries go into the same review modal as a scanned logbook, titled **Review Imported Entries** ("Found 5 entries in farm-log.xlsx"), with a Notes line on what was left out. Nothing is saved until **Save selected**, which uses `Repository.save*` like the manual form.
- Rows already in ChickPence (same type, date, batch and values, e.g. importing a file twice or an export back) are marked **Already saved** and left unticked.
- A **photo** goes to the logbook scan (section 3). A **scanned PDF** (no text layer) is split into page images (up to 10) that join the photo queue and appear under **Review scanned**.
- An old `.xls` / `.ods` file gets "Save the spreadsheet as Excel Workbook (.xlsx) or CSV first".

### How a file is read (`src/services/fileImport.js`)
1. **Loading:** `.xlsx` with `read-excel-file/universal` (every sheet), `.csv` with a small built-in parser (`,` `;` or tab, quotes, BOM, undoes the export's `'` formula guard), `.pdf` with `pdfjs-dist`: the text layer is grouped into lines and wide gaps split cells (`textItemsToRows`), so PDF tables keep their columns. Both libraries are lazy-loaded and precached for offline use.
2. **Header rows** (`headerField`): a row is a header when two or more cells are known columns and one is a date. English and Filipino names: Date/Petsa, Type/Uri, Batch, Buyer/Mamimili, Heads/Ulo, Weight/Timbang, Price per kg/Presyo, Deaths/Patay, Feed (kg)/Quantity (kg)/Dami, Feed cost, Other cost, Amount/Halaga/Gastos, Description/Paglalarawan; "Cumulative" is ignored.
3. **Type of each row:** a Type column ("Gastos", "Feed", "Patay", "Benta"…), else the sheet or section name (Expenses/Feed/Mortality/Sales, Gastos/Patay/Benta), else the columns with values. Chick purchases, Summary sheets and the batch history are skipped.
4. **Values:** dates as Excel dates, ISO, M/D/YYYY (D/M when the first part is over 12), Excel serials or month names; numbers with ₱, commas and units. An expense with one Amount column goes to feed cost when its description mentions feed (patuka, sako, feeds…), otherwise to other costs. A sale without a price gets total ÷ weight.
5. **Batch:** from a Batch column, else from an open batch named in the file name ("ChickPence_Batch_2026-09_….xlsx"), else the usual rule (the only open batch, or "Choose batch").
6. **Rows without a header** (a logbook typed into cells) are read by the logbook rules (`parseRecord`), with the date carried down. Rows that are neither are listed in the notes.
7. **ChickPence's own batch reports:** their expense rows are each batch's *allocated share*, not the farm expense, so they are left out with a note (detected by the "Allocation basis" column or a `ChickPence_` file name). Feed, mortality and sales import back exactly.

### Tested
- Unit tests (`tests/fileImport.test.js`, 15): CSV parsing, dates and numbers, headers in both languages, **round trips of ChickPence's own Excel, CSV and PDF exports** (written and read back in Node), Filipino tables, a sheet per type, typed logbook lines, missing dates, duplicates, review-modal text.
- In the app (Edge over DevTools, real file input): a Filipino-header workbook (5 entries correct), a CSV with a Type column (3 correct, 1 empty row skipped), a ChickPence PDF report (3 correct, expense share left out), saving 5 entries (7 s) and importing the same file again (all 5 marked Already saved), and a scanned PDF (page queued for the photo scan). The modal fits a 390 px phone screen.

### Still open
- The expense rows of a ChickPence batch report still cannot be imported (they are shares), but the farm expenses now have their own export that imports back (section 9).
- Fixed in section 9: `.xls` and `.ods` are read.
- Fixed 2026-10-29: the app offers to let the local AI read unrecognised lines (section 8; tested with Ollama in section 9).

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
- Fixed 2026-10-29: refused records are shown on the Sync screen (sidebar status) and can be retried or discarded (section 8).

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
- `npm audit`: 4 low advisories left (section 0, Known limits).
- Main JS chunk is 176 KB; Chart.js, Supabase and Dexie are separate chunks (section 9).
- The dev server reloads the page when `src/main.js` changes, which cancels a running scan or AI import; run long in-app tests on `npm run build` + `vite preview` (`.claude/launch.json` → `preview`). After a new build, the preview tab may still serve the old app from the service worker: unregister it or reload twice.

---

## 8. Done: open-item fixes (2026-10-29, merged, not pushed)

| Commit | What changed |
|---|---|
| `6cb8ff6` | **₱ in PDF reports.** `src/assets/fonts/notoSansPdf.js` holds Noto Sans Regular and Bold (SIL OFL, licence in `OFL-NotoSans.txt`) as base64: static instances (wght 400 and 700) of Google Fonts' variable `NotoSans[wdth,wght].ttf`, trimmed with `subset-font` to Basic Latin, Latin-1 and ₱ – — ‘ ’ “ ” • … · × € (about 36 KB each). Lazy-loaded with jsPDF; `formatForText` writes `₱1,234.50`. Poppins and Fira Sans have no ₱; Lato has one but a Reserved Font Name, so a trimmed copy is not allowed. To regenerate: `subset-font` with `variationAxes: { wght, wdth: 100 }`. Checked by rendering a report page. |
| `942d5c9` | **AI suggestions setting.** ⚙ Local AI settings → "AI suggestions": automatic (default), only when tapping **Write suggestions** (card status `paused`; the model never starts by itself), or off (card hidden). localStorage `chickpence_ai_suggestions`; `getSuggestionsMode` / `setSuggestionsMode` in `insightsService.js`. |
| `057dfce` | **Sync status and Sync screen.** The sidebar status line was lost in the redesign (`renderShell` built it but never showed it). It is back (`renderSyncStatus`: "⚠ N could not upload", "Offline · N waiting", "N waiting to upload", "All synced"), and the desktop sidebar is sticky so it stays in view. Tapping it opens `src/ui/syncProblemsModal.js`: each refused change with the server's reason and attempt count, **Try again now**, and **Discard this change** (`discardChange` in `syncEngine.js`: removes its queued uploads and the local record; a batch takes its waiting records with it; the next download restores the server's version if one exists; cost sharing is recomputed). Checked in Edge on desktop and phone width. |
| `d3b560c` | **AI for unrecognised import lines.** After a file import, if some lines were not recognised and the local AI is ready, a confirm asks to let it read them (at most 40, progress window with Cancel). `extractFromRecords` keeps each row as its own record (`extractEntries` joins lines that do not start with a date). Tested with Ollama in section 9. |

Tests: 180 (new: suggestion modes and the paused card, discard and the Sync screen, `extractFromRecords`). The production build passes.

---

## 9. Done: the to-do list (2026-10-29, second session)

Branch `fix/todo-items`, merged into `main` and pushed. Tests: 189.

| Commit | What changed |
|---|---|
| — | **Pushed `main`** with the section 8 fixes (180 tests passed first). |
| `2aa5789` | **AI import tested with Ollama, and a bug it found.** On the production build (`vite preview`), Demo Mode, a CSV with `Okt 27 Batch 2026-09 patay 4` and `tatlong manok ang nawala sa batch 9 kahapon`: the prompt appeared for the second line, qwen3.5:4b read it in **4 min 19 s** (Mortality, Batch 2026-09, yesterday, 3). But the first line was missing: alone in a cell, it names a type ("patay"), so it was taken as a "Mortality" section title and dropped. Now a one-cell row that the logbook rules can read (and that has a digit) is an entry. The prompt also says "read it" for one line. |
| `7a98b57`, `502d43e` | **`.xls` and `.ods` import.** SheetJS CE 0.20.3 from `cdn.sheetjs.com` (in `package.json` as the tarball URL), lazy-loaded only for these files (`fileKind` → `'spreadsheet'`). `sheetJsTables` turns each sheet into rows like read-excel-file; `XLSX.read(..., { cellNF: true })` keeps number formats so date cells become UTC-midnight `Date`s (without it they arrive as serial numbers). `.numbers` still gets "export as .xlsx or CSV". Unit tests write real `.xls` (BIFF8 and BIFF5) and `.ods` files; checked in the app with an `.xls` and an `.ods` made in the browser. |
| `f313456` | **Farm expenses export and import.** Export has a third choice, **Farm expenses** (`buildFarmExpensesReport`, file `ChickPence_Farm_Expenses_<date>`): date, feed cost, other cost, total, as entered. The whole-history Excel and PDF get a **Farm expenses** sheet / section too (`buildBatchListReport(list, expenses)`); its CSV stays one row per batch (CSV is one table, and the hint says so). Import: a sheet, section title or file name matching `FARM_EXPENSES` (`farm expenses`, `gastos ng farm/bukid`) is read as real expenses, so `reportShares` no longer skips them; batch reports' shares are still skipped. Round trips tested for Excel, PDF and CSV. |
| `af5ea67` | **Phones and Ollama.** `vite.config.js`: `server.proxy` and `preview.proxy` pass `/ollama` to `http://localhost:11434` (or `OLLAMA_PROXY_TARGET`), dropping the `Origin` header (Ollama answers 403 to a LAN origin otherwise). `defaultOllamaUrl()`: `http://localhost:11434` on the farm PC, `/ollama` when the app is opened from another device; ⚙ explains it. `npm run dev:lan` / `preview:lan` (`--host --mode lan`) add `@vitejs/plugin-basic-ssl` (self-signed https) so phones allow the microphone. COOP/COEP headers unchanged. Checked with curl: LAN origin direct to Ollama 403, via `/ollama` 200, `dev:lan` https page 200 with both headers, `/ollama` over https 200. Not tried from a real phone. |
| `1de5c32` | **`npm audit fix`** (no `--force`): vite 6.4.3 → 6.4.5 and other dev-tool fixes; 10 advisories → 4 low (section 0). Tests and build pass. |
| `34ba117` | **Bundle split.** Chart.js is loaded by `loadChart()` when the Dashboard draws its chart (own 153 KB chunk, precached), with a guard for a redraw during loading; `manualChunks` puts Supabase (227 KB) and Dexie (97 KB) in their own chunks. Main chunk 654 KB → **176 KB**. `chunkSizeWarningLimit: 600` because the two remaining big chunks are lazy (Whisper worker 549 KB, SheetJS 488 KB). Chart checked in the production build. |

# ChickPence — Session Handoff

**Date:** 2026-10-28
**Branch:** `main` (Phase 2 merged at `fdf678a`; the switch to a local LLM is not committed yet)
**Tests:** 87 passing (`npm test`)

---

## 1. Goal of this workstream

ChickPence is mainly a reporting system, so we are adding four features:

| Phase | Feature | Status |
|---|---|---|
| 1 | Export reports (Excel, PDF, CSV) | ✅ Done, merged, pushed |
| 2 | Logbook photo scanning with a **local LLM (Ollama)** + draft review modal | ✅ Done and tested end to end on this PC |
| 3 | Voice input in the entry form | ⏳ Next |
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
fdf678a Merge branch 'feature/ai-parse' into main
5df8893 feat(ai): scan logbook photos into reviewable draft entries
```
The switch from the Claude Edge Function to the local LLM is **not committed yet**. Local branch `feature/ai-parse` still exists (not pushed; already merged).

---

## 4. Next: Phase 3 voice input (decided with user)
- Reuse what Phase 2 built: `parseText(transcript, batchNames)` runs the same rules + local-model fallback, and `normalizeDrafts` / `validateDraft` turn the result into checked drafts. Spoken sentences are freer than logbook lines, so more of them will reach the slow text model; consider extending `logbookParser` with spoken patterns first.
- A **mic button inside the existing "+ Add New Log" modal**, not a separate import screen.
- Web Speech API (`fil-PH` / `en-PH`, Taglish) → show the transcript → `parseText` → **prefill the form** → the user taps Save as usual (the existing form acts as the review step).
- One entry per recording at first. Hide the mic when unsupported (works in Chrome/Edge; limited on iOS Safari; not in Firefox).
- Privacy: Web Speech sends audio to Google, which conflicts with the local-only AI. Either say so in the PRD privacy section, or use a local speech model (e.g. Whisper on a local server) instead.

## 5. Phase 4: AI suggestions
- Use the local LLM (`localLlm.js`) instead of an Edge Function. Send **only computed metrics** (cost breakdown, FCR, mortality trend, margins, `calcDashboardAverages`). No buyer names.
- Returns 3–5 suggestions, each tied to a specific number. They show in a "Suggestions" card on the Dashboard and Summary, labeled AI-generated. Cache them in Dexie (`ai_insights` table).
- Generation is slow on CPU (minutes), so run it in the background and only when the metrics change.
- The existing rule-based warning flags stay as they are. AI is advisory only.

---

## 6. Environment notes
- Dev server: `.claude/launch.json` → `npm run dev` (port 3000, falls back to the next free port). `.claude/launch.json` is now committed (it holds only the dev-server config).
- **Demo Mode** on the login screen seeds 8 realistic batches locally (no credentials needed); use it to test exports and logbook scanning.
- **Ollama** is installed and running on this PC with glm-ocr, qwen3.5:4b, qwen2.5:3b, qwen2.5:1.5b, llama3.2:3b, phi4-mini and nomic-embed-text.
- An old stash (`stash@{0}`, from before the multi-batch work) still exists locally; it was left alone.
- `npm audit` reports advisories in existing dev tooling (vitest, vite deps), not in the new export packages. `npm audit fix` is a separate cleanup.
- Main JS chunk is ~565 KB (Chart.js, Supabase, Dexie), separate from the export libraries. Code-splitting could be a later optimization.

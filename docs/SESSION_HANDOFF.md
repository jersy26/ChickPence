# ChickPence — Session Handoff

**Date:** 2026-10-28
**Branch:** `main` (pushed, in sync with `origin/main`; Phase 2 merged at `fdf678a`)
**Tests:** 70 passing (`npm test`)

---

## 1. Goal of this workstream

ChickPence is mainly a reporting system, so we are adding four features:

| Phase | Feature | Status |
|---|---|---|
| 1 | Export reports (Excel, PDF, CSV) | ✅ Done, merged, pushed |
| 2 | `ai-parse` edge function + logbook photo OCR + draft review modal | ✅ Done, merged, pushed (Edge Function **not deployed yet**) |
| 3 | Voice input in the entry form | ⏳ Next |
| 4 | AI suggestions (`ai-insights`) | ⏳ Planned |

### Architecture (agreed)

```
Logbook photo ─┐
               ├─► ai-parse (Supabase Edge Fn → Claude) ─► Draft review modal ─┐
Voice → text ──┘                                                                │
Manual form (existing "+ Add New Log") ─────────────────────────────────────────┤
                                                                                ▼
                                   Repository.save* + calcBatchMetrics (single write path)
                                         │                    │                     │
                                   Dexie + outbox       Export module        ai-insights (Edge Fn)
                                   → Supabase sync      xlsx / pdf / csv     → Suggestions card
```

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

## 3. Done: Phase 2 (ai-parse + photo OCR)

### What the user sees
- A **📷 Scan logbook** button next to **+ Add New Log** on the Batches page. It opens the camera (or file picker), shrinks the photo, and sends it to `ai-parse`.
- A **Review Scanned Entries** modal: one row per draft, every field editable, a confidence badge (red below 70%), and a "?" on fields the AI was unsure of or that are missing. Rows can be unticked. **Save selected** validates first, then saves through `Repository.save*`. If a save fails, only the failed rows stay in the modal, so nothing is saved twice.
- **Offline:** the photo is stored and scanned automatically when the app comes back online; then a **Review scanned (N)** button appears. A failed scan keeps the photo so the user can retry or delete it.
- **Demo Mode / no Supabase:** the button is greyed out; tapping it shows why (phones have no hover tooltip).

### Files
| File | Role |
|---|---|
| `supabase/functions/ai-parse/index.ts` | Deno Edge Function. `mode: "image"` → `claude-sonnet-5-5` (effort `medium`, server-side refusal fallback `fallbacks: "default"`); `mode: "text"` → `claude-haiku-5-5` (effort `low`). Structured JSON output via `output_config.format` (json_schema). Returns `{ entries, notes }`; never touches the database |
| `src/services/aiParseService.js` | `aiUnavailableReason`, `resizeImage`, `parseImage`, `parseText`; pure `normalizeDrafts`, `matchBatch`, `validateDraft`, `draftToSave`, `localToday`; offline queue (`queueImageJob`, `processQueuedJobs`, `getReadyJobs`, `retryJob`, `deleteJob`) |
| `src/ui/importReviewModal.js` | `renderImportReviewModal` (pure), `openImportReviewModal`, `escapeHtml` |
| `src/ui/batchesView.js` | `renderScanActions(importState)`; new `importState` argument on `renderBatches`; `onScanPhoto` / `onReviewScans` callbacks |
| `src/main.js` | `scanLogbookPhoto`, `reviewNextScan`, `processQueue` (runs at start-up and whenever the app comes back online) |
| `src/db/dexie.js` | **v4**: `import_jobs: '++id, status, created_at'` (local only, not synced) |
| `src/style.css` | `.import-*`, `.scan-btn` styles |
| `tests/aiImport.test.js` | 18 unit tests (normalization, validation, save mapping, HTML escaping, scan button states) |

### Decisions and gotchas
- **Forced `tool_choice` returns a 400 on `claude-sonnet-5-5`,** so the function uses structured output (`output_config.format`) instead of a forced tool. Every field is in the schema and unused ones are `null`.
- **Expenses never get a batch.** They are farm-level and allocated by the existing engine. Feed, mortality and sale drafts get a batch from the AI's `batch_hint`, matched to open batch names; with only one open batch it is used automatically.
- **Sacks of feed** are converted at 50 kg/sack and flagged as uncertain.
- **AI text is HTML-escaped** before it goes into the modal (buyer names, source quotes, notes).
- **"Today" is sent from the client in local time,** so "kahapon" resolves correctly before 8 AM PH time.
- `import_jobs.status`: `queued` → `ready` (drafts stored, photo dropped) or `failed` (photo kept for retry). A job is deleted once its drafts are saved or discarded.
- Requests need a signed-in Supabase user: Edge Functions verify the JWT by default, and `supabase.functions.invoke` sends it.
- **Not yet run against Claude.** Deno and the Supabase CLI are not installed on the dev machine, so the function has not been type-checked or called. The review modal and save path were tested in Demo Mode with sample drafts.

### Deploy (still to do)
```bash
supabase secrets set ANTHROPIC_API_KEY=your-key
supabase functions deploy ai-parse
```
Then sign in with a real Supabase account (not Demo Mode), scan a logbook page, and check the drafts. Logs: Supabase dashboard → Edge Functions → `ai-parse`.

### Commits (on `main`)
```
fdf678a Merge branch 'feature/ai-parse' into main
5df8893 feat(ai): scan logbook photos into reviewable draft entries
```
Local branch `feature/ai-parse` still exists (not pushed; already merged).

---

## 4. Next: Phase 3 voice input (decided with user)
- Reuse what Phase 2 built: `parseText(transcript, batchNames)` already calls `ai-parse` text mode, and `normalizeDrafts` / `validateDraft` turn the result into checked drafts.
- A **mic button inside the existing "+ Add New Log" modal**, not a separate import screen.
- Web Speech API (`fil-PH` / `en-PH`, Taglish) → show the transcript → `ai-parse` text mode → **prefill the form** → the user taps Save as usual (the existing form acts as the review step).
- One entry per recording at first. Hide the mic when offline or unsupported (works in Chrome/Edge; limited on iOS Safari; not in Firefox).
- Thesis note: Web Speech sends audio to Google. Mention it in the PRD privacy section.

## 5. Phase 4: AI suggestions
- Edge Function `ai-insights` receives **only computed metrics** (cost breakdown, FCR, mortality trend, margins, `calcDashboardAverages`). No buyer names.
- Returns 3–5 suggestions, each tied to a specific number. They show in a "Suggestions" card on the Dashboard and Summary, labeled AI-generated. Cache them in Dexie (`ai_insights` table).
- The existing rule-based warning flags stay as they are. AI is advisory only.

---

## 6. Environment notes
- Dev server: `.claude/launch.json` → `npm run dev` (port 3000, falls back to the next free port). `.claude/launch.json` is now committed (it holds only the dev-server config).
- **Demo Mode** on the login screen seeds 8 realistic batches locally (no credentials needed); use it to test exports. AI features are disabled there.
- An old stash (`stash@{0}`, from before the multi-batch work) still exists locally; it was left alone.
- `npm audit` reports advisories in existing dev tooling (vitest, vite deps), not in the new export packages. `npm audit fix` is a separate cleanup.
- Main JS chunk is ~565 KB (Chart.js, Supabase, Dexie), separate from the export libraries. Code-splitting could be a later optimization.

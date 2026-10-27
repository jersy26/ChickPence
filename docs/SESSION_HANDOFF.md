# ChickPence — Session Handoff

**Date:** 2026-10-28
**Branch:** `main` (pushed, in sync with `origin/main` at `03c1a7a`)
**Tests:** 52 passing (`npm test`)

---

## 1. Goal of this workstream

ChickPence is mainly a reporting system, so we are adding four features:

| Phase | Feature | Status |
|---|---|---|
| 1 | Export reports (Excel, PDF, CSV) | ✅ Done, merged, pushed |
| 2 | `ai-parse` edge function + logbook photo OCR + draft review modal | ⏳ Next |
| 3 | Voice input in the entry form | ⏳ Planned |
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

## 2. Done this session: Phase 1 export

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

## 3. Next: Phase 2 (ai-parse + photo OCR)

1. **Supabase Edge Function** `supabase/functions/ai-parse` (Deno). It keeps the Claude API key server-side.
   - Secret: `ANTHROPIC_API_KEY` (set with `supabase secrets set`).
   - **Image mode:** the client resizes the photo to ~1600px and sends base64 → `claude-sonnet-5-5` vision.
   - **Text mode** (reused by Phase 3): transcript → `claude-haiku-5-5`.
   - Returns structured JSON drafts, e.g. `{ type: "sale"|"expense"|"feed"|"mortality", date, ...fields, confidence }`. Use structured output / tool schema so the output is always valid JSON.
   - Check the claude-api skill for current SDK usage before writing it.
2. **`src/ui/importReviewModal.js`:** editable draft rows, low-confidence fields highlighted, batch picker per row, confirm → `Repository.save*`.
3. **Offline:** new Dexie table `import_jobs` (local only, not synced) holds queued photos and processes them when back online. This needs a **Dexie v4** schema bump in `src/db/dexie.js`.
4. Entry point: a "Scan logbook" action next to "+ Add New Log".
5. AI features must disable cleanly in Demo/offline mode (no Supabase configured).

## 4. Phase 3: voice input (decided with user)
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
- Dev server: `.claude/launch.json` → `npm run dev` (port 3000, falls back to 3001). `.claude/` is untracked on purpose.
- **Demo Mode** on the login screen seeds 8 realistic batches locally (no credentials needed); use it to test exports.
- `npm audit` reports advisories in existing dev tooling (vitest, vite deps), not in the new export packages. `npm audit fix` is a separate cleanup.
- Main JS chunk is ~565 KB (Chart.js, Supabase, Dexie), separate from the export libraries. Code-splitting could be a later optimization.

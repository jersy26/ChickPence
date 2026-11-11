# ChickPence UI/UX update (branch `feat/ui-ux-seller-center`)

This folder is the full ChickPence project with the seller-center UI/UX pass applied.
It includes the git history: the change is one commit on the branch `feat/ui-ux-seller-center`, on top of `main`.

## How to run

1. Install Node.js 20 or newer.
2. In this folder run `npm install`, then `npm run dev`.
3. Open the address it prints (usually http://localhost:5173) and click **Instant Demo Mode**.

Run the tests with `npm test`. Build the app with `npm run build` (output goes to `dist/`).

## What changed

| Area | What you get |
| --- | --- |
| Menu | Sidebar with main tabs and subtabs: Home, Batches, Sales & Buyers, Logbook, Team, Reports, User Management, Settings. Drawer menu on phones. |
| Top bar | Breadcrumb, "View as" role preview (Owner, Admin, Staff), notifications bell, sync status, profile. |
| Home | Greeting with the mascot's stage (chick, growing, ready for harvest) and mood; Daily insights (guided questions with answer pop-ups); to-do list that ticks itself from saved entries, with "No deaths today" and "No receipts today". The local-AI Suggestions card is no longer shown on Home. |
| Price check | Type a buyer's price per kg and see profit or loss for the sale and the break-even price. |
| Logbook | Every feed, death, sale and expense entry with filters and CSV export. |
| Team → Task board | Daily records per batch over the last 7 days. |
| User Management, Roles | Admin-panel layout with farm counters, roles, statuses, add user; Owner/Admin/Staff permission cards with farm permissions. |
| Settings | Target harvest age, daily death limit, task due time; profile; language (planned). |
| Coming-next pages | Buyers / Markets, Correction requests, Approvals, Concerns, Payroll: each says what it will do and what it needs first. |
| Staff preview | Hides money, team and user pages. |

## New and changed files

| File | Purpose |
| --- | --- |
| `src/services/guidedQuestions.js` | Computes the guided question cards from the records (no AI). |
| `src/services/dailyTasks.js` | Builds today's to-do list from the records. |
| `src/services/permissions.js` | Owner / Admin / Staff permission table. |
| `src/services/farmSettings.js` | Farm settings and day marks stored on the device. |
| `src/ui/navigation.js` | Menu structure and role filtering. |
| `src/ui/shell.js` | Sidebar and top bar (rewritten). |
| `src/ui/homeWidgets.js` | Question cards, answer pop-up, to-do list, mascot banner. |
| `src/ui/logbookView.js` | Logbook page. |
| `src/ui/priceCheckView.js` | Price check page. |
| `src/ui/usersView.js` | User Management and Roles pages. |
| `src/ui/miscViews.js` | Task board, Settings and coming-next pages. |
| `src/main.js`, `src/ui/dashboardView.js`, `src/style.css` | Routing, Home layout and styles. |
| `tests/guidedQuestions.test.js`, `tests/uiPages.test.js` | 25 new tests. |

## Still a preview

- Users, roles and settings are kept in the browser only. Real accounts need the roles update on the server (audit section 18).
- "Entered by" in the Logbook stays blank until records carry their author.
- Dark mode, the language switch and separate mascot pictures per stage are not done yet.
- Inside the Batches page, Staff can still see costs.

## Push it to GitHub later

From this folder, with write access to the repository:

```bash
git push -u origin feat/ui-ux-seller-center
```

## November 9 — supplied nine-section design

The existing site now follows the supplied cream/gold design boards and nine-section prompt document. Staff header links, centered striped Login and device-only previews follow the user's explicit choices. See `docs/redesign-implementation.md` for connected features, preview boundaries, asset origin and local review evidence. This stage remains local for review before any GitHub push.

## Final follow-up and publishing authorization

The latest Home screenshot now governs the compact composition: horizontal character/copy, shorter to-do rows, four answer cards, health beside the calendar, and a full-width five-KPI Performance row. Desktop Manage batches and the old mobile Questions carousel rule were corrected. The new 6b Concerns mockup replaces its Coming soon screen with a clearly labelled device-only board, thread/status controls and creation drawer. The helper cannot cover Concern controls.

Final validation: 297 tests across 22 files, production build and whitespace checks pass. The independent compact-layout review returned SHIP at its visual/source scope. The user then explicitly authorized pushing the design and all related changes to dstinnee/ChickPence.

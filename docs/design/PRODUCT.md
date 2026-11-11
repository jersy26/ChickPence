# ChickPence

ChickPence is an offline-first web app for broiler farms, developed as a BS Computer Science thesis at Pamantasan ng Lungsod ng Maynila. Its central record is a batch: farmers track chick counts and costs, feed, mortality, expenses and sales, then review cost and profitability.

Multiple batches can remain open together. Farm expenses are entered once and allocated by head count among batches alive on the expense date. Closed batches are read-only. Dashboard and batch summaries expose operational and financial results; history and exports support review. Reports export to Excel, PDF and CSV. File imports and locally scanned logbooks produce drafts for review before saving.

Data is stored in the browser using IndexedDB. Optional Supabase enables accounts and synchronization; without it, Demo Mode supplies eight sample batches. Optional Ollama supports logbook scanning and suggestions. Browser-based Whisper supports Filipino, Taglish and English voice entry after its initial model download. These capabilities depend on their configured services or downloaded models; they are not promises of always-available AI.

The dashboard also presents recorded daily P&L: sales minus chick purchases and allocated expenses on their relevant dates. It complements the existing closed-batch profitability view rather than changing that calculation.

Sources: README.md Features, optional setup and offline behavior; src/services/pnlCalendar.js and src/ui/dashboardView.js for the implemented daily calendar addition. This document records current product scope and makes no new roadmap or audience claims.

The confirmed calendar basis is daily recorded P&L, calculated in integer centavos: sales are booked on sale_date, chick purchases on the batch start_date, and allocated feed/other costs on the source expense's entry_date. Voided records are excluded. A day's figure is not the completed batch's final profit.

Hovering or focusing a date previews its totals and batch contributions. Clicking or tapping opens a dedicated date dialog with daily sales/costs/P&L, chick/feed/other costs, and cumulative batch performance through that date (P&L, live birds, sold birds and mortality). Batch links open the corresponding open-batch editor or closed-batch summary. Month arrows, Today and Latest activity support navigation; keyboard arrows move dates, Enter opens details and Escape dismisses them. The dashboard includes decorative passive and interactive motion with reduced-motion support.


The overview now includes a flock companion whose life stage follows the selected eligible open batch's age and configured harvest target: chick before the first third, growing pullet until the target, then harvest-ready. Its expression summarizes recorded daily loss, mortality spikes and unfinished tasks; it is not a diagnosis or forecast. Owner/Admin see the recorded P&L calendar beside the companion. Staff see tasks and a circular completion tracker in that position, with the same companion scale. A personalized welcome after login leads into the dashboard by scrolling or its entry button.

ChickCount is a separate photo-counting frontend reached through the feather launcher throughout the signed-in app. JPG, PNG and WebP uploads support local preview; selecting Count image sends the photo only when a hosted endpoint is configured. The frontend accepts counts for chickens, pullets, chicks and eggs, plus explicit not-poultry and undetermined results. Estimates require review and never change flock records. The actual endpoint URL and provider documentation remain pending from the user, so live counting is not claimed. Existing optional local AI scanning and suggestions remain separate and preserved. See docs/chickcount-api.md for the current frontend contract.

The existing Owner/Admin/Staff user-management and role controls remain browser-only previews; they do not establish server-enforced authorization or real account administration.


Logs presents saved farm entries as read-only source records, an actual device sync outbox for Owner/Admin, and the latest saved record activity. The outbox clears uploaded changes; it is not permanent sync history. Record activity does not store earlier versions or before/after edits. Search, batch/farm, type and date filters apply explicitly through Filter, with CSV export and pagination. Staff see operational feed and death entries only.

Reports adds Flock balance, Feed & mortality, Sales & buyers and Recorded P&L views with date/status/search filters and CSV export. Flock balance is initial chicks minus recorded deaths and sold birds through the inclusive To date, not a physical count. Feed and deaths follow the selected period; mortality rate and threshold checks are cumulative through To. Sales group actual saved sales by buyer and batch. Recorded P&L uses the integer-centavo date ledger; open batches remain provisional and a filtered period is not final whole-batch profit. Feed stock, payment status and unpaid buyer balances are not manufactured from these records.

Correction requests and Approvals track a proposed correction and reason, a snapshot of the source value, requester, reviewer and review note in an account-keyed queue on this device. Only the Owner/Admin role may decide requests, and self-review is blocked even when switching preview roles. Approval records a decision without editing the farm entry: approved requests remain “Approved · update pending” until a correction is applied separately in Batches. Shared farm/server review remains pending; the device preview is not a shared approval service or server-enforced authorization.

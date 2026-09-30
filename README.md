# 🐥 ChickPence

**Batch-Centric Relational Database System for Poultry Cost and Profitability Analysis**  
*Aligned with ChickPence PRD v1.5 and ERD v1.2*  
*Thesis Documentation — BS Computer Science, Pamantasan ng Lungsod ng Maynila (PLM)*

---

## 📋 Features

- **Batch Lifecycle Management**:
  - Track **Active** and **Completed** batches.
  - Enforces the **single Active batch rule** (at both application level and PostgreSQL partial unique index).
  - Chick acquisition cost recorded once at batch creation as the fixed "Chicks" expense category.
  - Initial chick count is immutable once created.
  - Optional per-batch **Mortality Threshold (%)** and **Cost Budget (₱)**.
- **Daily Operational Logging**:
  - **Itemized Daily Costs**: Feed, Medicines & Vitamins, Utilities (Electricity/Water), Labor, Transportation, Miscellaneous Other.
  - **Feed Consumption Logging**: Logged in physical quantity (kg) by feed type (Starter, Grower, Finisher), separate and independent from feed financial costs.
  - **Mortality Tracking**: Records daily death counts with running cumulative count and mortality percentage.
  - **Sales Recording**: Multi-transaction sales with buyer name, quantity sold (heads), weight (kg), price per kg (₱), and live computed total amount (`weight_kg × price_per_kg`).
  - Row-level editing and soft deletion of entries while batch is Active.
- **Batch Profitability & Decision Support**:
  - Computes Total Production Cost, Sales Revenue, Net Profit, and Profit Margin.
  - Cost breakdown by category with automatic identification of the **highest cost category**.
  - **Warning Flag System**: Live on-screen alerts on the Active Batch page and Dashboard warning card when actual mortality rate exceeds the threshold or total cost exceeds the budget.
  - **Read-Only Batch Summary Report**: Locks completed batches and summarizes costs, sales, feed consumed, and profitability.
- **Dashboard & Comparative Analysis**:
  - Active batch overview with cost, sales, and mortality KPIs.
  - Interactive **Net Profit Bar Chart** for the last 5 completed batches (tap any bar to jump to that batch's summary).
  - Rolling average Net Profit and average selling price per kg.
- **Offline-First PWA Architecture**:
  - Service Worker (Workbox) caching for instantaneous offline loading.
  - Local database via **Dexie.js (IndexedDB)** with an outbox sync queue.
  - Dual Mode: Instant Demo / Offline Mode out-of-the-box with 7 pre-populated realistic batches, or real cloud sync with **Supabase (PostgreSQL & Supabase Auth)**.
  - Idempotent upsert sync and last-write-wins conflict resolution by `updated_at`.

---

## 🛠 Tech Stack

- **Frontend**: HTML5, Tailwind CSS, Vanilla JavaScript (Single Page Application)
- **PWA & Offline Engine**: Service Worker (Workbox), Web App Manifest, Dexie.js (IndexedDB)
- **Bundler & Tooling**: Vite, VitePWA
- **Database & Auth (Cloud)**: Supabase (PostgreSQL 15+, Supabase Auth, Row Level Security)

---

## 🚀 Getting Started

### 1. Installation

Ensure you have [Node.js](https://nodejs.org/) installed (v18 or higher recommended).

```bash
# Clone or navigate to the directory
cd ChickPence

# Install dependencies
npm install
```

### 2. Run in Development Mode

```bash
npm run dev
```

Open your browser at `http://localhost:3000`.

### 3. Immediate Testing (Demo Offline Mode)

- Click **Instant Demo Mode** on the login screen (or enter any credentials).
- The app automatically initializes 7 realistic batches (`Batch 2025-08` through `Batch 2026-08`) in Dexie IndexedDB.
- Explore the **Dashboard**, switch between tabs in **Active Batch**, add or edit costs/sales, view the **History** table, or inspect a completed batch in **Batch Summary**.
- Test offline capabilities: Click **Simulate offline** in the bottom sidebar, record entries (notice the pending sync count), and click **Go online** to watch them sync!

---

## ☁ Connecting to Supabase Cloud

To enable live PostgreSQL database synchronization and Supabase Auth:

1. Create a free project at [Supabase](https://supabase.com).
2. Open the Supabase **SQL Editor** and execute the migration script located at:
   `supabase/migrations/20260930000000_init_chickpence.sql`
3. Configure your credentials in either of two ways:
   - **Method A**: Create/edit the `.env` file in the project root:
     ```env
     VITE_SUPABASE_URL=https://your-project.supabase.co
     VITE_SUPABASE_ANON_KEY=your-anon-key-here
     ```
   - **Method B**: From the running web app, click **⚙ Supabase** in the sidebar or login screen, paste your URL and Anon Key, and click **Save & Connect**.

---

## 📁 Project Structure

```
ChickPence/
├── public/
│   ├── favicon.svg
│   ├── pwa-192x192.svg
│   └── pwa-512x512.svg
├── src/
│   ├── db/
│   │   ├── dexie.js           # Dexie IndexedDB schema & stores
│   │   └── seed.js            # Initial data seeder (prototype batches)
│   ├── services/
│   │   ├── auth.js            # Dual mode auth (Supabase Auth / Demo session)
│   │   ├── calculations.js    # ERD/PRD mathematical & financial formulas
│   │   ├── repository.js      # Data queries and mutation operations
│   │   ├── supabaseClient.js  # Supabase client initializer
│   │   └── syncEngine.js      # Offline queue, outbox, and cloud sync engine
│   ├── ui/
│   │   ├── activeBatchView.js # Active batch entry, tabs & complete modal
│   │   ├── dashboardView.js   # Dashboard, KPI cards, warning & profit chart
│   │   ├── historyView.js     # Batch history table with search & filters
│   │   ├── loginView.js       # Login interface
│   │   ├── modals.js          # Threshold, completion, and config modals
│   │   ├── shell.js           # Navigation bar, brand & sync status widget
│   │   ├── summaryView.js     # Read-only completed batch summary report
│   │   └── toast.js           # Notification alerts
│   ├── main.js                # App bootstrap & view router
│   └── style.css              # Design tokens, variables & Tailwind CSS
├── supabase/
│   └── migrations/
│       └── 20260930000000_init_chickpence.sql  # PostgreSQL DDL & RLS policies
├── .env.example
├── index.html
├── package.json
└── vite.config.js
```

---

## 📐 Database Schema & Integrity

- **batch**: `batch_id` (PK, UUID), `user_id` (FK), `batch_name`, `start_date`, `end_date`, `initial_chick_count`, `chick_cost`, `mortality_threshold_pct`, `cost_budget`, `status`, `updated_at`, `deleted_at`.
- **one_active_batch Index**: `CREATE UNIQUE INDEX one_active_batch ON batch ((status)) WHERE status = 'Active' AND deleted_at IS NULL;`
- **daily_cost**: Itemized costs per date and batch (`feed_cost`, `medicine_cost`, `utilities_cost`, `labor_cost`, `transport_cost`, `other_cost`).
- **feed_log**: Physical consumption (`Starter`, `Grower`, `Finisher`) in kg.
- **mortality_log**: Daily deaths and cumulative rate.
- **sale**: Buyer, quantity, weight, price per kg, and stored `total_amount`.
- Soft delete (`deleted_at`) and timestamp tracking (`updated_at`) ensure safe, idempotent last-write-wins offline synchronization.

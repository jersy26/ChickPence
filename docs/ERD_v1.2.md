# Entity-Relationship Diagram (Logical)
## ChickPence: Batch-Centric Relational Database System

**Version:** 1.2  
**Status:** Draft  
**Related document:** ChickPence PRD v1.5  
**Database:** Supabase (PostgreSQL)  
**Aligned with:** ChickPence interactive prototype (Sept 2026)  

---

## Entities and Attributes

### USER
Users are managed by **Supabase Auth** (`auth.users`). There is no custom USER table and no `password_hash` column; passwords are handled by Supabase Auth. The system uses one shared login.

---

### BATCH
| Attribute | Data Type | Constraint | Notes |
|---|---|---|---|
| batch_id | UUID | PK | Auto-generated |
| user_id | UUID | FK → auth.users.id, NOT NULL | Supabase Auth user who created the batch |
| batch_name | VARCHAR(100) | NOT NULL | e.g. "Batch 2026-10" |
| start_date | DATE | NOT NULL | Date chicks acquired |
| end_date | DATE | NULLABLE | Set when batch is completed |
| initial_chick_count | INT | NOT NULL | Fixed at creation, not editable |
| chick_cost | DECIMAL(12,2) | NOT NULL, DEFAULT 0.00 | Total chick acquisition cost; counted as the "Chicks" cost category |
| mortality_threshold_pct | DECIMAL(5,2) | NULLABLE | Optional; set at creation or edited later |
| cost_budget | DECIMAL(12,2) | NULLABLE | Optional; total cost limit for the batch (used for cost flag) |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'Active' | Active / Completed |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | Auto-set on creation |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Set on every insert/update; used for last-write-wins sync |
| deleted_at | TIMESTAMPTZ | NULLABLE | Soft delete; NULL = active record |

*Rule: only one batch may have status 'Active' at a time (enforced by a partial unique index, see schema).*

---

### DAILY_COST
| Attribute | Data Type | Constraint | Notes |
|---|---|---|---|
| cost_id | UUID | PK | Auto-generated |
| batch_id | UUID | FK → BATCH.batch_id | NOT NULL |
| entry_date | DATE | NOT NULL | Date of cost entry |
| feed_cost | DECIMAL(10,2) | DEFAULT 0.00 | |
| medicine_cost | DECIMAL(10,2) | DEFAULT 0.00 | Medicine / vitamins |
| utilities_cost | DECIMAL(10,2) | DEFAULT 0.00 | Electricity + water |
| labor_cost | DECIMAL(10,2) | DEFAULT 0.00 | |
| transport_cost | DECIMAL(10,2) | DEFAULT 0.00 | |
| other_cost | DECIMAL(10,2) | DEFAULT 0.00 | Miscellaneous |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Set on every insert/update; used for last-write-wins sync |
| deleted_at | TIMESTAMPTZ | NULLABLE | Soft delete; NULL = active record |

---

### FEED_LOG
| Attribute | Data Type | Constraint | Notes |
|---|---|---|---|
| feed_log_id | UUID | PK | Auto-generated |
| batch_id | UUID | FK → BATCH.batch_id | NOT NULL |
| entry_date | DATE | NOT NULL | |
| feed_type | VARCHAR(100) | NOT NULL | e.g. "Starter", "Grower", "Finisher" |
| quantity_kg | DECIMAL(8,2) | NOT NULL | Consumed that day |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Set on every insert/update; used for last-write-wins sync |
| deleted_at | TIMESTAMPTZ | NULLABLE | Soft delete; NULL = active record |

*Note: Feed consumption is recorded independently from feed cost in DAILY_COST; no cross-validation enforced.*

---

### MORTALITY_LOG
| Attribute | Data Type | Constraint | Notes |
|---|---|---|---|
| mortality_id | UUID | PK | Auto-generated |
| batch_id | UUID | FK → BATCH.batch_id | NOT NULL |
| entry_date | DATE | NOT NULL | |
| count | INT | NOT NULL, DEFAULT 0 | Number of deaths that day |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Set on every insert/update; used for last-write-wins sync |
| deleted_at | TIMESTAMPTZ | NULLABLE | Soft delete; NULL = active record |

---

### SALE
| Attribute | Data Type | Constraint | Notes |
|---|---|---|---|
| sale_id | UUID | PK | Auto-generated |
| batch_id | UUID | FK → BATCH.batch_id | NOT NULL |
| sale_date | DATE | NOT NULL | |
| buyer_name | VARCHAR(150) | NOT NULL | |
| quantity_sold | INT | NOT NULL | Number of chickens (heads) sold |
| weight_kg | DECIMAL(8,2) | NOT NULL | Total weight of this sale |
| price_per_kg | DECIMAL(8,2) | NOT NULL | Selling price per kg |
| total_amount | DECIMAL(10,2) | NOT NULL | Stored computed: weight_kg × price_per_kg |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Set on every insert/update; used for last-write-wins sync |
| deleted_at | TIMESTAMPTZ | NULLABLE | Soft delete; NULL = active record |

---

## Computed Values (not stored, derived at query time)

| Value | Formula |
|---|---|
| Daily cost total (per entry) | `feed_cost + medicine_cost + utilities_cost + labor_cost + transport_cost + other_cost` for one DAILY_COST row |
| Active-record filter | All computed values use only rows with `deleted_at IS NULL` |
| Total production cost per batch | `batch.chick_cost + SUM(daily cost total)` across all DAILY_COST entries for the batch |
| Cost breakdown per batch | Per category: Chicks = `chick_cost`; Feed, Medicine, Utilities, Labor, Transport, Other = `SUM` of the matching DAILY_COST column |
| Highest cost category | Category with the largest amount in the cost breakdown |
| Total revenue per batch | `SUM(total_amount)` across all SALE entries for the batch |
| Net profit per batch | `Total revenue − Total production cost` |
| Profit margin per batch | `(Net profit / Total revenue) × 100` (0 if revenue is 0) |
| Total feed consumed per batch | `SUM(quantity_kg)` across all FEED_LOG entries for the batch |
| Cumulative mortality count | `SUM(count)` across all MORTALITY_LOG entries for the batch |
| Cumulative mortality rate | `(Cumulative mortality count / initial_chick_count) × 100` |
| Running cumulative mortality (per entry) | Running `SUM(count)` ordered by `entry_date`; rate = running count / `initial_chick_count` × 100 |
| Mortality flag | `mortality_threshold_pct IS NOT NULL AND Cumulative mortality rate > mortality_threshold_pct` |
| Cost flag | `cost_budget IS NOT NULL AND Total production cost > cost_budget` |
| Average net profit (Dashboard) | Mean of Net profit across the 5 most recent Completed batches (by `start_date`) |
| Average selling price per kg (Dashboard) | `SUM(total_amount) / SUM(weight_kg)` across all sales of the 5 most recent Completed batches |

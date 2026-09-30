# Product Requirements Document
## ChickPence: Batch-Centric Relational Database System for Poultry Cost and Profitability Analysis

**Version:** 1.5  
**Status:** Draft  
**Prepared by:** Jersylle Hannah Nismal  
**Institution:** Pamantasan ng Lungsod ng Maynila (PLM)  
**Document type:** Thesis PRD — BS Computer Science  
**Aligned with:** ChickPence interactive prototype, User Flow v1.2, ERD v1.2

---

## 1. Overview

### 1.1 Background
A small-scale poultry farm operating in the Philippines currently tracks batch expenses, feed consumption, mortality, and sales through paper logbooks — a mix of shared and separate notebooks with no structured reference back to a specific batch. Daily costs are recorded as a single consolidated dated amount rather than itemized entries. Sales are recorded per transaction but not linked to batch performance. As a result, the farm owner cannot accurately determine how much each chicken batch actually cost, earned, or lost.

### 1.2 Problem Statement
The business cannot accurately identify how much each chicken batch costs, earns, and loses because expenses, mortality, feed consumption, and sales records are not systematically analyzed together. The absence of a structured, batch-linked recording system prevents the owner from making data-driven decisions about pricing, batch size, and operational adjustments.

### 1.3 Proposed Solution
**ChickPence** is a Progressive Web Application (PWA) backed by a relational database that records, organizes, and analyzes production costs, operational expenses, mortality, feed consumption, and sales data per chicken batch. It is delivered as a single, unified interface — responsive across desktop, laptop, and mobile — with a simple, form-based UI designed for users with basic computer literacy. It works offline-first: data entered without internet is queued locally and synced to the cloud when connectivity is restored, making it practical for farm environments with unreliable internet access.

The interface has four areas: a **Dashboard** (current batch, recent profit trend, warnings), an **Active Batch** page (daily data entry), a **History** page (all past batches), and a read-only **Batch Summary** report for each completed batch.

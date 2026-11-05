# Polling Stations — Schema & Import Contract Proposal

**Status:** The `polling_stations` migration is now codified as
`database/migrations/003_polling_stations.sql`; the importer is still not
implemented. This document remains a design proposal for review and approval
before any importer code is written.

**Source of truth (verified, not guessed):**
- `Peddapuram_Booths.xlsx` — sheet `Booths`
- `Jami_Booths.xlsx` — sheet `Booths`

These are the sample proformas the district confirmed we will model against
("this is how we assume the data will look; we will use it"). The schema below
is derived from their actual columns.

---

## 1. Verified source structure

Both files share one worksheet named `Booths` with a single header row and
exactly these 11 columns, in this order:

| # | Column (exact header text) |
|---|---|
| 1 | Booth ID |
| 2 | Booth Number |
| 3 | Booth Name |
| 4 | Building Name |
| 5 | Street |
| 6 | Village/Locality |
| 7 | Ward |
| 8 | Mandal |
| 9 | District |
| 10 | PIN Code |
| 11 | Required Officers |

### Evidence (read-only checks performed)

| File | Data rows | Distinct District | Distinct Mandal | Required Officers | Duplicate Booth IDs |
|---|---|---|---|---|---|
| Peddapuram_Booths.xlsx | 10 | Kakinada | Peddapuram | 2 | none |
| Jami_Booths.xlsx | 10 | Vizianagaram | Jami | 1 | none |

- `Booth ID` is unique within each file (e.g. `PB101…`, `B001…`). This is a
  **within-file** observation only; global uniqueness is unverified, so it is
  NOT asserted as a primary key or unique constraint (see §2).
- `Required Officers` is a small integer (observed 1 and 2).
- `PIN Code` is a 6-digit postal code; stored as text to preserve leading zeros.
- `Booth Number` (e.g. `101`) is the display/station number and is distinct from
  `Booth ID`.

---

## 2. Proposed `polling_stations` table (conceptual)

One row per polling station (booth). Minimal, mirrors the proforma 1:1. No
invented columns; no SQL is included here.

| Column | Type (concept) | Source column | Notes / constraints (proposed) |
|---|---|---|---|
| `id` | integer | (surrogate) | PRIMARY KEY (`SERIAL` in migration 003) |
| `station_id` | text | Booth ID | stored verbatim; NON-UNIQUE (global uniqueness unverified) |
| `station_number` | text | Booth Number | display/station number |
| `station_name` | text | Booth Name | |
| `building_name` | text | Building Name | |
| `street` | text | Street | |
| `locality` | text | Village/Locality | |
| `ward` | text | Ward | |
| `mandal` | text | Mandal | candidate for Stage 1/3 scoping |
| `district` | text | District | see Open Question Q2 |
| `pin_code` | text | PIN Code | keep as text (leading zeros) |
| `required_officers` | integer | Required Officers | observed 1–2 |
| `import_batch_id` | integer/fk | (import bookkeeping) | links to `import_batches` for traceability, mirroring the `personnel` pattern |

Rationale for `import_batch_id`: the existing `personnel` import already records
a batch id for traceability. Reusing that pattern keeps station imports
auditable and consistent without a new concept.

### Why these columns
Every column maps to a real proforma column. `import_batch_id` is the only
addition, and it exists solely for import traceability (the import-history /
traceability requirement). No separate table is proposed for any single station
attribute.


---

## 3. Import contract (proposed)

**Input:** one `.xlsx` workbook, worksheet named `Booths`, header on row 1.
**Authorization (once wiring is approved):** `authority`, `admin` only —
identical to the personnel import policy.
**Traceability:** one `import_batches` row per upload; accepted stations
reference it via `import_batch_id`.

**Per-row rules (minimal, no invented rules):**
- `Booth ID` required; non-empty and unique within the file (later duplicate
  rejected).
- `Booth Number` required; non-empty.
- `Mandal`, `District` required; non-empty (they drive scoping).
- `PIN Code` optional format check: 6 digits when present.
- `Required Officers` optional; when present must be a positive integer.
- All other columns stored as-is (trimmed text); blanks allowed.

**Duplicate policy (mirrors personnel, pending confirmation):**
- Duplicate `Booth ID` **within one uploaded file** → reject the later row.
- Duplicate `Booth ID` **against existing stored stations** → see Open Question
  Q5 (do not silently overwrite).

**Result shape (mirrors the personnel import response):**
- `ok`, batch metadata, `counts` (total / accepted / rejected),
  `rejected: [{ row, stationId, reasons }]`, and the accepted rows.

---

## 4. Relationship to Stage 3

- Stage 3 (`stage3.mapping.js`) currently consumes caller-supplied stations as
  `{ stationId, stationCode, mandal }`. With this table, `station_id` becomes
  the persisted source, and Stage 3 would join formed polling parties
  (by `teamCode`) to stations (by `station_id`).
- Stage 3 logic itself does not change in this proposal — only the data source
  for stations moves from caller-supplied to the persisted `polling_stations`
  table.
- The `required_officers` value is captured now so a future, separately
  approved step can validate team-size vs. station requirement — **not**
  enforced in this proposal.

---

## 5. Open questions (still require confirmation)

1. **Allocation model (critical).** The circular's three-stage *team*
   randomization (our Stage 1/2/3) versus the sample files' *individual
   officer → booth* mapping. The station table is model-agnostic, but Stage 3
   persistence depends on this answer. Unresolved.
2. **District scope.** Sample files span Kakinada (Peddapuram) and
   Vizianagaram (Jami). Is real scope single-district or multi-district? This
   decides whether `district` is a plain column or a foreign key to a
   districts/master-data table. Unresolved.
3. **Booth = Polling Station?** Assumed yes. Confirm.
4. **Personnel schema.** The 35-column `Employees data_proforma.xlsx` remains
   the authoritative personnel source; the sample "Officers" sheet is test
   data. Confirm.
5. **Cross-batch duplicate policy** for re-importing an updated station file
   (replace vs. reject vs. version). Unresolved — mirrors the personnel open
   question.
6. **Notifications / SMS / Rejected / Dashboard** sheets in the complete test
   file are out of scope (WhatsApp/SMS excluded). Confirm they stay excluded.

---

## 6. Explicitly NOT in this proposal

- A migration file (`database/migrations/003_polling_stations.sql`) has been
  codified and matches the live `polling_stations` table; it is not executed
  again here (source-control recovery only).
- No importer code, endpoint, or service has been written.
- No database, configuration, frontend, or unrelated module has been changed.
- No SQL or ORM model code appears in this document.

This is documentation only, awaiting approval before any implementation step.

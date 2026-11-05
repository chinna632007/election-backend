# Decisions and Open Questions

> Documentation only. Part A records decisions **already confirmed**. Part B lists decisions **awaiting team review** — none of these may be assumed or invented by developers; each must be resolved against the APSEC circular/randomization manual or by team agreement, and moved to Part A when decided.

## Part A — Confirmed decisions

1. **Stack:** Node.js backend, MongoDB database, Excel/CSV input (Express, Mongoose, `jsonwebtoken`, and `dotenv`).
2. **Scope:** polling personnel only; users are the District Election Authority and authorized district staff.
3. **Workflow:** three randomization stages in order, then a separate training workflow.
4. **Stage 1 output:** the stated **120% pool including reserve personnel**.
5. **Stage dependency chain:** Stage 2 consumes Stage 1 output; Stage 3 consumes Stage 2 output; training references completed records without duplication.
6. **Module layout:** one module directory per stage plus shared modules (master-data, personnel, imports, reports, audit), as created in `src/modules/`.
7. **Stage ownership:** Teammate 1 → Stage 1; Teammate 2 → Stage 2; Me → Stage 3 + training.
8. **One shared database** and shared identifier conventions across all stages.
9. **Persistence change:** use a fresh MongoDB database; leave existing PostgreSQL data untouched and do not run the retained SQL migrations.

## Part B — Open questions awaiting team review

### B1. Personnel eligibility
- Which personnel are eligible for selection (designation levels, categories, tenure, prior-deployment exclusions)?
- Are classification/category attributes (exact list from the manual) mandatory for eligibility?
- Is any approval required for the imported personnel list before randomization?

### B2. Reserve-pool calculations (Stage 1)
- What exactly does the 120% apply to — per polling station, per constituency, per team, or district-wide?
- Rounding rules when 120% is not a whole number?
- Are reserve personnel ranked/ordered? What is the top-up or replacement procedure when a selected person becomes unavailable?
- Are reserves part of Stage 2 teams or held aside until called?

### B3. Team composition (Stage 2)
- How many members per polling team, and which roles per team (per the manual)?
- Any category/representativeness constraints across teams?
- Team numbering/scope conventions (per constituency? per station group?).

### B4. Import columns and templates
- Exact Excel/CSV templates: required columns, headers, order, sheet layout; do Excel and CSV share one template?
- File size/row limits; encoding; handling of merged or multi-row headers.
- Who may upload; whether batch corrections are new batches linked to old ones; retention of rejected rows.

### B5. Allocation rules (Stage 3 and cross-stage)
- Mapping constraints for teams ↔ polling stations (proximity, home-area, capacity) as stated by the manual.
- Cardinality: one team per polling station? Handling of auxiliary/aux stations?
- May a completed run be re-run or superseded? Under whose authorization? (Proposed: prior runs immutable; needs confirmation.)
- Post-mapping swaps/adjustments: permitted? How recorded?
- Is any seed/reference value required to be stored for official verification of randomness? (Do not assume — confirm with the manual.)

### B6. Authorization
- Exact role list beyond "authorized district staff" (e.g., who executes each stage, who approves, who only views).
- Permission matrix per module action; district-scoping rules if multiple districts share one deployment.
- Session/token policy (expiry, re-authentication for stage execution).
- Intended use of the declared `googleapis` dependency (Drive backup? Sheets sync? or remove it).

### B7. Training requirements
- Session structure, mandatory topics, duration, venues; who conducts and signs off.
- Does training completion gate deployment? Definition of "completed."
- Substitute (reserve) attendance rules; reporting obligations for training.

### B8. Reports
- Which reports are officially prescribed (by stage, by election), their formats, and recipients.
- Export formats required (Excel, PDF, print layouts) and at what granularity (per constituency, per station).

### B9. Engineering decisions (team-internal)
- Test framework for `tests/`.
- Migration file naming/ownership convention (prefix bands per owner).
- Stewardship assignment for shared modules (master-data, personnel, imports, reports, audit, config/database/middleware/shared).
- Audit retention period and whether audit storage must be append-only at the database level.
- Deployment/environment strategy (staging vs. production databases).

## How to resolve

Bring open questions to a short team review, verify against the circular/manual, record the outcome in Part A (and update the relevant document), and only then implement. Nothing in Part B may be hard-coded as if it were an official rule.

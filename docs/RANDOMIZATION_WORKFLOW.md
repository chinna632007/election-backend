# Randomization Workflow

> Documentation only. This document describes the three randomization stages — their prerequisites, inputs, outputs, validation, traceability, and dependencies. It deliberately contains **no randomization algorithm and no official rule that is not stated in the APSEC circular or randomization manual**. Unspecified rules are marked as open questions in `DECISIONS_AND_OPEN_QUESTIONS.md`.

## 0. Rules common to all stages

- Stages run in strict order for a given election configuration: Stage 1 → Stage 2 → Stage 3. A stage refuses to start until the previous stage has a completed run for the same election configuration.
- Every execution is recorded as a **randomization run** (who, when, which election, which stage, status) and every run is traceable through the audit trail.
- Completed runs are treated as immutable records (proposed): corrections produce a new run, never an edit of an old one. Re-run policy is an open question.
- All stages operate on the shared personnel identifiers, election configuration, and team records defined in `DATABASE_DESIGN.md`.
- Who is authorized to execute each stage is an open question; execution must be restricted to authorized district users and audited.

## 1. Stage 1 — Personnel selection and reserve-pool handling

Owner: **Teammate 1** (`src/modules/randomization-stage-1/`).

**Purpose.** Select the polling personnel required for the election as a pool of **120% of the requirement, including reserve personnel** — the required personnel plus the excess that forms the reserve pool.

**Prerequisites.**
- Election configuration exists (district context, requirement figures).
- Personnel and master data have been imported and validated.
- No completed Stage 1 run already in force for that election (unless a re-run is explicitly permitted — open question).

**Inputs.**
- Validated personnel records (with department, office, designation, classification attributes).
- Election configuration, including the required-strength figures that drive the 120% calculation.
- Eligibility rules as stated by the circular/manual (to be confirmed verbatim — not invented).

**Outputs.**
- A Stage 1 run record.
- The selected pool for that run: each selected personnel with selection outcome, including the reserve portion of the pool, marked so downstream stages can distinguish required vs. reserve personnel.
- Audit events for execution and any approval step.

**Validation (conceptual checks).**
- Pool size matches the stated 120% of requirement (base and rounding rules to be confirmed).
- No duplicates within the pool; every entry references an existing personnel record.
- Only eligible personnel are selected (eligibility rules TBD).
- Required-vs-reserve counts reconcile with the requirement figures.

**Traceability.** The run records actor, timestamp, election configuration, and the exact input set used; the pool entries reference the run; audit events mirror the execution. Reports can reconstruct who was selected, when, and by whom.

**Downstream dependency.** Stage 2 consumes this run's pool. Stage 2 must not re-select personnel independently.

**Open questions.** 120% base (per station/constituency/district) and rounding; eligibility/exclusion rules; whether reserves are ranked; top-up/replacement procedure; approval step after Stage 1.

## 2. Stage 2 — Polling-team formation

Owner: **Teammate 2** (`src/modules/randomization-stage-2/`).

**Purpose.** Form polling teams from the Stage 1 selected pool (including handling of reserve personnel per the manual).

**Prerequisites.**
- A completed Stage 1 run exists for the same election configuration, and its pool has not been superseded.
- Team composition rules are available (from the manual — exact composition is an open question).

**Inputs.**
- The Stage 1 run pool (required + reserve personnel), referenced by run identifier.
- Team composition rules: team size, member roles, and any category/representativeness constraints (all to be confirmed from the manual — not invented).

**Outputs.**
- A Stage 2 run record linked to the source Stage 1 run.
- Polling team records with their members, each member referencing shared personnel identifiers and their role in the team; reserve handling recorded explicitly (held aside, attached, or ranked — per confirmed rules).
- Audit events for execution and any approval step.

**Validation (conceptual checks).**
- Every team member comes from the Stage 1 pool of the linked run — no personnel appears twice across teams of the same run.
- Each team matches the confirmed composition rules (size, roles, categories).
- Reserve personnel are accounted for: assigned, held, or listed per the confirmed rule.
- Counts reconcile: formed teams and remaining reserves match the Stage 1 pool totals.

**Traceability.** The run records actor, timestamp, source Stage 1 run, and the composition rules in force; team members reference the run; audit events mirror the execution.

**Upstream dependency.** Consumes Stage 1 output only; Stage 2 is blocked without it and must never perform its own selection.

**Downstream dependency.** Stage 3 consumes this run's teams.

**Open questions.** Team size and role list; category/representativeness constraints; reserve handling inside Stage 2; approval step after Stage 2.

## 3. Stage 3 — Polling-team mapping to polling stations

Owner: **Me** (`src/modules/randomization-stage-3/`).

**Purpose.** Map the Stage 2 polling teams to polling stations, producing the final polling-station assignments.

**Prerequisites.**
- A completed Stage 2 run exists for the same election configuration, not superseded.
- Polling stations for the election are imported/validated in master data.
- Mapping constraints (if any) are documented from the manual.

**Inputs.**
- The Stage 2 run's teams and members, referenced by run identifier.
- Polling stations (master data) for the election configuration.
- Mapping rules/constraints as stated by the manual (to be confirmed — not invented).

**Outputs.**
- A Stage 3 run record linked to the source Stage 2 run.
- Polling-station assignments: which team serves which polling station, referencing shared team and station identifiers.
- Audit events for execution and any approval step.

**Validation (conceptual checks).**
- Every team of the linked Stage 2 run is mapped exactly once (per confirmed mapping cardinality).
- Every assignment references an existing polling station of the election.
- Any stated constraints (proximity, capacity, locality) are satisfied — constraint set TBD.
- Unmatched teams/stations are detected and reported rather than silently dropped.

**Traceability.** The run records actor, timestamp, source Stage 2 run, and the mapping rules in force; assignments reference the run; audit events mirror the execution. The final deployment list can be reconstructed end to end: assignment → team → Stage 1 pool → personnel → import batch.

**Upstream dependency.** Consumes Stage 2 output only; Stage 3 must not rebuild teams or re-select personnel.

**Downstream dependency.** Reports and the training workflow read Stage 3 results read-only.

**Open questions.** Mapping cardinality (one team per station or otherwise); mapping constraints; handling of surplus/deficit teams; whether post-mapping swaps are permitted and how they are recorded.


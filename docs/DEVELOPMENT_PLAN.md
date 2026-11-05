# Development Plan

> Documentation only. This is the agreed implementation sequence with dependencies and handoff points. **No code has been written**; each phase below starts only after the previous one is signed off by the team. The project is currently in **Phase 1** (partially done — see below).

## Phase 1 — Confirm requirements and architecture

- **Goal:** all three developers share one understanding of the APSEC circular/manual requirements and the backend architecture.
- **Deliverables:** `REQUIREMENTS.md`, `ARCHITECTURE.md`, `RANDOMIZATION_WORKFLOW.md` (done as drafts; confirmation pending).
- **Dependencies:** access to the circular/manual for verbatim verification.
- **Handoff:** team review sign-off; open questions from `DECISIONS_AND_OPEN_QUESTIONS.md` triaged.
- **Exit criteria:** requirements confirmed against source documents; architecture approved.

## Phase 2 — Agree on database design and API contracts

- **Goal:** one schema plan and one set of conceptual API boundaries all stages will honour.
- **Deliverables:** reviewed `DATABASE_DESIGN.md`, reviewed `API_CONTRACTS.md`, agreed identifier conventions, agreed migration naming/ownership convention, chosen test framework (open question).
- **Dependencies:** Phase 1 sign-off.
- **Handoff:** each stage owner confirms the parts of the schema their stage reads/writes; shared-module stewards assigned.
- **Exit criteria:** no open schema question blocks Stage 1; contract for the Stage 1 → Stage 2 handoff is fixed.

## Phase 3 — Implement master data and import functionality

- **Goal:** data can enter the system and be validated.
- **Deliverables:** migrations for foundations (users/audit) and master data; personnel and import-batch handling; Excel/CSV import with validation results; seeds for reference data.
- **Dependencies:** Phase 2 schema and contracts; import templates confirmed (open question).
- **Handoff:** validated, importable personnel + master data available to Teammate 1; shared steward(s) demo to the team.
- **Exit criteria:** a sample district dataset imports cleanly and is queryable with agreed identifiers.

## Phase 4 — Implement Stage 1

- **Goal:** personnel selection producing the 120% pool incl. reserves.
- **Deliverables:** Stage 1 module (Teammate 1), its migrations, run/result records, audit integration, Stage 1 reports.
- **Dependencies:** Phase 3; eligibility rules and the 120% base/rounding confirmed.
- **Handoff:** Stage 1 output contract frozen and demonstrated to Teammate 2 with real sample runs.
- **Exit criteria:** a completed Stage 1 run is reproducible in review, traceable, and consumable by Stage 2.

## Phase 5 — Implement Stage 2

- **Goal:** polling-team formation from Stage 1 output.
- **Deliverables:** Stage 2 module (Teammate 2), its migrations, team/team-member records, audit integration, Stage 2 reports.
- **Dependencies:** Phase 4; team composition rules confirmed.
- **Handoff:** Stage 2 output contract frozen and demonstrated to Me for Stage 3.
- **Exit criteria:** teams form only from a Stage 1 run's pool; composition validation passes; full traceability.

## Phase 6 — Implement Stage 3

- **Goal:** polling teams mapped to polling stations.
- **Deliverables:** Stage 3 module (Me), its migrations, assignment records, audit integration, allocation reports.
- **Dependencies:** Phase 5; polling-station master data complete; mapping rules confirmed.
- **Handoff:** final allocation output available read-only to reports and training.
- **Exit criteria:** every team of the source run is mapped exactly once (per confirmed rules) and the deployment list reconstructs end to end.

## Phase 7 — Implement training

- **Goal:** training sessions, scheduling, attendance, and completion tracking after the three stages.
- **Deliverables:** training module (Me), session/attendance records, training reports.
- **Dependencies:** Phase 6 complete (training references the final personnel/team/station context); training requirements confirmed.
- **Handoff:** completion summaries available to reports.
- **Exit criteria:** attendance records reference existing personnel only (no duplication); completion status is reportable per election.

## Phase 8 — Integrate, test, and document

- **Goal:** end-to-end confidence and handover-ready documentation.
- **Deliverables:** automated tests (framework per Phase 2) across modules; end-to-end dry run of a full district workflow; security/authorization review; updated documentation reflecting as-built reality; deployment runbook (not deployed yet).
- **Dependencies:** Phases 4–7 complete; open questions resolved or explicitly deferred with owners.
- **Exit criteria:** the team signs off that the system matches the confirmed requirements and the audit trail covers every stage.

## Dependency and handoff summary

```
P1 requirements/architecture → P2 schema/contracts → P3 master data/imports
        → P4 Stage 1 (TM1) → P5 Stage 2 (TM2) → P6 Stage 3 (Me) → P7 training (Me)
        → P8 integrate/test/document (all)
```

Critical handoffs: **P3 → P4** (imported, validated data), **P4 → P5** (Stage 1 pool contract), **P5 → P6** (team records contract), **P6 → P7** (final allocation context). Shared-area work (config, database, middleware, audit) is continuous and co-owned from P3 onward.

# Team Responsibilities

> Documentation only. This document records who owns what, how the shared database is co-owned, how the stage interfaces work, and the rules that keep three developers from conflicting. Stage ownership is confirmed; shared-module stewardship is **proposed** and awaits team agreement.

## 1. Confirmed module ownership

| Area | Owner | Directory |
| --- | --- | --- |
| Stage 1 — personnel selection & reserve pool | **Teammate 1** | `src/modules/randomization-stage-1/` |
| Stage 2 — polling-team formation | **Teammate 2** | `src/modules/randomization-stage-2/` |
| Stage 3 — polling-team ↔ polling-station mapping | **Me** | `src/modules/randomization-stage-3/` |
| Training workflow | **Me** | `src/modules/training/` |

## 2. Shared areas (co-owned)

These directories serve everyone; changes must be coordinated:

- `src/config/`, `src/database/`, `src/middleware/`, `src/shared/`
- `src/modules/master-data/`, `src/modules/personnel/`, `src/modules/imports/`
- `src/modules/reports/`, `src/modules/audit/`
- `database/migrations/`, `database/seeds/`
- `tests/`, `docs/`, `package.json`, `README.md`

**Proposed (not yet agreed):** a single steward per shared module to review and merge changes, with the other two teammates approving via review. Candidate stewards to be assigned in the first team review — see `DECISIONS_AND_OPEN_QUESTIONS.md`.

## 3. Shared database responsibilities

- **One database, one schema.** All three stages share the agreed personnel identifiers, election configuration, team records, and conventions (`DATABASE_DESIGN.md`). Nobody creates a private parallel structure.
- **Migrations are shared infrastructure.** Each teammate writes migrations only for the objects their own module needs, in the dependency order from `DATABASE_DESIGN.md`. Proposed file convention: a numeric (or timestamp) prefix plus owner tag in the filename, e.g. a prefix band reserved for Stage 1, another for Stage 2, another for Stage 3/training, so files never collide. The exact convention is agreed before the first migration is written.
- **Schema changes are announced.** Any change that touches another module's tables (or a shared table) is proposed to all three before implementation.
- **Seeds** (reference/lookup data) are co-owned; whoever adds a seed documents it in `database/seeds/`.

## 4. Interfaces between stages

| Producer | Consumer | Interface (conceptual) |
| --- | --- | --- |
| Teammate 1 (Stage 1) | Teammate 2 (Stage 2) | Completed Stage 1 run: selected pool incl. reserve markings, scoped to an election configuration, referenced by run identifier |
| Teammate 2 (Stage 2) | Me (Stage 3) | Completed Stage 2 run: teams + members, same election configuration, referenced by run identifier |
| Me (Stage 3) | Me (training), reports | Stage 3 run: team-to-station assignments, read-only for downstream |
| All | All | Shared master data, personnel, election configuration, audit trail |

Interface rules:

- Outputs are produced as agreed records per `DATABASE_DESIGN.md`; consumers read them read-only.
- A stage never writes into another stage's result records, and never re-implements another stage's logic.
- The producing teammate notifies the others when an interface changes; consumers adapt by agreement, not by surprise.

## 5. Rules for avoiding conflicting changes

1. **Stay in your lane.** Edit only your own module directory by default. Cross-module edits require the owner's explicit approval.
2. **Coordinate shared files.** `package.json`, `src/config/`, `src/database/`, `src/middleware/`, `src/shared/`, and root docs are touched only with a heads-up to the other two.
3. **No overlapping migrations.** Use the reserved prefix bands; never edit a migration that has already been applied by someone else — add a new one.
4. **Small, reviewable commits** to `main` (or short-lived branches per module); teammates review anything touching shared areas.
5. **Freeze points.** After an interface is agreed, changes to it need all-three sign-off; the Stage 1→2 and Stage 2→3 handoffs are frozen once the downstream teammate starts integration.
6. **Documentation travels with change.** Any decision that alters these documents is recorded in `DECISIONS_AND_OPEN_QUESTIONS.md` (or the relevant doc) in the same change.
7. **No destructive actions** on the shared database; nobody runs ad-hoc schema changes outside the migration process.

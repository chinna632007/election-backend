# Architecture

> Architecture reference. Runtime database access uses MongoDB through Mongoose and the shared `src/database/` connection module. The SQL files under `database/migrations/` are retained as historical PostgreSQL artifacts and are not executed by the application.

## 1. Overview

The backend is a Node.js application that exposes an HTTP API consumed by the frontend used by the District Election Authority and authorized district staff. It stores application records in a MongoDB database shared by all modules, reads personnel and master data from Excel/CSV imports, executes the three randomization stages in order, tracks the subsequent training workflow, and produces reports backed by an audit trail.

Design goals:

- **Stage independence** — the three randomization stages live in separate modules so three developers can work in parallel.
- **One shared contract** — all stages share the same personnel identifiers, election configuration, team records, and database conventions.
- **Traceability** — every significant action is recorded through the audit module.
- **Documentation-first** — this phase defines structure only; implementation follows the sequence in `DEVELOPMENT_PLAN.md`.

## 2. Intended layering

The repository is organized in layers (all directories exist; files are empty placeholders):

| Layer | Location | Intended responsibility |
| --- | --- | --- |
| Entry point | `src/index.js`, `src/app.js` | Start the HTTP server and assemble the application (future) |
| Configuration | `src/config/` | Read environment configuration via `dotenv` (future; no values committed) |
| Database access | `src/database/` | Own the shared MongoDB connection and collection access through Mongoose |
| Middleware | `src/middleware/` | Cross-cutting concerns: authentication (JWT), authorization, request validation, error handling (future) |
| Feature modules | `src/modules/*` | One directory per business capability, listed in section 4 |
| Shared | `src/shared/` | Cross-module constants, identifier conventions, and contract definitions agreed by the team (future) |
| Historical SQL migrations | `database/migrations/` | Retained for reference only; not used by MongoDB runtime |
| Tests | `tests/` | Automated Node.js tests |

## 3. MongoDB integration

- **Single database.** Modules use the database name configured by `MONGODB_DATABASE` (or the database encoded in `MONGODB_URI`) so randomization stages, imports, stations, and training records share one store.
- **One access layer.** Database access goes through `src/database/`; modules use its MongoDB connection and collection accessor rather than opening independent connections.
- **Environment handling.** `MONGODB_URI`, optional `MONGODB_DATABASE`, and `SESSION_SECRET` are loaded from the backend `.env` file. `.env.example` contains non-secret development defaults.
- **Fresh database.** Existing PostgreSQL data is not automatically copied. The SQL migration files remain as historical references and must not be run against MongoDB.

## 4. Module boundaries

| Module | Responsibility | Owner |
| --- | --- | --- |
| `master-data` | Departments, offices, designations, classifications, polling stations, election configuration | Shared (steward TBD) |
| `personnel` | Polling personnel records and their attributes | Shared (steward TBD) |
| `imports` | Excel/CSV upload, batch records, row-level validation results | Shared (steward TBD) |
| `randomization-stage-1` | Personnel selection and reserve pool (120% including reserves) | Teammate 1 |
| `randomization-stage-2` | Polling-team formation from Stage 1 output | Teammate 2 |
| `randomization-stage-3` | Polling-team-to-polling-station mapping from Stage 2 output | Me |
| `training` | Sessions, scheduling, attendance, completion after all stages | Me |
| `reports` | Outputs for the District Election Authority | Shared (steward TBD) |
| `audit` | Immutable event trail for all modules | Shared (steward TBD) |

Boundary rules:

- A module owns data access for its own records; it does not write directly into another module's records — it consumes that module's outputs through agreed shared records.
- Cross-module interaction follows the conceptual interfaces in `API_CONTRACTS.md`.
- Stage modules must not reach into each other's internals; the handoff is via shared database records (Stage 1 results → Stage 2, Stage 2 results → Stage 3).

## 5. Dependencies between the randomization stages

```
master-data + personnel + imports
            │
            ▼
   Stage 1 (Teammate 1)  ── produces selected pool incl. reserve personnel
            │
            ▼
   Stage 2 (Teammate 2)  ── produces polling teams with members
            │
            ▼
   Stage 3 (Me)          ── produces polling-station assignments
            │
            ▼
   Training (Me)         ── references personnel + completed stage records

   reports   ── reads outputs of every stage (no stage writes into reports)
   audit     ── receives events from every module (no module owns audit data)
```

- Stage 2 is blocked until Stage 1 output exists for the same election configuration.
- Stage 3 is blocked until Stage 2 output exists for the same election configuration.
- Training references personnel and completed workflow records; it never copies or re-creates them.
- Reports and audit are downstream-only: no randomization stage depends on them.

## 6. Cross-cutting responsibilities

- **Authentication/authorization:** JWT-based sessions (`jsonwebtoken` is declared). District-scoped access and per-role permissions belong in shared middleware so every module enforces them the same way. The permission model itself is not yet decided.
- **Validation:** input validation for imports and API requests is a shared concern; row-level import validation results are stored by the imports module.
- **Audit:** every module emits audit events (actor, action, target, timestamp) to the audit module.
- **Confidentiality:** personnel data is sensitive; access must be limited to authorized district users and recorded in the audit trail.

## 7. Explicit non-goals of this phase

This document intentionally contains no source code, no SQL, no route definitions, no algorithms, and no environment values. All of that is deferred until the team approves the architecture and contracts.

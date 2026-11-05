# Polling Officer Allocation Software — Backend

Backend for the Andhra Pradesh polling personnel randomization and allocation system, based on the Andhra Pradesh State Election Commission (APSEC) circular and the APSEC randomization manual.

## Purpose

Provide a Node.js backend that allows the District Election Authority and authorized district staff to import polling personnel and master data, carry out the three prescribed randomization stages, run the training workflow that follows randomization, and produce reports with a full audit trail.

## Technology stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js |
| HTTP framework | Express (declared in `package.json`) |
| Database | MongoDB, accessed through Mongoose |
| Auth tokens | `jsonwebtoken` (declared) |
| Environment configuration | `dotenv` (declared) |
| Input files | Excel and CSV |
| Other | `googleapis` is declared in `package.json`; its intended use is not yet confirmed |

Copy `.env.example` to `.env`, set `MONGODB_URI`, `MONGODB_DATABASE`, and a unique
`SESSION_SECRET`, then run `npm install` and `npm start`. The default URI uses a
local standalone MongoDB server on `127.0.0.1:27017`. The database name can be
specified in `MONGODB_DATABASE` or in the URI path.
To inspect application data in MongoDB Compass, connect using the same
`MONGODB_URI` and open the database named by `MONGODB_DATABASE`. User accounts
are stored in `users`; imported personnel and election workflow snapshots are
stored in their respective collections. The Phase 1–3 snapshots are scoped by
election context and are saved through the authenticated backend API.
Multi-document writes use ordered operations and compensating cleanup rather
than transactions. They preserve consistency on ordinary operation failures,
but cannot provide transaction isolation or guarantee rollback if MongoDB is
unavailable during compensation. Existing PostgreSQL data is not automatically
migrated; a clean MongoDB database is used. Run
`npm run create-account` after configuring MongoDB to create the first user;
the script initializes the standard `admin`, `authority`, and `staff` roles.
Runtime database access is MongoDB-only through `src/database/`; the retained
SQL migration files are historical and are not executed. Phase 1 uploads carry
a stable request ID so a retry after a lost response returns the existing
completed batch instead of inserting duplicate personnel rows.

## Scope

- **In scope:** polling personnel, related master data, Excel/CSV import, the three randomization stages, the training workflow, reporting, authorization, and audit.
- **Out of scope for now:** the frontend repository, and any domain beyond polling personnel.
- **Users:** District Election Authority and authorized district staff.
- **Workflow:** three randomization stages followed by a separate training workflow.

## Workflow

1. Import personnel and master data from Excel/CSV with validation.
2. **Stage 1** — personnel selection producing the stated 120% pool including reserve personnel.
3. **Stage 2** — polling-team formation, consuming the Stage 1 output.
4. **Stage 3** — mapping polling teams to polling stations, consuming the Stage 2 output.
5. **Training** — a separate workflow that runs after all three stages.
6. Reports and audit cover every step.

## Team responsibilities

- **Teammate 1** — Stage 1 (`src/modules/randomization-stage-1/`).
- **Teammate 2** — Stage 2 (`src/modules/randomization-stage-2/`).
- **Me** — Stage 3 (`src/modules/randomization-stage-3/`) and training (`src/modules/training/`).
- Shared areas (`src/config/`, `src/database/`, `src/middleware/`, `src/shared/`, master data, personnel, imports, reports, audit) are co-owned. See `docs/TEAM_RESPONSIBILITIES.md`.

## Repository structure

```
backend/
├── docs/                          # All project documentation (Markdown)
├── database/
│   ├── migrations/                # Historical PostgreSQL migrations (not used by runtime)
│   └── seeds/
├── src/
│   ├── index.js                   # Server entry point; connects to MongoDB
│   ├── app.js                     # Express app assembly
│   ├── config/                    # Environment configuration
│   ├── database/                  # MongoDB connection and collection access
│   ├── middleware/                # Authentication and authorization
│   ├── modules/
│   │   ├── master-data/
│   │   ├── personnel/
│   │   ├── imports/
│   │   ├── randomization-stage-1/ # Teammate 1
│   │   ├── randomization-stage-2/ # Teammate 2
│   │   ├── randomization-stage-3/ # Me
│   │   ├── training/              # Me
│   │   ├── reports/
│   │   └── audit/
│   └── shared/                    # Future cross-module helpers/contracts
├── tests/                         # Backend tests
├── package.json
└── README.md                      # This file
```

## Documentation

All project documents live in `docs/`; this README stays at the repository root as the standard entry point.

| Document | Purpose |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Backend architecture, MongoDB integration, module boundaries, stage dependencies |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Requirements from the circular/manual, separated from proposed features and open rules |
| [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md) | Conceptual entities and relationships; no SQL or ORM code |
| [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) | Conceptual module boundaries and data handoffs; no route handlers |
| [`docs/RANDOMIZATION_WORKFLOW.md`](docs/RANDOMIZATION_WORKFLOW.md) | The three stages: prerequisites, inputs, outputs, validation, traceability |
| [`docs/TRAINING_WORKFLOW.md`](docs/TRAINING_WORKFLOW.md) | Training as a separate workflow after the stages |
| [`docs/TEAM_RESPONSIBILITIES.md`](docs/TEAM_RESPONSIBILITIES.md) | Ownership, shared responsibilities, conflict-avoidance rules |
| [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md) | Implementation sequence, dependencies, handoff points |
| [`docs/DECISIONS_AND_OPEN_QUESTIONS.md`](docs/DECISIONS_AND_OPEN_QUESTIONS.md) | Confirmed decisions vs. questions awaiting team review |

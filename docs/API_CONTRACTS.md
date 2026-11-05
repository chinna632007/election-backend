# API Contracts (Conceptual)

> Documentation only. This document describes module responsibilities, conceptual API boundaries, data handoffs, and authorization considerations. It contains **no route handlers, no endpoint code, and no request/response implementations**. Concrete routes, verbs, and payload schemas are agreed in phase 2 of `DEVELOPMENT_PLAN.md`.

## 1. Module responsibilities

| Module | Responsibility | Consumes from | Produces for |
| --- | --- | --- | --- |
| `master-data` | Maintain departments, offices, designations, classifications, polling stations, election configuration | Imports (bulk load) | All stages, reports |
| `personnel` | Maintain polling personnel records | Imports | Stage 1, training, reports |
| `imports` | Accept Excel/CSV uploads, record batches, store validation results | — (entry point) | master-data, personnel |
| `randomization-stage-1` | Run Stage 1; produce the 120% pool incl. reserves | personnel, master-data, election config | Stage 2 |
| `randomization-stage-2` | Run Stage 2; form polling teams | Stage 1 results | Stage 3 |
| `randomization-stage-3` | Run Stage 3; map teams to polling stations | Stage 2 results, polling stations | reports, training context |
| `training` | Sessions, scheduling, attendance, completion | personnel, completed stage records | reports |
| `reports` | Compile outputs for the District Election Authority | All stage outputs, master-data | — (external consumers) |
| `audit` | Record and query the event trail | Events emitted by every module | Audit views, reports |

## 2. Conceptual API boundaries

Each module will eventually expose a **resource group** through the HTTP API. Named here only as boundaries (no verbs, paths, or handlers are defined yet):

- **Authentication resource group** (shared middleware): sign-in, session identity, role/permission information.
- **Master-data resource groups:** departments, offices, designations, classifications, polling stations, election configuration.
- **Personnel resource group:** the personnel collection and single-personnel views.
- **Import resource groups:** file submission, batch listing, batch detail with validation results, download of error reports.
- **Stage 1 resource group:** start a Stage 1 run for an election, view run status, view the selected pool with reserve markings, list historical runs.
- **Stage 2 resource group:** start a Stage 2 run consuming a completed Stage 1 run, view teams and members, list historical runs.
- **Stage 3 resource group:** start a Stage 3 run consuming a completed Stage 2 run, view station assignments, list historical runs.
- **Training resource groups:** sessions, scheduling, attendance marking, completion status per personnel.
- **Reports resource group:** available reports per election and stage, plus report generation requests.
- **Audit resource group:** queryable event trail filtered by actor, action, entity, and time.

## 3. Data handoffs between modules

- **imports → master-data/personnel:** validated rows become master-data and personnel records tied to the originating import batch.
- **Stage 1 → Stage 2:** a completed Stage 1 run — the selected personnel pool with reserve markings, scoped to one election configuration, referenced by run identifier. Stage 2 reads this; it must not re-select personnel.
- **Stage 2 → Stage 3:** a completed Stage 2 run — team records with members, scoped to the same election configuration. Stage 3 maps these teams; it must not rebuild them.
- **Stage 3 → reports/training:** station assignments and team records used read-only by reports and as context for training.
- **training → reports:** session and attendance summaries.
- **every module → audit:** event submissions (actor, action, target, timestamp, outcome).

All handoffs use the shared personnel identifiers, election configuration, and team records described in `DATABASE_DESIGN.md` — the single source of truth.

## 4. Authorization considerations

- Access is limited to authenticated district users; JWT-based sessions are the intended mechanism (`jsonwebtoken` is declared).
- District scoping: a user sees and manages data only within their district context (single-district deployment is also possible — open question).
- Permission areas to be defined: manage master data; import personnel; execute Stage 1 / Stage 2 / Stage 3 (likely restricted to specific authority roles); manage training; view/generate reports; view audit; manage users.
- Stage execution must additionally verify workflow preconditions (e.g., Stage 2 refuses to run without a completed Stage 1 run for that election).
- All privileged actions must emit audit events.
- The exact role/permission matrix is unresolved; see `DECISIONS_AND_OPEN_QUESTIONS.md`.

## 5. Expected interactions (end-to-end flow, prose)

1. An authorized user uploads an Excel/CSV file; the imports module records a batch and its validation results.
2. Validated rows become master-data and personnel records.
3. An authorized user executes Stage 1 for an election configuration; the module records a run and the selected 120% pool (incl. reserves).
4. Stage 2 is executed against that Stage 1 run, producing teams and members.
5. Stage 3 is executed against that Stage 2 run, producing team-to-station assignments.
6. Training sessions are scheduled and attendance is recorded against the deployed personnel.
7. Reports are generated at any point after the relevant stage completes; audit events exist for all of the above.

## 6. Explicit non-implementation note

No routes, controllers, handlers, schemas, or payload examples are defined in this phase. These boundaries exist only to keep the three developers' modules decoupled and to seed the API-contract agreement step.

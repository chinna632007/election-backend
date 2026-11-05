# Database Design (Conceptual)

> Conceptual reference for application entities. Runtime persistence is MongoDB; historical SQL migration files are not used by the application.

## 1. Conventions

- One MongoDB database is shared by all modules (see `ARCHITECTURE.md`).
- All entities are scoped to a district context where applicable; users are district-scoped.
- Every stage references the **same** personnel identifiers, election configuration, and team records — nothing is duplicated per stage.
- Records conceptually carry creation/modification metadata (who and when) for traceability; the exact mechanism is a design decision for implementation.
- Collection relationships follow the workflow: users/audit foundations → master data → personnel/imports → randomization results → teams/assignments → training.

## 2. Proposed entities

### 2.1 Personnel
The polling personnel subject to randomization.
- Likely attributes: stable identifier, name, employee/office identifier, department and office reference, designation reference, classification/category attributes, contact and home-area details (needed if the manual imposes locality rules), active status, source import batch.
- **Uncertain:** full attribute list; which classification fields the circular requires; whether one row per person or per election deployment.

### 2.2 Departments and offices
- Department: name, code, district scope.
- Office: name, code, parent department reference, location; possibly a hierarchy (office within office).
- **Uncertain:** whether offices nest; whether offices map to constituencies.

### 2.3 Designations and personnel classifications
- Designation: title, code, and the role it plays in teams/selection.
- Classification: the category dimensions the manual uses (exact categories to be confirmed from the source documents — not invented).
- **Uncertain:** the authoritative designation list; which classifications drive eligibility or team composition.

### 2.4 Election configuration
The election/context everything is scoped to.
- Likely attributes: identifier, election name/type, district, polling date, status (planning/importing/randomizing/training/completed — statuses TBD), required personnel strength figures.
- **Uncertain:** where the "required strength" per stage-1 calculation is stored; whether constituencies are a separate entity.

### 2.5 Polling stations
- Likely attributes: identifier, name/code, constituency/area reference, locality details, capacity or elector counts if relevant.
- **Uncertain:** which attributes the manual lists; whether capacity affects Stage 3 mapping.

### 2.6 Import batches and validation results
- Batch: identifier, source file name, file type (Excel/CSV), uploaded-by user, upload timestamp, record counts (accepted/rejected/total), status.
- Validation result: batch reference, row identifier, outcome (accepted/rejected/correction-needed), reason/message, the imported values snapshot.
- **Uncertain:** whether raw rows are stored; how corrections re-enter (new batch linked to old?); retention of rejected rows.

### 2.7 Randomization runs and stage results
- Run: identifier, election configuration reference, stage number (1/2/3), executing user, timestamp, status (draft/completed/superseded — statuses TBD), references to input records used, human-readable run description.
- Stage result: run reference plus the stage-specific outcome entries (which personnel selected in Stage 1; which teams formed in Stage 2; which mappings produced in Stage 3 — modeled through the dedicated result entities below).
- **Uncertain:** re-run policy; whether results are immutable once completed (proposed: immutable); whether a seed/reference value must be stored for official verification (open question — do not assume).

### 2.8 Reserve personnel
Personnel selected in Stage 1 beyond the required strength (the remainder of the 120% pool).
- Conceptually either a flag/marking on the Stage 1 result entries or a related record with rank/order if the manual prescribes one.
- **Uncertain:** whether reserves have an order; how reserves are promoted/replaced; whether reserves belong to teams in Stage 2.

### 2.9 Polling teams and team members
- Team: identifier, election configuration reference, team number/code, originating Stage 2 run reference, status.
- Team member: team reference, personnel reference, role within the team (role list per the manual — to be confirmed), whether the member is a reserve substitute.
- **Uncertain:** team size and role composition; whether teams are numbered per constituency or per station group.

### 2.10 Polling-station assignments
The outcome of Stage 3.
- Conceptual attributes: team reference, polling station reference, originating Stage 3 run reference, assignment timestamp; possibly a designated main station plus auxiliary stations if the manual distinguishes them.
- **Uncertain:** one team per station or many-to-many; whether personnel can be reassigned after mapping; handling of unmatched teams/stations.

### 2.11 Training sessions and attendance
- Session: identifier, election configuration reference, topic/title, date (or date range), venue, resource person, notes/status.
- Attendance: session reference, personnel reference, attendance status, completion marker, marked-by user, timestamp.
- **Uncertain:** whether completion of training gates deployment; session structure (single session vs. multi-day program); whether sessions are per-constituency.

### 2.12 Users, permissions, and audit events
- User: identifier, login name, display name, district scope, role references, active status.
- Permission/role: role name and the granted capabilities (import, execute stage 1/2/3, approve, manage training, view reports, manage users).
- Audit event: timestamp, acting user reference, action description, target entity type and identifier, outcome, optional detail payload (before/after values — proposed).
- **Uncertain:** exact role list and permission matrix; audit retention period; whether audit events are append-only at the database level.

## 3. Conceptual relationships

- Department → Offices (one-to-many; possibly hierarchical).
- Designation → Personnel; classification values → Personnel.
- Import batch → Personnel (and master-data rows) as their source; import batch → validation results.
- Election configuration → Personnel deployments, Randomization runs, Polling teams, Polling-station assignments, Training sessions.
- Randomization run → stage result entries; Stage 1 run → selected personnel entries incl. reserve markings; Stage 2 run → teams and team members; Stage 3 run → polling-station assignments.
- Polling team → team members (personnel); polling-station assignment → team + polling station.
- Training session → attendance entries → personnel; attendance references completed workflow context without copying stage data.
- Audit event → acting user and target entity (polymorphic reference).

## 4. Uncertain constraints (to be agreed, not invented)

- Uniqueness: one personnel deployment per election; one team member appears once per team; at most one team per polling station (if that is the official rule).
- Completeness: every team in Stage 3 must map to a station; every Stage 2 team derives from a Stage 1 selection.
- Ordering: whether reserve personnel need a defined order.
- Deletion: whether any record may be deleted once a stage completes (proposed: no — supersede instead).

## 5. Migration dependencies

Intended build order for future migrations (none written yet):

1. Foundations: users, roles/permissions, audit events.
2. Master data: departments, offices, designations, classifications, polling stations, election configuration.
3. Personnel and import batches/validation results.
4. Randomization runs and Stage 1 results (incl. reserve marking).
5. Teams, team members (Stage 2 results).
6. Polling-station assignments (Stage 3 results).
7. Training sessions and attendance.

Steps 4–6 depend on everything before them; step 7 depends on personnel plus completed stage records. Migration file naming and ownership are governed by `TEAM_RESPONSIBILITIES.md`.

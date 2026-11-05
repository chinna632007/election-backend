# Training Workflow

> Documentation only. Training is a **separate workflow that runs after the three randomization stages are complete**. It references the appropriate personnel and completed workflow records **without duplicating them**. The items marked "needs confirmation" must be verified against the APSEC circular/manual and the team's decisions — nothing here asserts an official rule.

## 1. Position in the overall process

1. Imports and master data → 2. Stage 1 → 3. Stage 2 → 4. Stage 3 → **5. Training**.

Training depends on personnel records and the completed randomization outcome (who was selected, which team they are in, which station they are assigned to). It reads those records; it never copies or re-creates them. Owner: **Me** (`src/modules/training/`).

## 2. Proposed session records

- **Training session:** identifier, election configuration reference, topic/title, date or date range, venue, resource person/facilitator, capacity (optional), status (planned/conducted/cancelled — statuses proposed), notes.
- **Session-to-scope link:** which audience the session targets (whole district, per constituency, specific teams/stations — proposed; needs confirmation).

**Needs confirmation:** whether the manual/circular prescribes session structure (single session vs. multi-day program), mandatory topics, or fixed venues.

## 3. Scheduling (proposed)

- Sessions are created against a completed election workflow (post-Stage 3).
- Scheduling data records planned date/venue; rescheduling creates an updated session record with audit trail rather than silent edits.
- Scheduling is performed by authorized district staff; the exact role needs confirmation.

**Needs confirmation:** who schedules training; whether multiple sessions per constituency are typical; deadlines relative to the polling date.

## 4. Attendance (proposed)

- **Attendance record:** session reference, personnel reference, attendance status (present/absent — statuses proposed), marked-by user, timestamp.
- Attendance is marked per session against personnel using the shared identifiers from the randomization workflow.
- Changes to attendance are audited.

**Needs confirmation:** whether attendance is per-person or per-team; whether substitutes (reserve personnel called up) attend in place of the original person; identification method at the venue (roll list generation — proposed report).

## 5. Completion tracking (proposed)

- Per-personnel completion status derived from attendance across required sessions for the election.
- A summary view per constituency/station/team showing who has and has not completed training.
- Completion status is reported, not enforced, until the team confirms whether training gates deployment.

**Needs confirmation:** what formally counts as "completed" (attended all sessions? one session? signed register?); whether untrained personnel are replaced by reserves; who signs off completion.

## 6. Linkage rules (no duplication)

- Attendance references existing personnel records — training never re-imports or re-creates personnel.
- Training is scoped by the election configuration and can surface the personnel's Stage 3 outcome (team, station) read-only for logistical planning.
- Audit events cover session creation, rescheduling, attendance marking, and completion sign-off.

## 7. Reporting (proposed)

- Per-session attendance sheets and lists.
- Per-constituency/station completion summaries.
- Overall training status for the election.

The prescribed official report set is an open question (see `DECISIONS_AND_OPEN_QUESTIONS.md`).

## 8. Summary of requirements needing confirmation

- Session structure, mandatory topics, and duration.
- Who organizes, conducts, and signs off training.
- Attendance rules and substitute handling.
- Definition of completion and whether it gates deployment.
- Official reporting obligations for training.

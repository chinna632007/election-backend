# Requirements

> Documentation only. This document records requirements derived from the uploaded Andhra Pradesh State Election Commission (APSEC) circular and APSEC randomization manual. It clearly separates **documented requirements** (stated by the source documents or the agreed task brief) from **proposed features** (our ideas, not official rules) and **unresolved business rules** (must be confirmed with the team or the source documents). Nothing here invents an official rule; where the exact wording of the circular/manual has not been re-verified, the item is flagged.

Legend: **[D]** documented · **[P]** proposed · **[U]** unresolved

## 1. Scope and users

- **[D]** Scope is polling personnel only.
- **[D]** Users are the District Election Authority and authorized district staff.
- **[D]** Input comes from Excel/CSV files.
- **[D]** Technology: Node.js backend with MongoDB (implementation decision replacing the original PostgreSQL proposal).
- **[D]** Workflow: three randomization stages followed by a separate training workflow.
- **[U]** Which district roles exist beyond "authorized district staff," and what each may do.

## 2. Polling personnel and master data

- **[D]** The system manages polling personnel as the central subject of the workflow.
- **[D]** Relevant master data accompanies personnel: departments and offices, designations, and personnel classifications used by randomization.
- **[D]** Election configuration (the election/context the personnel are allocated for) is part of the data model.
- **[D]** Polling stations are managed as master data for Stage 3 mapping.
- **[U]** The exact attribute list for personnel (the columns required by the circular/manual).
- **[U]** The complete designation list and classification categories (e.g., reservation/category fields) — must come from the source documents, not invented.
- **[U]** Which departments/offices participate and whether hierarchical office grouping is required.

## 3. Excel/CSV import

- **[D]** Personnel and master data enter the system through Excel/CSV upload.
- **[D]** Imports must be validated before the data is usable.
- **[P]** Batch history with row-level error reports downloadable for correction and re-upload.
- **[P]** Duplicate detection across batches.
- **[U]** Exact file templates: required columns, column order, header names, encodings, and whether Excel and CSV share one template.
- **[U]** Who is allowed to import, and whether imported data needs approval before randomization.

## 4. First randomization (Stage 1)

- **[D]** Stage 1 selects polling personnel for an election.
- **[D]** The pool produced is **120% of the required personnel, including reserve personnel** — the selection is larger than the requirement and the excess constitutes reserves.
- **[D]** Stage 1 output is consumed by Stage 2; it must use shared personnel identifiers and election configuration.
- **[U]** The exact base to which 120% applies (per polling station, per constituency, per team, or per district) and rounding rules.
- **[U]** Personnel eligibility rules (who may be selected, exclusions, tenure/deployment constraints stated in the circular).
- **[U]** How reserve personnel are marked, topped up, or replaced, and whether reserves are ranked.

## 5. Second randomization (Stage 2)

- **[D]** Stage 2 forms polling teams from the Stage 1 output.
- **[D]** Stage 2 must consume Stage 1 results — no independent re-selection of personnel.
- **[U]** Team composition: number of members per team, which roles exist per team, and category/representativeness rules — must be confirmed from the manual.
- **[U]** Whether reserve personnel are assigned to teams in Stage 2 or held aside.

## 6. Third randomization (Stage 3)

- **[D]** Stage 3 maps polling teams to polling stations.
- **[D]** Stage 3 must consume Stage 2 results — it maps teams, it does not rebuild them.
- **[U]** Mapping constraints (proximity, home-area restrictions, station capacity) if any are stated by the manual.
- **[U]** Handling of unmatched teams or stations (more teams than stations or vice versa).

## 7. Training after randomization

- **[D]** Training is a separate workflow that runs **after** the three randomization stages.
- **[D]** Training references the appropriate personnel and completed workflow records without duplicating them.
- **[P]** Session records (topic, date, venue, resource person), scheduling, per-session attendance, and completion tracking.
- **[U]** Whether training is mandatory before deployment, who conducts it, its typical duration, and what "completion" formally means.

## 8. Authorized access, validation, confidentiality, traceability, reporting

- **[D]** Access is restricted to authorized district users; unauthorized use must not be possible.
- **[D]** Data entering and moving through the system must be validated.
- **[D]** Personnel data is confidential and must be protected.
- **[D]** Actions must be traceable — an audit trail over who did what and when.
- **[D]** The system must produce reports for the District Election Authority.
- **[U]** The exact permission matrix (who may import, execute each stage, approve, and view reports).
- **[U]** The prescribed report set, formats, and recipients from the circular/manual.
- **[U]** Retention/visibility rules for prior randomization runs (superseded results).

## 9. Proposed features (not official requirements)

These are our implementation proposals, pending team review; they carry no authority from the circular/manual:

- **[P]** Import preview before commit, with per-row validation feedback.
- **[P]** Re-run protection: prior randomization runs preserved and never overwritten.
- **[P]** Dashboard-style summaries of stage status per election.
- **[P]** Export of stage results and reports in Excel/PDF-friendly formats.
- **[P]** JWT-based login and role claims for authorization.

## 10. Unresolved business rules

All **[U]** items above, plus the full catalogue in `DECISIONS_AND_OPEN_QUESTIONS.md`, must be resolved against the APSEC circular and randomization manual before implementation. No official rule may be inferred or invented by the development team.

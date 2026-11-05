-- 014_stage_results: normalized Stage 2 team + Stage 3 assignment rows.
--
-- Problem: Stage 2/3 results lived ONLY inside allocation_runs.stage2/stage3
-- JSONB. Nothing queryable per team/member/station existed, so Training
-- allocation had to re-parse run JSON and could silently diverge; the
-- training router even referenced never-created tables (designation_rules,
-- stage3_assignments) and 500'd.
--
-- This migration adds the queryable tables. POST /api/randomization/run
-- writes them (same run_id as the allocation_runs row); Training allocation
-- reads them DB-first with run-JSON fallback. Re-runs wipe prior rows for
-- the run scope via ON CONFLICT / explicit delete (see store code).
-- Personnel linkage uses personnel.employee_id (HR id, the key Stage 2 rows
-- carry) plus personnel.id FK where resolvable — never invented.

CREATE TABLE IF NOT EXISTS stage2_teams (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES allocation_runs (id) ON DELETE CASCADE,
  team_code TEXT NOT NULL,
  posting_mandal TEXT,                 -- duty mandal (Stage 2 posting)
  team_size INTEGER,
  UNIQUE (run_id, team_code)
);
CREATE INDEX IF NOT EXISTS idx_stage2_teams_run ON stage2_teams (run_id);
CREATE INDEX IF NOT EXISTS idx_stage2_teams_mandal ON stage2_teams (posting_mandal);

CREATE TABLE IF NOT EXISTS stage2_team_members (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES allocation_runs (id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES stage2_teams (id) ON DELETE CASCADE,
  team_code TEXT NOT NULL,
  employee_id TEXT NOT NULL,           -- HR id from Stage-2 row
  personnel_id INTEGER REFERENCES personnel (id) ON DELETE SET NULL,
  role TEXT NOT NULL,                  -- Presiding Officer / Polling Officer N / Micro Observer
  duty TEXT,
  training_group TEXT NOT NULL DEFAULT 'APO',
  -- PO | APO | MO at persist time (MO skipped by training allocation)
  UNIQUE (run_id, team_code, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_stage2_members_run ON stage2_team_members (run_id);
CREATE INDEX IF NOT EXISTS idx_stage2_members_group ON stage2_team_members (run_id, training_group);
CREATE INDEX IF NOT EXISTS idx_stage2_members_employee ON stage2_team_members (employee_id);

CREATE TABLE IF NOT EXISTS stage3_assignments (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES allocation_runs (id) ON DELETE CASCADE,
  team_code TEXT NOT NULL,
  station_id TEXT,
  station_code TEXT,
  station_mandal TEXT,
  posting_mandal TEXT,
  publication_status TEXT NOT NULL DEFAULT 'confidential',
  UNIQUE (run_id, team_code)
);
CREATE INDEX IF NOT EXISTS idx_stage3_assign_run ON stage3_assignments (run_id);

COMMENT ON TABLE stage2_teams IS 'Queryable Stage-2 teams per allocation run (duty mandal = posting_mandal).';
COMMENT ON TABLE stage2_team_members IS 'Queryable Stage-2 team members with PO/APO/MO group pre-classified.';
COMMENT ON TABLE stage3_assignments IS 'Queryable Stage-3 team-to-station mapping per run (confidential until published).';

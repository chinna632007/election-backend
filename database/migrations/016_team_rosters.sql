-- 016_team_rosters: frozen team roster snapshot per allocation run.
--
-- Problem: stage2_teams / stage2_team_members store only codes and roles.
-- Training-order printing needs the officer's full details (name, designation,
-- department, mobile, work/native mandal) and the team's Stage-3 station
-- allotment. Today generateOrders re-joins the LIVE personnel table, so an HR
-- edit or re-import silently rewrites historical orders.
--
-- This migration adds a snapshot written by persistStageTables() inside the
-- same transaction as the run: team header + per-member detail row. Orders
-- print from this snapshot; personnel stays the live source for new runs only.

CREATE TABLE IF NOT EXISTS team_rosters (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES allocation_runs (id) ON DELETE CASCADE,
  team_code TEXT NOT NULL,
  posting_mandal TEXT,
  team_size INTEGER,
  operational_size INTEGER,
  micro_observer_personnel_id TEXT,
  station_id TEXT,
  station_code TEXT,
  station_mandal TEXT,
  publication_status TEXT NOT NULL DEFAULT 'confidential',
  UNIQUE (run_id, team_code)
);
CREATE INDEX IF NOT EXISTS idx_team_rosters_run ON team_rosters (run_id);
CREATE INDEX IF NOT EXISTS idx_team_rosters_mandal ON team_rosters (posting_mandal);

CREATE TABLE IF NOT EXISTS team_roster_members (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES allocation_runs (id) ON DELETE CASCADE,
  team_code TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  personnel_id INTEGER REFERENCES personnel (id) ON DELETE SET NULL,
  name TEXT,
  designation TEXT,
  department_name TEXT,
  mobile_no TEXT,
  work_mandal TEXT,
  native_mandal TEXT,
  role TEXT NOT NULL,
  duty TEXT,
  training_group TEXT NOT NULL DEFAULT 'APO',      -- PO | APO | MO
  is_micro_observer BOOLEAN NOT NULL DEFAULT FALSE,
  duty_mandal TEXT,                                -- Stage-3 station mandal
  venue_code TEXT,                                 -- Stage-3 station / ballot ID
  UNIQUE (run_id, team_code, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_team_roster_members_run ON team_roster_members (run_id);
CREATE INDEX IF NOT EXISTS idx_team_roster_members_group ON team_roster_members (run_id, training_group);
CREATE INDEX IF NOT EXISTS idx_team_roster_members_emp ON team_roster_members (employee_id);

COMMENT ON TABLE team_rosters IS 'Frozen Stage-2/3 team snapshot per run (codes + station allotment) for training-order printing.';
COMMENT ON TABLE team_roster_members IS 'Frozen member details per team (name/designation/mobile/mandals) so orders print from the run, not live HR.';

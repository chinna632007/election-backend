-- 009_training_batches: Micro Observers (separate role/data — team decision
-- 2026-10-15 Q2: NEW TABLE, not a personnel flag) + training-location intake
-- + code-created training batches + per-mandal requirement intake.
--
-- Data sources (Phase 1 intake hub):
--   - micro_observers: MO allotment file (emp_mo shape: id, name, designation,
--     bank, mobile, gender, mandals). Old-file columns Phase/Allotted/
--     random_no/allotted_ps are example data and are NOT imported.
--   - training_locations: locations-style file (name + mandal; extra columns
--     tolerated) and/or manual rows. Editable.
--   - training_batches + members: created BY CODE (random within each mandal,
--     <= 100 per batch), then edited manually. Location per batch; date/time
--     comes from .env (same for all batches).
--   - election_requirements: requirement file (per-mandal REQUIRED/RESERVE/
--     TOTAL) -> feeds Stage 1 required strength.
--
-- Training never affects randomization stages (team decision Q5).

CREATE TABLE IF NOT EXISTS micro_observers (
  id SERIAL PRIMARY KEY,
  import_batch_id INTEGER,                 -- optional traceability (not personnel batches)
  sl_no TEXT,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  designation TEXT,
  bank_name TEXT,
  gender TEXT,
  mobile_no TEXT,
  email TEXT,                              -- editable later (collected offline)
  native_mandal TEXT,
  residence_mandal TEXT,
  working_mandal TEXT,
  alloted_mandal TEXT,                     -- from file when present (old example may be empty)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_micro_observers_emp ON micro_observers (employee_id);

CREATE TABLE IF NOT EXISTS training_locations (
  id SERIAL PRIMARY KEY,
  location_name TEXT NOT NULL,
  panchayat TEXT,
  mandal TEXT NOT NULL,
  category TEXT,                           -- e.g. Sensitive / Hyper Sensitive (file column)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_batches (
  id SERIAL PRIMARY KEY,
  batch_no INTEGER NOT NULL,               -- per-mandal sequence (code-assigned)
  mandal TEXT NOT NULL,                    -- batches never mix mandals (Q1)
  location_id INTEGER REFERENCES training_locations (id),  -- assigned by admin
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mandal, batch_no)
);

CREATE TABLE IF NOT EXISTS training_batch_members (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES training_batches (id) ON DELETE CASCADE,
  personnel_id INTEGER NOT NULL REFERENCES personnel (id),
  added_by_code BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE after manual move/add
  UNIQUE (batch_id, personnel_id)
);
CREATE INDEX IF NOT EXISTS idx_training_batch_members_personnel
  ON training_batch_members (personnel_id);

CREATE TABLE IF NOT EXISTS election_requirements (
  id SERIAL PRIMARY KEY,
  phase TEXT,
  division_name TEXT,
  mandal TEXT NOT NULL,
  no_of_gps TEXT,
  sensitive_loc TEXT,
  hyper_sensitive_loc TEXT,
  required_count INTEGER NOT NULL,
  reserve_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_election_requirements_mandal
  ON election_requirements (mandal);
-- 005_training: training sessions + attendance for polling personnel.
--
-- PREPARED ONLY — NOT APPLIED (requires separate approval). Supported by:
-- circular p.63 — at least two training classes for Presiding Officers /
-- Assistant Presiding Officers AND for other polling personnel (incl. one
-- practical session), 50-60 minutes each, arranged at the work Mandal or a
-- nearby Mandal / divisional headquarters, conducted by experienced officials,
-- and covering reserve polling personnel as applicable.
--
-- NOT official: no completion-status values, substitute rules, or reporting
-- obligations are invented here. Attendance records presence only; pass/fail,
-- venues and schedules are authority-supplied free text.

CREATE TABLE IF NOT EXISTS training_sessions (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  district TEXT NOT NULL,
  title TEXT NOT NULL,
  session_type TEXT NOT NULL,        -- 'theory' | 'practical'
  mandal TEXT,                       -- work Mandal or nearby/divisional venue
  venue TEXT,
  scheduled_at TIMESTAMPTZ,
  duration_minutes INTEGER,          -- official guidance: 50-60
  conducted_by TEXT,

  created_by_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'planned'  -- 'planned' | 'held' | 'cancelled'
);

CREATE TABLE IF NOT EXISTS training_attendance (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  session_id INTEGER NOT NULL REFERENCES training_sessions (id) ON DELETE RESTRICT,
  personnel_id TEXT NOT NULL,        -- joins imported personnel by employee id
  is_reserve BOOLEAN NOT NULL DEFAULT FALSE,
  present BOOLEAN NOT NULL DEFAULT FALSE,
  role TEXT                          -- role at training time (PO/APO/OPO/Observer)
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_district
ON training_sessions (district);
CREATE INDEX IF NOT EXISTS idx_training_attendance_session
ON training_attendance (session_id);
CREATE INDEX IF NOT EXISTS idx_training_attendance_personnel
ON training_attendance (personnel_id);

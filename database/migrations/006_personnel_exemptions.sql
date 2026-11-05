-- 006_personnel_exemptions: exemption review workflow for circular
-- p.61(a)(vii) bank postings and p.61(a)(viii) personal exemptions.
--
--   personnel_exemptions: append-only audit trail of every exemption
--   authorization (personnel PATCH endpoint). Rows are never updated or
--   deleted. Stores who marked it (requested_by_user_id from the session)
--   and the authority note. Read endpoints never expose note/medical status.
--
-- APPLIED: 2026-10-14 (was prepared-only; applied with team approval).

CREATE TABLE IF NOT EXISTS personnel_exemptions (
  id SERIAL PRIMARY KEY,
  personnel_id INTEGER NOT NULL REFERENCES personnel (id),
  employee_id TEXT NOT NULL,
  old_exempt_category TEXT,
  new_exempt_category TEXT,
  reason TEXT NOT NULL,              -- e.g. 'authority_mark'
  requested_by_user_id INTEGER REFERENCES users (id),
  note TEXT,                         -- authority note (audit only, never in reads)
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personnel_exemptions_personnel
  ON personnel_exemptions (personnel_id);
CREATE INDEX IF NOT EXISTS idx_personnel_exemptions_employee
  ON personnel_exemptions (employee_id);

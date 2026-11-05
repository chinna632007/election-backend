-- 006_training_po_apo_tables: separate PO and APO tables mirroring the
-- personnel table (all ~30 proforma + contract columns, INCLUDING sensitive
-- aadhar_number / voter_id / mobile_no).
--
-- GOVERNMENT-ONLY, by explicit authority decision: these tables keep the full
-- personnel row so PO/APO rosters can be checked end-to-end. Do NOT expose
-- them on any read-only/staff endpoint; keep them behind authority/admin.
--
-- Training allocation reads PO/APO slots from Stage 2 output and groups them
-- by each officer's WORK mandal (not duty mandal). MO and OPOs are excluded.
-- This migration is additive and safe to re-run (IF NOT EXISTS / DEFAULT).

CREATE TABLE IF NOT EXISTS po_officers (
  id SERIAL PRIMARY KEY,
  -- Run context (which randomization run assigned this PO):
  run_id TEXT,
  team_code TEXT,
  posting_mandal TEXT,
  -- Contract fields (mirrors personnel):
  district TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  exempt_category TEXT,
  -- Proforma columns A-AI (mirrors personnel, sensitive INCLUDED per above):
  sl_no TEXT,
  employee_id TEXT,
  employee_name TEXT,
  designation TEXT,
  gender TEXT,
  age TEXT,
  aadhar_number TEXT,            -- GOVERNMENT-ONLY
  languages_known TEXT,
  employment_sector TEXT,
  scale_of_pay TEXT,
  basic_pay TEXT,
  gazetted_status TEXT,
  date_of_birth DATE,
  date_of_retirement DATE,
  employment_type TEXT,
  enrolled_assembly_constituency TEXT,
  part_no_vote_sl_no TEXT,
  voter_id TEXT,                 -- GOVERNMENT-ONLY
  residence_address TEXT,
  residence_constituency_code TEXT,
  residence_constituency_name TEXT,
  work_mandal TEXT NOT NULL,
  working_constituency_code TEXT,
  working_constituency_name TEXT,
  native_mandal TEXT NOT NULL,
  native_constituency_code TEXT,
  native_constituency_name TEXT,
  previous_po_duty TEXT,
  mobile_no TEXT,                -- GOVERNMENT-ONLY
  service_in_district_4y TEXT,
  ph_category TEXT,
  criminal_case_or_eci_orders TEXT,
  exceeded_3_years TEXT,
  eci_ceo_order_details TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_officers_mandal ON po_officers (work_mandal);
CREATE INDEX IF NOT EXISTS idx_po_officers_employee ON po_officers (employee_id);

CREATE TABLE IF NOT EXISTS apo_officers (
  id SERIAL PRIMARY KEY,
  -- Run context (which randomization run assigned this APO):
  run_id TEXT,
  team_code TEXT,
  posting_mandal TEXT,
  -- Contract fields (mirrors personnel):
  district TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  exempt_category TEXT,
  -- Proforma columns A-AI (mirrors personnel, sensitive INCLUDED per above):
  sl_no TEXT,
  employee_id TEXT,
  employee_name TEXT,
  designation TEXT,
  gender TEXT,
  age TEXT,
  aadhar_number TEXT,            -- GOVERNMENT-ONLY
  languages_known TEXT,
  employment_sector TEXT,
  scale_of_pay TEXT,
  basic_pay TEXT,
  gazetted_status TEXT,
  date_of_birth DATE,
  date_of_retirement DATE,
  employment_type TEXT,
  enrolled_assembly_constituency TEXT,
  part_no_vote_sl_no TEXT,
  voter_id TEXT,                 -- GOVERNMENT-ONLY
  residence_address TEXT,
  residence_constituency_code TEXT,
  residence_constituency_name TEXT,
  work_mandal TEXT NOT NULL,
  working_constituency_code TEXT,
  working_constituency_name TEXT,
  native_mandal TEXT NOT NULL,
  native_constituency_code TEXT,
  native_constituency_name TEXT,
  previous_po_duty TEXT,
  mobile_no TEXT,                -- GOVERNMENT-ONLY
  service_in_district_4y TEXT,
  ph_category TEXT,
  criminal_case_or_eci_orders TEXT,
  exceeded_3_years TEXT,
  eci_ceo_order_details TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_apo_officers_mandal ON apo_officers (work_mandal);
CREATE INDEX IF NOT EXISTS idx_apo_officers_employee ON apo_officers (employee_id);
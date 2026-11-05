-- 002_personnel_import: personnel imported from the Employees Data Proforma
-- (docs/Employees data_proforma.xlsx) and the import-batch traceability record.
--
-- Design notes:
--   * Column names map 1:1 to the proforma's actual header row (row 5,
--     columns A-AI). No invented fields, no derived fields.
--   * Stage 1 contract fields not present on the proforma (district,
--     is_active, exempt_category) are added per docs/DATABASE_DESIGN.md.
--   * employee_id has NO unique constraint yet — whether the Employee ID No.
--     is unique district-wide is an open question (DECISIONS_AND_OPEN_QUESTIONS
--     B4/B1); the import step applies the agreed dedupe rule instead.

CREATE TABLE import_batches (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  imported_by INTEGER REFERENCES users (id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Per-sheet header fields (proforma rows 1-4), not per-employee:
  department_name TEXT,
  gad_department_code TEXT,
  ddo_code TEXT,
  total_rows INTEGER,
  accepted_rows INTEGER,
  rejected_rows INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress'
);

CREATE TABLE personnel (
  id SERIAL PRIMARY KEY,
  -- Which import brought this row in (traceability):
  import_batch_id INTEGER NOT NULL REFERENCES import_batches (id),
  import_status TEXT NOT NULL DEFAULT 'accepted',
  validation_errors JSONB,

  -- Scope / Stage 1 contract fields (not on the proforma):
  district TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  exempt_category TEXT,

  -- Proforma columns A-AI:
  sl_no TEXT,
  employee_id TEXT,
  employee_name TEXT,
  designation TEXT,
  gender TEXT,
  age TEXT,
  aadhar_number TEXT,
  languages_known TEXT,
  employment_sector TEXT,          -- Central / State / PSU / Private / Others
  scale_of_pay TEXT,
  basic_pay TEXT,
  gazetted_status TEXT,            -- Gazetted / Non-Gazetted
  date_of_birth DATE,              -- proforma dd.mm.yyyy
  date_of_retirement DATE,         -- proforma dd.mm.yyyy
  employment_type TEXT,            -- Regular / Out-sourcing / Contract basis
  enrolled_assembly_constituency TEXT,
  part_no_vote_sl_no TEXT,
  voter_id TEXT,
  residence_address TEXT,
  residence_constituency_code TEXT,
  residence_constituency_name TEXT,
  work_mandal TEXT,
  working_constituency_code TEXT,
  working_constituency_name TEXT,
  native_mandal TEXT,
  native_constituency_code TEXT,
  native_constituency_name TEXT,
  previous_po_duty TEXT,           -- Previous Worked as PO / APO / OPO
  mobile_no TEXT,
  service_in_district_4y TEXT,     -- Total service in present district, last 4 years
  ph_category TEXT,
  criminal_case_or_eci_orders TEXT,
  exceeded_3_years TEXT,           -- Yes / No
  eci_ceo_order_details TEXT,
  remarks TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stage 1 reads eligible candidates scoped by district.
CREATE INDEX idx_personnel_district ON personnel (district);

-- 021_field_registry: admin-defined data schema (docs/CUSTOMIZATION_ROADMAP.md §8).
--
-- Admins define FIELDS, never TABLES:
--   input   -> import_column matching drives Excel intake header mapping
--   storage -> core fields stay typed columns; custom fields live in
--              personnel.custom_fields / polling_stations.custom_fields (JSONB)
--   output  -> export_visible + sort_order drive exports/reports column sets
--
-- Core rows (is_core = true) are LOCKED: randomization fairness depends on
-- them. Only label / export_visible / sort_order may change. Never deleted,
-- never retyped. Custom rows (is_core = false) are created via the API.

CREATE TABLE IF NOT EXISTS field_definitions (
  id SERIAL PRIMARY KEY,
  entity TEXT NOT NULL CHECK (entity IN ('personnel', 'station')),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('string', 'number', 'date', 'boolean', 'enum')),
  is_core BOOLEAN NOT NULL DEFAULT false,
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  import_column TEXT,
  export_visible BOOLEAN NOT NULL DEFAULT true,
  enum_options JSONB,
  validation JSONB NOT NULL DEFAULT '{}',
  default_value JSONB,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity, field_key)
);
CREATE INDEX IF NOT EXISTS idx_field_definitions_entity
  ON field_definitions (entity, active, sort_order);

-- Custom-field storage on the two intake entities (JSONB, GIN-indexed).
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS custom_fields JSONB;
ALTER TABLE polling_stations ADD COLUMN IF NOT EXISTS custom_fields JSONB;
CREATE INDEX IF NOT EXISTS idx_personnel_custom_fields
  ON personnel USING GIN (custom_fields);
CREATE INDEX IF NOT EXISTS idx_polling_stations_custom_fields
  ON polling_stations USING GIN (custom_fields);

-- Seed CORE rows (locked). import_column = the proforma / Booths header text.
INSERT INTO field_definitions (entity, field_key, label, data_type, is_core, is_required, import_column, export_visible, sort_order) VALUES
  ('personnel', 'employee_id',        'Employee ID',      'string', true, true,  'Employee ID',        true, 10),
  ('personnel', 'employee_name',      'Employee Name',    'string', true, true,  'Employee Name',      true, 20),
  ('personnel', 'designation',        'Designation',      'string', true, true,  'Designation',        true, 30),
  ('personnel', 'gender',             'Gender',           'string', true, false, 'Gender',             true, 40),
  ('personnel', 'district',           'District',         'string', true, true,  'District',           true, 50),
  ('personnel', 'work_mandal',        'Work Mandal',      'string', true, true,  'Work Mandal',        true, 60),
  ('personnel', 'native_mandal',      'Native Mandal',    'string', true, true,  'Native Mandal',      true, 70),
  ('personnel', 'gazetted_status',    'Gazetted Status',  'string', true, true,  'Gazetted Status',    true, 80),
  ('personnel', 'employment_type',    'Employment Type',  'string', true, false, 'Employment Type',    true, 90),
  ('personnel', 'is_active',          'Active',           'boolean',true, false, NULL,                 true, 100),
  ('station',  'station_id',          'Booth ID',         'string', true, true,  'Booth ID',           true, 10),
  ('station',  'station_number',      'Booth Number',     'string', true, true,  'Booth Number',       true, 20),
  ('station',  'station_name',        'Booth Name',       'string', true, true,  'Booth Name',         true, 30),
  ('station',  'district',            'District',         'string', true, true,  'District',           true, 40),
  ('station',  'mandal',              'Mandal',           'string', true, true,  'Mandal',             true, 50),
  ('station',  'building_name',       'Building Name',    'string', true, false, 'Building Name',      true, 60),
  ('station',  'locality',            'Village/Locality', 'string', true, false, 'Village/Locality',  true, 70),
  ('station',  'pin_code',            'PIN Code',         'string', true, false, 'PIN Code',          true, 80),
  ('station',  'required_officers',   'Required Officers','number', true, false, 'Required Officers', true, 90)
ON CONFLICT (entity, field_key) DO NOTHING;

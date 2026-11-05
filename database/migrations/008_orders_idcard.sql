-- 008_orders_idcard: orders + ID-card foundation (approved 2026-10-15).
--
-- 1) personnel.email — Q2 decision: emails collected later; the import maps an
--    email column when the sheet carries one, and the new personnel edit
--    endpoint can fill it manually.
-- 2) order_templates — the 5 official .docx order templates, uploaded and
--    replaceable from the frontend (kinds fixed in code allow-list).
-- 3) order_config — single row; authority-supplied order metadata (election
--    title, district, dates, distribution center, polling datetime, training
--    venue/time, warning text). Nothing invented by the server.
-- 4) id_card_design — single active JSONB design (port of the reference
--    project's IdCardDesign model; edited by the frontend designer).
-- 5) order_assignments — manual appointments (Stage Officer II / Counting
--    staff are NOT produced by randomization; admin picks personnel).
-- 6) generated_documents — metadata for generated files (files on disk).

ALTER TABLE personnel ADD COLUMN IF NOT EXISTS email TEXT;

CREATE TABLE IF NOT EXISTS order_templates (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL UNIQUE,          -- allow-listed in code (5 kinds)
  display_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file BYTEA NOT NULL,                -- the actual .docx (tens of KB)
  active BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by INTEGER REFERENCES users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  election_title TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  order_date TEXT NOT NULL DEFAULT '',            -- dd.mm.yyyy as in orders
  order_place TEXT NOT NULL DEFAULT '',
  distribution_center TEXT NOT NULL DEFAULT '',
  distribution_report_time TEXT NOT NULL DEFAULT '',
  polling_date_time TEXT NOT NULL DEFAULT '',
  training_venue TEXT NOT NULL DEFAULT '',
  training_date_time TEXT NOT NULL DEFAULT '',
  warning_text TEXT NOT NULL DEFAULT '',
  extra_note TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO order_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS id_card_design (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  design JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by INTEGER REFERENCES users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO id_card_design (id, design) VALUES (1, '{}'::jsonb) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS order_assignments (
  id SERIAL PRIMARY KEY,
  order_kind TEXT NOT NULL,           -- 'stage_officer_ii' | 'counting_team'
  personnel_id INTEGER NOT NULL REFERENCES personnel (id),
  role TEXT NOT NULL,                 -- 'Stage Officer II' | 'CS'/'CAS'/'CA-1'...
  team_no TEXT,                       -- counting team no (null for stage officer)
  table_no TEXT,                      -- counting table no
  body_name TEXT,                     -- municipality / GP name for counting header
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generated_documents (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'order_docx' | 'order_pdf' | 'idcard_pdf'
  template_kind TEXT,                 -- order template kind when applicable
  scope_type TEXT NOT NULL,           -- 'personnel' | 'team' | 'assignment'
  scope_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,            -- relative path under uploads/generated
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
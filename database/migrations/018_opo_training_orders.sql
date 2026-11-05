-- 018_opo_training_orders: OPO (Other Presiding Officer) training tables.
-- Rework: each 6-officer team is now PO(1) + APO(1, the 4th Polling Officer
-- slot) + OPO(4: 1st/2nd/3rd/5th Polling Officers) + MO(excluded). OPOs get
-- their own batch/order tables mirroring po_/apo_ so the three groups stay
-- independently printable. Same Stage-3 columns (duty_mandal, venue_code)
-- as migration 015.

CREATE TABLE IF NOT EXISTS opo_training_batches (
  id SERIAL PRIMARY KEY,
  batch_no INTEGER NOT NULL,
  mandal TEXT NOT NULL,
  location_id INTEGER REFERENCES training_locations (id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mandal, batch_no)
);

CREATE TABLE IF NOT EXISTS opo_training_batch_members (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES opo_training_batches (id) ON DELETE CASCADE,
  personnel_id INTEGER NOT NULL REFERENCES personnel (id),
  employee_id TEXT,
  role TEXT,
  team_code TEXT,
  added_by_code BOOLEAN NOT NULL DEFAULT TRUE,
  duty_mandal TEXT,
  venue_code TEXT,
  UNIQUE (batch_id, personnel_id)
);
CREATE INDEX IF NOT EXISTS idx_opo_tbm_personnel ON opo_training_batch_members (personnel_id);

CREATE TABLE IF NOT EXISTS opo_training_orders (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  sl_no INTEGER NOT NULL,
  batch_id INTEGER REFERENCES opo_training_batches (id) ON DELETE SET NULL,
  personnel_id INTEGER NOT NULL REFERENCES personnel (id),
  employee_id TEXT,
  employee_name TEXT,
  mandal TEXT,
  venue TEXT,
  venue_code TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  order_docx BYTEA NOT NULL,
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opo_orders_created ON opo_training_orders (created_at DESC);

COMMENT ON TABLE opo_training_batches IS 'OPO training batches by duty mandal (other Presiding Officers: 1st/2nd/3rd/5th).';
COMMENT ON TABLE opo_training_orders IS 'Generated OPO appointment/training order DOCX (one row per officer).';

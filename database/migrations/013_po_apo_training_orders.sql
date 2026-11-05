-- 013_po_apo_training_orders: separate PO / APO training batch + order tables.
--
-- Agreed (TRAINING-ORDERS-ANALYSIS.md): PO and APO live in parallel tables so
-- they are easy to fetch/check independently. Shared venues stay in
-- training_locations. Re-allocate WIPE-clears these six tables then refills
-- from the last allocation_run Stage-2 excelRows (duty/posting mandal;
-- Micro Observers excluded).

-- ---- PO ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS po_training_batches (
  id SERIAL PRIMARY KEY,
  batch_no INTEGER NOT NULL,
  mandal TEXT NOT NULL,                    -- duty / posting mandal
  location_id INTEGER REFERENCES training_locations (id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mandal, batch_no)
);

CREATE TABLE IF NOT EXISTS po_training_batch_members (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES po_training_batches (id) ON DELETE CASCADE,
  personnel_id INTEGER NOT NULL REFERENCES personnel (id),
  employee_id TEXT,                        -- HR id from Stage-2 row (trace)
  role TEXT,                               -- e.g. Presiding Officer
  team_code TEXT,
  added_by_code BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (batch_id, personnel_id)
);
CREATE INDEX IF NOT EXISTS idx_po_tbm_personnel ON po_training_batch_members (personnel_id);

CREATE TABLE IF NOT EXISTS po_training_orders (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,                  -- public id TR-PO-…
  sl_no INTEGER NOT NULL,                  -- auto serial within a generate run
  batch_id INTEGER REFERENCES po_training_batches (id) ON DELETE SET NULL,
  personnel_id INTEGER NOT NULL REFERENCES personnel (id),
  employee_id TEXT,
  employee_name TEXT,
  mandal TEXT,                             -- duty mandal
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  order_docx BYTEA NOT NULL,
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_orders_created ON po_training_orders (created_at DESC);

-- ---- APO -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS apo_training_batches (
  id SERIAL PRIMARY KEY,
  batch_no INTEGER NOT NULL,
  mandal TEXT NOT NULL,
  location_id INTEGER REFERENCES training_locations (id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mandal, batch_no)
);

CREATE TABLE IF NOT EXISTS apo_training_batch_members (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES apo_training_batches (id) ON DELETE CASCADE,
  personnel_id INTEGER NOT NULL REFERENCES personnel (id),
  employee_id TEXT,
  role TEXT,
  team_code TEXT,
  added_by_code BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (batch_id, personnel_id)
);
CREATE INDEX IF NOT EXISTS idx_apo_tbm_personnel ON apo_training_batch_members (personnel_id);

CREATE TABLE IF NOT EXISTS apo_training_orders (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  sl_no INTEGER NOT NULL,
  batch_id INTEGER REFERENCES apo_training_batches (id) ON DELETE SET NULL,
  personnel_id INTEGER NOT NULL REFERENCES personnel (id),
  employee_id TEXT,
  employee_name TEXT,
  mandal TEXT,
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  order_docx BYTEA NOT NULL,
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apo_orders_created ON apo_training_orders (created_at DESC);

COMMENT ON TABLE po_training_batches IS 'PO training batches by duty mandal (post Stage-3 allocate).';
COMMENT ON TABLE apo_training_batches IS 'APO training batches by duty mandal (all non-PO/non-MO teammates).';
COMMENT ON TABLE po_training_orders IS 'Generated PO appointment/training order DOCX (one row per officer).';
COMMENT ON TABLE apo_training_orders IS 'Generated APO appointment/training order DOCX (one row per officer).';

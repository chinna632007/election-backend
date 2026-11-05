-- 011_training_orders: store generated PO/APO training order documents.
--
-- One row per generated order. The DOCX is generated server-side by merging
-- a {{tag}} template (uploaded per print) via the order-merge engine
-- (docxtemplater + pizzip) and stored in order_docx.
-- A PDF fallback can be stored in order_pdf (extension point).
--
-- Columns: order_id (client/public id), training_group (PO|APO), batch_id
-- (training_batches id), mandal, venue, date_time, scheduled_at, and the
-- filled document bytes.

CREATE TABLE IF NOT EXISTS training_orders (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,                  -- public order id (TR-XXXX-XXXX)
  training_group TEXT NOT NULL,            -- 'PO' or 'APO'
  batch_id INTEGER REFERENCES training_batches (id) ON DELETE SET NULL,
  mandal TEXT,
  venue TEXT,
  date_time TEXT,                          -- training schedule date/time
  scheduled_at TEXT,                       -- when the order was printed
  designated_officers INTEGER,             -- number of officers on the order
  total_officers INTEGER,                  -- total officers in the batch
  status TEXT NOT NULL DEFAULT 'generated', -- 'generated' | 'delivered' | 'cancelled'
  order_pdf BYTEA,                         -- optional pdfkit fallback
  order_docx BYTEA NOT NULL,               -- the filled DOCX (primary deliverable)
  created_by INTEGER REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_orders_group ON training_orders (training_group, created_at);
CREATE INDEX IF NOT EXISTS idx_training_orders_batch ON training_orders (batch_id);

-- Record for audit: who generated the order.
COMMENT ON TABLE training_orders IS 'Generated PO/APO training order documents (DOCX).';

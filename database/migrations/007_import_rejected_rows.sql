-- 007_import_rejected_rows: store rejected rows with import_status + reasons.
--
-- Team decision 2026-10-14: rejected rows must ALSO be stored (not dropped),
-- each carrying import_status ('accepted' | 'rejected') and the validation
-- reasons, so the frontend can show stored data from the DB instead of a
-- local-file fallback. personnel.import_status already exists
-- ('accepted' default); this migration only ADDS the rejected-rows table.
--
-- personnel rows keep import_status='accepted'; rejected rows land here with
-- the raw sheet values + reasons JSONB. Stage 1 / orchestrator read ONLY the
-- personnel table, so rejected rows can never leak into the pool.

CREATE TABLE IF NOT EXISTS import_rejected_rows (
  id SERIAL PRIMARY KEY,
  import_batch_id INTEGER NOT NULL REFERENCES import_batches (id),
  sheet_row INTEGER,                 -- 1-based row number in the workbook
  employee_id TEXT,                  -- may be null (id-missing rejections)
  reasons JSONB NOT NULL DEFAULT '[]',  -- validation reason codes
  raw_values JSONB,                  -- raw sheet values for correction view
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_rejected_rows_batch
  ON import_rejected_rows (import_batch_id);
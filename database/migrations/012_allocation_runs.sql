-- 012_allocation_runs: durable record of full randomization runs.
--
-- The orchestrator currently keeps ONLY the most recent run in process memory
-- (allocation-store.js), so every backend restart wipes Stage 1/2/3 results:
-- the reports page says "no run yet", downstream training allocation refuses
-- with 409, and published Stage 3 mappings vanish. This table fixes that.
--
-- One row per POST /api/randomization/run (full stage1/stage2/stage3 result
-- JSON) + the publish record (who confirmed disclosure, when). Only the
-- latest completed run is "current" (ORDER BY id DESC LIMIT 1); history is
-- kept for audit. Personnel rows are never stored — the run JSON carries the
-- same non-sensitive shapes the API already returns (names + roles only).

CREATE TABLE IF NOT EXISTS allocation_runs (
  id SERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_by_id INTEGER REFERENCES users (id),
  run_by_username TEXT,
  run_by_role TEXT,
  stage1 JSONB NOT NULL,
  stage2 JSONB NOT NULL,
  stage3 JSONB NOT NULL,
  audit_events JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_allocation_runs_created
  ON allocation_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS allocation_publications (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES allocation_runs (id) ON DELETE CASCADE,
  published_stage3 JSONB NOT NULL,
  confirmed_by_id INTEGER REFERENCES users (id),
  confirmed_by_username TEXT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_allocation_publications_run
  ON allocation_publications (run_id);

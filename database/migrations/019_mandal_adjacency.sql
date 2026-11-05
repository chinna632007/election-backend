-- 019_mandal_adjacency: near-mandal table for the two new posting rules.
--
-- Row semantics: (mandal_name, near_mandal_names) — an officer whose work or
-- native mandal is M may receive duty ONLY in one of M's near mandals.
--   - mandal_name       TEXT NOT NULL UNIQUE  (canonical mandal)
--   - near_mandal_names TEXT[] NOT NULL       (adjacent mandals; may be empty)
--
-- Upload REPLACES the table (same intake semantics as training_locations).
-- Stage 2 uses it to pick party posting mandals; Stage 3 uses it to pick
-- stations. Mandals missing from this table are fail-closed (no near set =
-- no eligible posting), reported via unmetRequirements, never guessed.

CREATE TABLE IF NOT EXISTS mandal_adjacency (
  id SERIAL PRIMARY KEY,
  mandal_name TEXT NOT NULL,
  near_mandal_names TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mandal_name)
);
CREATE INDEX IF NOT EXISTS idx_mandal_adjacency_name ON mandal_adjacency (mandal_name);

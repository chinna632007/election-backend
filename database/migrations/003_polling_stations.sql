-- 003_polling_stations: polling-station master data imported from the supplied
-- Booths workbooks (e.g. Peddapuram_Booths.xlsx, Jami_Booths.xlsx, worksheet
-- "Booths") and the traceability record that links each station to its import.
--
-- Design notes:
--   * Columns map 1:1 to the source "Booths" header row (11 columns): Booth ID,
--     Booth Number, Booth Name, Building Name, Street, Village/Locality, Ward,
--     Mandal, District, PIN Code, Required Officers. Source values preserved
--     verbatim; no derived fields.
--   * A surrogate integer id is the primary key; the source Booth ID is stored
--     as TEXT in station_id for traceability and is NOT the primary key.
--   * District is TEXT with NO foreign key (multi-district, no district master
--     yet) — mirrors the personnel.district convention.
--   * "Booth" is a provisional equivalent of "Polling Station" (DECISIONS
--     B-series); source terminology is preserved in comments.
--   * NO unique constraint/index on station_id or (district, station_id): the
--     uniqueness scope of Booth IDs is unverified, so asserting it could reject
--     legitimate re-imports. Only NON-UNIQUE lookup indexes are added; within-
--     file duplicate handling is applied by the import step, not the schema.
--   * required_officers is source data only. NOT a Stage 2 team size or a
--     Stage 3 validation rule.

-- Import-batch discriminator: separates personnel imports from polling-station
-- imports on the shared import_batches table. Additive + defaulted so existing
-- personnel inserts (which never name this column) keep working as 'personnel'.
ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'personnel';

CREATE TABLE polling_stations (
  id SERIAL PRIMARY KEY,

  -- Which import brought this station in (traceability):
  import_batch_id INTEGER NOT NULL REFERENCES import_batches (id) ON DELETE RESTRICT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Source columns (worksheet "Booths"):
  district TEXT NOT NULL,                -- preserved source text, no district FK
  station_id TEXT NOT NULL,              -- source "Booth ID", preserved as TEXT
  station_number TEXT NOT NULL,          -- source "Booth Number"
  station_name TEXT NOT NULL,            -- source "Booth Name"
  building_name TEXT,                    -- source "Building Name"
  street TEXT,                           -- source "Street"
  locality TEXT,                         -- source "Village/Locality"
  ward TEXT,                             -- source "Ward"
  mandal TEXT NOT NULL,                  -- source "Mandal"
  pin_code TEXT,                         -- source "PIN Code", kept as TEXT
  required_officers INTEGER              -- source "Required Officers"; source data only
);

-- Lookup only (NON-UNIQUE). See design notes for why uniqueness is deferred.
CREATE INDEX idx_polling_stations_batch ON polling_stations (import_batch_id);
CREATE INDEX idx_polling_stations_district_station ON polling_stations (district, station_id);
CREATE INDEX idx_polling_stations_district_mandal ON polling_stations (district, mandal);

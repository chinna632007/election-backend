-- 009b_order_templates_idcard_design: template manager tables for the
-- Phase-1 template manager page (display order templates + ID-card design).
--
-- order_templates: one row per uploaded .docx (kind: polling_team |
-- stage_officer_ii | counting_team | po_apo_training | po_apo_training_gp |
-- id_card) with the raw document bytes + metadata.
--
-- id_card_design: draft of the ID-card template edited in the frontend
-- designer (legacy design blob for backwards compatibility; one row "active").

CREATE TABLE IF NOT EXISTS order_templates (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                     -- polling_team, stage_officer_ii,
                                          -- counting_team, po_apo_training,
                                          -- po_apo_training_gp, id_card
  display_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file BYTEA NOT NULL,                    -- the .docx as uploaded
  active BOOLEAN NOT NULL DEFAULT FALSE,  -- only ONE id_card template active;
                                          -- order templates: admin picks
  uploaded_by INTEGER REFERENCES users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_templates_kind
  ON order_templates (kind, active);

-- Allow ONLY one active template per kind (updated_at bumps on replace).
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_templates_kind_active
  ON order_templates (kind) WHERE active;

CREATE TABLE IF NOT EXISTS id_card_design (
  id SERIAL PRIMARY KEY CHECK (id = 1),
  design JSONB NOT NULL DEFAULT '{}'::jsonb,   -- full designer payload
  updated_by INTEGER REFERENCES users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO id_card_design (id, design) VALUES (1, '{}'::jsonb)
  ON CONFLICT DO NOTHING;
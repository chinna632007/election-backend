-- 020_app_settings: key/value customization store (see docs/CUSTOMIZATION_ROADMAP.md).
--
-- Every admin-editable knob is ONE row here, declared in
-- src/modules/settings/settings.registry.js. New customizable things add a
-- registry entry + a seeded default row — never a new table, never code.
--
-- Row semantics:
--   key         TEXT PRIMARY KEY  (dotted path, e.g. 'uploads.max_file_mb')
--   value       JSONB NOT NULL    (scalar or object; typed per registry)
--   value_type  TEXT NOT NULL     ('string'|'number'|'boolean'|'string_array')
--   group_name  TEXT NOT NULL     (admin UI grouping: notifications|documents|
--                                 election|uploads|training|portal)
--   label       TEXT NOT NULL     (admin UI display label)
--   is_public   BOOLEAN           (staff may read; secrets content never public)
--   updated_by  INTEGER           (users.id of last editor; null = seed)
--   updated_at  TIMESTAMPTZ
--
-- settings_audit: append-only who/when/old/new trail for every write.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('string', 'number', 'boolean', 'string_array')),
  group_name TEXT NOT NULL,
  label TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings_audit (
  id SERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB NOT NULL,
  changed_by INTEGER,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settings_audit_key ON settings_audit (setting_key);
CREATE INDEX IF NOT EXISTS idx_settings_audit_time ON settings_audit (changed_at DESC);

-- Seeded defaults == current hardcoded behavior (deploy changes NOTHING).
INSERT INTO app_settings (key, value, value_type, group_name, label, is_public) VALUES
  ('uploads.max_file_mb', '100', 'number', 'uploads', 'Max upload file size (MB)', true),
  ('uploads.max_ballot_mb', '15', 'number', 'uploads', 'Max ballot register size (MB)', true),
  ('uploads.max_stations', '5000', 'number', 'uploads', 'Max polling stations per import', true),
  ('training.max_batch_size', '100', 'number', 'training', 'Max officers per training batch', true),
  ('election.district_default', '"Kakinada"', 'string', 'election', 'Default district', true),
  ('randomization.max_attempts', '50', 'number', 'election', 'Max formation attempts', false),
  ('notify.preview_required', 'true', 'boolean', 'notifications', 'Require preview before send', true),
  ('notify.send_window', '"08:00-20:00"', 'string', 'notifications', 'Allowed send window (IST)', true),
  ('portal.district_name', '"Kakinada District"', 'string', 'portal', 'District display name', true),
  ('portal.state_line', '"Andhra Pradesh State Election Commission"', 'string', 'portal', 'State commission line', true),
  ('portal.support_contact', '""', 'string', 'portal', 'Helpdesk contact shown on portal', true)
ON CONFLICT (key) DO NOTHING;

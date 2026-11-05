# CUSTOMIZATION ROADMAP — "100% customizable, future-proof" polling software

> Goal (team decision 2026-10-17): any district/election/authority can run this
> software without code changes. EVERY knob lives in the database (admin UI)
> or in documented `.env`, never in source code.
>
> Status convention: [x] done · [ ] planned · [~] partial

---

## 1. What is ALREADY customizable (do not rebuild)

| Area | Mechanism | Notes |
|---|---|---|
| DOCX order templates | `order_templates` table + `GET/POST /imports/templates` | Upload per kind |
| Order text/authority | `order_config` table + `GET /imports/order-config` | Authority, signatory, numbering |
| ID cards | `id_card_design` table | Schema unchecked — verify before building on it |
| Polling-station import | `POST /master-data/stations` batch JSON | |
| Personnel / MO / locations / adjacency | Upload intakes (replace-semantics) | |
| Designation policy | `designationRules` per-run JSON (seniority, eligibility) | Server never invents policy |
| Election strength | `electionConfiguration` per-run JSON | |
| SMS/WhatsApp credentials | Env vars (`FAST2SMS_*`, `WHATSAPP_*`); honest `status()` | Never in code, never logged |

---

## 2. Customization registry (THE pattern — read before adding any knob)

Every customizable thing MUST be one of these, in this order of preference:

1. **A row in `app_settings`** (migration 020) declared in
   `src/modules/settings/settings.registry.js` — for scalars/objects an
   admin edits in a form (limits, labels, toggles, message text, IDs).
2. **An uploaded artifact** in an existing table (`order_templates`,
   `id_card_design`) — for documents/layouts.
3. **An uploaded dataset** via an intake (personnel, stations, adjacency…).
4. **An `.env` variable** — ONLY for secrets/credentials and infra
   (ports, DB URLs). Never for content, labels, limits, or message text.

### Rules for every new knob (non-negotiable)

- Seeded default in the migration == current hardcoded behavior. Deploying
  must change NOTHING until an admin edits it.
- Value validated against the registry schema on write; unknown keys and
  wrong types fail closed (400). No "allow all" form.
- Reads: `authority`/`admin` may read all; `staff` gets the public-safe
  subset only. Writes: `authority`/`admin`.
- Every write stamps `updated_by` + audit row (who/when/old/new).
- Never expose secrets: `status()`-style endpoints list missing names, never values.
- Never invent official content: reporting time, venue, reference, helpdesk
  appear ONLY when an authority supplies them (existing notification rule).
- Tests: every registry entry gets a `node --test` case (valid accept,
  wrong-type reject, unknown-key reject, role-gate 403).

---

## 3. Registry — every customizable option (grouped)

### 3.1 Notifications (SMS / WhatsApp)
- [~] Credentials via env (done) — keep.
- [ ] `notify.channels` — which channels exist + priority order
      (e.g. `["whatsapp","sms"]`, fallback rules).
- [ ] `notify.sender_ids` — per-channel sender IDs (Fast2SMS sender ID,
      WhatsApp display name). Text IDs only.
- [ ] `notify.dlt.template_ids` — per-purpose DLT template IDs
      (duty_allotted, training_scheduled, order_issued, reminder).
- [ ] `notify.message.<purpose>.<channel>` — full message template text
      with `{name} {teamCode} {role} {station} {stationMandal} {reportingDateTime}
      {electionReference} {helpdesk}` placeholders. Rendered by the existing
      `buildNotification`; unknown placeholders fail the save, never render blank.
- [ ] `notify.preview_required` — force Preview-before-Send toggle.
- [ ] `notify.daily_cap_per_officer` + `notify.send_window` (e.g. 08:00–20:00).
- [ ] Admin UI: per-channel configured/missing status, template editor with
      placeholder picker + live preview against a sample officer, send log
      (`deliveries`), retry-failed button.
- [ ] Future hook: `notify.provider.<name>` registry (Twilio/MSG91/Gmail)
      behind the same provider interface — add provider WITHOUT touching callers.

### 3.2 Documents (orders, ID cards, reports)
- [~] DOCX upload + order_config APIs (done) — need admin UI.
- [ ] Admin page: list templates per kind, upload/replace, set active,
      download current, test-print (generate sample against a fake officer).
- [ ] `order_config` form UI: issuing authority, signatory name/title,
      order-number prefix + series, footer notes.
- [ ] ID-card designer: layout choice, header text, which fields show
      (photo/signature/QR toggles), signatory; preview before save.
- [ ] `reports.header` / `reports.footer` — text on allocation/summary exports.
- [ ] `reports.filename_pattern` — e.g. `{district}-{phase}-{date}.xlsx`.

### 3.3 Election rules (no-code election changes)
- [ ] Designation→role mapping editor producing validated `designationRules`
      (seniority rank, presidingEligible, microObserverEligible, gazetted mapping)
      saved per election — replaces hand-edited run JSON.
- [ ] Election-configuration builder: required strength per mandal,
      district default (today hardcoded `'Kakinada'` → seeded setting).
- [ ] Mandal-adjacency editor over the migration-019 table.
- [ ] `randomization.polling_officers_per_party`, `.max_attempts`, `.seed_optional`.
- [ ] `formation.shortage_reason_default` (authorised 1+4 text template).

### 3.4 Intake & limits
- [ ] `uploads.max_file_mb` (seed 100), `uploads.max_ballot_mb` (seed 15),
      `uploads.max_stations` (seed 5000), `uploads.max_batch_size` (seed 100).
- [ ] Personnel proforma: required-column set + label map (so new columns
      never need code).
- [ ] `exemptions.auto_categories` — which categories the authority allows
      auto-exempting vs "held for review" (today hardcoded in tests/code).

### 3.5 Training
- [ ] `training.max_batch_size` (seed 100), batch-no pattern, venue assignment
      workflow toggles, attendance statuses list.
- [ ] Reuse §3.2 document pipeline for training orders (no parallel system).

### 3.6 Portal branding & text (multi-district future-proofing)
- [ ] `portal.district_name` (seed "Kakinada District"), `portal.state_line`,
      `portal.support_contact`, `portal.announcement_banner`.
- [ ] `portal.primary_color` + logo upload (replace hardcoded blues/logo paths).
- [ ] Login/help/empty-state copy as settings, not literals.

### 3.7 NOT customizable (deliberately)
- Secrets/credentials → `.env` only.
- Randomization fairness logic (1+1+4 composition, mandal bars, uniqueness).
- Anything the circular fixes (public-display confidentiality, publish gating).
- Role vocabulary enforcement (middleware). New roles need code + seed, by design.

---

## 4. Build order (agreed 2026-10-17: foundation first)

- [x] **Phase 1 — Foundation (DONE 2026-10-17)**: migration `020_app_settings.sql`
      (`app_settings` + `settings_audit`, 11 seeded knobs) → `src/modules/settings/`
      (router + service + validator + `settings.registry.js` + 7 tests, fake-pool
      style) → `GET /api/settings`, `PATCH /api/settings/:key`,
      `GET /api/settings/changes` → frontend `Settings.jsx` (grouped editor +
      audit strip) + hub cards (Municipal/Panchayat) + `client.js` helpers →
      consumers wired: upload limits (`uploads.max_file_mb`,
      `uploads.max_ballot_mb`, `uploads.max_stations`), training batch size
      (`training.max_batch_size`), district default (`election.district_default`),
      formation attempts (`randomization.max_attempts`) — all fail-open to
      defaults when the table is missing → suite 318/318, build + lint clean.
- [ ] **Phase 2 — Notifications**: registry entries §3.1 → template editor +
      preview + status page → provider registry hook.
- [ ] **Phase 3 — Documents**: admin UI over existing template/config APIs →
      ID-card designer + test-print → report header/filename settings.
- [ ] **Phase 4 — Rules engine**: designation editor → election builder →
      adjacency editor.

## 5. Per-phase checklist (copy into the PR)

- [ ] Migration seeds defaults == old hardcoded values (behavior unchanged).
- [ ] Registry entry + validator tests (accept / wrong-type 400 / unknown-key
      400 / staff-write 403).
- [ ] Backend suite: `node --test tests/` green (311 baseline).
- [ ] `node --check` clean on touched files; `vite build` + `eslint` clean.
- [ ] Frontend: optimistic save, inline API errors, loading/disabled states,
      audit strip ("last changed by X at Y").

## 6. Open questions (ask the authority, not the code)

1. SMS before WhatsApp or WhatsApp before SMS on fallback?
2. Which DLT sender IDs / template IDs are registered today?
3. One global template set, or per-district overrides?
4. Who may edit settings — `authority` alone, or `authority` + `admin`?

---

## 7. Bonus ideas (agreed 2026-10-17, add to phases)

- [ ] **Settings import/export** — JSON export of all knobs; import validates
      against registry then applies in one transaction. New district clones a
      working config in seconds. (small — do in Phase 2)
- [ ] **Dry-run / test buttons** — "Send test SMS", "Generate sample order",
      "Preview ID card" before committing. Reuses the honest-failure pattern.
- [ ] **Rate-limit knobs as settings** — login attempts window, upload
      throttle (auth.js limiter constants move to registry). (Phase 2)
- [ ] **Dark mode + density toggle** — CSS variables on the portal group,
      persisted per user in localStorage. (Phase 3, pure frontend)
- [ ] **Backup/restore** — admin-triggered pg_dump download + restore via
      uploaded dump (admin-only, audited). NEVER auto-scheduled. (Phase 4)
- [ ] **Field-level help text** — every settings knob gets an optional
      `help` string shown as a tooltip in Settings.jsx. (tiny — Phase 2)

---

## 8. Phase 5 plan — DATA SCHEMA CUSTOMIZATION ("SQL-level" input/output/storage)

> Goal (team 2026-10-17): the authority controls WHICH data is collected
> (input), WHAT is stored and shown (storage/output), and which columns
> appear in imports/exports/reports — **without any code change and without
> ever giving admins raw SQL.**

### 8.1 The core decision (read this first)

We do **NOT** expose SQL, DDL, or a table designer. Reasons specific to
this system:
- The randomization core (Stage 1→2→3) depends on fixed columns
  (`work_mandal`, `native_mandal`, `gazetted_status`, `seniority_rank`,
  `designation`, `presiding_eligible`). A dropped/renamed column silently
  breaks fairness — the worst possible failure for election software.
- `ALTER TABLE` from a web form = privilege-escalation + injection surface.
- Every migration in this repo is reviewed SQL; runtime DDL skips review.

Instead: a **field registry** that drives intake → validation → storage →
export end-to-end. Admins define FIELDS, not TABLES. This still delivers
"100% customizable input, output, and storage" with zero risk to fairness.

### 8.2 Architecture — the field registry

New table (migration 021_field_registry.sql):

```
field_definitions (
  id, entity TEXT CHECK IN ('personnel','station','batch'),
  field_key TEXT,            -- stable key, e.g. 'blood_group'
  label TEXT,                -- admin-facing / export header text
  data_type TEXT CHECK IN ('string','number','date','boolean','enum'),
  is_core BOOLEAN,           -- true = randomization-critical, LOCKED
  is_required BOOLEAN,
  is_sensitive BOOLEAN,      -- never exported/logged (privacy allow-list)
  import_column TEXT,        -- expected Excel header (empty = not imported)
  export_visible BOOLEAN,    -- include in exports/reports
  enum_options JSONB,        -- allowed values when data_type='enum'
  validation JSONB,          -- {min,max,pattern,maxLength}
  default_value JSONB,
  active BOOLEAN,
  sort_order INT, created_by, updated_by, created_at, updated_at
)
```

Storage rule:
- **Core fields** → existing typed columns (unchanged; locked rows in
  registry, read-only except label/export flags).
- **Custom fields** → a `custom_fields JSONB` column added to
  `personnel` + `polling_stations` (GIN index). No new tables ever.

### 8.3 How each side uses the registry

- **Input (intake)**: parsers read active registry rows for the entity;
  header matching uses `import_column` (exact, case-insensitive) with a
  fuzzy fallback that must be CONFIRMED (never guessed silently). Required
  fields missing → rejected row with reason (existing pattern).
- **Validation**: type/enum/min-max/pattern from the registry row, applied
  in the same validator chain as today's field checks.
- **Storage**: core → column; custom → `custom_fields->field_key`.
- **Output**: exports (Excel/DOCX/reports) emit core columns first (fixed
  order), then custom fields by `sort_order` where `export_visible`.
  `is_sensitive` fields are excluded from every export, log, and API
  response for staff (same policy as Aadhaar allow-list today).
- **API**: `GET /api/fields/:entity` (list), `POST /api/fields` (create
  custom), `PATCH /api/fields/:id` (edit; core fields: label/export flags
  only), `DELETE` = deactivate (never hard-delete; data retention for audit).

### 8.4 Explicitly NOT customizable (locked forever)

- Randomization fairness inputs (the six core columns above) — registry
  rows with `is_core=true`; deletion/rename/type-change rejected 400.
- Sensitive-flag semantics: a field marked sensitive can never be
  un-marked to retroactively expose already-collected data (audit checks).
- Table names, indexes, keys, FKs — migration-owned, reviewed SQL only.
- No SQL text, no regex-from-admin executed as code (patterns are
  length-capped + anchored, never eval'd).

### 8.5 Build order within Phase 5

- [ ] 5a. Migration 021 (registry + `custom_fields JSONB` + GIN index) +
      seed core rows for personnel & station entities.
- [ ] 5b. Backend `modules/field-registry/` (router+service+validator,
      fake-pool tests: core-lock enforcement, sensitive exclusion).
- [ ] 5c. Wire intake parsers to registry (personnel first, then stations).
- [ ] 5d. Wire exports (allocation Excel, training tables) to registry.
- [ ] 5e. Frontend "Data fields" admin page: list per entity, add custom
      field form, toggle required/sensitive/export, reorder; live import
      template preview that regenerates the Excel header row from the
      registry (so a new district prints its own proforma).
- [ ] 5f. Regression: existing uploads with zero custom fields must
      behave byte-identically (suite green, fixtures unchanged).

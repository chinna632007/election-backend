# MongoDB Authoritative Data Model & Architecture

This document defines the authoritative MongoDB data model for the Polling Management Application, collection retention, relationships, and deletion policies.

---

## 1. MongoDB as the Single Source of Truth

The application uses MongoDB as the sole source of truth across all election phases.

- **No Local Storage Fallbacks**: Browser `localStorage` is not used for business data.
- **No In-Memory Resurrections**: When records are deleted or modified directly in MongoDB (e.g. via MongoDB Compass), the next read/refresh reflects that exact database state. The UI does not silently repopulate deleted records from cached copies.
- **Fail-Closed Connectivity**: If MongoDB is unreachable, the backend returns HTTP 503 (`MongoConnectionError`), and the frontend displays a clear error state rather than faking data with mock arrays.

---

## 2. Retained Collections & Responsibilities

The application retains only collections that store business data, user authentication, audit records, or allocation state. Temporary UI state is kept in frontend memory only.

| Collection Name | Purpose | Key Fields | User / Election Ownership |
| :--- | :--- | :--- | :--- |
| `users` | User credentials and role assignments | `id`, `username`, `password_hash`, `role_id` | Core identity store |
| `roles` | System roles (RBAC) | `id`, `name` (`admin`, `authority`, `staff`) | System catalog |
| `counters` | Atomic monotonic sequence generators | `_id` (entity name), `sequence` | System utility |
| `import_batches` | Uploaded personnel & station proforma metadata | `id`, `file_name`, `department_name`, `total_rows`, `accepted_rows`, `imported_by`, `imported_at` | Owned by `imported_by` (`users.id`) |
| `personnel` | Validated, eligible polling personnel | `id`, `import_batch_id`, `employee_id`, `employee_name`, `designation`, `voter_id`, `mobile_no`, `district`, `mandal` | Child of `import_batches` (`import_batch_id`) |
| `import_rejected_rows` | Invalid personnel rows with validation error reasons | `id`, `import_batch_id`, `sheet_row`, `raw_values`, `reasons` | Child of `import_batches` (`import_batch_id`) |
| `personnel_exemptions` | Exemption grant/revoke audit trail | `id`, `personnel_id`, `requested_by_user_id`, `category`, `decision`, `updated_at` | Audit trail linked to `users.id` |
| `micro_observers` | Uploaded pool of Micro Observers (bank/central staff) | `id`, `employee_name`, `designation`, `bank_branch`, `mandal` | Election personnel pool |
| `polling_stations` | Polling station master records & complete addresses | `id`, `station_number`, `station_name`, `building_name`, `address`, `ward`, `mandal`, `pin_code`, `imported_by` | Owned by `imported_by` (`users.id`) |
| `mandal_adjacency` | Mandal neighbor topology for conflict-free postings | `mandal`, `adjacent_mandals` | Master lookup data |
| `election_requirements` | Mandal/post volunteer strength requirements | `mandal`, `required_po`, `required_apo`, `required_opo` | Election configuration |
| `team_rosters` | Formed election teams (PO, APO, OPOs) | `team_code`, `run_id`, `posting_mandal`, `status` | Phase 2 allocation state |
| `team_roster_members` | Members assigned to formed election teams | `team_code`, `personnel_id`, `role`, `duty_order` | Child of `team_rosters` & `personnel` |
| `allocation_runs` | Execution metadata of randomization runs | `run_id`, `stage`, `run_at`, `actor_id`, `parameters` | Execution audit linked to `users.id` |
| `allocation_publications` | Published/finalized status of station-to-team assignments | `run_id`, `published_at`, `published_by` | Controlled release |
| `training_locations` | Physical venues available for training | `_id`, `location_name`, `address`, `capacity`, `mandal` | Venue master data |
| `training_sessions` | Training schedules, sessions, and batches | `id`, `session_date`, `time_from`, `time_to`, `venue_id`, `created_by_user_id` | Owned by `created_by_user_id` (`users.id`) |
| `training_attendance` | Attendance records marked for trainees | `session_id`, `personnel_id`, `present`, `marked_at`, `marked_by` | Attendance audit |
| `training_batches` | Formed training batches | `id`, `batch_no`, `mandal`, `location_id`, `created_by` | Owned by `created_by` (`users.id`) |
| `training_batch_members` | Officers assigned to training batches | `batch_id`, `personnel_id`, `duty_role` | Child of `training_batches` |
| `order_templates` | Uploaded appointment order DOCX templates | `id`, `template_name`, `template_bytes`, `uploaded_by` | Document templates |
| `order_assignments` | Appointment order numbers assigned to officers | `id`, `personnel_id`, `order_kind`, `order_number`, `created_by` | Officer appointment orders |
| `generated_documents` | Generated appointment order documents and history | `id`, `document_type`, `personnel_id`, `created_by`, `generated_at` | Generated document audit |
| `workflow_state` | Authoritative cross-phase snapshots | `_id` (`context:phase`), `context`, `phase`, `value`, `updated_by`, `updated_at` | Workflow progress |
| `app_settings` | Customizable system settings (limits, rules, branding) | `key`, `value`, `group`, `type`, `updated_by`, `updated_at` | System configuration |
| `settings_audit` | Audit log of setting alterations | `key`, `old_value`, `new_value`, `updated_by`, `changed_at` | Settings audit |
| `audit_events` | Security and operational audit log | `id`, `actor_id`, `actor_username`, `action`, `target_entity`, `created_at` | System security log |
| `field_registry` | Customizable proforma and station fields | `id`, `field_key`, `label`, `data_type`, `entity`, `active`, `created_by`, `updated_by` | Schema registry |

---

## 3. User Deletion & Related Record Cleanup Policy

When an administrator deletes a user via `DELETE /api/auth/users/:id` or through the **User Accounts & Data Administration** panel:

### 3.1 Authorization & Protection Rules
1. **Admin Only**: Ordinary users (`staff`, `authority`) receive HTTP 403 Forbidden.
2. **Self-Deletion Prohibited**: An administrator cannot delete their own active account.
3. **Last Admin Protection**: The last remaining administrator account cannot be deleted to prevent system lockout.

### 3.2 Cascading Cleanup & Anonymization
When user `U` is deleted:
1. **Import Batches & Personnel**: All batches in `import_batches` where `imported_by == U.id` are removed. All associated child documents in `personnel` and `import_rejected_rows` are deleted atomically.
2. **Polling Stations**: Stations in `polling_stations` where `imported_by == U.id` are deleted.
3. **Training Data**: Training sessions and training batches created by `U.id` are deleted.
4. **Generated Documents**: Document records in `generated_documents` created by `U.id` are deleted.
5. **Workflow State**: Any snapshot in `workflow_state` updated by `U.id` is cleared.
6. **Audit Integrity (Anonymization)**: Historical entries in `audit_events`, `settings_audit`, `personnel_exemptions`, and `field_registry` are **anonymized** rather than destroyed, setting `actor_id = null` and `actor_username = '[deleted-user#<id>]'`. This maintains chronological audit logs without broken foreign keys.
7. **User Record**: The user is deleted from `users`.

---

## 4. Empty State on Site Startup

On a fresh deployment where MongoDB has no records:
- **Phase 1**: Renders an empty proforma upload panel.
- **Phase 2**: Displays a clear prerequisite requirement: *"Phase 1: Validated Input required. Please upload personnel proforma in Phase 1 first."*
- **Phase 3**: Displays prerequisite prompt to form teams in Phase 2 and upload stations.
- **Training**: Displays prerequisite prompt to complete Phases 1, 2, and 3.
- **No Automatic Seeding**: Sample data is never injected automatically. Development sample data can only be seeded intentionally using the explicit development command:
  ```bash
  npm run seed:dev -- --confirm
  ```
  *(Requires `NODE_ENV !== 'production'` and explicit `--confirm` flag).*

---

## 5. Verification Commands

- Run full backend test suite:
  ```bash
  cd polling-backend && npm test
  ```
- Run user deletion unit tests:
  ```bash
  cd polling-backend && node --test tests/auth/user-deletion.test.js
  ```
- Build frontend production bundle:
  ```bash
  cd polling-frontend && npm run build
  ```
- Run opt-in cleanup health check (dry run):
  ```bash
  cd polling-backend && npm run migrate:cleanup
  ```


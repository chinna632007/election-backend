'use strict';

/**
 * personnel-edit.service.js — admin edit of a personnel record.
 *
 * PATCH /api/imports/personnel/:id   { ...fields }
 *
 * Only an explicit ALLOW-LIST of editable columns is accepted. Identity,
 * import-control, and sensitive columns (aadhar_number, voter_id, and the
 * exemption status handled by its own endpoint) are NOT editable here — the
 * caller cannot touch them because they are simply not in the allow-list.
 *
 * Unknown keys are ignored (not an error) so the frontend can send a whole
 * record; only recognized fields are written. Absent keys are left unchanged
 * (partial update). Sending a field as null clears it where the column allows.
 *
 * 400: invalid id or a field failing its shape check.
 * 404: personnel not found.
 */

const { getCollection } = require('../../database');

// Editable columns -> { max, kind }. kind 'text' (trimmed) | 'int'.
// Deliberately EXCLUDES: id, import_batch_id, import_status, validation_errors,
// is_active, exempt_category, employee_id, employee_name, aadhar_number,
// voter_id, created_at. employee_name/employee_id are identity set at import.
const EDITABLE = {
  designation: { max: 200, kind: 'text' },
  gender: { max: 20, kind: 'text' },
  age: { max: 10, kind: 'text' },
  languages_known: { max: 500, kind: 'text' },
  employment_sector: { max: 200, kind: 'text' },
  scale_of_pay: { max: 100, kind: 'text' },
  basic_pay: { max: 100, kind: 'text' },
  gazetted_status: { max: 100, kind: 'text' },
  date_of_birth: { max: 40, kind: 'text' },
  date_of_retirement: { max: 40, kind: 'text' },
  employment_type: { max: 100, kind: 'text' },
  enrolled_assembly_constituency: { max: 200, kind: 'text' },
  part_no_vote_sl_no: { max: 100, kind: 'text' },
  residence_address: { max: 500, kind: 'text' },
  residence_constituency_code: { max: 100, kind: 'text' },
  residence_constituency_name: { max: 200, kind: 'text' },
  work_mandal: { max: 200, kind: 'text' },
  working_constituency_code: { max: 100, kind: 'text' },
  working_constituency_name: { max: 200, kind: 'text' },
  native_mandal: { max: 200, kind: 'text' },
  native_constituency_code: { max: 100, kind: 'text' },
  native_constituency_name: { max: 200, kind: 'text' },
  previous_po_duty: { max: 200, kind: 'text' },
  mobile_no: { max: 40, kind: 'text' },
  service_in_district_4y: { max: 20, kind: 'text' },
  ph_category: { max: 100, kind: 'text' },
  criminal_case_or_eci_orders: { max: 500, kind: 'text' },
  exceeded_3_years: { max: 20, kind: 'text' },
  eci_ceo_order_details: { max: 1000, kind: 'text' },
  remarks: { max: 1000, kind: 'text' },
};

function cleanValue(spec, value, field) {
  if (value === null) return null; // explicit clear where column allows
  if (typeof value !== 'string') {
    if (typeof value === 'number') value = String(value);
    else {
      const err = new Error(field + ' must be a string');
      err.statusCode = 400;
      throw err;
    }
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > spec.max) {
    const err = new Error(field + ' must be at most ' + spec.max + ' characters');
    err.statusCode = 400;
    throw err;
  }
  return trimmed;
}

/**
 * editPersonnel({ id, fields, req }) -> { ok, id, updated: [cols] }
 * `fields` is the raw request body; only allow-listed keys are applied.
 */
async function editPersonnel({ id, fields, req } = {}) {
  const numId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(numId) || numId <= 0) {
    const err = new Error('invalid personnel id');
    err.statusCode = 400;
    throw err;
  }
  const body = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};

  const changes = {};
  const updated = [];
  for (const key of Object.keys(EDITABLE)) {
    if (!(key in body)) continue; // partial update: absent = unchanged
    changes[key] = cleanValue(EDITABLE[key], body[key], key);
    updated.push(key);
  }

  if (updated.length === 0) {
    // Nothing editable supplied. Validate the record still exists, then no-op.
    const exists = await getCollection('personnel').findOne(
      { id: numId },
      { projection: { _id: 0, id: 1 } }
    );
    if (!exists) {
      const err = new Error('personnel not found');
      err.statusCode = 404;
      throw err;
    }
    return { ok: true, id: numId, updated: [] };
  }

  const result = await getCollection('personnel').updateOne({ id: numId }, { $set: changes });
  if (result.matchedCount === 0) {
    const err = new Error('personnel not found');
    err.statusCode = 404;
    throw err;
  }
  return { ok: true, id: numId, updated };
}

module.exports = { editPersonnel, EDITABLE };

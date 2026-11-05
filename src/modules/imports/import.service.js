'use strict';

/**
 * Stage: imports — persistence for a personnel import.
 *
 * One import = one import_batches row + accepted rows in personnel +
 * rejected rows in import_rejected_rows, written in order with compensating
 * cleanup on failure. Rejected rows carry import_status='rejected' semantics via
 * their own table + the reasons array, so the frontend always renders stored
 * DB data (never a local-file fallback).
 *
 * District is stamped per the confirmed single-district scope (Kakinada).
 */

const { getCollection } = require('../../database');
const { createHash } = require('crypto');
const { parseProformaWorkbook } = require('./excel.parser');
const { validateRows } = require('./validation');
const { resolveExemption } = require('./exemption.mapping');

function collection(name) {
  const result = getCollection(name);
  return result.collection || result;
}

const IMPORT_DISTRICT = 'Kakinada';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

// Personnel columns written from the sheet (proforma fields only; scope and
// control columns are set by the import itself).
const PERSONNEL_COLUMNS = [
  'sl_no', 'employee_id', 'employee_name', 'designation', 'gender', 'age',
  'aadhar_number', 'languages_known', 'employment_sector', 'scale_of_pay',
  'basic_pay', 'gazetted_status', 'date_of_birth', 'date_of_retirement',
  'employment_type', 'enrolled_assembly_constituency', 'part_no_vote_sl_no',
  'voter_id', 'residence_address', 'residence_constituency_code',
  'residence_constituency_name', 'work_mandal', 'working_constituency_code',
  'working_constituency_name', 'native_mandal', 'native_constituency_code',
  'native_constituency_name', 'previous_po_duty', 'mobile_no',
  'service_in_district_4y', 'ph_category', 'criminal_case_or_eci_orders',
  'exceeded_3_years', 'eci_ceo_order_details', 'remarks',
];

async function reserveIds(collectionName, count) {
  if (count === 0) return [];
  const result = await collection('counters').findOneAndUpdate(
    { _id: collectionName },
    { $inc: { sequence: count } },
    { upsert: true, returnDocument: 'after' }
  );
  const counter = result && (result.value || result);
  return Array.from({ length: count }, (_value, index) => counter.sequence - count + index + 1);
}

async function findExistingPersonnelImport(importedBy, requestId, requestHash) {
  if (!requestId) return null;
  const batch = await collection('import_batches').findOne({
    imported_by: importedBy ?? null,
    request_id: requestId,
  });
  if (!batch) return null;

  if (batch.request_hash !== requestHash) {
    const error = new Error('The upload request key was reused for a different file. Select the file again and retry.');
    error.statusCode = 409;
    throw error;
  }
  if (batch.status !== 'completed') {
    const error = new Error('This employee upload is still processing. Retry the same upload shortly.');
    error.statusCode = 409;
    throw error;
  }

  const rejectedRows = await collection('import_rejected_rows').find(
    { import_batch_id: batch.id },
    { projection: { _id: 0, sheet_row: 1, employee_id: 1, reasons: 1, raw_values: 1 } }
  ).sort({ sheet_row: 1 }).toArray();

  return {
    batchId: batch.id,
    totalRows: batch.total_rows,
    acceptedRows: batch.accepted_rows,
    rejectedRows: batch.rejected_rows,
    exemptRows: batch.exempt_rows || 0,
    rejected: rejectedRows.map((row) => ({
      sheetRow: row.sheet_row,
      employeeId: row.employee_id,
      reasons: row.reasons || [],
      values: row.raw_values || {},
      rawValues: row.raw_values || {},
    })),
  };
}

/**
 * persistPersonnelImport({ fileName, buffer, importedBy }) -> batch summary
 * Throws ImportParseError (400) for unreadable files; other errors propagate
 * as 500s. Failed writes trigger compensating cleanup for this import batch.
 */
async function persistPersonnelImport({ fileName, buffer, importedBy, requestId }) {
  if (requestId !== undefined && requestId !== null &&
      (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId))) {
    const error = new Error('requestId must be 8–128 letters, digits, dots, underscores, colons, or hyphens');
    error.statusCode = 400;
    throw error;
  }

  const requestHash = requestId
    ? createHash('sha256').update(fileName).update('\0').update(buffer).digest('hex')
    : null;
  if (requestId) {
    await collection('import_batches').createIndex(
      { imported_by: 1, request_id: 1 },
      {
        unique: true,
        partialFilterExpression: { request_id: { $type: 'string' } },
        name: 'import_batches_request_id_unique',
      }
    );
    const existing = await findExistingPersonnelImport(importedBy, requestId, requestHash);
    if (existing) return existing;
  }

  const { sheetInfo, rows } = parseProformaWorkbook(buffer);
  const { accepted, rejected } = validateRows(rows);

  const batchId = (await reserveIds('import_batches', 1))[0];
  let exemptCount = 0;
  try {
    await collection('import_batches').insertOne({
        id: batchId,
        file_name: fileName,
        imported_by: importedBy ?? null,
        ...(requestId ? { request_id: requestId, request_hash: requestHash } : {}),
        department_name: sheetInfo.departmentName,
        gad_department_code: sheetInfo.gadDepartmentCode,
        ddo_code: sheetInfo.ddoCode,
        total_rows: accepted.length + rejected.length,
        accepted_rows: accepted.length,
        rejected_rows: rejected.length,
        status: 'in_progress',
        imported_at: new Date(),
      });

    const personnelDocs = [];
    const personnelIds = await reserveIds('personnel', accepted.length);
    let personnelIndex = 0;
    for (const record of accepted) {
      // Circular p.61 exemption resolution (sheet Department + row Designation).
      // Never blocks the import: markings land in exempt_category and Stage 1
      // excludes them from the pool; the authority reviews them before running.
        const hit = resolveExemption(sheetInfo.departmentName, record.designation);
      const exemptCategory = hit ? hit.category : null;
      if (hit) exemptCount += 1;
        const document = {
          id: personnelIds[personnelIndex++],
          import_batch_id: batchId,
          import_status: 'accepted',
          district: IMPORT_DISTRICT,
          exempt_category: exemptCategory,
          is_active: true,
        };
        for (const column of PERSONNEL_COLUMNS) document[column] = record[column] ?? null;
        personnelDocs.push(document);
    }
    if (personnelDocs.length) await collection('personnel').insertMany(personnelDocs, { ordered: true });

    // Rejected rows are stored too in import_rejected_rows with reasons, so the frontend
    // always renders stored DB data and never a local-file fallback.
    const rejectedDocs = [];
    const rejectedIds = await reserveIds('import_rejected_rows', rejected.length);
    let rejectedIndex = 0;
    for (const rej of rejected) {
      const rawRow = rows.find((r) => r.sheetRow === rej.sheetRow);
      rejectedDocs.push({
        id: rejectedIds[rejectedIndex++],
        import_batch_id: batchId,
        sheet_row: rej.sheetRow ?? null,
        employee_id: rej.employeeId ?? null,
        reasons: rej.reasons || [],
        raw_values: (rawRow && rawRow.values) || {},
      });
    }
    if (rejectedDocs.length) await collection('import_rejected_rows').insertMany(rejectedDocs, { ordered: true });
    await collection('import_batches').updateOne(
      { id: batchId },
      { $set: { status: 'completed', exempt_rows: exemptCount } }
    );

    const enrichedRejected = rejected.map((rej) => {
      const rawRow = rows.find((r) => r.sheetRow === rej.sheetRow);
      const vals = (rawRow && rawRow.values) || rej.values || rej.rawValues || {};
      return {
        ...rej,
        values: vals,
        rawValues: vals,
      };
    });

    return {
      batchId,
      totalRows: accepted.length + rejected.length,
      acceptedRows: accepted.length,
      rejectedRows: rejected.length,
      exemptRows: exemptCount,
      rejected: enrichedRejected,
    };
  } catch (error) {
    try {
      await collection('personnel').deleteMany({ import_batch_id: batchId });
      await collection('import_rejected_rows').deleteMany({ import_batch_id: batchId });
      await collection('import_batches').deleteOne({ id: batchId });
    } catch (cleanupError) {
      throw new Error(
        `Personnel import failed (${error.message}); compensating cleanup also failed (${cleanupError.message}). Batch ${batchId} may require manual cleanup.`,
        { cause: error }
      );
    }
    if (requestId && error.code === 11000 && error.keyPattern?.request_id) {
      const existing = await findExistingPersonnelImport(importedBy, requestId, requestHash);
      if (existing) return existing;
    }
    throw error;
  }
}

/**
 * Mark (or clear) a single personnel record's official exemption status.
 *
 *   POST /api/imports/personnel/:id/exemption   { exemptCategory, note }
 *
 *  - `exemptCategory` = an official EXEMPT_CATEGORY value, or
 *    'pending_authority_confirmation' (bank p.61(a)(vii)).
 *  - `note` is an audit-only reason (never returned in the personnel response).
 *
 * Writes the personnel row and an append-only audit record with compensation.
 * Sensitive categories ('pregnant', 'breastfeeding') are stored; existing read
 * endpoints mask them with the generic 'exempt' label.
 *
 * 400: unknown/unauthorized category, negative id, note > 400 chars.
 * 404: personnel not found.
 */
async function patchPersonnelExemption({ id, exemptCategory, note = '', req } = {}) {
  if (!['pregnant', 'breastfeeding', 'bank_rural_single_officer', 'veterinary_staff', 'health_medical', 'nurse_anm', 'ayush_medical', 'all_india_radio', 'doordarshan', 'bsnl_mtnl_ops', 'pending_authority_confirmation', null].includes(exemptCategory)) {
    throw new Error('unauthorized category');
  }
  if (typeof note !== 'string' || note.length > 400) {
    throw new Error('note must be a string up to 400 characters');
  }
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('invalid personnel id');
  }

  let auditId;
  try {
    const personnel = await collection('personnel').findOne(
      { id },
      { projection: { _id: 0, id: 1, employee_id: 1, exempt_category: 1, import_batch_id: 1 } }
    );
    if (!personnel) throw new Error('personnel not found');
    auditId = (await reserveIds('personnel_exemptions', 1))[0];
    await collection('personnel_exemptions').insertOne({
        personnel_id: id,
        id: auditId,
        employee_id: personnel.employee_id,
        new_exempt_category: exemptCategory,
        old_exempt_category: personnel.exempt_category,
        reason: 'authority_mark',
        requested_by_user_id: (req && req.session && req.session.user && req.session.user.id) || null,
        note,
      });
    const updated = await collection('personnel').updateOne(
      { id, exempt_category: personnel.exempt_category ?? null },
      { $set: { exempt_category: exemptCategory } }
    );
    if (updated.matchedCount !== 1) {
      const conflict = new Error('personnel exemption changed concurrently; reload and retry');
      conflict.statusCode = 409;
      throw conflict;
    }
    return { ok: true, id, profileId: personnel.id };
  } catch (error) {
    if (auditId !== undefined) {
      try {
        await collection('personnel_exemptions').deleteOne({ id: auditId });
      } catch (cleanupError) {
        throw new Error(
          `Personnel exemption update failed (${error.message}); audit cleanup also failed (${cleanupError.message}).`,
          { cause: error }
        );
      }
    }
    throw error;
  }
}

module.exports = { persistPersonnelImport, patchPersonnelExemption, IMPORT_DISTRICT };

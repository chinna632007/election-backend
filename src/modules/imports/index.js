'use strict';

/**
 * Stage: imports — HTTP routes (session-authenticated).
 *
 *   POST /api/imports/personnel   upload one proforma workbook (base64 JSON)
 *   GET  /api/imports/batches     recent import batches (traceability)
 *   GET  /api/imports/batches/:id/personnel
 *          accepted personnel rows in one batch (all proforma columns)
 *   GET  /api/imports/batches/:id/rejected
 *          rejected rows stored for one batch (status + reasons + raw values)
 *
 * Upload format: { "fileName": "...", "dataBase64": "<file as base64>" }.
 * (JSON instead of multipart so no extra upload package is needed; the file
 * content never touches disk.)
 *
 * Both accepted AND rejected rows are stored (team decision 2026-10-14):
 * accepted -> personnel (import_status='accepted'), rejected ->
 * import_rejected_rows (import_status='rejected' semantics + reasons).
 * Every read comes from the DB; the frontend never renders a local-file
 * fallback as if it were stored data.
 *
 * Authorization: session required (router.use(requireAuth)). Role policy is
 * enforced per route with authorize(...roles):
 *   POST /personnel                 -> authority, admin
 *   GET  /batches                   -> staff, authority, admin (read-only)
 *   GET  /batches/:id/personnel     -> staff, authority, admin (read-only)
 *   GET  /batches/:id/rejected      -> staff, authority, admin (read-only)
 *
 * The personnel read endpoint uses an explicit field allow-list covering
 * every proforma column the import step stores (see import.service.js
 * PERSONNEL_COLUMNS); it never exposes unrelated document fields.
 */

const express = require('express');
const { getCollection } = require('../../database');
const { requireAuth, authorize } = require('../../middleware/auth');
const { persistPersonnelImport, patchPersonnelExemption } = require('./import.service');
const {
  replaceMicroObservers,
  replaceTrainingLocations,
  replaceTrainingSessions,
  replaceMandalAdjacency,
  replaceRequirements,
  createTrainingBatches,
  clearTrainingBatches,
  ALLOWED_KINDS,
} = require('./intake.service');
const {
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
} = require('./order-assignment.service');
const { IntakeParseError } = require('./intake');
const { ImportParseError } = require('./excel.parser');
const trainingOrders = require('../training-orders/service');

function collection(name) {
  const result = getCollection(name);
  return result.collection || result;
}

const MAX_FILE_BYTES = 100 * 1024 * 1024; // decoded size cap (~100 MB) for large Excel uploads
const { getSetting } = require('../settings/settings.service');

function assertFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    const err = new Error('Invalid template file');
    err.statusCode = 400;
    throw err;
  }
}

async function maxFileBytes() {
  const mb = await getSetting('uploads.max_file_mb');
  const n = Number(mb);
  if (!Number.isFinite(n) || n <= 0) return MAX_FILE_BYTES;
  return Math.floor(n * 1024 * 1024);
}

const router = express.Router();
router.use(requireAuth);
router.use(express.json({ limit: '20mb' }));
router.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(stringifyResponseIds(body));
  next();
});

function stringifyResponseIds(value, fieldName = '') {
  if (value == null) return value;
  if (/(?:^id$|_id$|Id$|_by$)/.test(fieldName)) return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyResponseIds(item));
  if (value instanceof Date || Buffer.isBuffer(value) || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, stringifyResponseIds(item, key)])
  );
}

router.post('/personnel', authorize('authority', 'admin'), async (req, res) => {
  const { fileName, dataBase64, requestId } = req.body || {};
  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({ ok: false, error: 'fileName is required' });
  }
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    return res.status(400).json({ ok: false, error: 'dataBase64 is required' });
  }

  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length === 0) {
    return res.status(400).json({ ok: false, error: 'Uploaded file is empty' });
  }
  if (buffer.length > await maxFileBytes()) {
    return res.status(413).json({ ok: false, error: 'File too large (max 15 MB)' });
  }

  try {
    const result = await persistPersonnelImport({
      fileName,
      buffer,
      importedBy: req.session.user.id,
      requestId,
    });
    res.json({
      ok: true,
      batch: {
        id: result.batchId,
        totalRows: result.totalRows,
        acceptedRows: result.acceptedRows,
        rejectedRows: result.rejectedRows,
        exemptRows: result.exemptRows,
      },
      rejected: result.rejected,
    });
  } catch (err) {
    if (err instanceof ImportParseError) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (err.statusCode === 400 || err.statusCode === 409) {
      return res.status(err.statusCode).json({ ok: false, error: err.message });
    }
    if (err.statusCode === 503 || err.name === 'MongoNetworkError' ||
        err.name === 'MongoServerSelectionError' || err.name === 'MongoNotConnectedError') {
      console.error('personnel import database unavailable:', err.name, err.message);
      return res.status(503).json({
        ok: false,
        error: 'MongoDB is unavailable. The employee upload did not complete; retry after the database connection is restored.',
      });
    }
    console.error('personnel import failed:', err);
    res.status(500).json({
      ok: false,
      error: 'Employee upload failed. Check the server logs before retrying.',
    });
  }
});

router.get('/batches', authorize('staff', 'authority', 'admin'), async (req, res) => {
  const batches = await collection('import_batches').find({}, {
    projection: {
      _id: 0, id: 1, file_name: 1, department_name: 1, total_rows: 1,
      accepted_rows: 1, rejected_rows: 1, status: 1, imported_at: 1, imported_by: 1,
    },
  }).sort({ id: -1 }).limit(50).toArray();
  const userIds = [...new Set(batches.map((batch) => batch.imported_by).filter((id) => id != null))];
  const users = userIds.length
    ? await collection('users').find({ id: { $in: userIds } }, {
      projection: { _id: 0, id: 1, username: 1 },
    }).toArray()
    : [];
  const usernames = new Map(users.map((user) => [user.id, user.username]));
  res.json({
    ok: true,
    batches: batches.map(({ imported_by, ...batch }) => ({
      ...batch,
      imported_by: usernames.get(imported_by) || null,
    })),
  });
});

// Personnel accepted in a single import batch (review-before-use).
// Returns the FULL accepted row (all proforma columns) so Phase 1 can render
// the total uploaded data. Field projection is explicit and matches the
// columns the import step writes.
// 404 on an unknown batch; invalid ids -> 400.
router.get('/batches/:id/personnel', authorize('staff', 'authority', 'admin'), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid batch id' });
  }

  try {
    const batch = await collection('import_batches').findOne(
      { id },
      { projection: { _id: 0, id: 1, file_name: 1, department_name: 1, total_rows: 1, accepted_rows: 1, status: 1, imported_at: 1 } }
    );
    if (!batch) {
      return res.status(404).json({ ok: false, error: 'Import batch not found' });
    }

    // Full data: every proforma column stored at import time, no row cap, so
    // Phase 1 shows the same total data that is present in the database.
    // Includes voter_id (Elector ID), aadhar_number, and mobile_no so the
    // Phase 1 frontend renders complete employee identity records.
    const fields = [
      'id', 'import_batch_id', 'import_status', 'district', 'exempt_category',
      'sl_no', 'employee_id', 'employee_name', 'designation', 'gender', 'age',
      'aadhar_number', 'mobile_no', 'voter_id', 'languages_known', 'employment_sector',
      'scale_of_pay', 'basic_pay', 'gazetted_status', 'date_of_birth',
      'date_of_retirement', 'employment_type', 'enrolled_assembly_constituency',
      'part_no_vote_sl_no', 'residence_address', 'residence_constituency_code',
      'residence_constituency_name', 'work_mandal', 'working_constituency_code',
      'working_constituency_name', 'native_mandal', 'native_constituency_code',
      'native_constituency_name', 'previous_po_duty', 'service_in_district_4y',
      'ph_category', 'criminal_case_or_eci_orders', 'exceeded_3_years',
      'eci_ceo_order_details', 'remarks',
    ];
    const personnelRows = await collection('personnel').find(
      { import_batch_id: id },
      { projection: Object.fromEntries([...fields.map((field) => [field, 1]), ['_id', 0]]) }
    ).sort({ id: 1 }).toArray();

    const personnel = personnelRows.map((r) => ({
      id: r.id,
      importBatchId: r.import_batch_id,
      importStatus: r.import_status,
      district: r.district,
      exemptCategory: r.exempt_category,
      slNo: r.sl_no,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      designation: r.designation,
      gender: r.gender,
      age: r.age,
      aadharNumber: r.aadhar_number,
      mobileNo: r.mobile_no,
      voterId: r.voter_id || '—',
      languagesKnown: r.languages_known,
      employmentSector: r.employment_sector,
      scaleOfPay: r.scale_of_pay,
      basicPay: r.basic_pay,
      gazettedStatus: r.gazetted_status,
      dateOfBirth: r.date_of_birth,
      dateOfRetirement: r.date_of_retirement,
      employmentType: r.employment_type,
      enrolledAssemblyConstituency: r.enrolled_assembly_constituency,
      partNoVoteSlNo: r.part_no_vote_sl_no,
      residenceAddress: r.residence_address,
      residenceConstituencyCode: r.residence_constituency_code,
      residenceConstituencyName: r.residence_constituency_name,
      workMandal: r.work_mandal,
      workingConstituencyCode: r.working_constituency_code,
      workingConstituencyName: r.working_constituency_name,
      nativeMandal: r.native_mandal,
      nativeConstituencyCode: r.native_constituency_code,
      nativeConstituencyName: r.native_constituency_name,
      previousPoDuty: r.previous_po_duty,
      serviceInDistrict4y: r.service_in_district_4y,
      phCategory: r.ph_category,
      criminalCaseOrEciOrders: r.criminal_case_or_eci_orders,
      exceeded3Years: r.exceeded_3_years,
      eciCeoOrderDetails: r.eci_ceo_order_details,
      remarks: r.remarks,
    }));

    res.json({ ok: true, batch, count: personnel.length, personnel });
  } catch (err) {
    console.error('list batch personnel failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load personnel' });
  }
});


// ---- Training: PO / APO separate roster tables (work_mandal based) ----

const { buildTrainingBatches } = require('../training/po_apo.allocator');

router.get('/training/po-apo-batches', authorize('authority', 'admin'), async (req, res) => {
  try {
    // Stage 2 output (PO + APO) with work_mandal per member, joined by teamCode.
    // In production this would read the durable Stage 2 tables; for now we
    // return the latest in-memory run's parties.
    const run = require('../../randomization/allocation-store').getLastRun();
    const parties = (run && run.stage2 && run.stage2.parties) || [];

    // Optional venue override: map work_mandal -> venue (from authoritative source).
    const venueMap = req.query.venueMap
      ? JSON.parse(String(req.query.venueMap))
      : {};

    const { poBatches, apoBatches } = buildTrainingBatches(parties, venueMap);

    res.json({ ok: true, poBatches, apoBatches });
  } catch (err) {
    console.error('list training po/apo batches failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to list training batches' });
  }
});

// Rejected rows stored for one batch (import_status='rejected' semantics).
// Returns { ok, batch, count, rejected: [{ sheetRow, employeeId, reasons,
// rawValues }] } straight from import_rejected_rows — no local fallback.
router.get(
  '/batches/:id/rejected',
  authorize('staff', 'authority', 'admin'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid batch id' });
    }
    try {
      const batch = await collection('import_batches').findOne(
        { id },
        { projection: { _id: 0 } }
      );
      if (!batch) {
        return res.status(404).json({ ok: false, error: 'Batch not found' });
      }
      const rejectedRows = await collection('import_rejected_rows').find(
        { import_batch_id: id },
        { projection: { _id: 0, id: 1, sheet_row: 1, employee_id: 1, reasons: 1, raw_values: 1 } }
      ).toArray();
      rejectedRows.sort((left, right) => {
        if (left.sheet_row == null && right.sheet_row != null) return 1;
        if (left.sheet_row != null && right.sheet_row == null) return -1;
        return (left.sheet_row ?? 0) - (right.sheet_row ?? 0) || left.id - right.id;
      });
      const rejected = rejectedRows.map((r) => ({
        sheetRow: r.sheet_row,
        employeeId: r.employee_id,
        reasons: r.reasons || [],
        rawValues: r.raw_values || {},
        importStatus: 'rejected',
      }));
      res.json({ ok: true, batch, count: rejected.length, rejected });
    } catch (err) {
      console.error('list batch rejected rows failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to load rejected rows' });
    }
  }
);

// Personal exemption workflow (circular p.61(a)(viii) + p.61(a)(vii) bank).
// Marker is updated only; the response never exposes medical status.
// Personnel edit (admin correction after import):
//   PATCH /personnel/:id   { ...allow-listed fields }
// Only identity-safe editable columns are written (see personnel-edit.service
// EDITABLE); identity / import-control / sensitive columns are ignored.
router.patch('/personnel/:id', authorize('authority', 'admin'), async (req, res) => {
  try {
    const { editPersonnel } = require('./personnel-edit.service');
    const result = await editPersonnel({ id: req.params.id, fields: req.body || {} });
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('edit personnel failed:', err);
    res.status(status).json({ ok: false, error: err.message || 'Failed to update personnel' });
  }
});
router.patch(
  '/batches/:batchId/personnel/:id/exemption',
  authorize('authority', 'admin'),
  async (req, res) => {
    const id = Number(req.params.id);
    try {
      const result = await patchPersonnelExemption({
        id,
        exemptCategory: req.body?.exemptCategory,
        note: (req.body && req.body.note) || '',
        req,
      });
      res.json({ ok: true, id: result.id });
    } catch (err) {
      console.error('patch personnel exemption failed:', err.message);
      const status = err.message === 'personnel not found' ? 404
        : err.message === 'unauthorized category' ? 400
        : err.message === 'invalid personnel id' ? 400
        : err.message === 'note must be a string up to 400 characters' ? 400
        : 400;
      res.status(status).json({ ok: false, error: err.message });
    }
  }
);

// ---------------------------------------------------------------------------
// Read endpoints for the Phase-1 intake lists (frontend tables + edit screens).
// ---------------------------------------------------------------------------
router.get('/micro-observers', authorize('staff', 'authority', 'admin'), async (_req, res) => {
  try {
    const rows = await collection('micro_observers').find({}, { projection: { _id: 0 } })
      .sort({ id: 1 }).limit(5000).toArray();
    res.json({ ok: true, count: rows.length, microObservers: rows });
  } catch (err) {
    console.error('list micro observers failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load micro observers' });
  }
});

router.get('/training-locations', authorize('staff', 'authority', 'admin'), async (_req, res) => {
  try {
    const rows = await collection('training_locations').find({}, { projection: { _id: 0 } })
      .sort({ mandal: 1, location_name: 1 }).limit(5000).toArray();
    res.json({ ok: true, count: rows.length, locations: rows });
  } catch (err) {
    console.error('list training locations failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load training locations' });
  }
});

router.get('/mandal-adjacency', authorize('staff', 'authority', 'admin'), async (_req, res) => {
  try {
    const rows = await collection('mandal_adjacency').find({}, {
      projection: { _id: 0, id: 1, mandal_name: 1, near_mandal_names: 1, updated_at: 1 },
    }).sort({ mandal_name: 1 }).limit(2000).toArray();
    res.json({ ok: true, count: rows.length, adjacency: rows });
  } catch (err) {
    console.error('list mandal adjacency failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load mandal adjacency' });
  }
});

router.get('/requirements', authorize('staff', 'authority', 'admin'), async (_req, res) => {
  try {
    const rows = await collection('election_requirements').find({}, { projection: { _id: 0 } })
      .sort({ mandal: 1 }).limit(500).toArray();
    res.json({ ok: true, count: rows.length, requirements: rows });
  } catch (err) {
    console.error('list requirements failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load requirements' });
  }
});

// Batches with members (officer details + location + env date/time shown by
// the frontend Training page). Join keeps the response one query.
router.get('/training-batches', authorize('staff', 'authority', 'admin'), async (_req, res) => {
  try {
    const [batchRows, memberRows] = await Promise.all([
      collection('training_batches').find({}, {
        projection: { _id: 0, id: 1, batch_no: 1, mandal: 1, location_id: 1 },
      }).sort({ mandal: 1, batch_no: 1 }).toArray(),
      collection('training_batch_members').find({}, {
        projection: { _id: 0, batch_id: 1, personnel_id: 1, added_by_code: 1 },
      }).toArray(),
    ]);
    const locationIds = [...new Set(batchRows.map((row) => row.location_id).filter((id) => id != null))];
    const locations = locationIds.length
      ? await collection('training_locations').find({ id: { $in: locationIds } }, {
        projection: { _id: 0, id: 1, location_name: 1, panchayat: 1, category: 1 },
      }).toArray()
      : [];
    const personnelIds = [...new Set(memberRows.map((row) => row.personnel_id))];
    const personnelRows = personnelIds.length
      ? await collection('personnel').find({ id: { $in: personnelIds } }, {
        projection: { _id: 0, id: 1, employee_id: 1, employee_name: 1, designation: 1, mobile_no: 1, work_mandal: 1 },
      }).sort({ employee_name: 1 }).toArray()
      : [];
    const locationsById = new Map(locations.map((location) => [location.id, location]));
    const personnelById = new Map(personnelRows.map((person) => [person.id, person]));
    const byBatch = new Map();
    for (const member of memberRows) {
      const person = personnelById.get(member.personnel_id);
      if (!person) continue;
      const row = {
        batch_id: member.batch_id,
        personnel_id: member.personnel_id,
        added_by_code: member.added_by_code,
        employee_id: person.employee_id,
        employee_name: person.employee_name,
        designation: person.designation,
        mobile_no: person.mobile_no,
        work_mandal: person.work_mandal,
      };
      if (!byBatch.has(member.batch_id)) byBatch.set(member.batch_id, []);
      byBatch.get(member.batch_id).push(row);
    }
    const batches = batchRows.map((batch) => {
      const location = locationsById.get(batch.location_id);
      return {
        ...batch,
        ...(location ? {
          location_name: location.location_name,
          panchayat: location.panchayat,
          category: location.category,
        } : { location_name: null, panchayat: null, category: null }),
        members: byBatch.get(batch.id) || [],
      };
    });
    res.json({ ok: true, count: batches.length, batches });
  } catch (err) {
    console.error('list training batches failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load training batches' });
  }
});

// ---------------------------------------------------------------------------
// Phase-1 intake hub: Micro Observers / training locations / requirements.
// Same upload format as personnel: { fileName, dataBase64 }.
// Upload REPLACES the whole table (corrected file supersedes old one);
// rejected rows returned with reasons (not stored for these lists).
// ---------------------------------------------------------------------------
async function handleIntake(req, res, fn) {
  const { fileName, dataBase64 } = req.body || {};
  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({ ok: false, error: 'fileName is required' });
  }
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    return res.status(400).json({ ok: false, error: 'dataBase64 is required' });
  }
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length === 0) {
    return res.status(400).json({ ok: false, error: 'Uploaded file is empty' });
  }
  if (buffer.length > await maxFileBytes()) {
    return res.status(413).json({ ok: false, error: 'File too large (max 15 MB)' });
  }
  try {
    const result = await fn(buffer);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof IntakeParseError) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (err && err.statusCode === 409) {
      return res.status(409).json({ ok: false, error: err.message });
    }
    console.error('intake import failed:', err);
    res.status(500).json({ ok: false, error: 'Import failed' });
  }
}

router.post(
  '/micro-observers',
  authorize('authority', 'admin'),
  (req, res) => handleIntake(req, res, (buffer) => replaceMicroObservers({ buffer }))
);

router.post(
  '/training-locations',
  authorize('authority', 'admin'),
  (req, res) => handleIntake(req, res, (buffer) => replaceTrainingLocations({ buffer }))
);

router.post(
  '/training-sessions',
  authorize('authority', 'admin'),
  (req, res) =>
    handleIntake(req, res, (buffer) => replaceTrainingSessions({ buffer, createdBy: req.session.user.id }))
);

router.post(
  '/mandal-adjacency',
  authorize('authority', 'admin'),
  (req, res) => handleIntake(req, res, (buffer) => replaceMandalAdjacency({ buffer }))
);

// Training orders (PO/APO/OPO separate tables).
router.post(
  '/requirements',
  authorize('authority', 'admin'),
  (req, res) => handleIntake(req, res, (buffer) => replaceRequirements({ buffer }))
);

// Training orders (PO/APO/OPO separate tables).
router.post(
  '/training-orders/allocate',
  authorize('authority', 'admin'),
  (req, res) => trainingOrders.allocate(req, res),
);
router.post(
  '/training-orders/wipe-all-data',
  authorize('authority', 'admin'),
  (req, res) => trainingOrders.wipeAllData(req, res),
);
router.post(
  '/training-orders/generate',
  authorize('authority', 'admin'),
  (req, res) => trainingOrders.generate(req, res),
);
// Legacy alias: print → generate (built-in templates; no upload).
router.post(
  '/training-orders/print',
  authorize('authority', 'admin'),
  (req, res) => trainingOrders.generate(req, res),
);
router.get(
  '/training-orders',
  authorize('authority', 'admin'),
  (req, res) => trainingOrders.list(req, res),
);
router.get(
  '/training-orders/batches',
  authorize('staff', 'authority', 'admin'),
  (req, res) => trainingOrders.batches(req, res),
);
router.get(
  '/training-orders/batches/:id/members',
  authorize('staff', 'authority', 'admin'),
  (req, res) => trainingOrders.members(req, res),
);
router.get(
  '/training-orders/batches/:id/locations',
  authorize('staff', 'authority', 'admin'),
  (req, res) => trainingOrders.locations(req, res),
);
router.patch(
  '/training-orders/batches/:id/location',
  authorize('authority', 'admin'),
  (req, res) => trainingOrders.setLocation(req, res),
);
router.get(
  '/training-orders/download-zip',
  authorize('authority', 'admin'),
  (req, res) => trainingOrders.downloadZip(req, res),
);
router.get(
  '/training-orders/:group/:id/download',
  authorize('authority', 'admin'),
  (req, res) => trainingOrders.downloadOne(req, res),
);

router.post(
  '/training-batches/create',
  authorize('authority', 'admin'),
  async (req, res) => {
    try {
      const result = await createTrainingBatches({ createdBy: req.session.user.id });
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err && err.statusCode === 409) {
        return res.status(409).json({ ok: false, error: err.message });
      }
      console.error('create training batches failed:', err);
      res.status(500).json({ ok: false, error: 'Batch creation failed' });
    }
  }
);

router.delete(
  '/training-batches',
  authorize('authority', 'admin'),
  async (_req, res) => {
    try {
      const result = await clearTrainingBatches();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('clear training batches failed:', err);
      res.status(500).json({ ok: false, error: 'Clear failed' });
    }
  }
);

// ---------------------------------------------------------------------------
// Order templates / ID card design / order configuration manager.
// All editable in the frontend template page (partner Q3).
// ---------------------------------------------------------------------------
router.post(
  '/templates',
  authorize('authority', 'admin'),
  async (req, res) => {
    try {
      const { kind, display_name, file_name, dataBase64 } = req.body || {};
      if (!kind || !ALLOWED_KINDS.includes(kind)) {
        return res.status(400).json({ ok: false, error: 'kind is required (' + ALLOWED_KINDS.join(', ') + ')' });
      }
      if (!file_name || typeof file_name !== 'string') {
        return res.status(400).json({ ok: false, error: 'file_name is required' });
      }
      if (!dataBase64 || typeof dataBase64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'dataBase64 is required' });
      }
      const buffer = Buffer.from(dataBase64, 'base64');
      if (buffer.length === 0 || buffer.length > await maxFileBytes()) {
        const capMb = Number(await getSetting('uploads.max_file_mb')) || 100;
        return res.status(400).json({ ok: false, error: 'Invalid file size (0..' + capMb + 'MB)' });
      }
      assertFile(buffer);
      const { upsertOrderTemplate } = require('./intake.service');
      const result = await upsertOrderTemplate({
        kind,
        display_name,
        file: buffer,
        file_name,
        uploadedBy: req.session.user.id,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err.statusCode === 400 || err.message === 'unknown template kind') {
        return res.status(400).json({ ok: false, error: err.message });
      }
      console.error('template upload failed:', err);
      res.status(500).json({ ok: false, error: 'Template upload failed' });
    }
  }
);

router.get('/templates', authorize('staff', 'authority', 'admin'), async (_req, res) => {
  try {
    const { getOrderTemplates } = require('./intake.service');
    const { templates } = await getOrderTemplates();
    res.json({ ok: true, templates });
  } catch (err) {
    console.error('list templates failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load templates' });
  }
});

router.get(
  '/templates/:kind',
  authorize('staff', 'authority', 'admin'),
  async (req, res) => {
    try {
      const { kind } = req.params;
      const { getOrderTemplate } = require('./intake.service');
      const file = await getOrderTemplate(kind);
      if (!file) return res.status(404).json({ ok: false, error: 'template not found' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.buffer);
    } catch (err) {
      console.error('get template failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to load template' });
    }
  }
);

router.get(
  '/order-config',
  authorize('staff', 'authority', 'admin'),
  async (_req, res) => {
    try {
      const { getOrderConfig } = require('./intake.service');
      const { config } = await getOrderConfig();
      res.json({ ok: true, config });
    } catch (err) {
      console.error('order config failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to load order config' });
    }
  }
);

router.put(
  '/order-config',
  authorize('authority', 'admin'),
  async (req, res) => {
    try {
      const config = req.body || {};
      const { upsertOrderConfig } = require('./intake.service');
      await upsertOrderConfig({ config, updatedBy: req.session.user.id });
      res.json({ ok: true });
    } catch (err) {
      console.error('order config update failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to save order config' });
    }
  }
);

router.post(
  '/idcard-design',
  authorize('authority', 'admin'),
  async (req, res) => {
    try {
      const { design } = req.body || {};
      if (!design || typeof design !== 'object') {
        return res.status(400).json({ ok: false, error: 'design object required' });
      }
      const { upsertIdCardDesign } = require('./intake.service');
      await upsertIdCardDesign({
        design,
        updatedBy: req.session.user.id,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('idcard design failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to save idcard design' });
    }
  }
);

router.get(
  '/idcard-design',
  authorize('staff', 'authority', 'admin'),
  async (_req, res) => {
    try {
      const { getOrderTemplates } = require('./intake.service');
      // Design lives in its own table; placeholder object until designer route.
      res.json({ ok: true, design: {} });
    } catch (err) {
      console.error('idcard design load failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to load idcard design' });
    }
  }
);

// ---------------------------------------------------------------------------
// Manual appointments (order_assignments) — Stage Officer II / counting team.
// NOT produced by randomization; an admin picks personnel by hand. The server
// validates shape + existence and persists; it never invents a person/role.
//   GET    /order-assignments[?orderKind=stage_officer_ii|counting_team]
//   POST   /order-assignments          (authority, admin)
//   PATCH  /order-assignments/:id      (authority, admin)
//   DELETE /order-assignments/:id      (authority, admin)
// ---------------------------------------------------------------------------
router.get('/order-assignments', authorize('staff', 'authority', 'admin'), async (req, res) => {
  try {
    const rows = await listAssignments({ orderKind: req.query.orderKind });
    res.json({ ok: true, count: rows.length, assignments: rows });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('list order assignments failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load appointments' });
  }
});

router.post('/order-assignments', authorize('authority', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const created = await createAssignment({
      orderKind: body.orderKind,
      personnelId: body.personnelId,
      role: body.role,
      teamNo: body.teamNo,
      tableNo: body.tableNo,
      bodyName: body.bodyName,
      createdBy: req.session.user.id,
    });
    res.status(201).json({ ok: true, assignment: created });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('create order assignment failed:', err);
    res.status(status).json({ ok: false, error: err.message || 'Failed to create appointment' });
  }
});

router.patch('/order-assignments/:id', authorize('authority', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const updated = await updateAssignment({
      id: req.params.id,
      role: body.role,
      teamNo: body.teamNo,
      tableNo: body.tableNo,
      bodyName: body.bodyName,
      personnelId: body.personnelId,
    });
    res.json({ ok: true, assignment: updated });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('update order assignment failed:', err);
    res.status(status).json({ ok: false, error: err.message || 'Failed to update appointment' });
  }
});

router.delete('/order-assignments/:id', authorize('authority', 'admin'), async (req, res) => {
  try {
    const result = await deleteAssignment({ id: req.params.id });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('delete order assignment failed:', err);
    res.status(status).json({ ok: false, error: err.message || 'Failed to delete appointment' });
  }
});

// ---------------------------------------------------------------------------
// Order generation (order-merge engine).
//   POST /order-assignments/:id/generate            -> generate .docx (metadata)
// Templates come from order_templates; metadata from order_config. The merged
// .docx bytes are returned base64 so the caller can download them. Fails
// closed when no template exists (never a fake success).
// ---------------------------------------------------------------------------
router.post(
  '/order-assignments/:id/generate',
  authorize('authority', 'admin'),
  async (req, res) => {
    try {
      const { generateOrder } = require('./order-generation.service');
      const result = await generateOrder({
        assignmentId: req.params.id,
        actorId: req.session.user.id,
      });
      res.json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      if (status >= 500) console.error('generate order failed:', err);
      res.status(status).json({ ok: false, error: err.message || 'Failed to generate order' });
    }
  }
);

module.exports = router;

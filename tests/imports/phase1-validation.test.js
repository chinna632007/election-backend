'use strict';

/**
 * tests/imports/phase1-validation.test.js
 *
 * Integration tests for the Stage 1 Employee Validation pipeline:
 *   parseProformaWorkbook -> validateRows -> batch summary + rejected rows.
 *
 * This proves that records that fail the eligibility rules are REJECTED
 * (not silently approved) and that the batch summary + import_rejected_rows
 * reflect exactly which rows were rejected, so Phase 1 never silently keeps
 * invalid data.
 *
 * Native Mongo collections and transaction sessions are stubbed so no live
 * database is touched.
 *
 * Run: node --test tests/imports/phase1-validation.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const { parseProformaWorkbook } = require('../../src/modules/imports/excel.parser');
const { validateRows } = require('../../src/modules/imports/validation');
const { createMongoStub, installMongoStub } = require('./mongo-stub');

let failNextPersonnelInsert = false;
const mongo = createMongoStub({
  seed: {
    import_batches: [],
    personnel: [],
    import_rejected_rows: [],
    counters: [],
  },
  onOperation({ collection, method }) {
    if (failNextPersonnelInsert && collection === 'personnel' && method === 'insertMany') {
      failNextPersonnelInsert = false;
      throw new Error('simulated MongoDB write failure');
    }
  },
});
const restoreMongo = installMongoStub(mongo);
const { persistPersonnelImport } = require('../../src/modules/imports/import.service');

function reset() {
  mongo.data.import_batches.splice(0);
  mongo.data.personnel.splice(0);
  mongo.data.import_rejected_rows.splice(0);
  mongo.data.counters.splice(0);
}

// Reusable proforma buffer: 7 data rows, 1 valid + 6 that must be rejected.
// Row roles:
//   1) EMP001 - valid (over 18, name+id present, unique)
//   2) EMP002 - under 18 by date_of_birth
//   3) EMP003 - under 18 via the Age column
//   4) EMP004 - missing employee_name
//   5) EMP005 - missing employee_id
//   6) EMP006 - unparseable date_of_birth
//   7) EMP001 - duplicate employee_id (later row)
function buildWorkbook() {
  const headers = [
    'Sl. No.', 'Employee ID No.', 'Employee Name', 'Designation', 'Gender (M/F)', 'Age',
    'Aadhar Number', 'Languages Known', 'Central/ State/ PSU / Private/ Others', 'Scale of Pay',
    'Basic Pay', 'Gazetted/ Non-Gazetted', 'Date of Birth (dd.mm.yyyy)', 'Date of Retirement (dd.mm.yyyy)',
    'Type Of Employment (Regular/ Out-sourcing / Contract basis)', 'Assembly Constituency Where He/she Enrolled the Name',
    'Part No. /Vote Sl. No.', 'Voter ID (EPIC Number)', 'Residence Address', 'Residence Constituency Code',
    'Residency Constituency Name', 'Work Mandal', 'Working Constituency Code', 'Working Constituency Name',
    'Native Mandal', 'Native Constituency Code', 'Native Constituency Name',
    'Previous Worked as PO/ APO/ OPO', 'Mobile No.', 'Total Service in Present District from Last 4 Years ( In all Cadres)',
    'Whether He/she belongs  PH category (PH-%)', 'Whether any Criminal Cases Pending? Or If there are any Orders from ECI/ CEO against the Person that not  Participate In Election',
    'Whether exceeded 3 Years (Yes/No)', 'If there are any order from ECI/ CEO against the Person that not to Participate In Election? (Yes/No) If So, Details of Order No.',
    'Remarks',
  ];
  const numberingRow = headers.map((_, i) => i + 1);
  const grid = [
    ['Statement showing the particulars of the Employees working in  R&B  Department'],
    ['Dept. Code as per GAD', '25'],
    [],
    ['DDO Code', '28'],
    headers,
    numberingRow,
    ['1', 'EMP001', 'Alpha', 'Assistant Engineer', 'M', '', '', '', '', '', '', '', '01.01.1980', '', 'Regular', '', '', '', '', '', '', '', '', '', '', 'No', '9876543210', '4 yrs', 'No', 'None', 'No', ''],
    ['2', 'EMP002', 'Beta', 'Assistant Engineer', 'F', '', '', '', '', '', '', '', '01.01.2012', '', 'Regular', '', '', '', '', '', '', '', '', '', '', 'No', '9876543211', '4 yrs', 'No', 'None', 'No', ''],
    ['3', 'EMP003', 'Gamma', 'Assistant Engineer', 'F', '15', '', '', '', '', '', '', '', '', 'Regular', '', '', '', '', '', '', '', '', '', '', 'No', '9876543212', '4 yrs', 'No', 'None', 'No', ''],
    ['4', 'EMP004', '', 'Assistant Engineer', 'F', '', '', '', '', '', '', '', '01.01.1980', '', 'Regular', '', '', '', '', '', '', '', '', '', '', 'No', '9876543213', '4 yrs', 'No', 'None', 'No', ''],
    ['5', '', 'Delta', 'Assistant Engineer', 'F', '', '', '', '', '', '', '', '01.01.1980', '', 'Regular', '', '', '', '', '', '', '', '', '', '', 'No', '9876543214', '4 yrs', 'No', 'None', 'No', ''],
    ['6', 'EMP006', 'Epsilon', 'Assistant Engineer', 'F', '', '', '', '', '', '', '', 'not-a-date', '', 'Regular', '', '', '', '', '', '', '', '', '', '', 'No', '9876543215', '4 yrs', 'No', 'None', 'No', ''],
    ['7', 'EMP001', 'Zeta', 'Assistant Engineer', 'F', '', '', '', '', '', '', '', '01.01.1980', '', 'Regular', '', '', '', '', '', '', '', '', '', '', 'No', '9876543216', '4 yrs', 'No', 'None', 'No', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(grid);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const buffer = buildWorkbook();

test('phase-1: parses the proforma into 7 rows', () => {
  const { sheetInfo, rows } = parseProformaWorkbook(buffer);
  assert.equal(sheetInfo.departmentName, 'R&B');
  assert.equal(rows.length, 7);
});

test('phase-1: validateRows rejects every invalid row and accepts the valid one', () => {
  const { accepted, rejected } = validateRows([]);
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);

  const rows = (overrides) => [{ sheetRow: overrides.sheetRow, values: { sl_no: overrides.sheetRow - 6, ...overrides } }];

  const { accepted: a, rejected: r } = validateRows([
    ...rows({ sheetRow: 7, employee_id: 'EMP002', employee_name: 'Beta', date_of_birth: '01.01.2012' }),
    ...rows({ sheetRow: 8, employee_id: 'EMP003', employee_name: 'Gamma', age: '15' }),
    ...rows({ sheetRow: 9, employee_id: 'EMP004', employee_name: '', date_of_birth: '01.01.1980' }),
    ...rows({ sheetRow: 10, employee_id: '', employee_name: 'Delta', date_of_birth: '01.01.1980' }),
    ...rows({ sheetRow: 11, employee_id: 'EMP006', employee_name: 'Epsilon', date_of_birth: 'not-a-date' }),
    ...rows({ sheetRow: 12, employee_id: 'EMP001', employee_name: 'Zeta', date_of_birth: '01.01.1980' }),
    ...rows({ sheetRow: 13, employee_id: 'EMP001', employee_name: 'Dup', date_of_birth: '01.01.1980' }),
  ]);

  // Only the valid row (EMP001 at sheetRow 12) is accepted; the other 6 are rejected.
  assert.equal(a.length, 1);
  assert.equal(r.length, 6);

  const byId = (id) => r.find((x) => x.employeeId === id);
  const byIdOrNull = (id) => r.find((x) => x.employeeId === null && x.reasons.includes('employee_id_required'));

  assert.ok(byId('EMP002'), 'EMP002 under-18 by DOB must be rejected');
  assert.ok(byId('EMP002').reasons.includes('below_minimum_age'));

  assert.ok(byId('EMP003'), 'EMP003 under-18 by Age col must be rejected');
  assert.ok(byId('EMP003').reasons.includes('below_minimum_age'));

  assert.ok(byId('EMP004'), 'EMP004 missing name must be rejected');
  assert.ok(byId('EMP004').reasons.includes('employee_name_required'));

  assert.ok(byIdOrNull('EMP005'), 'EMP005 missing employee_id must be rejected');
  assert.ok(byIdOrNull('EMP005').reasons.includes('employee_id_required'));

  assert.ok(byId('EMP006'), 'EMP006 bad date must be rejected');
  assert.ok(byId('EMP006').reasons.includes('date_of_birth_unparseable'));

  const duplicate = r.find((x) => x.reasons.includes('duplicate_employee_id_in_file'));
  assert.ok(duplicate, 'duplicate employee_id (later row) must be rejected');
});

test('phase-1: persistPersonnelImport stores rejected rows and reports the summary', async () => {
  reset();
  const result = await persistPersonnelImport({
    fileName: 'proforma.xlsx',
    buffer,
    importedBy: 1,
  });
  assert.equal(result.batchId, 1);
  assert.equal(result.totalRows, 7);
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.rejectedRows, 6);

  const lastBatch = mongo.data.import_batches[0];
  assert.equal(lastBatch.accepted_rows, 1);
  assert.equal(lastBatch.rejected_rows, 6);

  const ids = mongo.data.import_rejected_rows.map((x) => x.employee_id);
  assert.ok(ids.includes('EMP002'), 'EMP002 under-18 must be rejected');
  assert.ok(ids.includes('EMP003'), 'EMP003 under-18 via Age must be rejected');
  assert.ok(ids.includes('EMP004'), 'EMP004 missing name must be rejected');
  assert.ok(ids.includes('EMP006'), 'EMP006 bad date must be rejected');
  assert.equal(mongo.data.import_rejected_rows.length, 6);
  assert.equal(mongo.data.personnel.length, 1);
  assert.equal(lastBatch.status, 'completed');
});

test('phase-1: retrying the same upload request returns the saved batch without duplicates', async () => {
  reset();
  const first = await persistPersonnelImport({
    fileName: 'proforma.xlsx',
    buffer,
    importedBy: 1,
    requestId: 'phase1-upload-retry-001',
  });
  const countsAfterFirst = {
    batches: mongo.data.import_batches.length,
    personnel: mongo.data.personnel.length,
    rejected: mongo.data.import_rejected_rows.length,
  };
  const retried = await persistPersonnelImport({
    fileName: 'proforma.xlsx',
    buffer,
    importedBy: 1,
    requestId: 'phase1-upload-retry-001',
  });

  assert.equal(retried.batchId, first.batchId);
  assert.equal(retried.totalRows, first.totalRows);
  assert.deepEqual(retried.rejected, first.rejected);
  assert.deepEqual({
    batches: mongo.data.import_batches.length,
    personnel: mongo.data.personnel.length,
    rejected: mongo.data.import_rejected_rows.length,
  }, countsAfterFirst);
});

test('phase-1: failed Mongo writes are compensated and the same request can retry', async () => {
  reset();
  failNextPersonnelInsert = true;
  const request = {
    fileName: 'proforma.xlsx',
    buffer,
    importedBy: 1,
    requestId: 'phase1-upload-failure-001',
  };

  await assert.rejects(() => persistPersonnelImport(request), /simulated MongoDB write failure/);
  assert.equal(mongo.data.import_batches.length, 0);
  assert.equal(mongo.data.personnel.length, 0);
  assert.equal(mongo.data.import_rejected_rows.length, 0);

  const retried = await persistPersonnelImport(request);
  assert.equal(retried.batchId, 2);
  assert.equal(mongo.data.import_batches.length, 1);
  assert.equal(mongo.data.personnel.length, 1);
  assert.equal(mongo.data.import_rejected_rows.length, 6);
});

test.after(restoreMongo);

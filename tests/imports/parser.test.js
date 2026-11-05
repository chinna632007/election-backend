'use strict';

const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');

const { parseProformaWorkbook, ImportParseError } = require('../../src/modules/imports/excel.parser');
const { parseTrainingLocations, IntakeParseError } = require('../../src/modules/imports/intake');

function buildIntakeWorkbook(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Training Places');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Build a proforma-like workbook in memory (title rows + header + rows). */
function buildWorkbook(dataRows) {
  const headers = [
    'Sl. No.', 'Employee ID No.', 'Employee Name ', 'Designation ', 'Gender (M/F)', 'Age',
    'Aadhar Number', 'Languages Known', 'Central/ State/ PSU / Private/ Others',
    'Scale of Pay', 'Basic Pay ', 'Gazetted/ \r\nNon-Gazetted',
    'Date of Birth (dd.mm.yyyy) ', 'Date of Retirement (dd.mm.yyyy) ',
    'Type Of Employment\r\n(Regular/ Out-sourcing / Contract basis)',
    'Assembly Constituency Where He/she Enrolled the Name', 'Part No. /Vote Sl. No.',
    'Voter ID (EPIC Number)', 'Residence Address', 'Residence Constituency Code',
    'Residency Constituency Name ', 'Work Mandal', 'Working Constituency Code',
    'Working Constituency Name', 'Native Mandal', 'Native Constituency Code',
    'Native Constituency Name', 'Previous Worked as PO/ APO/ OPO', 'Mobile No.',
    'Total Service in Present District from Last 4 Years ( In all Cadres)',
    'Whether He/she belongs  PH category (PH-%)',
    'Whether any Criminal Cases Pending? Or If there are any Orders from ECI/ CEO against the Person that not  Participate In Election',
    'Whether exceeded 3 Years (Yes/No)',
    'If there are any order from ECI/ CEO against the Person that not to Participate In Election? (Yes/No) If So, Details of Order No.',
    'Remarks',
  ];
  const numberingRow = headers.map((_, i) => i + 1);
  const grid = [
    ['Statement showing the particulars of the Employees working in  R&B  Department'],
    ['Dept. Code as per GAD _________________________________', '25'],
    [],
    ['DDO Code ____________________________________', '28'],
    headers,
    numberingRow,
    ...dataRows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(grid);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function emptyRow() {
  return new Array(35).fill('');
}

function makeRow(overrides) {
  const row = emptyRow();
  const index = {
    sl_no: 0, employee_id: 1, employee_name: 2, designation: 3, gender: 4, age: 5,
    aadhar_number: 6, date_of_birth: 12, date_of_retirement: 13, work_mandal: 21,
  };
  for (const [key, value] of Object.entries(overrides)) {
    row[index[key]] = value;
  }
  return row;
}

test('parses data rows and maps columns by header text', () => {
  const buffer = buildWorkbook([
    makeRow({ employee_id: 'EMP001', employee_name: 'Alpha', work_mandal: 'Kakinada', date_of_birth: '01.02.1980' }),
  ]);
  const { sheetInfo, rows } = parseProformaWorkbook(buffer);

  assert.strictEqual(sheetInfo.departmentName, 'R&B');
  assert.strictEqual(sheetInfo.gadDepartmentCode, '25');
  assert.strictEqual(sheetInfo.ddoCode, '28');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].values.employee_id, 'EMP001');
  assert.strictEqual(rows[0].values.employee_name, 'Alpha');
  assert.strictEqual(rows[0].values.work_mandal, 'Kakinada');
  assert.strictEqual(rows[0].values.date_of_birth, '01.02.1980');
});

test('skips the column-numbering row and blank rows', () => {
  const buffer = buildWorkbook([
    makeRow({ employee_id: 'EMP001', employee_name: 'Alpha' }),
    emptyRow(),
    emptyRow(),
  ]);
  const { rows } = parseProformaWorkbook(buffer);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].values.employee_id, 'EMP001');
});

test('reports the original sheet row number', () => {
  const buffer = buildWorkbook([
    makeRow({ employee_id: 'EMP001', employee_name: 'Alpha' }),
  ]);
  const { rows } = parseProformaWorkbook(buffer);
  assert.strictEqual(rows[0].sheetRow, 7); // 1 title + 1 gad + 1 blank + 1 ddo + header + numbering
});

test('rejects a workbook without the proforma header row', () => {
  const ws = XLSX.utils.aoa_to_sheet([['random', 'file'], ['1', '2']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  assert.throws(() => parseProformaWorkbook(buffer), ImportParseError);
});

test('rejects a non-Excel file', () => {
  assert.throws(() => parseProformaWorkbook(Buffer.from('not an excel file')), ImportParseError);
});

test('training locations require Location/Venue and Mandal columns and report invalid rows', () => {
  const workbook = buildIntakeWorkbook([
    ['Location Name', 'Mandal'],
    ['Training Centre A', 'Mandal A'],
    ['', 'Mandal B'],
  ]);
  const parsed = parseTrainingLocations(workbook);
  assert.equal(parsed.accepted.length, 1);
  assert.equal(parsed.accepted[0].location_name, 'Training Centre A');
  assert.equal(parsed.rejected.length, 1);
  assert.ok(parsed.rejected[0].reasons.includes('location_name_required'));

  const missingMandal = buildIntakeWorkbook([['Location'], ['Training Centre A']]);
  assert.throws(
    () => parseTrainingLocations(missingMandal),
    (error) => error instanceof IntakeParseError && /Location, Location Name or Venue, and Mandal columns/.test(error.message)
  );
});

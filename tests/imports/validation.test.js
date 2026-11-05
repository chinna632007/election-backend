'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { validateRows, normalizeDate } = require('../../src/modules/imports/validation');

function row(sheetRow, values) {
  return { sheetRow, values: { sl_no: String(sheetRow - 6), ...values } };
}

test('accepts a fully valid row', () => {
  const { accepted, rejected } = validateRows([
    row(7, { employee_id: 'EMP001', employee_name: 'Alpha', date_of_birth: '01.02.1980' }),
  ]);
  assert.strictEqual(accepted.length, 1);
  assert.strictEqual(rejected.length, 0);
  assert.strictEqual(accepted[0].date_of_birth, '1980-02-01');
});

test('rejects missing employee_name', () => {
  const { accepted, rejected } = validateRows([
    row(7, { employee_id: 'EMP001', employee_name: '' }),
  ]);
  assert.strictEqual(accepted.length, 0);
  assert.deepStrictEqual(rejected[0].reasons, ['employee_name_required']);
});

test('rejects missing employee_id', () => {
  const { rejected } = validateRows([row(7, { employee_id: '', employee_name: 'Alpha' })]);
  assert.deepStrictEqual(rejected[0].reasons, ['employee_id_required']);
});

test('rejects unparseable and impossible dates, accepts blank', () => {
  const { accepted, rejected } = validateRows([
    row(7, { employee_id: 'A1', employee_name: 'A', date_of_birth: 'not-a-date' }),
    row(8, { employee_id: 'A2', employee_name: 'B', date_of_birth: '31.02.1980' }),
    row(9, { employee_id: 'A3', employee_name: 'C', date_of_birth: '', date_of_retirement: '' }),
  ]);
  assert.strictEqual(accepted.length, 1);
  assert.strictEqual(accepted[0].date_of_birth, null);
  assert.deepStrictEqual(rejected[0].reasons, ['date_of_birth_unparseable']);
  assert.deepStrictEqual(rejected[1].reasons, ['date_of_birth_unparseable']);
});

test('rejects duplicate employee_id within one file (later rows)', () => {
  const { accepted, rejected } = validateRows([
    row(7, { employee_id: 'EMP001', employee_name: 'Alpha' }),
    row(8, { employee_id: 'EMP001', employee_name: 'Beta' }),
  ]);
  assert.strictEqual(accepted.length, 1);
  assert.strictEqual(accepted[0].employee_name, 'Alpha');
  assert.deepStrictEqual(rejected[0].reasons, ['duplicate_employee_id_in_file']);
});

test('combines multiple reasons on one row', () => {
  const { rejected } = validateRows([
    row(7, { employee_id: '', employee_name: '', date_of_birth: 'junk' }),
  ]);
  assert.deepStrictEqual(rejected[0].reasons.sort(), [
    'date_of_birth_unparseable',
    'employee_id_required',
    'employee_name_required',
  ]);
});

test('normalizeDate handles dd.mm.yyyy edge cases', () => {
  assert.deepStrictEqual(normalizeDate('29.2.2004'), { value: '2004-02-29' }); // leap year
  assert.deepStrictEqual(normalizeDate('29.2.2003'), { error: 'unparseable_date' });
  assert.deepStrictEqual(normalizeDate(''), { value: null });
});

test('below 18 by DOB is rejected with below_minimum_age', () => {
  const young = new Date();
  young.setUTCFullYear(young.getUTCFullYear() - 17);
  const dob = `${String(young.getUTCDate()).padStart(2, '0')}.${String(young.getUTCMonth() + 1).padStart(2, '0')}.${young.getUTCFullYear()}`;
  const { accepted, rejected } = validateRows([
    row(7, { employee_id: 'Y1', employee_name: 'Young', date_of_birth: dob }),
  ]);
  assert.strictEqual(accepted.length, 0);
  assert.deepStrictEqual(rejected[0].reasons, ['below_minimum_age']);
});

test('exactly 18 by DOB today is accepted (birthday counts)', () => {
  const adult = new Date();
  adult.setUTCFullYear(adult.getUTCFullYear() - 18);
  const dob = `${String(adult.getUTCDate()).padStart(2, '0')}.${String(adult.getUTCMonth() + 1).padStart(2, '0')}.${adult.getUTCFullYear()}`;
  const { accepted } = validateRows([
    row(7, { employee_id: 'A1', employee_name: 'Adult', date_of_birth: dob }),
  ]);
  assert.strictEqual(accepted.length, 1);
});

test('blank DOB falls back to Age column; both blank is accepted', () => {
  const low = validateRows([row(7, { employee_id: 'L1', employee_name: 'L', age: '15' })]);
  assert.deepStrictEqual(low.rejected[0].reasons, ['below_minimum_age']);
  const ok = validateRows([row(7, { employee_id: 'O1', employee_name: 'O', age: '30' })]);
  assert.strictEqual(ok.accepted.length, 1);
  const none = validateRows([row(7, { employee_id: 'N1', employee_name: 'N' })]);
  assert.strictEqual(none.accepted.length, 1);
});

test('non-numeric Age is not an age basis (row accepted)', () => {
  const { accepted } = validateRows([row(7, { employee_id: 'X1', employee_name: 'X', age: 'forty' })]);
  assert.strictEqual(accepted.length, 1);
});

test('age_dob_age_mismatch: DOB and Age column disagree by more than 2 years -> rejected', () => {
  // DOB 1980 -> age ~46; Age column says 30. Diff = 16 > 2.
  const { rejected } = validateRows([
    row(7, { employee_id: 'M1', employee_name: 'M', date_of_birth: '01.01.1980', age: '30' }),
  ]);
  assert.strictEqual(rejected[0].reasons.includes('age_dob_age_mismatch'), true);
});

test('age_dob_age_mismatch: DOB and Age column agree within 2 years -> accepted', () => {
  // DOB 1980 -> age ~46; Age column says 47. Diff = 1 <= 2.
  const { accepted } = validateRows([
    row(7, { employee_id: 'M2', employee_name: 'M', date_of_birth: '01.01.1980', age: '47' }),
  ]);
  assert.strictEqual(accepted.length, 1);
  assert.strictEqual(accepted[0].age, '47');
});

test('age_dob_age_mismatch: blank Age with DOB present -> no mismatch check', () => {
  const { accepted } = validateRows([
    row(7, { employee_id: 'M3', employee_name: 'M', date_of_birth: '01.01.1980', age: '' }),
  ]);
  assert.strictEqual(accepted.length, 1);
});

test('age_dob_age_mismatch: non-numeric Age with DOB present -> no mismatch check', () => {
  const { accepted } = validateRows([
    row(7, { employee_id: 'M4', employee_name: 'M', date_of_birth: '01.01.1980', age: 'forty' }),
  ]);
  assert.strictEqual(accepted.length, 1);
});

test('age_dob_age_mismatch: mismatch and below_minimum_age combine on one row', () => {
  // DOB 2005 -> age ~21 (>= 18 so no below_minimum_age); Age col 40. Diff = 19 > 2.
  const { rejected } = validateRows([
    row(7, { employee_id: 'M5', employee_name: 'M', date_of_birth: '01.01.2005', age: '40' }),
  ]);
  assert.strictEqual(rejected[0].reasons.includes('age_dob_age_mismatch'), true);
  assert.strictEqual(rejected[0].reasons.includes('below_minimum_age'), false);
});

test('medical designations are HARD-rejected (doctors, nurses, homeopathy, ayurveda)', () => {
  const cases = [
    'doctor', 'Doctor', 'DOCTOR', 'Staff Nurse', 'NURSE', 'ANM', 'Homeopath', 'Homoeopath',
    'Ayurvedic Doctor', 'ayurvedic', 'Unani Doctor', 'Compounder', 'Pharmacist', 'Dispenser',
    'Medical Officer', 'Civil Surgeon', 'MBBS Doctor', 'Veterinary Doctor',
  ];
  for (const designation of cases) {
    const { accepted, rejected } = validateRows([
      row(7, { employee_id: `MED-${designation.replace(/\s+/g, '')}`, employee_name: 'M', date_of_birth: '01.01.1980', designation }),
    ]);
    assert.strictEqual(accepted.length, 0, `designation ${JSON.stringify(designation)} must be rejected`);
    assert.strictEqual(rejected[0].reasons.includes('medical_designation_not_eligible'), true, `designation ${JSON.stringify(designation)} reason`);
  }
});

test('medical reject is department-independent and is a HARD reject (not exempt_category)', () => {
  const { rejected } = validateRows([
    row(7, { employee_id: 'D1', employee_name: 'D', date_of_birth: '01.01.1980', designation: 'doctor' }),
  ]);
  // HARD reject: exactly one reason, the medical code — no exempt_category involved.
  assert.deepStrictEqual(rejected[0].reasons, ['medical_designation_not_eligible']);
});

test('non-medical designations pass the medical check (no false positives)', () => {
  const cases = ['Senior Assistant', 'Data Entry Operator', 'Section Officer', 'Junior Accountant', 'Typist', 'Assistant Engineer', 'Attender'];
  for (const designation of cases) {
    const { accepted } = validateRows([
      row(7, { employee_id: `OK-${designation.replace(/\s+/g, '')}`, employee_name: 'O', date_of_birth: '01.01.1980', designation }),
    ]);
    assert.strictEqual(accepted.length, 1, `designation ${JSON.stringify(designation)} must be accepted`);
  }
});

test('age_dob_age_mismatch: DOB under-18 AND mismatch -> both reasons', () => {
  // DOB 2010 -> age ~16 (< 18); Age col 30. Both reasons fire.
  const { rejected } = validateRows([
    row(7, { employee_id: 'M6', employee_name: 'M', date_of_birth: '01.01.2010', age: '30' }),
  ]);
  assert.strictEqual(rejected[0].reasons.includes('below_minimum_age'), true);
  assert.strictEqual(rejected[0].reasons.includes('age_dob_age_mismatch'), true);
});

test('PH officers are rejected with ph_category_not_eligible', () => {
  const phCases = ['Yes', 'yes', 'Y', '5 yrs PH-40%', 'PH-40%', 'PH', 'Physically Handicapped', '40%'];
  for (const ph of phCases) {
    const { accepted, rejected } = validateRows([
      row(7, { employee_id: 'PH01', employee_name: 'PH Officer', date_of_birth: '01.01.1985', ph_category: ph }),
    ]);
    assert.strictEqual(accepted.length, 0, `PH value ${JSON.stringify(ph)} must be rejected`);
    assert.strictEqual(rejected[0].reasons.includes('ph_category_not_eligible'), true, `Reason for ${ph}`);
  }
});

test('non-PH values are accepted (No, blank, null, dash)', () => {
  const nonPhCases = ['No', 'no', 'N', '—', '-', 'None', 'NA', '', null, undefined];
  for (const ph of nonPhCases) {
    const { accepted } = validateRows([
      row(7, { employee_id: 'OK01', employee_name: 'Able Officer', date_of_birth: '01.01.1985', ph_category: ph }),
    ]);
    assert.strictEqual(accepted.length, 1, `Non-PH value ${JSON.stringify(ph)} must be accepted`);
  }
});

test('invalid voter/elector IDs are rejected with invalid_elector_id', () => {
  const invalidCases = ['invalid', 'INVALID-EPIC', 'fake', 'invalid_epic'];
  for (const vId of invalidCases) {
    const { accepted, rejected } = validateRows([
      row(7, { employee_id: 'INV01', employee_name: 'Voter Check', date_of_birth: '01.01.1985', voter_id: vId }),
    ]);
    assert.strictEqual(accepted.length, 0, `Invalid voter ID ${JSON.stringify(vId)} must be rejected`);
    assert.strictEqual(rejected[0].reasons.includes('invalid_elector_id'), true, `Reason for ${vId}`);
  }
});

test('valid or empty voter IDs pass validation', () => {
  const validCases = ['ABC1234567', 'XYZ9876543', 'AP/01/123456', 'TEST123', 'TEST-EPIC-001', '', null, undefined];
  for (const vId of validCases) {
    const { accepted, rejected } = validateRows([
      row(7, { employee_id: 'V01', employee_name: 'Valid Voter', date_of_birth: '01.01.1985', voter_id: vId }),
    ]);
    assert.strictEqual(accepted.length, 1, `Valid voter ID ${JSON.stringify(vId)} must be accepted`);
    assert.strictEqual(rejected.length, 0);
  }
});

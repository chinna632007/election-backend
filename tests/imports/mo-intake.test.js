'use strict';

/**
 * Phase-1 MO intake — Micro Observer upload rejects medical roles.
 * Same authority decision (2026-10-15) as the personnel import: doctors,
 * nurses, homeopaths and related clinical designations must never enter
 * the MO pool either.
 *
 * Run: node --test tests/imports/mo-intake.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseMicroObservers } = require('../../src/modules/imports/intake');

function moBuffer(rows) {
  const grid = [
    ['Ele Id', 'Employee ID', 'Name of the Employee', 'Desig-nation in Full Form', 'BANK NAME', 'Working Mandal'],
    ...rows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(grid);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MO');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('MO intake accepts bank staff', () => {
  const buf = moBuffer([
    ['1', 'MO-001', 'Ravi Kumar', 'Assistant Manager', 'APGB', 'Amadaguru'],
    ['2', 'MO-002', 'Sita Rao', 'Clerk', 'SBI', 'Bukkapatnam'],
  ]);
  const { accepted, rejected } = parseMicroObservers(buf);
  assert.equal(accepted.length, 2);
  assert.equal(rejected.length, 0);
});

test('MO intake HARD-rejects doctors, nurses, homeopaths, ayurveda, compounders', () => {
  const buf = moBuffer([
    ['1', 'MO-101', 'Dr A', 'doctor', 'APGB', 'Amadaguru'],
    ['2', 'MO-102', 'Nurse B', 'Staff Nurse', 'SBI', 'Bukkapatnam'],
    ['3', 'MO-103', 'Homeo C', 'Homoeopath', 'APGB', 'Amadaguru'],
    ['4', 'MO-104', 'Ayur D', 'ayurvedic', 'SBI', 'Bukkapatnam'],
    ['5', 'MO-105', 'Comp E', 'compounder', 'APGB', 'Amadaguru'],
    ['6', 'MO-106', 'Ok F', 'Assistant Manager', 'SBI', 'Bukkapatnam'],
  ]);
  const { accepted, rejected } = parseMicroObservers(buf);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].employee_id, 'MO-106');
  assert.equal(rejected.length, 5);
  for (const r of rejected) {
    assert.ok(
      r.reasons.includes('medical_designation_not_eligible'),
      'MO ' + r.employeeId + ' must carry medical_designation_not_eligible, got: ' + JSON.stringify(r.reasons)
    );
  }
});

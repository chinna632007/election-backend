'use strict';

/**
 * Ballot register parsing + allocation.
 * Run: node --test tests/randomization/ballot-allocation.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const {
  parseBallotRegister,
  allocateBallots,
  BallotParseError,
} = require('../../src/modules/randomization/ballot-allocation');

function boothBuffer(rows) {
  const grid = [
    ['Booth ID', 'Booth Number', 'Booth Name', 'Building Name', 'Street',
      'Village/Locality', 'Ward', 'Mandal', 'District', 'PIN Code', 'Required Officers'],
    ...rows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(grid);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Booths');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const BOOTH_ROWS = [
  ['B001', '101', 'ZP High School', 'ZP HS', 'Main Rd', 'Jami', '1', 'Jami', 'Vizianagaram', '535250', 1],
  ['B002', '102', 'Govt School', 'Govt School', 'Market Rd', 'Kothavalasa', '2', 'Jami', 'Vizianagaram', '535251', 1],
  ['B003', '103', 'Community Hall', 'Community Hall', 'Station Rd', 'Vizianagaram Town', '4', 'Jami', 'Vizianagaram', '535252', 1],
];

test('parseBallotRegister: real Booths shape -> accepted rows with mandal', () => {
  const { accepted, rejected } = parseBallotRegister(boothBuffer(BOOTH_ROWS));
  assert.equal(accepted.length, 3);
  assert.equal(rejected.length, 0);
  assert.equal(accepted[0].ballotId, 'B001');
  assert.equal(accepted[0].psNo, '101');
  assert.equal(accepted[0].mandal, 'Jami');
});

test('parseBallotRegister: duplicate booth identity rejects the later row', () => {
  const { accepted, rejected } = parseBallotRegister(boothBuffer([
    BOOTH_ROWS[0],
    ['B001', '109', 'Dup Booth ID', '', '', '', '', 'Jami', '', '', 1],
  ]));
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reasons.includes('duplicate_ballot_in_file'));
});

test('parseBallotRegister: file without ballot columns -> BallotParseError', () => {
  const ws = XLSX.utils.aoa_to_sheet([['Name', 'Role'], ['A', 'Teacher']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  assert.throws(() => parseBallotRegister(buf), BallotParseError);
});

test('allocateBallots: officers consumed in order, one ballot each', () => {
  const { accepted } = parseBallotRegister(boothBuffer(BOOTH_ROWS));
  const out = allocateBallots({
    ballots: accepted,
    presidingOfficers: ['PO 1', 'PO 2', 'PO 3'],
    pollingOfficers: ['POff 1', 'POff 2', 'POff 3'],
  });
  assert.equal(out.summary.totalBallots, 3);
  assert.equal(out.summary.allocated, 3);
  assert.equal(out.rows[0].presidingOfficer, 'PO 1');
  assert.equal(out.rows[2].pollingOfficer, 'POff 3');
  assert.ok(out.rows.every((r) => r.status === 'Allocated'));
  // An officer is never reused: 3 distinct presiding + 3 distinct polling.
  assert.equal(out.summary.presidingCount, 3);
  assert.equal(out.summary.pollingCount, 3);
});

test('allocateBallots: shortfall is fail-closed and visible per row', () => {
  const { accepted } = parseBallotRegister(boothBuffer(BOOTH_ROWS));
  const out = allocateBallots({
    ballots: accepted,
    presidingOfficers: ['PO 1'],
    pollingOfficers: ['POff 1'],
  });
  assert.equal(out.summary.allocated, 1);
  const row3 = out.rows[2];
  assert.equal(row3.status, 'Unassigned');
  assert.match(row3.remarks, /no Presiding Officer and Polling Officer left/);
  // Rejected rows keep ballot identity so the table can still list them.
  assert.equal(row3.ballotId, 'B003');
  assert.equal(row3.psNo, '103');
});

test('allocateBallots: empty officer lists -> all rows Unassigned, never crashes', () => {
  const { accepted } = parseBallotRegister(boothBuffer(BOOTH_ROWS));
  const out = allocateBallots({ ballots: accepted, presidingOfficers: [], pollingOfficers: [] });
  assert.equal(out.summary.allocated, 0);
  assert.ok(out.rows.every((r) => r.status === 'Unassigned'));
});
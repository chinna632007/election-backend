'use strict';

/**
 * tests/master-data/stations.validation.test.js
 *
 * Pure unit tests for polling-station row validation (no DB).
 * Run: node --test tests/master-data/stations.validation.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStations } = require('../../src/modules/master-data/stations.validation');

function station(overrides) {
  return Object.assign({
    stationId: 'B1', stationNumber: '1', stationName: 'Govt School',
    mandal: 'Peddapuram', district: 'Kakinada',
  }, overrides || {});
}

test('accepts a fully valid station', () => {
  const { accepted, rejected } = validateStations([station()]);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(accepted[0].stationId, 'B1');
  assert.equal(accepted[0].district, 'Kakinada');
});

test('required fields: stationId, stationNumber, stationName, mandal, district', () => {
  const { rejected } = validateStations([
    { stationId: '', stationNumber: '', stationName: '', mandal: '', district: '' },
  ]);
  assert.deepEqual(rejected[0].reasons.sort(), [
    'district_required', 'mandal_required', 'station_id_required',
    'station_name_required', 'station_number_required',
  ]);
});

test('optional fields default to null when blank', () => {
  const { accepted } = validateStations([station({ buildingName: '', street: '  ', locality: null })]);
  assert.equal(accepted[0].buildingName, null);
  assert.equal(accepted[0].street, null);
  assert.equal(accepted[0].locality, null);
});

test('pinCode: optional, must be 6 digits when present', () => {
  const ok = validateStations([station({ pinCode: '533005' })]);
  assert.equal(ok.rejected.length, 0);
  assert.equal(ok.accepted[0].pinCode, '533005');

  const bad = validateStations([station({ pinCode: '12345' })]);
  assert.deepEqual(bad.rejected[0].reasons, ['pin_code_invalid']);

  const blank = validateStations([station({ pinCode: '' })]);
  assert.equal(blank.accepted[0].pinCode, null);
  assert.equal(blank.rejected.length, 0);
});

test('requiredOfficers: optional, positive integer when present', () => {
  const ok = validateStations([station({ requiredOfficers: 5 })]);
  assert.equal(ok.rejected.length, 0);
  assert.equal(ok.accepted[0].requiredOfficers, 5);

  const zero = validateStations([station({ requiredOfficers: 0 })]);
  assert.deepEqual(zero.rejected[0].reasons, ['required_officers_invalid']);

  const neg = validateStations([station({ requiredOfficers: -2 })]);
  assert.deepEqual(neg.rejected[0].reasons, ['required_officers_invalid']);

  const frac = validateStations([station({ requiredOfficers: 2.5 })]);
  assert.deepEqual(frac.rejected[0].reasons, ['required_officers_invalid']);
});

test('duplicate stationId within one payload rejects later rows', () => {
  const { accepted, rejected } = validateStations([
    station({ stationId: 'B1' }),
    station({ stationId: 'B1', stationName: 'Duplicate' }),
  ]);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].stationName, 'Govt School');
  assert.deepEqual(rejected[0].reasons, ['duplicate_station_id_in_file']);
});

test('multiple reasons combine on one row', () => {
  const { rejected } = validateStations([
    { stationId: '', stationNumber: '', stationName: '', mandal: '', district: 'K', pinCode: 'x' },
  ]);
  assert.ok(rejected[0].reasons.includes('pin_code_invalid'));
  assert.ok(rejected[0].reasons.includes('mandal_required'));
});

test('empty array yields empty results', () => {
  const { accepted, rejected } = validateStations([]);
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);
});

'use strict';

/**
 * tests/master-data/stations.routes.test.js
 *
 * Verifies polling-station routes with safe in-memory Mongo collection stubs:
 *   POST /stations          -> authority, admin
 *   GET  /stations          -> staff, authority, admin
 *   GET  /stations/batches  -> staff, authority, admin
 * Unauthenticated -> 401; wrong role -> 403; allowed role reaches handler.
 *
 * Run: node --test tests/master-data/stations.routes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const express = require('express');
const { installMongoStub } = require('../helpers/mongo-stub');
const mongo = installMongoStub();
const masterDataRouter = require('../../src/modules/master-data');

const mongoose = require('../../src/database').mongoose;
function seed() {
  const stations = mongo.collection('polling_stations');
  stations.splice(0, stations.length, {
    _id: new mongoose.Types.ObjectId(),
    import_batch_id: String(mongo.collection('import_batches')[0]?._id || ''),
    district: 'Kakinada',
    station_id: 'B1',
    station_number: '1',
    station_name: 'Govt School',
    building_name: null,
    street: null,
    locality: null,
    ward: null,
    mandal: 'Peddapuram',
    pin_code: '533005',
    required_officers: 5,
  });
  const batches = mongo.collection('import_batches');
  batches.splice(0, batches.length, {
    _id: new mongoose.Types.ObjectId(),
    file_name: 'stations.json',
    total_rows: 1,
    accepted_rows: 1,
    rejected_rows: 0,
    status: 'completed',
    kind: 'stations',
    imported_at: new Date('2026-01-01T00:00:00Z'),
    imported_by: 'tester',
  });
}

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) {
    app.use((req, _res, next) => { req.session = { user }; next(); });
  }
  app.use('/api/master-data', masterDataRouter);
  return app;
}

async function request(app, method, path, body) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const validStation = { stationId: 'B1', stationNumber: '1', stationName: 'Govt School', mandal: 'Peddapuram', district: 'Kakinada' };

// --- POST /stations: authority, admin ---------------------------------------
test('POST /stations: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'POST', '/api/master-data/stations', { fileName: 's.json', stations: [validStation] });
  assert.equal(status, 401);
});

test('POST /stations: staff -> 403 (denied)', async () => {
  const { status, body } = await request(buildApp({ id: 1, role: 'staff' }), 'POST', '/api/master-data/stations', { fileName: 's.json', stations: [validStation] });
  assert.equal(status, 403);
  assert.equal(body.error, 'Forbidden');
});

test('POST /stations: authority -> 200 (import succeeds)', async () => {
  const { status, body } = await request(buildApp({ id: 1, role: 'authority' }), 'POST', '/api/master-data/stations', { fileName: 's.json', stations: [validStation] });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.batch.id, /^[a-f\d]{24}$/i);
  assert.equal(body.batch.acceptedRows, 1);
});

test('POST /stations: admin -> 200', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'admin' }), 'POST', '/api/master-data/stations', { fileName: 's.json', stations: [validStation] });
  assert.equal(status, 200);
});

test('POST /stations: maps camelCase input to snake_case Mongo fields', async () => {
  const station = {
    stationId: 'B99', stationNumber: '99', stationName: 'ZPH School',
    mandal: 'Peddapuram', district: 'Kakinada',
    buildingName: 'Main', street: 'Road 1', locality: 'Village', ward: 'W2',
    pinCode: '533005', requiredOfficers: 4,
  };
  const { status } = await request(buildApp({ id: 1, role: 'authority' }), 'POST', '/api/master-data/stations', { fileName: 's.json', stations: [station] });
  assert.equal(status, 200);
  const saved = mongo.collection('polling_stations').find((row) => row.station_id === 'B99');
  assert.ok(saved, 'accepted station persisted');
  assert.equal(saved.district, 'Kakinada');
  assert.equal(saved.station_number, '99');
  assert.equal(saved.station_name, 'ZPH School');
  assert.equal(saved.building_name, 'Main');
  assert.equal(saved.street, 'Road 1');
  assert.equal(saved.locality, 'Village');
  assert.equal(saved.ward, 'W2');
  assert.equal(saved.mandal, 'Peddapuram');
  assert.equal(saved.pin_code, '533005');
  assert.equal(saved.required_officers, 4);
  assert.match(saved.import_batch_id, /^[a-f\d]{24}$/i);
});

test('POST /stations: missing fileName -> 400 (validation after authz)', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'authority' }), 'POST', '/api/master-data/stations', { stations: [validStation] });
  assert.equal(status, 400);
});

test('POST /stations: stations not an array -> 400', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'authority' }), 'POST', '/api/master-data/stations', { fileName: 's.json', stations: 'nope' });
  assert.equal(status, 400);
});

test('POST /stations: empty stations array -> 400', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'authority' }), 'POST', '/api/master-data/stations', { fileName: 's.json', stations: [] });
  assert.equal(status, 400);
});

// --- GET /stations: staff, authority, admin ---------------------------------
test('GET /stations: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'GET', '/api/master-data/stations');
  assert.equal(status, 401);
});

test('GET /stations: staff allowed -> 200 with stations', async () => {
  seed();
  const { status, body } = await request(buildApp({ id: 1, role: 'staff' }), 'GET', '/api/master-data/stations');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 1);
  assert.equal(body.stations[0].station_id, 'B1');
});

test('GET /stations: unknown role -> 403', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'guest' }), 'GET', '/api/master-data/stations');
  assert.equal(status, 403);
});

test('GET /stations: invalid batchId -> 400', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'staff' }), 'GET', '/api/master-data/stations?batchId=abc');
  assert.equal(status, 400);
});

// --- GET /stations/batches --------------------------------------------------
test('GET /stations/batches: staff allowed -> 200', async () => {
  seed();
  const { status, body } = await request(buildApp({ id: 1, role: 'staff' }), 'GET', '/api/master-data/stations/batches');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.batches[0].kind, 'stations');
});

test('GET /stations/batches: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'GET', '/api/master-data/stations/batches');
  assert.equal(status, 401);
});

test.after(() => mongo.close());

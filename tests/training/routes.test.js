'use strict';

/**
 * tests/training/routes.test.js
 *
 * Verifies training routes using safe in-memory Mongo collection stubs.
 *
 * Run: node --test tests/training/routes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { installMongoStub } = require('../helpers/mongo-stub');
const mongo = installMongoStub();
const mongoose = require('../../src/database').mongoose;
const trainingRouter = require('../../src/modules/training');

let batchId;
let personId;
let locationId;

function seedBatch() {
  const batches = mongo.collection('training_batches');
  const members = mongo.collection('training_batch_members');
  const people = mongo.collection('personnel');
  const locations = mongo.collection('training_locations');
  batches.splice(0, batches.length);
  members.splice(0, members.length);
  people.splice(0, people.length);
  locations.splice(0, locations.length);
  batchId = new mongoose.Types.ObjectId();
  personId = new mongoose.Types.ObjectId();
  locationId = new mongoose.Types.ObjectId();
  const otherLocationId = new mongoose.Types.ObjectId();
  batches.push({ _id: batchId, batch_no: 1, mandal: 'Tuni', location_id: String(locationId), created_at: new Date() });
  members.push({ _id: new mongoose.Types.ObjectId(), batch_id: String(batchId), personnel_id: String(personId), employee_id: 'EMP1' });
  people.push({ _id: personId, employee_id: 'EMP1', employee_name: 'Officer One', designation: 'Clerk', native_mandal: 'Tuni', work_mandal: 'Tuni' });
  locations.push(
    { _id: locationId, location_name: 'Tuni Centre', mandal: 'Tuni', panchayat: 'Tuni', category: 'A' },
    { _id: otherLocationId, location_name: 'Kakinada Centre', mandal: 'Kakinada', panchayat: 'Kakinada', category: 'A' }
  );
  return { otherLocationId };
}

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) {
    app.use((req, _res, next) => { req.session = { user }; next(); });
  }
  app.use('/api/training', trainingRouter);
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

const AUTHORITY = { id: 1, username: 'auth1', role: 'authority' };
const STAFF = { id: 2, username: 'staff1', role: 'staff' };

test('unauthenticated -> 401 on sessions', async () => {
  const app = buildApp(undefined);
  const { status } = await request(app, 'GET', '/api/training/sessions');
  assert.equal(status, 401);
});

test('staff can list sessions but cannot create', async () => {
  const app = buildApp(STAFF);
  const listed = await request(app, 'GET', '/api/training/sessions');
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.body.sessions));
  const denied = await request(app, 'POST', '/api/training/sessions', { title: 'X' });
  assert.equal(denied.status, 403);
});

test('authority creates a session; validation rejects bad type', async () => {
  const app = buildApp(AUTHORITY);
  const ok = await request(app, 'POST', '/api/training/sessions', {
    title: 'PO practical class 1',
    sessionType: 'practical',
    mandal: 'Tuni',
    durationMinutes: 60,
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.session.title, 'PO practical class 1');
  assert.match(ok.body.session.id, /^[a-f\d]{24}$/i);

  const bad = await request(app, 'POST', '/api/training/sessions', {
    title: 'Bad session', sessionType: 'exam',
  });
  assert.equal(bad.status, 400);
});

test('attendance marking + reading works (incl. reserve + MO role)', async () => {
  const app = buildApp(AUTHORITY);
  const created = await request(app, 'POST', '/api/training/sessions', {
    title: 'Attendance demo', sessionType: 'theory',
  });
  const id = created.body.session.id;
  const marked = await request(app, 'POST', `/api/training/sessions/${id}/attendance`, {
    records: [
      { personnelId: 'E1', present: true, role: 'Presiding Officer' },
      { personnelId: 'E2', present: true, role: 'Micro Observer' },
      { personnelId: 'E3', present: false, role: '1st Polling Officer', isReserve: true },
    ],
  });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.attendance.length, 3);

  const read = await request(app, 'GET', `/api/training/sessions/${id}/attendance`);
  assert.equal(read.status, 200);
  assert.equal(read.body.attendance.length, 3);
  const mo = read.body.attendance.find((a) => a.personnelId === 'E2');
  assert.equal(mo.role, 'Micro Observer');
});

/* ------------------------------------------------------------------------- *
 * Training batch read/edit endpoints (in-memory Mongo collection fixtures).
 *   GET  /api/training/batches
 *   GET  /api/training/batches/:id/members
 *   GET  /api/training/batches/:id/locations
 *   DELETE /api/training/batches/:id/members/:personnelId  (persisted)
 *   PATCH /api/training/batches/:id/location                (admin)
 * ------------------------------------------------------------------------- */

test('unauthenticated -> 401 on batches', async () => {
  const app = buildApp(undefined);
  const { status } = await request(app, 'GET', '/api/training/batches');
  assert.equal(status, 401);
});

test('GET /batches returns array with expected shape', async () => {
  seedBatch();
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'GET', '/api/training/batches');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.batches));
  if (body.batches.length > 0) {
    const b = body.batches[0];
    assert.ok('id' in b && 'batch_no' in b && 'mandal' in b && 'member_count' in b);
  }
});

test('GET /batches/:id/members returns members for a real batch', async () => {
  seedBatch();
  const app = buildApp(AUTHORITY);
  const list = await request(app, 'GET', '/api/training/batches');
  assert.ok(list.body.batches.length > 0, 'expected seeded batches');
  const id = list.body.batches[0].id;
  const { status, body } = await request(app, 'GET', `/api/training/batches/${id}/members`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.members));
  assert.ok(body.batch && body.batch.id === id);
  if (body.members.length > 0) {
    const m = body.members[0];
    assert.ok('personnel_id' in m && 'employee_id' in m && 'employee_name' in m);
    assert.ok('designation' in m && 'native_mandal' in m && 'work_mandal' in m);
  }
});

test('GET /batches/:id/members -> 404 for missing batch', async () => {
  seedBatch();
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'GET', '/api/training/batches/ffffffffffffffffffffffff/members');
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test('GET /batches/:id/members -> 400 for non-numeric id', async () => {
  const app = buildApp(AUTHORITY);
  const { status } = await request(app, 'GET', '/api/training/batches/not-an-object-id/members');
  assert.equal(status, 400);
});

test('GET /batches/:id/locations returns same-mandal candidates', async () => {
  seedBatch();
  const app = buildApp(AUTHORITY);
  const list = await request(app, 'GET', '/api/training/batches');
  const id = list.body.batches[0].id;
  const mandal = list.body.batches[0].mandal;
  const { status, body } = await request(app, 'GET', `/api/training/batches/${id}/locations`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mandal, mandal);
  assert.ok(Array.isArray(body.locations));
  for (const l of body.locations) assert.equal(l.mandal, mandal);
});

test('staff cannot assign a location (403)', async () => {
  seedBatch();
  const app = buildApp(STAFF);
  const list = await request(app, 'GET', '/api/training/batches');
  const id = list.body.batches[0].id;
  const { status } = await request(app, 'PATCH', `/api/training/batches/${id}/location`, { locationId: null });
  assert.equal(status, 403);
});

test('PATCH location rejects a location from a different mandal (400)', async () => {
  const { otherLocationId } = seedBatch();
  const app = buildApp(AUTHORITY);
  const id = String(batchId);
  const { status, body } = await request(
    app, 'PATCH', `/api/training/batches/${id}/location`, { locationId: String(otherLocationId) }
  );
  assert.equal(status, 400);
  assert.equal(body.ok, false);
});

test('PATCH location accepts null then restores (admin, round-trip)', async () => {
  seedBatch();
  const app = buildApp(AUTHORITY);
  const id = String(batchId);
  const cleared = await request(app, 'PATCH', `/api/training/batches/${id}/location`, { locationId: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.locationId, null);
  assert.equal(mongo.collection('training_batches')[0].location_id, null);
  const restored = await request(app, 'PATCH', `/api/training/batches/${id}/location`, { locationId: String(locationId) });
  assert.equal(restored.status, 200);
  assert.equal(mongo.collection('training_batches')[0].location_id, String(locationId));
});

test('DELETE member removes persisted member', async () => {
  seedBatch();
  const app = buildApp(AUTHORITY);
  const del = await request(app, 'DELETE', `/api/training/batches/${batchId}/members/${personId}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.ok, true);
  assert.equal(mongo.collection('training_batch_members').length, 0);
});

test.after(() => mongo.close());

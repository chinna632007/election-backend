'use strict';

/**
 * tests/imports/order-assignments.test.js
 *
 * Route + service tests for the manual-appointment endpoints (migration 008
 * order_assignments — Stage Officer II / counting team, admin-picked).
 *
 *   GET    /api/imports/order-assignments[?orderKind=...]
 *   POST   /api/imports/order-assignments
 *   PATCH  /api/imports/order-assignments/:id
 *   DELETE /api/imports/order-assignments/:id
 *
 * Uses a real Express round-trip with stubbed Mongo collections and injectable
 * session role (no live database). Covers auth (401/403), validation (400), the
 * create->read->update->delete round-trip, the one-appointment-per-person
 * guard (409), and 404s.
 *
 * Run: node --test tests/imports/order-assignments.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createMongoStub, installMongoStub } = require('./mongo-stub');

// --- in-memory fake of the two tables the service touches -----------------
const personnel = [       // minimal personnel for existence checks and joins
  { id: 5, employee_id: 'EMP5', employee_name: 'Asha', designation: 'SA', work_mandal: 'Kakinada' },
  { id: 7, employee_id: 'EMP7', employee_name: 'Bhanu', designation: 'Teacher', work_mandal: 'Samalkot' },
];
const mongo = createMongoStub({
  seed: { personnel, order_assignments: [], counters: [] },
});
const restoreMongo = installMongoStub(mongo);
const importsRouter = require('../../src/modules/imports');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) {
    app.use((req, _res, next) => { req.session = { user }; next(); });
  }
  app.use('/api/imports', importsRouter);
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

function reset() {
  mongo.data.order_assignments.splice(0);
  mongo.data.counters.splice(0);
}

// --- authorization ---------------------------------------------------------

test('GET /order-assignments: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'GET', '/api/imports/order-assignments');
  assert.equal(status, 401);
});

test('GET /order-assignments: staff allowed -> 200', async () => {
  reset();
  const { status, body } = await request(buildApp(STAFF), 'GET', '/api/imports/order-assignments');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.assignments));
});

test('POST /order-assignments: staff -> 403', async () => {
  const { status } = await request(buildApp(STAFF), 'POST', '/api/imports/order-assignments', { orderKind: 'stage_officer_ii', personnelId: 5, role: 'Stage Officer II' });
  assert.equal(status, 403);
});

test('POST /order-assignments: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'POST', '/api/imports/order-assignments', {});
  assert.equal(status, 401);
});

// --- validation ------------------------------------------------------------

test('POST: unknown order_kind -> 400', async () => {
  reset();
  const { status, body } = await request(buildApp(AUTHORITY), 'POST', '/api/imports/order-assignments', { orderKind: 'bogus', personnelId: 5, role: 'X' });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
});

test('POST: missing role -> 400', async () => {
  reset();
  const { status } = await request(buildApp(AUTHORITY), 'POST', '/api/imports/order-assignments', { orderKind: 'stage_officer_ii', personnelId: 5 });
  assert.equal(status, 400);
});

test('POST: invalid personnelId -> 400', async () => {
  reset();
  const { status } = await request(buildApp(AUTHORITY), 'POST', '/api/imports/order-assignments', { orderKind: 'stage_officer_ii', personnelId: 'abc', role: 'X' });
  assert.equal(status, 400);
});

test('POST: personnel not found -> 404', async () => {
  reset();
  const { status, body } = await request(buildApp(AUTHORITY), 'POST', '/api/imports/order-assignments', { orderKind: 'stage_officer_ii', personnelId: 999, role: 'Stage Officer II' });
  assert.equal(status, 404);
  assert.match(body.error, /personnel not found/i);
});

// --- create + duplicate guard ---------------------------------------------

test('POST: valid -> 201; duplicate person in same kind -> 409', async () => {
  reset();
  const app = buildApp(AUTHORITY);
  const first = await request(app, 'POST', '/api/imports/order-assignments', {
    orderKind: 'stage_officer_ii', personnelId: 5, role: 'Stage Officer II', bodyName: 'Kakinada Municipal',
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.assignment.personnel_id, '5');
  assert.equal(first.body.assignment.role, 'Stage Officer II');

  const dup = await request(app, 'POST', '/api/imports/order-assignments', {
    orderKind: 'stage_officer_ii', personnelId: 5, role: 'Stage Officer II again',
  });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /already has/i);

  // same person may hold a DIFFERENT order_kind (counting team) — not a dup
  const other = await request(app, 'POST', '/api/imports/order-assignments', {
    orderKind: 'counting_team', personnelId: 5, role: 'CS', teamNo: '1', tableNo: '3',
  });
  assert.equal(other.status, 201);
});

// --- list (with filter) ----------------------------------------------------

test('GET: lists with optional orderKind filter', async () => {
  reset();
  const adminApp = buildApp(AUTHORITY);
  const staffApp = buildApp(STAFF);
  await request(adminApp, 'POST', '/api/imports/order-assignments', { orderKind: 'stage_officer_ii', personnelId: 5, role: 'Stage Officer II' });
  await request(adminApp, 'POST', '/api/imports/order-assignments', { orderKind: 'counting_team', personnelId: 7, role: 'CS', teamNo: '1' });

  const all = await request(staffApp, 'GET', '/api/imports/order-assignments');
  assert.equal(all.status, 200);
  assert.equal(all.body.assignments.length, 2);
  // joined identity present, no sensitive columns
  assert.ok('employee_name' in all.body.assignments[0]);
  assert.ok(!('aadhar_number' in all.body.assignments[0]));

  const filtered = await request(staffApp, 'GET', '/api/imports/order-assignments?orderKind=counting_team');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.assignments.length, 1);
  assert.equal(filtered.body.assignments[0].order_kind, 'counting_team');
});

test('GET: invalid orderKind filter -> 400', async () => {
  reset();
  const { status } = await request(buildApp(STAFF), 'GET', '/api/imports/order-assignments?orderKind=nope');
  assert.equal(status, 400);
});

// --- update ----------------------------------------------------------------

test('PATCH: update role/team/table; unknown id -> 404', async () => {
  reset();
  const app = buildApp(AUTHORITY);
  const created = await request(app, 'POST', '/api/imports/order-assignments', { orderKind: 'counting_team', personnelId: 7, role: 'CS', teamNo: '1' });
  const id = created.body.assignment.id;

  const updated = await request(app, 'PATCH', `/api/imports/order-assignments/${id}`, { role: 'CAS', teamNo: '2', tableNo: '5' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.assignment.role, 'CAS');
  assert.equal(updated.body.assignment.team_no, '2');
  assert.equal(updated.body.assignment.table_no, '5');

  const missing = await request(app, 'PATCH', '/api/imports/order-assignments/9999', { role: 'X' });
  assert.equal(missing.status, 404);
});

test('PATCH: staff -> 403', async () => {
  reset();
  const app = buildApp(AUTHORITY);
  const created = await request(app, 'POST', '/api/imports/order-assignments', { orderKind: 'stage_officer_ii', personnelId: 5, role: 'SO II' });
  const id = created.body.assignment.id;
  const { status } = await request(buildApp(STAFF), 'PATCH', `/api/imports/order-assignments/${id}`, { role: 'X' });
  assert.equal(status, 403);
});

// --- delete ----------------------------------------------------------------

test('DELETE: removes; unknown id -> 404; staff -> 403', async () => {
  reset();
  const app = buildApp(AUTHORITY);
  const created = await request(app, 'POST', '/api/imports/order-assignments', { orderKind: 'stage_officer_ii', personnelId: 5, role: 'SO II' });
  const id = created.body.assignment.id;

  const denied = await request(buildApp(STAFF), 'DELETE', `/api/imports/order-assignments/${id}`);
  assert.equal(denied.status, 403);

  const del = await request(app, 'DELETE', `/api/imports/order-assignments/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, true);

  const gone = await request(app, 'DELETE', `/api/imports/order-assignments/${id}`);
  assert.equal(gone.status, 404);
});

test.after(restoreMongo);

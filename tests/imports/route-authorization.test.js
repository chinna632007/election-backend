'use strict';

/**
 * tests/imports/route-authorization.test.js
 *
 * Verifies the approved role policy wired onto the import routes:
 *   POST /personnel               -> authority, admin
 *   GET  /batches                 -> staff, authority, admin
 *   GET  /batches/:id/personnel   -> staff, authority, admin
 *   GET  /batches/:id/rejected    -> staff, authority, admin
 *
 * Uses a real Express round-trip with stubbed Mongo collections and an
 * injectable session role. Unauthenticated -> 401; wrong role -> 403; allowed
 * role reaches the handler.
 *
 * Run: node --test tests/imports/route-authorization.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const express = require('express');
const { createMongoStub, installMongoStub } = require('./mongo-stub');
const mongo = createMongoStub({
  seed: {
    import_batches: [{
      id: 7, file_name: 'f.xlsx', department_name: 'Ed', total_rows: 1,
      accepted_rows: 1, rejected_rows: 0, status: 'completed',
      imported_at: '2026-01-01T00:00:00Z', imported_by: 'tester',
    }],
    users: [{ id: 'tester', username: 'tester' }],
    personnel: [{ id: 1, import_batch_id: 7, employee_id: 'EMP1', employee_name: 'Alpha' }],
    import_rejected_rows: [],
  },
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

// --- POST /personnel: authority, admin ---------------------------------------

test('POST /personnel: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'POST', '/api/imports/personnel', {});
  assert.equal(status, 401);
});

test('POST /personnel: staff -> 403 (denied)', async () => {
  const { status, body } = await request(buildApp({ id: 1, role: 'staff' }), 'POST', '/api/imports/personnel', {});
  assert.equal(status, 403);
  assert.equal(body.error, 'Forbidden');
});

test('POST /personnel: authority passes authorize -> reaches handler (400 on empty body)', async () => {
  const { status, body } = await request(buildApp({ id: 1, role: 'authority' }), 'POST', '/api/imports/personnel', {});
  assert.equal(status, 400);
  assert.equal(body.ok, false);
});

test('POST /personnel: admin passes authorize -> reaches handler (400 on empty body)', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'admin' }), 'POST', '/api/imports/personnel', {});
  assert.equal(status, 400);
});

// --- GET /batches: staff, authority, admin -----------------------------------

test('GET /batches: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'GET', '/api/imports/batches');
  assert.equal(status, 401);
});

test('GET /batches: staff allowed -> 200', async () => {
  const { status, body } = await request(buildApp({ id: 1, role: 'staff' }), 'GET', '/api/imports/batches');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('GET /batches: unknown role -> 403', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'guest' }), 'GET', '/api/imports/batches');
  assert.equal(status, 403);
});

// --- GET /batches/:id/personnel: staff, authority, admin ---------------------

test('GET /batches/:id/personnel: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'GET', '/api/imports/batches/7/personnel');
  assert.equal(status, 401);
});

test('GET /batches/:id/personnel: staff allowed -> 200', async () => {
  const { status, body } = await request(buildApp({ id: 1, role: 'staff' }), 'GET', '/api/imports/batches/7/personnel');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('GET /batches/:id/personnel: unknown role -> 403', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'guest' }), 'GET', '/api/imports/batches/7/personnel');
  assert.equal(status, 403);
});

// --- GET /batches/:id/rejected: staff, authority, admin -----------------------

test('GET /batches/:id/rejected: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'GET', '/api/imports/batches/7/rejected');
  assert.equal(status, 401);
});

test('GET /batches/:id/rejected: staff allowed -> 200 with rejected rows', async () => {
  const { status, body } = await request(buildApp({ id: 1, role: 'staff' }), 'GET', '/api/imports/batches/7/rejected');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('GET /batches/:id/rejected: unknown role -> 403', async () => {
  const { status } = await request(buildApp({ id: 1, role: 'guest' }), 'GET', '/api/imports/batches/7/rejected');
  assert.equal(status, 403);
});

test.after(restoreMongo);

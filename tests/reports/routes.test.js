'use strict';

/**
 * tests/reports/routes.test.js
 *
 * Verifies the reports authorization + empty-run behavior.
 * /allocation -> authority/admin only (deployment-sensitive).
 * /summary   -> any authenticated user (counts only, stubbed Mongo collections).
 *
 * Run: node --test tests/reports/routes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const database = require('../../src/database');
const reportsRouter = require('../../src/modules/reports');

const restoreCollectionMethods = [];
function stubCollection(name, methods) {
  const collection = database.getCollection(name);
  for (const [method, implementation] of Object.entries(methods)) {
    const original = collection[method];
    collection[method] = implementation;
    restoreCollectionMethods.push(() => { collection[method] = original; });
  }
}
function emptyCursor(rows = []) {
  return { toArray: async () => rows };
}

stubCollection('allocation_runs', { findOne: async () => null });
stubCollection('allocation_publications', { findOne: async () => null });
stubCollection('import_batches', { find: async () => emptyCursor() });
stubCollection('personnel', { aggregate: async () => emptyCursor() });
stubCollection('polling_stations', { aggregate: async () => emptyCursor() });

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) {
    app.use((req, _res, next) => { req.session = { user }; next(); });
  }
  app.use('/api/reports', reportsRouter);
  return app;
}

async function request(app, method, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const STAFF = { id: 2, username: 'staff1', role: 'staff' };
const AUTHORITY = { id: 1, username: 'auth1', role: 'authority' };

test('unauthenticated -> 401 on allocation', async () => {
  const app = buildApp(undefined);
  const { status } = await request(app, 'GET', '/api/reports/allocation');
  assert.equal(status, 401);
});

test('staff -> 403 on allocation (deployment-sensitive)', async () => {
  const app = buildApp(STAFF);
  const { status } = await request(app, 'GET', '/api/reports/allocation');
  assert.equal(status, 403);
});

test('authority sees empty allocation report when no run recorded', async () => {
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'GET', '/api/reports/allocation');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  // Either null (fresh server) or a shape with parties — never sensitive rows
  assert.ok(body.run === null || Array.isArray(body.stage2.parties));
  if (body.run === null) assert.match(body.note, /No allocation run/);
});

test('summary is readable by staff and carries counts only', async () => {
  const app = buildApp(STAFF);
  const { status, body } = await request(app, 'GET', '/api/reports/summary');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.batches));
  assert.ok(Array.isArray(body.personnelByMandal));
  assert.ok(Array.isArray(body.stationsByMandal));
  // Counts only: no personnel rows, no sensitive columns
  const serialized = JSON.stringify(body);
  assert.ok(!/aadhar/i.test(serialized), 'no Aadhaar in summary');
  assert.ok(!/mobile/i.test(serialized), 'no mobile in summary');
  assert.ok(!/voter_id/i.test(serialized), 'no voter ID in summary');
});

test.after(() => {
  for (const restore of restoreCollectionMethods.reverse()) restore();
});

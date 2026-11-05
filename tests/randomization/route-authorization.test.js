'use strict';

/**
 * tests/randomization/route-authorization.test.js
 *
 * Verifies the role policy on POST /api/randomization/run:
 *   session required (401), staff -> 403, authority/admin reach the handler.
 * Also checks request validation (400s) with safe Mongo collection stubs.
 *
 * Run: node --test tests/randomization/route-authorization.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const express = require('express');
const database = require('../../src/database');
const randomizationRouter = require('../../src/modules/randomization/routes');

const stationCollection = database.getCollection('polling_stations');
const originalFindStations = stationCollection.find;
let stationRows = [];
stationCollection.find = async () => ({ toArray: async () => stationRows });
const settingsCollection = database.getCollection('app_settings');
const originalFindSetting = settingsCollection.findOne;
settingsCollection.findOne = async () => null;

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) {
    app.use((req, _res, next) => { req.session = { user }; next(); });
  }
  app.use('/api/randomization', randomizationRouter);
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

test('unauthenticated request -> 401, no DB query', async () => {
  stationRows = [{ station_id: 'ST-1', station_number: '101', mandal: 'Tuni' }];
  const app = buildApp(undefined);
  const { status, body } = await request(app, 'POST', '/api/randomization/run', {});
  assert.equal(status, 401);
  assert.equal(body.ok, false);
});

test('staff role -> 403 (randomization execution is authority/admin only)', async () => {
  const app = buildApp({ id: 2, username: 'staff1', role: 'staff' });
  const { status, body } = await request(app, 'POST', '/api/randomization/run', {});
  assert.equal(status, 403);
  assert.equal(body.ok, false);
});

test('authority reaches validation: missing electionConfiguration -> 400', async () => {
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'POST', '/api/randomization/run', {});
  assert.equal(status, 400);
  assert.match(body.error, /electionConfiguration/);
});

test('authority reaches validation: missing stationImportBatchId -> 400', async () => {
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'POST', '/api/randomization/run', {
    electionConfiguration: { id: 'EC1', requiredStrength: [{ mandalId: 'M', requiredCount: 1 }] },
    designationRules: {},
  });
  assert.equal(status, 400);
  assert.match(body.error, /stationImportBatchId/);
});

test('authority reaches validation: empty station batch -> 400', async () => {
  stationRows = [];
  try {
    const app = buildApp(AUTHORITY);
    const { status, body } = await request(app, 'POST', '/api/randomization/run', {
      electionConfiguration: { id: 'EC1', requiredStrength: [{ mandalId: 'M', requiredCount: 1 }] },
      designationRules: {},
      stationImportBatchId: 99,
    });
    assert.equal(status, 400);
    assert.match(body.error, /No polling stations/);
  } finally {
    stationRows = [{ station_id: 'ST-1', station_number: '101', mandal: 'Tuni' }];
  }
});

// --- publish (confidential -> public, authority/admin only) -----------------

test('authority reaches Mongo-backed station validation with election details', async () => {
  const { runAllocation } = require('../../src/modules/randomization/orchestrator');
  // A full 3-party run requires distinct offices; prove the route's
  // officeIdOverrides body field is what supplies them.
  const app = buildApp(AUTHORITY);
  const body = {
    electionConfiguration: {
      id: 'EC1',
      districtId: 'Kakinada',
      status: 'ready_for_randomization',
      requiredStrength: [{ mandalId: 'Kakinada', requiredCount: 6 }],
    },
    designationRules: {
      'School Assistant': { seniorityRank: 1, presidingEligible: true, microObserverEligible: true },
      Teacher: { seniorityRank: 5, presidingEligible: false, microObserverEligible: true },
    },
    stationImportBatchId: 9,
    officeIdOverrides: { 'EMP-1': 'OTHER-OFFICE' },
    districtId: 'Kakinada',
    seed: 42,
  };
  stationRows = [];
  const { status, body: response } = await request(app, 'POST', '/api/randomization/run', body);
  assert.equal(status, 400);
  assert.match(response.error, /No polling stations/);
  assert.ok(typeof runAllocation === 'function');
});

// --- publish (confidential -> public, authority/admin only) -----------------

test('publish: unauthenticated -> 401', async () => {
  const app = buildApp(undefined);
  const { status } = await request(app, 'POST', '/api/randomization/publish', { stage3Run: {} });
  assert.equal(status, 401);
});

test('publish: staff -> 403', async () => {
  const app = buildApp({ id: 2, username: 'staff1', role: 'staff' });
  const { status } = await request(app, 'POST', '/api/randomization/publish', { stage3Run: {} });
  assert.equal(status, 403);
});

test('publish: authority without stage3Run -> 400', async () => {
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'POST', '/api/randomization/publish', {});
  assert.equal(status, 400);
  assert.match(body.error, /stage3Run/);
});

test('publish: authority refuses an incomplete mapping', async () => {
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'POST', '/api/randomization/publish', {
    stage3Run: { status: 'incomplete', stage: 3, publicationStatus: 'confidential', assignments: [] },
  });
  assert.ok(status === 400 || status === 422);
  assert.equal(body.ok, false);
});

// --- ballot allocation (Phase 3 page endpoint) -------------------------------

test('ballot-allocation: unauthenticated -> 401', async () => {
  const app = buildApp(undefined);
  const { status } = await request(app, 'POST', '/api/randomization/ballot-allocation', {});
  assert.equal(status, 401);
});

test('ballot-allocation: staff -> 403', async () => {
  const app = buildApp({ id: 2, username: 'staff1', role: 'staff' });
  const { status } = await request(app, 'POST', '/api/randomization/ballot-allocation', {});
  assert.equal(status, 403);
});

test('ballot-allocation: authority without fileName -> 400', async () => {
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'POST', '/api/randomization/ballot-allocation', {});
  assert.equal(status, 400);
  assert.match(body.error, /fileName/);
});

test('ballot-allocation: authority without dataBase64 -> 400', async () => {
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'POST', '/api/randomization/ballot-allocation', {
    fileName: 'booths.xlsx',
  });
  assert.equal(status, 400);
  assert.match(body.error, /dataBase64/);
});

test.after(() => {
  stationCollection.find = originalFindStations;
  settingsCollection.findOne = originalFindSetting;
});

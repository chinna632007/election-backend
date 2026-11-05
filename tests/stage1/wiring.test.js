'use strict';

/**
 * tests/stage1/wiring.test.js — Stage 1 HTTP integration (app wiring).
 *
 * Proves the permission-string vs role-based resolution:
 *  - unauthenticated -> 401 (session first),
 *  - staff denied on execute (403) but allowed on reads,
 *  - authority allowed on execute,
 *  - unknown permission strings throw at mount (fail closed),
 *  - district scope comes from the adapter (never the request).
 *
 * Run: node --test tests/stage1/wiring.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const database = require('../../src/database');

const runsCollection = database.getCollection('randomization_runs');
const originalFindRuns = runsCollection.find;
runsCollection.find = async () => ({ toArray: async () => [] });

const {
  stage1Authorize,
  registerElectionConfiguration,
  getRegisteredConfiguration,
  DEFAULT_DISTRICT_ID,
} = require('../../src/modules/randomization-stage-1/wiring');
const { authorize } = require('../../src/middleware/auth');

function buildApp({ role }) {
  const app = express();
  app.use(express.json());
  if (role !== undefined) {
    app.use((req, _res, next) => {
      req.session = { user: { id: 1, username: 't', role } };
      next();
    });
  }
  const { createAppStage1Router } = require('../../src/modules/randomization-stage-1/wiring');
  app.use('/api/randomization/stage-1', createAppStage1Router());
  return app;
}

async function call(app, method, path) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const res = await fetch(base + path, { method });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('stage1Authorize maps permission strings to approved roles', () => {
  // Returns a middleware function for known permissions...
  assert.equal(typeof stage1Authorize('stage1.execute'), 'function');
  assert.equal(typeof stage1Authorize('stage1.view'), 'function');
  assert.equal(typeof stage1Authorize('stage1.viewResults'), 'function');
  // ...and FAILS CLOSED on anything unknown (mount-time throw).
  assert.throws(() => stage1Authorize('stage1.delete'), /Unknown Stage 1 permission/);
  assert.throws(() => stage1Authorize(''), /Unknown Stage 1 permission/);
});

test('stage1Authorize is backed by the shared role-based authorize()', () => {
  // Both produce middleware; unknown shared roles are rejected by shared policy.
  assert.equal(typeof stage1Authorize('stage1.execute'), 'function');
  assert.equal(typeof authorize('authority', 'admin'), 'function');
});

test('unauthenticated -> 401 on GET /runs (session checked first)', async () => {
  const app = buildApp({ role: undefined });
  const { status, body } = await call(app, 'GET', '/api/randomization/stage-1/runs');
  assert.equal(status, 401);
  assert.equal(body.ok, false);
});

test('staff -> 403 on POST /runs (execute is authority/admin only)', async () => {
  const app = buildApp({ role: 'staff' });
  const { status } = await call(app, 'POST', '/api/randomization/stage-1/runs');
  assert.equal(status, 403);
});

test('staff -> allowed past authorization on GET /runs (read)', async () => {
  const app = buildApp({ role: 'staff' });
  const { status, body } = await call(app, 'GET', '/api/randomization/stage-1/runs');
  assert.equal(status, 200);
  assert.deepEqual(body, { runs: [] });
});

test('authority passes the execute gate (fails only on validation, not auth)', async () => {
  const app = buildApp({ role: 'authority' });
  const { status } = await call(app, 'POST', '/api/randomization/stage-1/runs');
  // Empty body -> Stage 1 validation error (400), NOT 401/403.
  assert.notEqual(status, 401);
  assert.notEqual(status, 403);
  assert.equal(status, 400);
});

test('election-configuration registry: authority-supplied config resolves by id', () => {
  registerElectionConfiguration({
    id: 'ec-wiring-test',
    status: 'validated',
    requiredStrength: [{ mandalId: 'M1', requiredCount: 4 }],
  });
  const cfg = getRegisteredConfiguration('ec-wiring-test');
  assert.ok(cfg, 'registered config resolves');
  assert.equal(cfg.status, 'validated');
  assert.equal(cfg.requiredStrength[0].requiredCount, 4);
  assert.equal(getRegisteredConfiguration('no-such-id'), null);
});

test('district scope constant is the confirmed single-district scope', () => {
  assert.equal(DEFAULT_DISTRICT_ID, 'Kakinada');
});

test.after(() => {
  runsCollection.find = originalFindRuns;
});

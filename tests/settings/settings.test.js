'use strict';

/**
 * tests/settings/settings.test.js
 *
 * Route + service tests for the customization-center settings API
 * (migration 020 app_settings).
 *
 *   GET   /api/settings          (staff sees public subset)
 *   PATCH /api/settings/:key     (authority, admin)
 *   GET   /api/settings/changes  (authority, admin audit trail)
 *
 * Uses a real Express round-trip with safe in-memory Mongo collection stubs
 * role (no database connection). Covers auth (401/403), validation (400 on unknown
 * key / wrong type / out of range), the update round-trip, and the audit row.
 *
 * Run: node --test tests/settings/settings.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { installMongoStub } = require('../helpers/mongo-stub');
const mongo = installMongoStub();
const settingsRouter = require('../../src/modules/settings');

// --- in-memory fake of app_settings + settings_audit ----------------------
let settings = [];
let audit = [];

function seed() {
  settings = [
    { key: 'uploads.max_file_mb', value: 100, value_type: 'number', group_name: 'uploads', label: 'Max upload file size (MB)', is_public: true, updated_by: null, updated_at: '2026-10-17T00:00:00.000Z' },
    { key: 'randomization.max_attempts', value: 50, value_type: 'number', group_name: 'election', label: 'Max formation attempts', is_public: false, updated_by: null, updated_at: '2026-10-17T00:00:00.000Z' },
    { key: 'notify.preview_required', value: true, value_type: 'boolean', group_name: 'notifications', label: 'Require preview before send', is_public: true, updated_by: null, updated_at: '2026-10-17T00:00:00.000Z' },
  ];
  mongo.collection('app_settings').splice(0, mongo.collection('app_settings').length, ...settings);
  audit = [];
  mongo.collection('settings_audit').splice(0);
}

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) {
    app.use(function (req, _res, next) { req.session = { user: user }; next(); });
  }
  app.use('/api/settings', settingsRouter);
  return app;
}

async function call(app, method, path, body) {
  const server = http.createServer(app);
  await new Promise(function (resolve) { server.listen(0, resolve); });
  const port = server.address().port;
  try {
    const payload = body === undefined ? null : JSON.stringify(body);
    const res = await fetch('http://127.0.0.1:' + port + path, {
      method: method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload || undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    return { status: res.status, data: data };
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
}

const ADMIN = { id: 1, username: 'admin', role: 'admin' };
const STAFF = { id: 2, username: 'staff', role: 'staff' };

test('GET /api/settings: staff sees the public subset only', async function () {
  seed();
  const r = await call(buildApp(STAFF), 'GET', '/api/settings');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.settings.length, 2);
  assert.ok(r.data.settings.every(function (x) { return x.isPublic === true; }));
});

test('GET /api/settings: admin sees all rows', async function () {
  seed();
  const r = await call(buildApp(ADMIN), 'GET', '/api/settings');
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.length, 3);
});

test('GET /api/settings: unauthenticated -> 401', async function () {
  seed();
  const r = await call(buildApp(undefined), 'GET', '/api/settings');
  assert.equal(r.status, 401);
});

test('PATCH /api/settings/:key: valid update round-trips + audit row', async function () {
  seed();
  const r = await call(buildApp(ADMIN), 'PATCH', '/api/settings/uploads.max_file_mb', { value: 200 });
  assert.equal(r.status, 200);
  assert.equal(r.data.setting.value, 200);
  audit.push(...mongo.collection('settings_audit'));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].setting_key, 'uploads.max_file_mb');
  assert.equal(audit[0].old_value, 100);
  assert.equal(audit[0].new_value, 200);
});

test('PATCH /api/settings/:key: unknown key, wrong type, out of range -> 400', async function () {
  seed();
  const unknown = await call(buildApp(ADMIN), 'PATCH', '/api/settings/nope.not_real', { value: 1 });
  assert.equal(unknown.status, 400);
  const wrongType = await call(buildApp(ADMIN), 'PATCH', '/api/settings/uploads.max_file_mb', { value: 'lots' });
  assert.equal(wrongType.status, 400);
  const outOfRange = await call(buildApp(ADMIN), 'PATCH', '/api/settings/uploads.max_file_mb', { value: 99999 });
  assert.equal(outOfRange.status, 400);
});

test('PATCH /api/settings/:key: staff -> 403', async function () {
  seed();
  const r = await call(buildApp(STAFF), 'PATCH', '/api/settings/uploads.max_file_mb', { value: 200 });
  assert.equal(r.status, 403);
});

test('GET /api/settings/changes: audit trail for admin, denied to staff', async function () {
  seed();
  await call(buildApp(ADMIN), 'PATCH', '/api/settings/notify.preview_required', { value: false });
  const r = await call(buildApp(ADMIN), 'GET', '/api/settings/changes');
  assert.equal(r.status, 200);
  assert.equal(r.data.changes.length, 1);
  const denied = await call(buildApp(STAFF), 'GET', '/api/settings/changes');
  assert.equal(denied.status, 403);
});

test.after(function () { mongo.close(); });

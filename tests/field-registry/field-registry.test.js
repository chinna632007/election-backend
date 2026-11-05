'use strict';

/**
 * tests/field-registry/field-registry.test.js
 *
 * Route + service tests for the data-schema customization API
 * (migration 021 field_definitions).
 *
 *   GET    /api/fields/:entity
 *   POST   /api/fields            (authority, admin)
 *   PATCH  /api/fields/:id        (core: label/export only)
 *   DELETE /api/fields/:id        (custom only, soft)
 *
 * Run: node --test tests/field-registry/field-registry.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { installMongoStub } = require('../helpers/mongo-stub');
const mongo = installMongoStub();
const fieldsRouter = require('../../src/modules/field-registry');
const mongoose = require('../../src/database').mongoose;
let ids;

function seed() {
  const rows = mongo.collection('field_definitions');
  rows.splice(0, rows.length);
  ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  rows.push(
    { _id: ids[0], entity: 'personnel', field_key: 'work_mandal', label: 'Work Mandal', data_type: 'string', is_core: true, is_required: true, is_sensitive: false, import_column: 'Work Mandal', export_visible: true, enum_options: null, sort_order: 60, active: true, updated_at: '2026-10-17T00:00:00.000Z' },
    { _id: ids[1], entity: 'personnel', field_key: 'blood_group', label: 'Blood Group', data_type: 'enum', is_core: false, is_required: false, is_sensitive: true, import_column: 'Blood Group', export_visible: false, enum_options: ['A+', 'B+', 'O+'], sort_order: 100, active: true, updated_at: '2026-10-17T00:00:00.000Z' },
    { _id: ids[2], entity: 'station', field_key: 'mandal', label: 'Mandal', data_type: 'string', is_core: true, is_required: true, is_sensitive: false, import_column: 'Mandal', export_visible: true, enum_options: null, sort_order: 50, active: true, updated_at: '2026-10-17T00:00:00.000Z' }
  );
  const personnel = mongo.collection('personnel');
  personnel.splice(0, personnel.length);
}

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) {
    app.use((req, _res, next) => { req.session = { user: user }; next(); });
  }
  app.use('/api/fields', fieldsRouter);
  return app;
}

async function call(app, method, path, body) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const payload = body === undefined ? null : JSON.stringify(body);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload || undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: res.status, data };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const ADMIN = { id: 1, username: 'admin', role: 'admin' };
const STAFF = { id: 2, username: 'staff', role: 'staff' };

test.after(() => mongo.close());

test('GET /api/fields/:entity: lists active fields for the entity only', async () => {
  seed();
  const r = await call(buildApp(STAFF), 'GET', '/api/fields/personnel');
  assert.equal(r.status, 200);
  assert.equal(r.data.fields.length, 2);
  assert.ok(r.data.fields.every((f) => f.entity === 'personnel'));
});

test('GET /api/fields/:entity: bad entity -> 400; unauthenticated -> 401', async () => {
  seed();
  const bad = await call(buildApp(STAFF), 'GET', '/api/fields/nope');
  assert.equal(bad.status, 400);
  const unauth = await call(buildApp(undefined), 'GET', '/api/fields/personnel');
  assert.equal(unauth.status, 401);
});

test('POST /api/fields: creates a custom field round-trip', async () => {
  seed();
  const r = await call(buildApp(ADMIN), 'POST', '/api/fields', {
    entity: 'personnel', fieldKey: 'uniform_size', label: 'Uniform Size',
    dataType: 'enum', enumOptions: ['S', 'M', 'L'], importColumn: 'Uniform Size',
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.field.fieldKey, 'uniform_size');
  assert.equal(r.data.field.isCore, false);
  assert.equal(r.data.field.dataType, 'enum');
  assert.deepEqual(r.data.field.enumOptions, ['S', 'M', 'L']);
});

test('POST /api/fields: duplicate key, core key, bad key -> 400', async () => {
  seed();
  const dup = await call(buildApp(ADMIN), 'POST', '/api/fields', {
    entity: 'personnel', fieldKey: 'blood_group', label: 'BG', dataType: 'string',
  });
  assert.equal(dup.status, 400);
  const core = await call(buildApp(ADMIN), 'POST', '/api/fields', {
    entity: 'personnel', fieldKey: 'work_mandal', label: 'WM', dataType: 'string',
  });
  assert.equal(core.status, 400);
  const badKey = await call(buildApp(ADMIN), 'POST', '/api/fields', {
    entity: 'personnel', fieldKey: 'DROP TABLE', label: 'X', dataType: 'string',
  });
  assert.equal(badKey.status, 400);
});

test('POST /api/fields: staff -> 403', async () => {
  seed();
  const r = await call(buildApp(STAFF), 'POST', '/api/fields', {
    entity: 'personnel', fieldKey: 'x_field', label: 'X', dataType: 'string',
  });
  assert.equal(r.status, 403);
});

test('PATCH core field: label allowed; dataType/fieldKey retype rejected 400', async () => {
  seed();
  const fieldId = String(ids[0]);
  const ok = await call(buildApp(ADMIN), 'PATCH', '/api/fields/' + fieldId, { label: 'Work Mandal (Primary)' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.field.label, 'Work Mandal (Primary)');
  const retype = await call(buildApp(ADMIN), 'PATCH', '/api/fields/' + fieldId, { dataType: 'number' });
  assert.equal(retype.status, 400);
  const rename = await call(buildApp(ADMIN), 'PATCH', '/api/fields/' + fieldId, { fieldKey: 'other_key' });
  assert.equal(rename.status, 400);
});

test('PATCH custom field: un-marking sensitive refused while data exists (409)', async () => {
  seed();
  mongo.collection('personnel').push({ custom_fields: { blood_group: 'O+' } });
  const fieldId = String(ids[1]);
  const blocked = await call(buildApp(ADMIN), 'PATCH', '/api/fields/' + fieldId, { isSensitive: false });
  assert.equal(blocked.status, 409);
  mongo.collection('personnel').splice(0);
  const allowed = await call(buildApp(ADMIN), 'PATCH', '/api/fields/' + fieldId, { isSensitive: false });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.field.isSensitive, false);
});

test('DELETE: core -> 400; custom -> soft-deactivated', async () => {
  seed();
  const core = await call(buildApp(ADMIN), 'DELETE', '/api/fields/' + String(ids[0]));
  assert.equal(core.status, 400);
  const custom = await call(buildApp(ADMIN), 'DELETE', '/api/fields/' + String(ids[1]));
  assert.equal(custom.status, 200);
  assert.equal(custom.data.field.active, false);
  const list = await call(buildApp(STAFF), 'GET', '/api/fields/personnel');
  assert.equal(list.data.fields.length, 1); // blood_group no longer listed
});

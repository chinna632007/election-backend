'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { installMongoStub } = require('../helpers/mongo-stub');

const mongo = installMongoStub();
const workflowRouter = require('../../src/modules/workflow');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) {
    app.use((req, _res, next) => {
      req.session = { user };
      next();
    });
  }
  app.use('/api/workflow', workflowRouter);
  return app;
}

async function call(app, method, path, body) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test.after(() => mongo.close());

test('workflow state requires authentication and rejects invalid contexts', async () => {
  assert.equal((await call(buildApp(), 'GET', '/api/workflow/municipal/phase1')).status, 401);
  const invalid = await call(
    buildApp({ id: 1, role: 'staff' }),
    'GET',
    '/api/workflow/other/phase1'
  );
  assert.equal(invalid.status, 400);
});

test('authorized user can save and read a workflow snapshot in MongoDB', async () => {
  const authority = buildApp({ id: 7, role: 'authority' });
  const value = { batchId: 12, summary: { approved: 3 } };
  const saved = await call(authority, 'PUT', '/api/workflow/municipal/phase1', { value });
  assert.equal(saved.status, 200);

  const stored = mongo.collection('workflow_state').find(
    (record) => record.context === 'municipal' && record.phase === 'phase1'
  );
  assert.deepEqual(stored.value, value);
  assert.equal(stored.updated_by, '7');

  const read = await call(buildApp({ id: 8, role: 'staff' }), 'GET', '/api/workflow/municipal/phase1');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.value, value);
});

test('workflow state writes are limited to authority and admin', async () => {
  const result = await call(
    buildApp({ id: 8, role: 'staff' }),
    'PUT',
    '/api/workflow/municipal/phase2',
    { value: { rows: [] } }
  );
  assert.equal(result.status, 403);
});

test('saving or clearing an earlier phase invalidates dependent phase snapshots', async () => {
  const authority = buildApp({ id: 7, role: 'authority' });
  await call(authority, 'PUT', '/api/workflow/municipal/phase2', { value: { rows: [] } });
  await call(authority, 'PUT', '/api/workflow/municipal/phase3', { value: { rows: [] } });
  await call(authority, 'PUT', '/api/workflow/municipal/phase1', { value: { batchId: 22 } });

  let records = mongo.collection('workflow_state').filter((record) => record.context === 'municipal');
  assert.deepEqual(records.map((record) => record.phase), ['phase1']);

  await call(authority, 'PUT', '/api/workflow/municipal/phase2', { value: { rows: [] } });
  await call(authority, 'PUT', '/api/workflow/municipal/phase3', { value: { rows: [] } });
  await call(authority, 'PUT', '/api/workflow/municipal/training', { value: { poApoTrainingRows: [] } });
  await call(authority, 'DELETE', '/api/workflow/municipal/phase2');
  records = mongo.collection('workflow_state').filter((record) => record.context === 'municipal');
  assert.deepEqual(records.map((record) => record.phase), ['phase1']);
});

test('training phase can be saved and read', async () => {
  const authority = buildApp({ id: 7, role: 'authority' });
  const trainingData = { trainingDate: '2026-11-20', poApoTrainingRows: [{ id: 1 }] };
  const putRes = await call(authority, 'PUT', '/api/workflow/municipal/training', { value: trainingData });
  assert.equal(putRes.status, 200);

  const getRes = await call(authority, 'GET', '/api/workflow/municipal/training');
  assert.equal(getRes.status, 200);
  assert.deepEqual(getRes.body.value, trainingData);
});

test('workflow state rejects invalid phase and malformed values', async () => {
  const authority = buildApp({ id: 7, role: 'authority' });
  assert.equal(
    (await call(authority, 'PUT', '/api/workflow/municipal/not-a-phase', { value: {} })).status,
    400
  );
  assert.equal(
    (await call(authority, 'PUT', '/api/workflow/municipal/phase2', { value: [] })).status,
    400
  );
  assert.equal(
    (await call(authority, 'PUT', '/api/workflow/municipal/phase2', { value: {} })).status,
    400
  );
});

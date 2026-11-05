'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createMongoStub, installMongoStub } = require('./mongo-stub');

let operations = [];
const mongo = createMongoStub({
  onOperation(operation) { operations.push(operation); },
});
const restoreMongo = installMongoStub(mongo);
const importsRouter = require('../../src/modules/imports');

function reset({ batch = null, personnel = [] } = {}) {
  operations = [];
  mongo.data.import_batches ||= [];
  mongo.data.personnel ||= [];
  mongo.data.import_batches.splice(0, mongo.data.import_batches.length, ...(batch ? [batch] : []));
  mongo.data.personnel.splice(0, mongo.data.personnel.length, ...personnel);
}

function buildApp({ withSession }) {
  const app = express();
  app.use(express.json());
  if (withSession) {
    app.use((req, _res, next) => {
      req.session = { user: { id: '1', username: 'tester', role: 'authority' } };
      next();
    });
  }
  app.use('/api/imports', importsRouter);
  return app;
}

async function request(app, method, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const batch = {
  id: 7, file_name: 'proforma.xlsx', department_name: 'Education',
  total_rows: 2, accepted_rows: 2, status: 'completed', imported_at: '2026-01-01T00:00:00Z',
};
const personnel = {
  id: 1, import_batch_id: 7, employee_id: 'EMP1', employee_name: 'Alpha',
  designation: 'Teacher', gender: 'F', gazetted_status: 'Non-Gazetted',
  work_mandal: 'Kakinada', native_mandal: 'Peddapuram',
  working_constituency_name: 'Kakinada', import_status: 'accepted',
  exempt_category: null, aadhar_number: 'SECRET-AADHAAR',
  voter_id: 'SECRET-EPIC', mobile_no: 'SECRET-MOBILE',
};

test('unauthenticated request is rejected (401) and performs no collection operation', async () => {
  reset({ batch });
  const { status, body } = await request(buildApp({ withSession: false }), 'GET', '/api/imports/batches/1/personnel');
  assert.equal(status, 401);
  assert.equal(body.ok, false);
  assert.equal(operations.length, 0);
});

test('invalid batch id -> 400, no collection operation', async () => {
  reset({ batch });
  for (const id of ['abc', '0', '-3']) {
    operations = [];
    const { status, body } = await request(buildApp({ withSession: true }), 'GET', `/api/imports/batches/${id}/personnel`);
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(operations.length, 0);
  }
});

test('unknown batch -> 404', async () => {
  reset();
  const { status, body } = await request(buildApp({ withSession: true }), 'GET', '/api/imports/batches/999/personnel');
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test('known batch -> 200 with batch summary and camelCase personnel', async () => {
  reset({ batch, personnel: [personnel] });
  const { status, body } = await request(buildApp({ withSession: true }), 'GET', '/api/imports/batches/7/personnel');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.batch.id, '7');
  assert.equal(body.count, 1);
  assert.equal(body.personnel[0].employeeId, 'EMP1');
  assert.equal(body.personnel[0].employeeName, 'Alpha');
  assert.equal(body.personnel[0].workMandal, 'Kakinada');
  assert.equal(body.personnel[0].aadharNumber, 'SECRET-AADHAAR');
  assert.equal(body.personnel[0].mobileNo, 'SECRET-MOBILE');
  assert.equal(body.personnel[0].voterId, 'SECRET-EPIC');
  assert.ok(!Object.keys(body.personnel[0]).some((key) => key.includes('_')));
});

test('personnel Mongo projection returns Aadhaar, mobile, and voter ID', async () => {
  reset({ batch, personnel: [personnel] });
  await request(buildApp({ withSession: true }), 'GET', '/api/imports/batches/7/personnel');
  const query = operations.find((operation) => operation.collection === 'personnel' && operation.method === 'find');
  assert.ok(query);
  assert.equal(query.filter.import_batch_id, 7);
  assert.equal(query.options.projection.aadhar_number, 1);
  assert.equal(query.options.projection.mobile_no, 1);
  assert.equal(query.options.projection.voter_id, 1);
});

test.after(restoreMongo);

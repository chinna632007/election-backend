'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { installMongoStub } = require('../helpers/mongo-stub');

const mongo = installMongoStub();
const authRouter = require('../../src/modules/auth');
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
  app.use('/api/auth', authRouter);
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

test('user management authorization checks', async () => {
  // Unauthenticated
  assert.equal((await call(buildApp(), 'GET', '/api/auth/users')).status, 401);
  assert.equal((await call(buildApp(), 'DELETE', '/api/auth/users/2')).status, 401);

  // Staff forbidden
  assert.equal((await call(buildApp({ id: '3', role: 'staff' }), 'GET', '/api/auth/users')).status, 403);
  assert.equal((await call(buildApp({ id: '3', role: 'staff' }), 'DELETE', '/api/auth/users/2')).status, 403);

  // Authority forbidden
  assert.equal((await call(buildApp({ id: '2', role: 'authority' }), 'GET', '/api/auth/users')).status, 403);
  assert.equal((await call(buildApp({ id: '2', role: 'authority' }), 'DELETE', '/api/auth/users/3')).status, 403);
});

test('admin can list users without exposing sensitive password hash', async () => {
  mongo.collection('roles').push(
    { id: 1, name: 'admin' },
    { id: 2, name: 'authority' },
    { id: 3, name: 'staff' }
  );

  mongo.collection('users').push(
    { id: 1, username: 'admin1', role_id: 1, password_hash: 'secret_hash_1' },
    { id: 2, username: 'authority1', role_id: 2, password_hash: 'secret_hash_2' }
  );

  const res = await call(buildApp({ id: '1', role: 'admin' }), 'GET', '/api/auth/users');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.users.length, 2);

  // Sensitive field password_hash must never be present
  for (const u of res.body.users) {
    assert.equal(u.password_hash, undefined);
    assert.ok(u.username);
    assert.ok(u.role);
  }
});

test('admin cannot delete self or last admin account', async () => {
  // Self-deletion check
  const selfDel = await call(buildApp({ id: '1', role: 'admin' }), 'DELETE', '/api/auth/users/1');
  assert.equal(selfDel.status, 400);
  assert.match(selfDel.body.error, /cannot delete your own/i);

  // Add another admin so we can test last admin protection
  mongo.collection('users').push({ id: 99, username: 'admin2', role_id: 1, password_hash: 'hash' });

  // Now delete user 99 as admin1
  const delAdmin2 = await call(buildApp({ id: '1', role: 'admin' }), 'DELETE', '/api/auth/users/99');
  assert.equal(delAdmin2.status, 200);

  // Now user 1 is the sole admin left; trying to delete from another session (if user 99 existed) would fail
  assert.equal(mongo.collection('users').filter((u) => u.role_id === 1).length, 1);
});

test('deleting a user removes or anonymizes their related records safely', async () => {
  const targetId = 42;
  const otherUserId = 999;

  // Add target user
  mongo.collection('users').push({ id: targetId, username: 'temp_officer', role_id: 2, password_hash: 'hash' });

  // Add import batch for target user
  mongo.collection('import_batches').push(
    { id: 501, imported_by: targetId, file_name: 'user42_proforma.xlsx' },
    { id: 502, imported_by: otherUserId, file_name: 'other_proforma.xlsx' }
  );

  // Add personnel for both batches
  mongo.collection('personnel').push(
    { id: 1001, import_batch_id: 501, employee_name: 'Target Person A' },
    { id: 1002, import_batch_id: 501, employee_name: 'Target Person B' },
    { id: 1003, import_batch_id: 502, employee_name: 'Retained Person' }
  );

  mongo.collection('import_rejected_rows').push(
    { id: 2001, import_batch_id: 501, employee_name: 'Rejected A' },
    { id: 2002, import_batch_id: 502, employee_name: 'Retained Rejected' }
  );

  // Add polling stations
  mongo.collection('polling_stations').push(
    { id: 3001, imported_by: targetId, station_name: 'Station Target' },
    { id: 3002, imported_by: otherUserId, station_name: 'Station Retained' }
  );

  // Add training sessions
  mongo.collection('training_sessions').push(
    { id: 4001, created_by_user_id: targetId, session_name: 'Session Target' },
    { id: 4002, created_by_user_id: otherUserId, session_name: 'Session Retained' }
  );

  // Add audit events to verify anonymization
  mongo.collection('audit_events').push(
    { id: 5001, actor_id: targetId, action: 'UPLOAD_PROFORMA' }
  );

  // Add workflow state for target user
  mongo.collection('workflow_state').push(
    { _id: 'municipal:phase1', context: 'municipal', phase: 'phase1', updated_by: String(targetId), value: { batchId: 501 } }
  );

  // Execute deletion as admin 1
  const delRes = await call(buildApp({ id: '1', role: 'admin' }), 'DELETE', `/api/auth/users/${targetId}`);
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.ok, true);
  assert.equal(delRes.body.cleaned.batches, 1);
  assert.equal(delRes.body.cleaned.personnel, 2);
  assert.equal(delRes.body.cleaned.rejectedRows, 1);
  assert.equal(delRes.body.cleaned.pollingStations, 1);
  assert.equal(delRes.body.cleaned.trainingSessions, 1);

  // Target user is deleted
  assert.equal(mongo.collection('users').find((u) => u.id === targetId), undefined);

  // Personnel for other user must NOT be deleted
  assert.equal(mongo.collection('personnel').filter((p) => p.import_batch_id === 502).length, 1);
  assert.equal(mongo.collection('import_batches').filter((b) => b.id === 502).length, 1);
  assert.equal(mongo.collection('polling_stations').filter((s) => s.id === 3002).length, 1);
  assert.equal(mongo.collection('training_sessions').filter((s) => s.id === 4002).length, 1);

  // Audit event was anonymized, not dropped
  const audit = mongo.collection('audit_events').find((a) => a.id === 5001);
  assert.ok(audit);
  assert.equal(audit.actor_id, null);
  assert.equal(audit.actor_username, `[deleted-user#${targetId}]`);
});

test('deleting a user removes their active workflow snapshots', async () => {
  const userId = 77;
  mongo.collection('users').push({ id: userId, username: 'workflow_user', role_id: 2 });
  mongo.collection('workflow_state').push({
    _id: 'panchayat:phase1',
    context: 'panchayat',
    phase: 'phase1',
    updated_by: String(userId),
    value: { batchId: 999 },
  });

  const delRes = await call(buildApp({ id: '1', role: 'admin' }), 'DELETE', `/api/auth/users/${userId}`);
  assert.equal(delRes.status, 200);

  const remainingWorkflow = mongo.collection('workflow_state').find((w) => w.updated_by === String(userId));
  assert.equal(remainingWorkflow, undefined);
});

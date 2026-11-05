'use strict';

/**
 * tests/notifications/route-authorization.test.js
 *
 * Verifies the notification routes' authorization:
 *   unauthenticated -> 401; staff -> 403 on preview/send/deliveries;
 *   send requires confirmAllocation === true.
 * No live provider calls (routes only report channel status / preview).
 *
 * Run: node --test tests/notifications/route-authorization.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const notificationRouter = require('../../src/modules/notifications');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) {
    app.use((req, _res, next) => { req.session = { user }; next(); });
  }
  app.use('/api/notifications', notificationRouter);
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

test('unauthenticated -> 401 on channels', async () => {
  const app = buildApp(undefined);
  const { status } = await request(app, 'GET', '/api/notifications/channels');
  assert.equal(status, 401);
});

test('staff -> 403 on preview', async () => {
  const app = buildApp({ id: 2, username: 'staff1', role: 'staff' });
  const { status } = await request(app, 'POST', '/api/notifications/preview', {});
  assert.equal(status, 403);
});

test('staff -> 403 on send', async () => {
  const app = buildApp({ id: 2, username: 'staff1', role: 'staff' });
  const { status } = await request(app, 'POST', '/api/notifications/send', { confirmAllocation: true });
  assert.equal(status, 403);
});

test('authority preview succeeds (renders, no send)', async () => {
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'POST', '/api/notifications/preview', {
    recipients: [{ personnelId: 'E1', name: 'A', role: 'PO', mobile: '9999999999' }],
    party: { teamCode: 'PP-1', teamSize: 7, operationalSize: 6, members: [{ personnelId: 'E1', name: 'A', role: 'PO' }] },
    station: { stationId: 'ST-1', stationNumber: '101', stationName: 'X', mandal: 'M', district: 'D' },
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.recipients.length, 1);
});

test('authority send without confirmAllocation -> 400', async () => {
  const app = buildApp(AUTHORITY);
  const { status, body } = await request(app, 'POST', '/api/notifications/send', {
    recipients: [{ personnelId: 'E1', name: 'A', role: 'PO', mobile: '9999999999' }],
  });
  assert.equal(status, 400);
  assert.match(body.error, /confirmAllocation/);
});

test('channels status is read-only for any authenticated user', async () => {
  const app = buildApp({ id: 3, username: 'staff2', role: 'staff' });
  const { status, body } = await request(app, 'GET', '/api/notifications/channels');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.channels));
});

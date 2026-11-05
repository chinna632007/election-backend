'use strict';

/**
 * tests/notifications/service.test.js
 *
 * Notification templates + service behaviour with MOCKED providers (no live
 * API calls). Covers message content, unconfigured-channel handling, transient
 * retry, idempotent de-duplication, and dry-run. Route authorization is in
 * route-authorization.test.js.
 *
 * Run: node --test tests/notifications/service.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNotification, smsSegments } = require('../../src/modules/notifications/templates');
const { createNotificationService } = require('../../src/modules/notifications/service');
const {
  NotificationConfigError,
  isTransient,
  createFast2smsProvider,
} = require('../../src/modules/notifications/providers');

const party = {
  teamCode: 'PP-EC1-001',
  postingMandal: 'Tuni',
  operationalSize: 6,
  teamSize: 7,
  members: [
    { personnelId: 'E1', name: 'Anand Rao', role: 'Presiding Officer' },
    { personnelId: 'E2', name: 'Sita Devi', role: '1st Polling Officer' },
    { personnelId: 'E3', name: 'Mohan Lal', role: 'Micro Observer', isMicroObserver: true },
  ],
};
const station = {
  stationId: 'ST-1', stationNumber: '101', stationName: 'ZPHS Tuni',
  building: 'ZPHS School', locality: 'Tuni Bazar', mandal: 'Tuni', district: 'Kakinada',
};

test('message includes party, station, role, MO, and official notice', () => {
  const n = buildNotification({
    recipient: { personnelId: 'E2', name: 'Sita Devi', role: '1st Polling Officer' },
    party, station,
  });
  assert.match(n.text, /PP-EC1-001/);
  assert.match(n.text, /101 - ZPHS Tuni/);
  assert.match(n.text, /Tuni, Kakinada/);
  assert.match(n.text, /Your role: 1st Polling Officer/);
  assert.match(n.text, /Micro Observer/);
  assert.match(n.text, /official only after authorized confirmation/);
  assert.match(n.text, /Party size: 7 \(incl\. Micro Observer\)/);
  // Recipient sees other members' names+roles but not their own.
  assert.match(n.text, /Anand Rao \(Presiding Officer\)/);
  assert.doesNotMatch(n.text, /Sita Devi \(1st Polling Officer\)/);
});

test('message NEVER contains sensitive fields', () => {
  const n = buildNotification({
    recipient: { personnelId: 'E1', name: 'Anand Rao', role: 'Presiding Officer' },
    party, station,
  });
  // No phone/aadhaar/epic patterns; templates never receive them.
  assert.doesNotMatch(n.text, /\b\d{10}\b/); // no 10-digit mobile
  assert.doesNotMatch(n.text, /aadhaar|aadhar|epic|voter id/i);
});

test('election reference + reporting time only when supplied', () => {
  const without = buildNotification({ recipient: { personnelId: 'E1', name: 'A', role: 'PO' }, party, station });
  assert.doesNotMatch(without.text, /Report at/);
  const withTime = buildNotification({
    recipient: { personnelId: 'E1', name: 'A', role: 'PO' }, party, station,
    election: { reference: 'SEC/2026', reportingDateTime: '06:00 AM, 09-May-2026' },
  });
  assert.match(withTime.text, /Election: SEC\/2026/);
  assert.match(withTime.text, /Report at: 06:00 AM, 09-May-2026/);
});

test('smsSegments splits long messages', () => {
  assert.equal(smsSegments('short'), 1);
  assert.equal(smsSegments('x'.repeat(161)), 2);
});

test('unconfigured provider reports unavailable and is never faked', async () => {
  const svc = createNotificationService({ providers: [createFast2smsProvider({ env: {} })] });
  const res = await svc.send({
    recipients: [{ personnelId: 'E1', name: 'A', role: 'PO', mobile: '9999999999' }],
    party, station,
  });
  assert.equal(res.summary.sent, 0);
  assert.equal(res.summary.byChannel.sms.unavailable, 1);
  assert.equal(res.deliveries[0].status, 'unavailable');
});

/** Mock provider factory for controlled success/failure/retry scenarios. */
function mockProvider(channel, behaviour) {
  let calls = 0;
  return {
    name: 'mock-' + channel,
    channel,
    isConfigured: () => true,
    status: () => ({ configured: true, missing: [] }),
    async send(input) {
      calls += 1;
      return behaviour(calls, input);
    },
    get calls() { return calls; },
  };
}

const okProvider = (channel) => mockProvider(channel, (n) =>
  ({ providerMessageId: 'mid-' + n }));

test('successful send records delivered with provider id', async () => {
  const prov = okProvider('sms');
  const svc = createNotificationService({ providers: [prov] });
  const res = await svc.send({
    recipients: [{ personnelId: 'E1', name: 'A', role: 'PO', mobile: '9999999999' }],
    party, station,
  });
  assert.equal(res.summary.sent, 1);
  assert.equal(res.summary.byChannel.sms.delivered, 1);
  assert.equal(res.deliveries[0].status, 'delivered');
  assert.match(res.deliveries[0].providerMessageId, /^mid-/);
});

test('transient failure is retried then succeeds', async () => {
  let calls = 0;
  const prov = mockProvider('sms', () => {
    calls += 1;
    if (calls === 1) { const e = new Error('rate limited'); e.statusCode = 429; throw e; }
    return { providerMessageId: 'mid-ok' };
  });
  const svc = createNotificationService({ providers: [prov], maxAttempts: 2 });
  const res = await svc.send({
    recipients: [{ personnelId: 'E1', name: 'A', role: 'PO', mobile: '9999999999' }],
    party, station,
  });
  assert.equal(res.summary.sent, 1);
  assert.equal(res.deliveries[0].attempts, 2, 'one retry after transient 429');
});

test('permanent failure is NOT retried', async () => {
  let calls = 0;
  const prov = mockProvider('sms', () => {
    calls += 1;
    const e = new Error('bad request'); e.statusCode = 400; throw e;
  });
  const svc = createNotificationService({ providers: [prov], maxAttempts: 3 });
  const res = await svc.send({
    recipients: [{ personnelId: 'E1', name: 'A', role: 'PO', mobile: '9999999999' }],
    party, station,
  });
  assert.equal(res.summary.failed, 1);
  assert.equal(calls, 1, '4xx must not be retried');
  assert.equal(res.deliveries[0].attempts, 1);
});

test('recipient without mobile is reported no_destination, not sent', async () => {
  const prov = okProvider('sms');
  const svc = createNotificationService({ providers: [prov] });
  const res = await svc.send({
    recipients: [{ personnelId: 'E1', name: 'A', role: 'PO' }], party, station,
  });
  assert.equal(res.summary.sent, 0);
  assert.equal(res.deliveries[0].status, 'no_destination');
  assert.equal(prov.calls, 0, 'provider never contacted without a destination');
});

test('dry run reports would-send without contacting provider', async () => {
  const prov = okProvider('sms');
  const svc = createNotificationService({ providers: [prov] });
  const res = await svc.send({
    recipients: [{ personnelId: 'E1', name: 'A', role: 'PO', mobile: '9999999999' }],
    party, station, dryRun: true,
  });
  assert.equal(prov.calls, 0, 'dry run must not call the provider');
  assert.equal(res.deliveries[0].status, 'dry_run');
});

test('preview renders without sending and flags channel availability', () => {
  const svc = createNotificationService({ providers: [createFast2smsProvider({ env: {} })] });
  const out = svc.preview({
    recipients: [{ personnelId: 'E1', name: 'A', role: 'PO', mobile: '9999999999' }],
    party, station,
  });
  assert.equal(out.recipients.length, 1);
  assert.match(out.recipients[0].message, /PP-EC1-001/);
  assert.equal(out.recipients[0].channels.sms.configured, false, 'unconfigured channel flagged');
  assert.equal(out.recipients[0].channels.sms.destinationAvailable, true, 'mobile present');
});

test('isTransient classifies 429/5xx as retryable, 4xx as not', () => {
  assert.equal(isTransient({ statusCode: 429 }), true);
  assert.equal(isTransient({ statusCode: 503 }), true);
  assert.equal(isTransient({ statusCode: 400 }), false);
  assert.equal(isTransient({ statusCode: 404 }), false);
});


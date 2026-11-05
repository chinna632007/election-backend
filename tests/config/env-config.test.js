'use strict';

/**
 * tests/config/env-config.test.js
 *
 * Proves configuration is read from environment variables (never hardcoded):
 *  1. .env loads relative to src/config regardless of process CWD.
 *  2. Each provider takes credentials ONLY from an injected env / process.env.
 *  3. Missing configuration fails safe: actionable error naming the variable,
 *     never the value, never a fake send.
 *  4. status() output never contains credential values.
 *  5. Source scan: no hardcoded credential literals in providers.js.
 *
 * Run: node --test tests/config/env-config.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const BACKEND = path.resolve(__dirname, '..', '..');
const {
  createFast2smsProvider,
  createWhatsAppProvider,
} = require('../../src/modules/notifications/providers');

test('1. .env loads regardless of the current working directory', () => {
  const out = execFileSync(
    process.execPath,
    [
      '-e',
      `require(${JSON.stringify(path.join(BACKEND, 'src', 'config'))});` +
        'console.log(process.env.MONGODB_URI && process.env.SESSION_SECRET ? "LOADED" : "MISSING");',
    ],
    { cwd: path.join(BACKEND, '..'), encoding: 'utf8' } // run from project root, not backend/
  );
  assert.match(out, /LOADED/, 'config must resolve .env relative to src/config, not CWD');
  // The check above compares truthiness only — the actual secret values are
  // never part of the assertion or the printed output.
  assert.ok(!/mongodb(?:\+srv)?:\/\/[^ ]+/i.test(out), 'connection values must never be printed');
});

test('2. Fast2SMS credentials come only from env', () => {
  const unconfigured = createFast2smsProvider({ env: {} });
  assert.equal(unconfigured.isConfigured(), false);
  const configured = createFast2smsProvider({ env: { FAST2SMS_API_KEY: 'test-env-key-123' } });
  assert.equal(configured.isConfigured(), true);
});

test('2. WhatsApp credentials come only from env', () => {
  assert.equal(createWhatsAppProvider({ env: {} }).isConfigured(), false);
  assert.equal(
    createWhatsAppProvider({
      env: { WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '123' },
    }).isConfigured(),
    true
  );
});

test('2. Gmail provider was removed with the mail channel', () => {
  const providers = require('../../src/modules/notifications/providers');
  assert.equal(providers.createGmailProvider, undefined,
    'mail channel removed: createGmailProvider must no longer exist');
});

test('3. missing configuration -> safe, actionable NotificationConfigError', async () => {
  const p = createFast2smsProvider({ env: {} });
  await assert.rejects(
    () => p.send({ to: '9000000000', message: 'x' }),
    (err) => {
      assert.equal(err.code, 'NOTIFICATION_NOT_CONFIGURED');
      assert.ok(err.message.includes('FAST2SMS_API_KEY'), 'names the missing variable');
      return true;
    }
  );
});

test('4. status() lists variable NAMES only — never values', () => {
  const secretValue = 'SUPER-SECRET-VALUE-a1b2c3d4';
  const p = createFast2smsProvider({ env: { FAST2SMS_API_KEY: secretValue } });
  const serialized = JSON.stringify(p.status());
  assert.ok(!serialized.includes(secretValue), 'status must not leak the key');

  const p2 = createFast2smsProvider({ env: {} });
  const missingJson = JSON.stringify(p2.status());
  assert.ok(missingJson.includes('FAST2SMS_API_KEY'));
  assert.equal(p2.status().configured, false);
});

test('5. providers.js has no hardcoded credential literals', () => {
  const src = fs.readFileSync(
    path.join(BACKEND, 'src', 'modules', 'notifications', 'providers.js'),
    'utf8'
  );
  // Credentials must be sourced from env, never assigned a literal value.
  assert.ok(/apiKey\s*=\s*env\.FAST2SMS_API_KEY/.test(src), 'Fast2SMS key must come from env');
  assert.ok(/token\s*=\s*env\.WHATSAPP_ACCESS_TOKEN/.test(src), 'WhatsApp token must come from env');
  assert.ok(!/GMAIL|gmail/i.test(src), 'mail provider must be fully removed');
  // No long opaque literals assigned to credential-ish variables.
  assert.ok(
    !/(apiKey|token|accessToken|secret)\s*=\s*["'][A-Za-z0-9_\-]{20,}["']/.test(src),
    'no credential may be hardcoded'
  );
});

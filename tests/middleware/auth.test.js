'use strict';

/**
 * tests/middleware/auth.test.js
 *
 * Covers requireAuth (unchanged) and the new fail-closed authorize(...roles).
 * Run: node --test tests/middleware/auth.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { requireAuth, authorize } = require('../../src/middleware/auth');

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function makeReq(user) {
  // user === undefined -> unauthenticated (no session user)
  if (user === undefined) return {};
  return { session: { user } };
}

// --- requireAuth (unchanged behavior) --------------------------------------

test('requireAuth: 401 when unauthenticated', () => {
  const res = makeRes();
  requireAuth(makeReq(undefined), res, () => {
    throw new Error('next() must not be called');
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Not authenticated');
});

test('requireAuth: calls next() when a session user exists', () => {
  let called = false;
  requireAuth(makeReq({ id: 1, role: 'staff' }), makeRes(), () => {
    called = true;
  });
  assert.equal(called, true);
});

// --- authorize: setup-time validation (fail closed) ------------------------

test('authorize: throws when no roles are supplied', () => {
  assert.throws(() => authorize(), /at least one role/);
});

test('authorize: throws on non-string or empty-string role', () => {
  assert.throws(() => authorize(''), /non-empty string role names/);
  assert.throws(() => authorize('   '), /non-empty string role names/);
  assert.throws(() => authorize('admin', 42), /non-empty string role names/);
  assert.throws(() => authorize(null), /non-empty string role names/);
});

// --- authorize: request-time behavior --------------------------------------

test('authorize: unauthenticated request -> 401 (same as requireAuth), next not called', () => {
  const mw = authorize('authority');
  const res = makeRes();
  mw(makeReq(undefined), res, () => {
    throw new Error('next() must not be called');
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Not authenticated');
});

test('authorize: allowed role -> next() called', () => {
  const mw = authorize('authority', 'admin');
  const res = makeRes();
  let called = false;
  mw(makeReq({ id: 1, role: 'authority' }), res, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(res.statusCode, null);
});

test('authorize: denied role -> 403 Forbidden, next not called', () => {
  const mw = authorize('authority', 'admin');
  const res = makeRes();
  mw(makeReq({ id: 1, role: 'staff' }), res, () => {
    throw new Error('next() must not be called');
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Forbidden');
});

test('authorize: authenticated user with NO role -> 403, next not called', () => {
  const mw = authorize('staff');
  const res = makeRes();
  mw(makeReq({ id: 1 }), res, () => {
    throw new Error('next() must not be called');
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Forbidden');
});

test('authorize: never leaks the allowed set or internals in the 403 body', () => {
  const mw = authorize('authority', 'admin');
  const res = makeRes();
  mw(makeReq({ id: 1, role: 'staff' }), res, () => {});
  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes('authority'));
  assert.ok(!serialized.includes('admin'));
});

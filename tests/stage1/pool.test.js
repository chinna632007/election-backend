'use strict';

/**
 * Unit tests — Stage 1 target pool-size calculation.
 * Run: node --test tests/stage1/pool.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calculatePoolSize, splitPool } = require('../../src/modules/randomization-stage-1/stage1.pool');
const {
  Stage1ValidationError,
  Stage1UnresolvedRuleError,
} = require('../../src/modules/randomization-stage-1/stage1.errors');

test('[O] 120% with ceil: pool is never below the requirement product', () => {
  // required 5 -> 6.0 -> 6
  assert.equal(calculatePoolSize(5, { roundingRule: 'ceil' }), 6);
  // required 3 -> 3.6 -> 4
  assert.equal(calculatePoolSize(3, { roundingRule: 'ceil' }), 4);
  // required 10 -> 12
  assert.equal(calculatePoolSize(10, { roundingRule: 'ceil' }), 12);
});

test('floor and nearest rules behave as named', () => {
  assert.equal(calculatePoolSize(3, { roundingRule: 'floor' }), 3);
  // required 3 -> 3.6 -> 4
  assert.equal(calculatePoolSize(3, { roundingRule: 'nearest' }), 4); // 3.6 -> 4
  assert.equal(calculatePoolSize(1, { roundingRule: 'floor' }), 1); // 1.2 -> 1
  assert.equal(calculatePoolSize(5, { roundingRule: 'floor' }), 6); // exactly 6
});

test('exact multiples need no rounding under any rule', () => {
  for (const rule of ['ceil', 'floor', 'nearest']) {
    assert.equal(calculatePoolSize(10, { roundingRule: rule }), 12);
    assert.equal(calculatePoolSize(0, { roundingRule: rule }), 0);
  }
});

test('U1: absent rounding rule FAILS CLOSED with UnresolvedRuleError', () => {
  assert.throws(
    () => calculatePoolSize(5, {}),
    (err) =>
      err instanceof Stage1UnresolvedRuleError &&
      err.code === 'STAGE1_UNRESOLVED_RULE'
  );
});

test('U1: unknown rounding rule is rejected, not coerced', () => {
  assert.throws(
    () => calculatePoolSize(5, { roundingRule: 'bankers' }),
    Stage1UnresolvedRuleError
  );
  assert.throws(
    () => calculatePoolSize(5, { roundingRule: undefined }),
    Stage1UnresolvedRuleError
  );
});

test('[P] proposed default is opt-in only via proposedDefaults flag', () => {
  // Without the flag: fail closed.
  assert.throws(() => calculatePoolSize(3, {}), Stage1UnresolvedRuleError);
  // With the flag: ceil proposal applies.
  assert.equal(calculatePoolSize(3, { proposedDefaults: true }), 4);
});

test('invalid requiredCount values are rejected', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, '5', null, undefined, 2n, {}]) {
    assert.throws(
      () => calculatePoolSize(bad, { roundingRule: 'ceil' }),
      Stage1ValidationError,
      `expected rejection for ${String(bad)}`
    );
  }
});

test('large values stay within safe-integer arithmetic', () => {
  assert.equal(calculatePoolSize(1_000_000, { roundingRule: 'ceil' }), 1_200_000);
  assert.equal(calculatePoolSize(999_999, { roundingRule: 'ceil' }), 1_199_999); // 1199998.8 -> 1199999
});

test('splitPool: reserve is the excess above the requirement [O p.3(a)]', () => {
  assert.deepEqual(splitPool(6, 5), { required: 5, reserve: 1 });
  assert.deepEqual(splitPool(12, 10), { required: 10, reserve: 2 });
  assert.deepEqual(splitPool(5, 5), { required: 5, reserve: 0 });
});

test('splitPool rejects required > pool', () => {
  assert.throws(() => splitPool(5, 6), Stage1ValidationError);
});

'use strict';

/**
 * Unit tests — Stage 1 random selection.
 * Run: node --test tests/stage1/selection.test.js
 *
 * Deterministic tests use a controlled RNG seam (a simple LCG). Production
 * code uses crypto.randomInt; no test depends on uncontrolled randomness
 * returning a fixed sequence.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { selectRandom } = require('../../src/modules/randomization-stage-1/stage1.selection');
const {
  Stage1ValidationError,
  Stage1InsufficientPersonnelError,
} = require('../../src/modules/randomization-stage-1/stage1.errors');

/** Deterministic, unbiased-range RNG seam (test-only LCG). */
function makeLcg(seed) {
  let state = seed >>> 0;
  return (maxExclusive) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % maxExclusive;
  };
}

const pool = Array.from({ length: 20 }, (_, i) => ({ id: `p${i + 1}` }));

test('selects exactly the requested count', () => {
  const picked = selectRandom(pool, 6, { randomInt: makeLcg(42) });
  assert.equal(picked.length, 6);
});

test('selected members are unique (distinct personnel)', () => {
  const picked = selectRandom(pool, 20, { randomInt: makeLcg(7) });
  const ids = picked.map((p) => p.id);
  assert.equal(new Set(ids).size, 20, 'full shuffle must contain each id once');
});

test('every selected member comes from the pool', () => {
  const poolIds = new Set(pool.map((p) => p.id));
  const picked = selectRandom(pool, 8, { randomInt: makeLcg(99) });
  for (const p of picked) assert.ok(poolIds.has(p.id));
});

test('the input pool array is not mutated', () => {
  const before = pool.map((p) => p.id).join(',');
  selectRandom(pool, 5, { randomInt: makeLcg(1) });
  assert.equal(pool.map((p) => p.id).join(','), before);
});

test('different seeds give different draws (no fixed sequence dependence)', () => {
  const a = selectRandom(pool, 6, { randomInt: makeLcg(1) }).map((p) => p.id).join(',');
  const b = selectRandom(pool, 6, { randomInt: makeLcg(2) }).map((p) => p.id).join(',');
  assert.notEqual(a, b);
});

test('draw is spread across the pool, not just the first N (order-bias check)', () => {
  // With an LCG seam and 20 candidates drawing 20, positions of any given id
  // vary across seeds; check that the FIRST selection across seeds is not
  // always the first pool member.
  const firstPicks = new Set();
  for (let seed = 1; seed <= 25; seed += 1) {
    firstPicks.add(selectRandom(pool, 1, { randomInt: makeLcg(seed) })[0].id);
  }
  assert.ok(
    firstPicks.size > 1,
    'first pick must vary across RNG streams (selection must not be prefix-biased)'
  );
});

test('count === 0 returns empty selection; count === pool.length shuffles all', () => {
  assert.deepEqual(selectRandom(pool, 0, { randomInt: makeLcg(3) }), []);
  const all = selectRandom(pool, pool.length, { randomInt: makeLcg(3) });
  assert.equal(all.length, pool.length);
});

test('insufficient pool fails clearly (no partial selection)', () => {
  assert.throws(
    () => selectRandom(pool, 21, { randomInt: makeLcg(1) }),
    (err) =>
      err instanceof Stage1InsufficientPersonnelError &&
      err.details.requested === 21 &&
      err.details.available === 20
  );
});

test('invalid pool/count inputs are rejected', () => {
  assert.throws(() => selectRandom('nope', 1, {}), Stage1ValidationError);
  assert.throws(() => selectRandom(pool, -1, {}), Stage1ValidationError);
  assert.throws(() => selectRandom(pool, 1.5, {}), Stage1ValidationError);
  assert.throws(() => selectRandom(pool, NaN, {}), Stage1ValidationError);
});

test('a broken custom RNG seam cannot silently corrupt the draw', () => {
  // Seam returning an out-of-range value must raise, not wrap.
  assert.throws(
    () => selectRandom(pool, 3, { randomInt: () => 999 }),
    Stage1ValidationError
  );
  assert.throws(
    () => selectRandom(pool, 3, { randomInt: () => -1 }),
    Stage1ValidationError
  );
});

test('default RNG (crypto.randomInt) is used when no seam is given', () => {
  const picked = selectRandom(pool, 6);
  assert.equal(picked.length, 6);
  assert.equal(new Set(picked.map((p) => p.id)).size, 6);
});

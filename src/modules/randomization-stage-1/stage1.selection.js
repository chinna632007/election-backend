'use strict';

/**
 * Stage 1 — random selection (pure, testable).
 *
 * Official rule [O]: "appropriate software should be used to undertake
 * randomization of the polling personnel" (circular p.5(a)) and the 120% list
 * "should be generated ... randomly from the database" (p.5(b)).
 *
 * The circular/manual prescribes NO specific algorithm and NO seed or
 * reproducibility requirement. This module therefore:
 *  - uses an unbiased Fisher–Yates (Knuth) partial shuffle;
 *  - draws randomness through an INJECTABLE `randomInt` seam (default:
 *    Node's crypto.randomInt — a CSPRNG-backed unbiased integer generator).
 *    The seam exists so tests can be deterministic; production callers get
 *    cryptographic-strength randomness from Node's crypto module, but the
 *    module makes no claim of official reproducibility or of compliance with
 *    any prescribed algorithm, because none is prescribed.
 *
 * Guarantees (enforced):
 *  - exactly `count` DISTINCT items are returned;
 *  - every returned item comes from the input pool;
 *  - selection is not biased by names, ids, import order, or DB row order —
 *    the shuffle operates on indices via unbiased random offsets, and results
 *    are returned in draw order (a fresh random permutation each run).
 */

const { randomInt: cryptoRandomInt } = require('crypto');

const {
  Stage1ValidationError,
  Stage1InsufficientPersonnelError,
} = require('./stage1.errors');

/**
 * selectRandom(pool, count, options) -> newly drawn items (in draw order)
 *
 * @param {Array} pool           Distinct eligible candidates.
 * @param {number} count         How many distinct members to select.
 * @param {object} [options]
 * @param {(maxExclusive:number)=>number} [options.randomInt]
 *        Unbiased integer generator returning an integer in [0, maxExclusive).
 *        Defaults to crypto.randomInt. Injectable as a controlled test seam.
 * @returns {Array} a new array of `count` distinct elements from `pool`.
 */
function selectRandom(pool, count, options = {}) {
  if (!Array.isArray(pool)) {
    throw new Stage1ValidationError('pool must be an array.');
  }
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Stage1ValidationError('count must be a non-negative safe integer.', {
      count,
    });
  }
  if (count > pool.length) {
    throw new Stage1InsufficientPersonnelError(
      'Not enough eligible personnel to fill the required pool.',
      { requested: count, available: pool.length }
    );
  }

  const randomInt =
    typeof options.randomInt === 'function' ? options.randomInt : cryptoRandomInt;

  // Work on a copy of indices so input order of `pool` is never mutated and
  // selection depends only on the RNG stream.
  const indices = pool.map((_, i) => i);

  for (let i = 0; i < count; i += 1) {
    const remaining = pool.length - i;
    const offset = randomInt(remaining); // uniform in [0, remaining)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= remaining) {
      /* istanbul ignore next — defensive: broken custom seam */
      throw new Stage1ValidationError(
        'randomInt seam returned an out-of-range value.',
        { offset, remaining }
      );
    }
    const j = i + offset;
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  // Return in draw order; each selection is distinct by construction.
  return indices.slice(0, count).map((i) => pool[i]);
}

module.exports = {
  selectRandom,
};

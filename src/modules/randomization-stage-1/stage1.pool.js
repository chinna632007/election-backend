'use strict';

/**
 * Stage 1 — target pool-size calculation (pure, isolated).
 *
 * Official rule [O] (APSEC Circular No.12/USEC/2026, 27.03.2026, p.5,
 * Randomization (b)):
 *   "From updated database of available manpower in the district, a list of
 *    120% of required number of polling personnel for each Mandal should be
 *    generated (including reserve) randomly from the database. This is the
 *    first stage of randomization process."
 * Reinforced at p.3(a): the District Election Authority adds "20 percent in
 * excess of their requirement so as to keep certain personnel in reserve".
 *
 * CONFIRMED: the base of the 120% is the required number of polling personnel
 * for each Mandal (not per polling station, not district-wide lump sum).
 * UNRESOLVED [U]: the official source never states how to round when 120% of a
 * Mandal requirement is not a whole number. This module therefore FAILS CLOSED
 * unless a rounding rule is explicitly supplied. A "ceil" default exists as a
 * PROPOSAL [P] (never below 120%) but is only used when the caller explicitly
 * opts in via `proposedDefaults: true`; it is never silently applied.
 */

const {
  POOL_FACTOR_NUMERATOR,
  POOL_FACTOR_DENOMINATOR,
  ROUNDING_RULES,
} = require('./stage1.constants');

const {
  Stage1ValidationError,
  Stage1UnresolvedRuleError,
} = require('./stage1.errors');

function assertRequiredCount(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Stage1ValidationError(
      'requiredCount must be a non-negative safe integer.',
      { requiredCount: value }
    );
  }
}

function assertRoundingRuleIsApproved(rule) {
  const allowed = Object.values(ROUNDING_RULES);
  if (!allowed.includes(rule)) {
    throw new Stage1UnresolvedRuleError(
      'The rounding rule for the 120% pool is not approved. The APSEC circular ' +
        'does not prescribe a rounding method; the team must supply one ' +
        `(one of: ${allowed.join(', ')}). The module will not guess.`,
      { suppliedRule: rule ?? null }
    );
  }
}

/**
 * calculatePoolSize(requiredCount, options) -> integer pool size
 *
 * @param {number} requiredCount  Approved required strength (base) for one
 *                                Mandal [O base: per-Mandal requirement].
 * @param {object} [options]
 * @param {string} [options.roundingRule]  One of ROUNDING_RULES. Required
 *                                unless proposedDefaults is true.
 * @param {boolean} [options.proposedDefaults]  When true and no rule is
 *                                supplied, uses PROPOSED_DEFAULT_ROUNDING_RULE
 *                                (ceil) as a documented PROPOSAL [P].
 * @returns {number} pool size = round(120% of requiredCount)
 */
function calculatePoolSize(requiredCount, options = {}) {
  assertRequiredCount(requiredCount);

  let rule = options.roundingRule;
  if (rule == null && options.proposedDefaults === true) {
    // Explicit opt-in to the team-proposal default; see header.
    rule = require('./stage1.constants').PROPOSED_DEFAULT_ROUNDING_RULE;
  }
  assertRoundingRuleIsApproved(rule);

  // Compute exactly: pool = requiredCount * 6 / 5, then round.
  const numerator = requiredCount * POOL_FACTOR_NUMERATOR;
  const denominator = POOL_FACTOR_DENOMINATOR;

  let pool;
  switch (rule) {
    case ROUNDING_RULES.CEIL:
      pool = Math.ceil(numerator / denominator);
      break;
    case ROUNDING_RULES.FLOOR:
      pool = Math.floor(numerator / denominator);
      break;
    case ROUNDING_RULES.NEAREST: {
      // Round half away from zero (deterministic, no float surprises).
      const q = Math.floor(numerator / denominator);
      const r = numerator % denominator;
      pool = r * 2 >= denominator ? q + 1 : q;
      break;
    }
    /* istanbul ignore next — guarded by assertRoundingRuleIsApproved */
    default:
      throw new Stage1UnresolvedRuleError('Unreachable rounding rule.');
  }

  if (!Number.isSafeInteger(pool) || pool < 0) {
    /* istanbul ignore next */
    throw new Stage1ValidationError('Computed pool size is not a valid integer.', {
      requiredCount,
      rule,
      pool,
    });
  }
  return pool;
}

/**
 * splitPool(poolSize, requiredCount) -> { required, reserve }
 *
 * [O] The excess over the requirement "is kept in reserve" (p.3(a)); the pool
 * is "including reserve" (p.5(b)). Classification is arithmetic: the first
 * `requiredCount` members of the pool fill the requirement, the remainder are
 * reserves. No official ranking of reserves exists (U2) — this function only
 * computes counts; ordering of reserves is intentionally NOT implemented.
 */
function splitPool(poolSize, requiredCount) {
  assertRequiredCount(poolSize);
  assertRequiredCount(requiredCount);
  if (requiredCount > poolSize) {
    throw new Stage1ValidationError(
      'requiredCount cannot exceed poolSize when splitting required vs reserve.',
      { poolSize, requiredCount }
    );
  }
  return {
    required: requiredCount,
    reserve: poolSize - requiredCount,
  };
}

module.exports = {
  calculatePoolSize,
  splitPool,
};

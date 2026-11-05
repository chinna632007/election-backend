'use strict';

/**
 * Unit tests — Stage 1 eligibility filtering.
 * Run: node --test tests/stage1/eligibility.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isEligible,
  filterEligible,
} = require('../../src/modules/randomization-stage-1/stage1.eligibility');
const {
  Stage1ValidationError,
} = require('../../src/modules/randomization-stage-1/stage1.errors');

const scope = { districtId: 'd1' };

test('[O] active in-district personnel are eligible by default', () => {
  const p = { id: 'p1', isActive: true, districtId: 'd1' };
  assert.deepEqual(isEligible(p, scope), { eligible: true, reason: null });
});

test('inactive personnel are rejected', () => {
  const r = isEligible({ id: 'p1', isActive: false, districtId: 'd1' }, scope);
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'not_active');
});

test('[O] out-of-district personnel are rejected (district scoping)', () => {
  const r = isEligible({ id: 'p1', isActive: true, districtId: 'd2' }, scope);
  assert.deepEqual(r, { eligible: false, reason: 'outside_district_scope' });
});

test('optional mandal scoping applies when both sides carry mandalId', () => {
  const s = { districtId: 'd1', mandalId: 'm1' };
  assert.equal(isEligible({ id: 'a', isActive: true, districtId: 'd1', mandalId: 'm1' }, s).eligible, true);
  assert.equal(
    isEligible({ id: 'b', isActive: true, districtId: 'd1', mandalId: 'm2' }, s).reason,
    'outside_mandal_scope'
  );
  // Person without mandalId is not filtered out by mandal scope.
  assert.equal(isEligible({ id: 'c', isActive: true, districtId: 'd1' }, s).eligible, true);
});

test('[O] every exempt category from the circular is rejected', () => {
  const exempt = [
    'veterinary_staff', 'health_medical', 'nurse_anm', 'ayush_medical', 'all_india_radio',
    'doordarshan', 'bsnl_mtnl_ops', 'bank_rural_single_officer',
    'pregnant', 'breastfeeding',
  ];
  for (const cat of exempt) {
    const r = isEligible(
      { id: 'p', isActive: true, districtId: 'd1', exemptCategory: cat },
      scope
    );
    assert.equal(r.eligible, false, `category ${cat} must be exempt`);
    assert.ok(r.reason.startsWith('exempt_category:'));
  }
});

test('unknown exemptCategory values do not silently exclude', () => {
  // Not in the official list — eligibility code must not invent exclusions.
  const r = isEligible(
    { id: 'p', isActive: true, districtId: 'd1', exemptCategory: 'made_up_category' },
    scope
  );
  assert.equal(r.eligible, true);
});

test('filterEligible removes duplicate ids (distinct-personnel requirement)', () => {
  const people = [
    { id: 'p1', isActive: true, districtId: 'd1' },
    { id: 'p1', isActive: true, districtId: 'd1' },
    { id: 'p2', isActive: true, districtId: 'd1' },
  ];
  const { eligible, rejected } = filterEligible(people, scope);
  assert.equal(eligible.length, 2);
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ['duplicate_id']
  );
});

test('filterEligible reports every rejection with a reason', () => {
  const people = [
    { id: 'p1', isActive: true, districtId: 'd1' },
    { id: 'p2', isActive: false, districtId: 'd1' },
    { id: 'p3', isActive: true, districtId: 'd2' },
    { id: 'p4', isActive: true, districtId: 'd1', exemptCategory: 'doordarshan' },
  ];
  const { eligible, rejected } = filterEligible(people, scope);
  assert.deepEqual(eligible.map((p) => p.id), ['p1']);
  assert.equal(rejected.length, 3);
});

test('invalid inputs throw ValidationError', () => {
  assert.throws(() => isEligible(null, scope), Stage1ValidationError);
  assert.throws(() => isEligible({}, scope), Stage1ValidationError);
  assert.throws(
    () => isEligible({ id: 'p1', isActive: true, districtId: 'd1' }, null),
    Stage1ValidationError
  );
  assert.throws(() => filterEligible('nope', scope), Stage1ValidationError);
});

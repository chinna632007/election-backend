'use strict';

/**
 * tests/imports/exemption.mapping.test.js — circular p.61 exemption
 * resolution at import (sheet Department + row Designation).
 *
 * Run: node --test tests/imports/exemption.mapping.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveExemption } = require('../../src/modules/imports/exemption.mapping');

const cat = (dept, desig) => {
  const hit = resolveExemption(dept, desig);
  return hit ? hit.category : null;
};

test('(i) veterinary doctors and compounders', () => {
  assert.equal(cat('Animal Husbandry Department', 'Veterinary Doctor'), 'veterinary_staff');
  assert.equal(cat('Some Other Department', 'Veterinary Assistant Surgeon'), 'veterinary_staff');
  assert.equal(cat('Veterinary Hospital, Kakinada', 'Compounder'), 'veterinary_staff');
  // A bare Compounder on a non-veterinary sheet is NOT exempt.
  assert.equal(cat('Health Department', 'Compounder'), null);
  assert.equal(cat('School Education Department', 'Compounder'), null);
});

test('(ii) Health Department doctors, nurses, ANMs — dept AND designation', () => {
  assert.equal(cat('Health Department', 'Medical Officer'), 'health_medical');
  assert.equal(cat('Health Department', 'Doctor'), 'health_medical');
  assert.equal(cat('Health Department', 'Staff Nurse'), 'nurse_anm');
  assert.equal(cat('Health Department', 'ANM'), 'nurse_anm');
  // Same designations elsewhere are NOT exempt (circular limits to Health Dept).
  assert.equal(cat('Railways Department', 'Doctor'), null);
  assert.equal(cat('School Education Department', 'Medical Officer'), null);
  // A Health-sheet clerk is NOT exempt.
  assert.equal(cat('Health Department', 'Junior Assistant'), null);
});

test('(iii) Ayush medical officers', () => {
  assert.equal(cat('Ayush Department', 'Ayurvedic Medical Officer'), 'ayush_medical');
  assert.equal(cat('Ayush Department', 'Medical Officer'), 'ayush_medical');
  assert.equal(cat('School Education Department', 'BHMS Doctor'), 'ayush_medical');
  assert.equal(cat('School Education Department', 'BAMS Practitioner'), 'ayush_medical');
  // A plain MO on a non-Ayush sheet is NOT exempt.
  assert.equal(cat('School Education Department', 'Medical Officer'), null);
});

test('(iv) All India Radio and (v) Doordarshan — whole sheet', () => {
  assert.equal(cat('All India Radio', 'Programme Executive'), 'all_india_radio');
  assert.equal(cat('All India Radio', 'Clerk'), 'all_india_radio');
  assert.equal(cat('Doordarshan', 'Cameraman'), 'doordarshan');
  assert.equal(cat('Doordarshan', 'Driver'), 'doordarshan');
  // Ordinary staff elsewhere are untouched.
  assert.equal(cat('School Education Department', 'Clerk'), null);
  assert.equal(cat('School Education Department', 'School Assistant'), null);
});

test('(vi) BSNL/MTNL operational-technical staff (soft rule)', () => {
  assert.equal(cat('BSNL', 'Telecom Mechanic'), 'bsnl_mtnl_ops');
  assert.equal(cat('BSNL Kakinada', 'Junior Telecom Officer'), 'bsnl_mtnl_ops');
  // Non-technical BSNL staff are NOT auto-exempt.
  assert.equal(cat('BSNL', 'Accountant'), null);
  // Tech-sounding designations outside BSNL/MTNL are NOT exempt.
  assert.equal(cat('School Education Department', 'Electrician'), null);
});

test('(vii) bank postings are NOT auto-exempt — held pending authority review (rural + single-officer unverifiable)', () => {
  assert.equal(cat('Commercial Bank', 'Bank Officer'), 'pending_authority_confirmation');
  assert.equal(cat('State Bank of India', 'Clerk'), 'pending_authority_confirmation');
});

test('(viii) personal-status categories are never auto-derived', () => {
  // No designation/department text can produce these — manual authority flag only.
  assert.equal(cat('Health Department', 'Staff Nurse (pregnant)'), 'nurse_anm');
});

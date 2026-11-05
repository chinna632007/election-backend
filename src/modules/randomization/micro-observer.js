'use strict';

/**
 * Micro Observer assignment (pure, testable, no I/O).
 *
 * NEW REQUIREMENT (this submission): every polling party carries exactly ONE
 * Micro Observer who supervises/observes the other 5 (1+4) or 6 (1+5) party
 * members. The Micro Observer is an ADDITIONAL role — never a replacement for
 * an operational role, and never counted as one of them.
 *
 * Where this runs: AFTER Stage 2 forms the operational parties. Stage 2's
 * tested formation engine (PO + Polling Officers, distinct-office + no-own-
 * mandal + seniority rules) is NOT modified. The Micro Observer is appended
 * to each already-formed party as a distinct member.
 *
 * Eligibility (UNRESOLVED policy — kept configurable, never invented):
 *  The official circular text we verified does NOT define Micro Observer
 *  eligibility. Callers therefore supply, per designation, an explicit
 *  `microObserverEligible` boolean in `designationRules` (mirrors the existing
 *  presidingEligible pattern). A designation with no rule is treated as NOT
 *  eligible (fail closed). The circular's own mixing rules are still enforced
 *  for the MO: distinct office from every operational member, and never posted
 *  to their own work/native Mandal.
 *
 * Source: new project requirement for this submission; role/duty text is
 * [P] proposed, not an OCR-verified circular line.
 */

const { randomInt: cryptoRandomInt } = require('crypto');
const { isMandalBarred, normalizeMandal } = require('../randomization-stage-2/stage2.mandal');

/** [P] Role label used in outputs, reports and notifications. */
const MICRO_OBSERVER_ROLE = 'Micro Observer';

/** [P] Duty description — proposed wording, NOT an OCR-verified circular line. */
const MICRO_OBSERVER_DUTY =
  'Observes and supervises the functioning of the polling party at the polling station.';

function defaultRandomInt(maxExclusive) {
  return cryptoRandomInt(maxExclusive);
}

function shuffleInPlace(arr, randomInt) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function officeKeyOf(personnelId, internalById, fallbackOfficeId) {
  const p = internalById && internalById.get(String(personnelId));
  if (p && p.officeId !== undefined && p.officeId !== null && String(p.officeId).trim() !== '') {
    return String(p.officeId).trim().toLowerCase();
  }
  if (fallbackOfficeId !== undefined && fallbackOfficeId !== null) {
    return String(fallbackOfficeId).trim().toLowerCase();
  }
  return null;
}

/**
 * Plan and attach exactly one Micro Observer to every formed party.
 *
 * @param {object} args
 * @param {Array}  args.parties        Stage 2 output parties (operational members only).
 * @param {Array}  args.pool           Stage 1 pool (required+reserve) internal personnel.
 * @param {object} args.internalById   Map personnelId -> internal personnel record.
 * @param {object} args.designationRules  { designation: { microObserverEligible } }.
 * @param {function} [args.randomInt]  Injectable RNG for reproducible picks.
 * @param {boolean} [args.required]    When true (default) an unplaceable MO is
 *                                     reported as an unmet requirement (fail closed).
 * @returns {{ parties: Array, unmetRequirements: Array, assignedCount: number }}
 */
function assignMicroObservers(args) {
  const parties = (args && args.parties) || [];
  const pool = (args && args.pool) || [];
  const internalById = (args && args.internalById) || new Map();
  const designationRules = (args && args.designationRules) || {};
  const required = !args || args.required !== false;
  const rand = args && typeof args.randomInt === 'function' ? args.randomInt : defaultRandomInt;

  const unmetRequirements = [];

  // Personnel already used as an operational member of any party.
  const usedOperational = new Set();
  for (const p of parties) {
    for (const m of p.members || []) {
      usedOperational.add(String(m.personnelId));
    }
  }

  // MO-eligible candidates: in the pool, not used operationally, and carrying
  // an explicit microObserverEligible rule for their designation.
  const eligible = pool.filter(function (person) {
    const pid = String(person.id);
    if (usedOperational.has(pid)) return false;
    const rule = designationRules[person.designation];
    return !!(rule && rule.microObserverEligible === true);
  });

  const pickedAsMo = new Set();
  let assignedCount = 0;

  const partiesWithMo = parties.map(function (party) {
    // Office keys already taken by the operational members of THIS party.
    const operationalOfficeKeys = new Set();
    for (const m of party.members || []) {
      const key = officeKeyOf(m.personnelId, internalById, m.officeId);
      if (key) operationalOfficeKeys.add(key);
    }

    // Shuffle a fresh candidate list each party so picks are random but the
    // same person is never used twice.
    const candidates = shuffleInPlace(
      eligible.filter(function (c) { return !pickedAsMo.has(String(c.id)); }),
      rand
    );

    let chosen = null;
    for (const cand of candidates) {
      const key = officeKeyOf(cand.id, internalById, cand.officeId);
      if (key && operationalOfficeKeys.has(key)) continue; // distinct-office rule
      if (isMandalBarred(cand, party.postingMandal)) continue; // no-own-mandal rule
      chosen = cand;
      break;
    }

    if (!chosen) {
      unmetRequirements.push({
        code: 'MICRO_OBSERVER_NOT_ASSIGNED',
        teamCode: party.teamCode,
        message: 'No eligible Micro Observer available for party ' + party.teamCode +
          ' (distinct-office / no-own-mandal / eligibility rules).',
      });
      return party; // unchanged when no MO could be placed
    }

    pickedAsMo.add(String(chosen.id));
    assignedCount += 1;

    const operationalSize = (party.members || []).length;
    const moMember = {
      role: MICRO_OBSERVER_ROLE,
      duty: MICRO_OBSERVER_DUTY,
      personnelId: chosen.id,
      name: chosen.name,
      designation: chosen.designation,
      workMandal: chosen.workMandal,
      nativeMandal: chosen.nativeMandal,
      officeId: chosen.officeId,
      officeName: chosen.officeName !== undefined ? chosen.officeName : chosen.officeId,
      seniorityRank: chosen.seniorityRank,
      classification: chosen.classification,
      isMicroObserver: true,
    };

    return Object.assign({}, party, {
      members: (party.members || []).concat([moMember]),
      // teamSize now INCLUDES the MO; operationalSize keeps the PO+POfficers count.
      operationalSize: operationalSize,
      teamSize: operationalSize + 1,
      microObserverPersonnelId: chosen.id,
    });
  });

  return {
    parties: partiesWithMo,
    unmetRequirements: unmetRequirements,
    assignedCount: assignedCount,
  };
}

module.exports = {
  MICRO_OBSERVER_ROLE: MICRO_OBSERVER_ROLE,
  MICRO_OBSERVER_DUTY: MICRO_OBSERVER_DUTY,
  assignMicroObservers: assignMicroObservers,
};


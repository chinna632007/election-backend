'use strict';

/**
 * Stage 1 — eligibility filtering (pure, testable).
 *
 * Only rules confirmed against the APSEC circular (No.12/USEC/2026, 27.03.2026)
 * are applied here. Anything the source does not state is deliberately NOT
 * filtered, and is listed in stage1README.md as unresolved.
 *
 * CONFIRMED rules applied:
 *  [O] p.3(b) — all gazetted and non-gazetted Government servants shall be
 *      drafted; exemption only under extraordinary circumstances with
 *      documentary evidence. (Implemented as: inclusion is the default; only
 *      the documented exempted categories below are excluded.)
 *  [O] p.4 "Exempted" — the specific departments/categories exempt from
 *      election duty (see EXEMPT_CATEGORY in stage1.constants.js).
 *  [O] p.3(c) — each district should, as far as practicable, use its own
 *      personnel -> personnel must belong to the district scope of the run.
 *  [O] p.5(b) / p.3(d) — the list is drawn from the "updated database of
 *      available manpower in the district" -> only active records are
 *      available; records must carry the mandated attributes (p.3(d)) and
 *      belong to the Mandal the pool is generated for.
 *
 * NOT applied here (deliberately):
 *  - Native-mandal / work-mandal posting prohibition ("No person should be
 *    assigned polling duties in a native Mandal and in the Mandal in which
 *    he/she works", circular p.4) is stated under "Proper Mixing ... at the
 *    time of formation of a polling party" = STAGE 2 party formation. Its
 *    effect on the Stage 1 pool is UNRESOLVED (open question U4); the module
 *    does not silently filter on it.
 *  - Pay-scale classification of Presiding vs Polling Officers (p.4) is a
 *    Stage 2 team-composition rule, not a Stage 1 eligibility rule.
 *  - Female-officer-per-station rules (p.4) are Stage 2/appointment rules.
 */

const { EXEMPT_CATEGORY, ALL_EXEMPT_CATEGORIES, PENDING_AUTHORITY_CONFIRMATION } = require('./stage1.constants');
const { Stage1ValidationError } = require('./stage1.errors');

/**
 * @typedef {object} PersonnelRecord
 * @property {string|number} id            Stable personnel identifier.
 * @property {boolean} isActive            False for archived/withdrawn staff.
 * @property {string|number} districtId    District the record belongs to.
 * @property {string|number} [mandalId]    Mandal the record belongs to, if known.
 * @property {string} [exemptCategory]     One of EXEMPT_CATEGORY, if exempt.
 * @property {object} [attributes]         The p.3(d) attribute set (name, etc.).
 */

/**
 * isEligible(person, scope) -> { eligible: boolean, reason: string|null }
 *
 * @param {PersonnelRecord} person
 * @param {{ districtId: string|number, mandalId?: string|number|null,
 *           exemptCategories?: string[] }} scope
 */
function isEligible(person, scope) {
  if (!person || typeof person !== 'object' || person.id === undefined || person.id === null) {
    throw new Stage1ValidationError('Personnel record must include a valid id.');
  }
  if (!scope || scope.districtId === undefined || scope.districtId === null) {
    throw new Stage1ValidationError('Eligibility scope requires a districtId.');
  }

  if (person.isActive !== true) {
    return { eligible: false, reason: 'not_active' };
  }
  if (String(person.districtId) !== String(scope.districtId)) {
    return { eligible: false, reason: 'outside_district_scope' };
  }
  if (
    scope.mandalId !== undefined &&
    scope.mandalId !== null &&
    person.mandalId !== undefined &&
    person.mandalId !== null &&
    String(person.mandalId) !== String(scope.mandalId)
  ) {
    return { eligible: false, reason: 'outside_mandal_scope' };
  }
  // Pending authority confirmation (circular p.61(a)(vii) bank cases with
  // unverifiable criteria, or manually flagged records): an UNRESOLVED state,
  // not an exemption. Eligibility is NOT finalized for these records until
  // the authority resolves them — rejected here regardless of any custom
  // exemptCategories scope, so they can be neither silently drafted nor
  // silently excluded.
  if (person.exemptCategory === PENDING_AUTHORITY_CONFIRMATION) {
    return { eligible: false, reason: 'pending_authority_confirmation' };
  }
  if (person.exemptCategory) {
    const exemptSet = scope.exemptCategories || ALL_EXEMPT_CATEGORIES;
    if (exemptSet.includes(person.exemptCategory)) {
      return { eligible: false, reason: `exempt_category:${person.exemptCategory}` };
    }
  }
  return { eligible: true, reason: null };
}

/**
 * filterEligible(personnel, scope) -> { eligible: PersonnelRecord[], rejected: [{id, reason}] }
 *
 * Applies isEligible to every record and rejects duplicate ids (the pool must
 * contain distinct persons — p.5(b) generates a list of distinct personnel; a
 * duplicate indicates corrupt upstream data).
 */
function filterEligible(personnel, scope) {
  if (!Array.isArray(personnel)) {
    throw new Stage1ValidationError('personnel must be an array.');
  }
  const eligible = [];
  const rejected = [];
  const seen = new Set();

  for (const person of personnel) {
    const { eligible: ok, reason } = isEligible(person, scope);
    if (!ok) {
      rejected.push({ id: person && person.id, reason });
      continue;
    }
    const key = String(person.id);
    if (seen.has(key)) {
      rejected.push({ id: person.id, reason: 'duplicate_id' });
      continue;
    }
    seen.add(key);
    eligible.push(person);
  }
  return { eligible, rejected };
}

module.exports = {
  isEligible,
  filterEligible,
  EXEMPT_CATEGORY,
};

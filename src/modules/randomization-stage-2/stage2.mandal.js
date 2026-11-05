'use strict';

/**
 * Stage 2 — Mandal normalisation + posting-eligibility helper (pure).
 *
 * Why this file exists: the proforma carries Work Mandal / Native Mandal as
 * free text plus Working/Native Constituency Codes, and Stage 1 result
 * entries carry a `mandalId`. Posting Mandal values arrive from election
 * configuration / caller input in either form. All comparisons MUST go
 * through normalizeMandal so that ' GUNTUR ' === 'guntur' and code '07'
 * does not collide with name '7 ' handling, etc.
 *
 * Rules:
 *  - normalizeMandal(value) -> canonical key string, or null when missing.
 *    Trims, lower-cases, collapses inner whitespace. Accepts strings and
 *    numbers (numbers are stringified first so code 7 !== name '7 '? — both
 *    become '7'; code-vs-name collisions are therefore reported, not hidden:
 *    callers that mix code and name spaces must disambiguate upstream; this
 *    helper never silently treats them as different).
 *  - isMandalBarred(employee, postingMandal): true when the posting Mandal
 *    equals the employee's work Mandal OR native Mandal (circular p.4:
 *    "No person should be assigned polling duties in a native Mandal and in
 *    the Mandal in which he/she works"). Fails closed (returns true =
 *    barred) when the posting is missing or the employee record lacks both
 *    mandals? No — missing employee mandals mean "cannot verify", so the
 *    caller must reject the record at validation instead. Here: null posting
 *    is barred (cannot post somewhere unknown); an employee with neither
 *    work nor native mandal simply never matches, but validation forbids
 *    such records from entering the pool.
 */

function normalizeMandal(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  return s.length > 0 ? s : null;
}

/**
 * isMandalBarred(employee, postingMandal) -> boolean
 * employee: { workMandal, nativeMandal } (raw values accepted).
 */
function isMandalBarred(employee, postingMandal) {
  const posting = normalizeMandal(postingMandal);
  if (!posting) return true; // cannot verify a posting -> barred
  if (!employee || typeof employee !== 'object') return true;
  const work = normalizeMandal(employee.workMandal);
  const native = normalizeMandal(employee.nativeMandal);
  return posting === work || posting === native;
}

module.exports = {
  normalizeMandal,
  isMandalBarred,
};

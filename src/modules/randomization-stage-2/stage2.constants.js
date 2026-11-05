'use strict';

/**
 * Stage 2 — approved constants and their sources.
 *
 * Source legend:
 *  [O] Official — APSEC Circular No.12/USEC/2026 dated 27.03.2026 (per
 *      Stage 1 module verification against polling.pdf) + Employees
 *      data proforma template (blank template headers).
 *  [P] Proposed — Stage 2 implementation proposal, NOT an official rule.
 *      Team must ratify.
 *  [U] Unresolved — official source silent or not re-verified here; the
 *      module fails closed instead of guessing.
 *
 * Team-size rule [O] (Stage 1 constants, circular p.2, re-stated here for
 * Stage 2 enforcement — Stage 1 marks it informational only):
 *  per polling station 1 Presiding Officer + 5 Polling Officers;
 *  shortage (District Election Authority authorised): 1 + 4 with 3rd/4th
 *  duties merged.
 *
 * Party-formation rules [O] (circular OCR-verified 2026-10-13, pp.60-61):
 *  - Presiding Officer must be of higher scale/grade than every Polling
 *    Officer (p.60(g): "The Presiding Officer should be of higher scale /
 *    grade in comparison to all Polling Officers"; p.61(a) repeats it;
 *    seniority takes relative cadre position into account, not pay alone).
 *    The exact designation/pay mapping is [U], so the module enforces this
 *    through explicit per-employee `seniorityRank` (lower = higher
 *    scale/grade) + `presidingEligible` from an agreed mapping — never
 *    inferred from salary or designation strings.
 *  - members of a party must come from different offices/departments
 *    (p.61 "proper mixing ... at the time of formation of a polling party";
 *    p.61(c): "Two members of the polling party should not be from the
 *    same office or school");
 *  - no person posted to their work Mandal or native Mandal (p.59: posted
 *    outside place of duty and native Mandals; p.61(b)).
 */

const STAGE_NUMBER = 2;

/** [O] Default team composition: 1 Presiding + 5 Polling = 6. */
const DEFAULT_POLLING_OFFICERS_PER_PARTY = 5;

/** [O] Shortage composition, ONLY with an authorised reason: 1 + 4 = 5. */
const SHORTAGE_POLLING_OFFICERS_PER_PARTY = 4;

const PRESIDING_OFFICERS_PER_PARTY = 1;

/** [P] Team roles as they appear in output / Excel rows.
 *
 * [O] Numbered Polling Officer roles (circular p.2 + OCR of p.59):
 *  1st — Incharge of identification of electors and Marked copy of Electoral Roll;
 *  2nd — Responsible for application of Indelible Ink;
 *  3rd — Incharge of MPTC Ballot Papers;
 *  4th — Incharge of ZPTC Ballot Papers;
 *  5th — Incharge of Arrow Cross Mark Rubber Stamps + folding/hand-over of
 *    ballot papers (folds MPTC ballot vertically then horizontally, unfolds
 *    and hands to voter; while voter records that vote, folds ZPTC ballot
 *    and hands it over for the second compartment; both dropped in same box).
 * [O] Shortage 1+4 (circular p.2): duties of 3rd and 4th merged — MPTC and
 * ZPTC Ballot Papers both taken care of by the 3rd Polling Officer; no 4th
 * Polling Officer role exists in a shortage party.
 * [U] The circular gives NO duty description for the Presiding Officer on
 * the OCR-verified pages; the role is recorded with duty: null and
 * presidingDutyNeedsConfirmation: true. Nothing invented.
 */
const TEAM_ROLES = Object.freeze({
  PRESIDING_OFFICER: 'Presiding Officer',
  ASSISTANT_POLLING_OFFICER: 'Assistant Polling Officer',
  POLLING_OFFICER_1: '1st Polling Officer',
  POLLING_OFFICER_2: '2nd Polling Officer',
  POLLING_OFFICER_3: '3rd Polling Officer',
  POLLING_OFFICER_4: '4th Polling Officer',
  POLLING_OFFICER_5: '5th Polling Officer',
});

/** [P] Stage 2 run outcome — never claim complete when formation failed. */
const STAGE2_STATUS = Object.freeze({
  COMPLETED: 'completed',
  INCOMPLETE: 'incomplete',
});

/**
 * [P] Pool classification values consumed from Stage 1.
 * Must match Stage 1 POOL_CLASSIFICATION ('required' | 'reserve').
 */
const POOL_CLASSIFICATION = Object.freeze({
  REQUIRED: 'required',
  RESERVE: 'reserve',
});

/** [P] Default team-code prefix (Stage 3 uses teamCode as the join key). */
const DEFAULT_TEAM_CODE_PREFIX = 'PP';

/**
 * [U] Seniority / Presiding-eligibility mapping.
 * The circular classifies PO vs Polling Officers by pay-scale/designation,
 * but the exact designation list and pay mapping were NOT ratified. This
 * module therefore NEVER infers seniority from salary/basic-pay/scale or
 * from designation strings. Callers must supply, per employee, an explicit
 * numeric `seniorityRank` (lower number = more senior) and an explicit
 * boolean `presidingEligible` from an agreed team mapping. Missing values
 * fail closed (see stage2.errors Stage2UnresolvedRuleError).
 */
const SENIORITY_POLICY = Object.freeze({
  RANK_FIELD: 'seniorityRank',
  ELIGIBILITY_FIELD: 'presidingEligible',
  DIRECTION: 'lower_number_is_more_senior',
  INFER_FROM_PAY: false,
  INFER_FROM_DESIGNATION: false,
});

module.exports = {
  STAGE_NUMBER,
  DEFAULT_POLLING_OFFICERS_PER_PARTY,
  SHORTAGE_POLLING_OFFICERS_PER_PARTY,
  PRESIDING_OFFICERS_PER_PARTY,
  TEAM_ROLES,
  STAGE2_STATUS,
  POOL_CLASSIFICATION,
  DEFAULT_TEAM_CODE_PREFIX,
  SENIORITY_POLICY,
};

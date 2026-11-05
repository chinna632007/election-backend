'use strict';

/**
 * Stage 1 — approved constants and their sources.
 *
 * Source legend used throughout this module:
 *  [O]  Official  — stated in APSEC Circular No.12/USEC/2026 dated 27.03.2026
 *       ("Ordinary elections to MPTCs/ZPTCs — Appointment of Returning Officers
 *       and Polling Personnel and training — Instructions"), including
 *       Annexure-III (SEC-EMS randomization workflow for polling personnel).
 *       Verified against polling.pdf in the repository root via OCR.
 *  [P]  Proposed  — implementation proposal by the Stage 1 owner; NOT an
 *       official rule and NOT yet a team-ratified decision. Overridable via
 *       configuration where noted; recorded so the team can ratify or replace
 *       it in docs/DECISIONS_AND_OPEN_QUESTIONS.md (Part B).
 *  [U]  Unresolved — the official source is silent; nothing may be hard-coded.
 *       Such values must be injected via configuration and the module fails
 *       closed when they are absent.
 */

/** [O] The pool produced by Stage 1 is 120% of the requirement (p.5, Randomization (b)). */
const POOL_FACTOR_NUMERATOR = 6;
const POOL_FACTOR_DENOMINATOR = 5;

/** [O] The 20% excess exists "to keep certain personnel in reserve" (p.3(a)). */
const RESERVE_PERCENT = 20;

/** [O] Stage identifier: 1 = first level of randomization (p.5(b), Annexure-III). */
const STAGE_NUMBER = 1;

/**
 * [U] Rounding rule when 120% is not a whole number.
 * The circular/manual never states a rounding method. The module therefore
 * refuses to guess: every call to calculatePoolSize must receive an explicit
 * rule. The value below is a PROPOSAL (round up so the pool is never below
 * 120%) for the team to ratify; it is only used when a caller explicitly opts
 * in via PROPOSED_DEFAULT_ROUNDING_RULE.
 */
const ROUNDING_RULES = Object.freeze({
  CEIL: 'ceil',
  FLOOR: 'floor',
  NEAREST: 'nearest',
});

/**
 * [P] Proposed default rounding rule: round UP so the pool is never smaller
 * than 120% of the requirement. Explicitly marked as a proposal; the team must
 * ratify it (or choose another rule) before it becomes a project decision.
 */
const PROPOSED_DEFAULT_ROUNDING_RULE = ROUNDING_RULES.CEIL;

/**
 * [O] Per polling station, for the simultaneous MPTC + ZPTC poll:
 * 1 Presiding Officer + 5 Polling Officers (p.2). Where there is a shortage of
 * polling personnel the District Election Authority may appoint 1 + 4 with the
 * 3rd/4th officer duties merged (p.2).
 */
const PER_POLLING_STATION = Object.freeze({
  PRESIDING_OFFICERS: 1,
  POLLING_OFFICERS: 5,
});

/** [O] Exempted categories (circular p.4, "Exempted"). */
const EXEMPT_CATEGORY = Object.freeze({
  VETERINARY: 'veterinary_staff', // Doctors and Compounders of veterinary hospitals
  HEALTH_MEDICAL: 'health_medical', // Doctors of Health Department (circular p.61 (a)(ii))
  NURSE_ANM: 'nurse_anm', // Nurses, ANMs of Health Department
  AYUSH: 'ayush_medical', // Unani & Medical Officers of Ayush Department
  AIR: 'all_india_radio', // Staff of All India Radio
  DOORDARSHAN: 'doordarshan', // Staff of Doordarshan
  BSNL_MTNL: 'bsnl_mtnl_ops', // Operational/technical staff of BSNL, MTNL
  BANK_RURAL_SINGLE_OFFICER: 'bank_rural_single_officer',
  PREGNANT: 'pregnant', // Women in advanced stage of pregnancy / medically unfit
  BREASTFEEDING: 'breastfeeding', // Women breastfeeding a newly born child
});

/** [O] All exempt categories are excluded from the eligible pool (p.4). */
const ALL_EXEMPT_CATEGORIES = Object.freeze(Object.values(EXEMPT_CATEGORY));

/**
 * [P] Procedural marker for circular p.61(a)(vii) bank personnel whose
 * rural/single-officer-branch criteria cannot be verified from sheet data,
 * and for manually flagged records awaiting an authority decision.
 * Deliberately NOT a member of ALL_EXEMPT_CATEGORIES: it is an UNRESOLVED
 * state, not an exemption. Stage 1 treats it as not-finalized (rejected with
 * reason pending_authority_confirmation) regardless of any custom
 * exemptCategories scope — never silently eligible, never silently exempt.
 */
const PENDING_AUTHORITY_CONFIRMATION = 'pending_authority_confirmation';

/**
 * [O] The manual requires personnel records for randomization to carry, among
 * others: Name, Gender, Contact No. (Mobile), Designation, Office and
 * Department/Institution, Place of residence, Work place, Native Mandal,
 * Assembly Constituency (p.3(d)).
 */
const REQUIRED_PERSONNEL_ATTRIBUTES = Object.freeze([
  'name',
  'gender',
  'mobile',
  'designation',
  'office',
  'department',
  'residencePlace',
  'workPlace',
  'nativeMandal',
  'assemblyConstituency',
]);

/**
 * [P] Pool classification values persisted on each Stage 1 result entry and
 * consumed by Stage 2. "required" = the portion that fills the requirement;
 * "reserve" = the 20% excess held in reserve. The official source says reserves
 * exist but does not define a machine-readable marker; the names are a
 * proposed contract detail for the team to ratify.
 */
const POOL_CLASSIFICATION = Object.freeze({
  REQUIRED: 'required',
  RESERVE: 'reserve',
});

/**
 * [P] Run status values for Stage 1 runs (proposed; DATABASE_DESIGN.md marks
 * run statuses as TBD). Only 'completed' runs are exposed to Stage 2.
 */
const RUN_STATUS = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SUPERSEDED: 'superseded',
});

module.exports = {
  POOL_FACTOR_NUMERATOR,
  POOL_FACTOR_DENOMINATOR,
  RESERVE_PERCENT,
  STAGE_NUMBER,
  ROUNDING_RULES,
  PROPOSED_DEFAULT_ROUNDING_RULE,
  PER_POLLING_STATION,
  EXEMPT_CATEGORY,
  ALL_EXEMPT_CATEGORIES,
  PENDING_AUTHORITY_CONFIRMATION,
  REQUIRED_PERSONNEL_ATTRIBUTES,
  POOL_CLASSIFICATION,
  RUN_STATUS,
};

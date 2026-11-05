'use strict';

/**
 * Randomization Stage 2 — module entry point (owned by Teammate 2).
 *
 * Forms polling parties (1 Presiding Officer + 5 Polling Officers by
 * default; 1+4 only with an authorised shortage reason) from a completed
 * Stage 1 run's employee pool.
 *
 * Consumes Stage 1 ONLY as data (run + enriched employee pool); never
 * re-selects or invents personnel. Produces teams with unique teamCodes
 * for Stage 3, plus Excel-ready rows (no Aadhaar / mobile).
 *
 * Pure logic: no database, no Excel parsing/export, no routes, no app
 * wiring. Shared infrastructure (DB, auth, audit, migrations) is out of
 * scope until the team approves it — same dormant-port posture as Stage 1.
 *
 * Direct use:
 *   const { formPollingParties } = require('./modules/randomization-stage-2');
 *   const out = formPollingParties({ stage1Run, employees, options });
 *
 * See stage2README.md for rules, inputs, outputs, and limitations.
 */

const { createStage2Service } = require('./stage2.service');
const { formPollingParties } = require('./stage2.api');
const {
  validateStage2Request,
  validateStage1Run,
  validateEmployee,
  validateOptions,
} = require('./stage2.validator');
const {
  formParties,
  formPartiesWithFallback,
  partyIsValid,
  roleForSlot,
  dutyForSlot,
  buildTeamCode,
  electionShortOf,
  toExcelRows,
} = require('./stage2.formation');
const { normalizeMandal, isMandalBarred } = require('./stage2.mandal');
const constants = require('./stage2.constants');
const duties = require('./stage2.duties');
const errors = require('./stage2.errors');

module.exports = {
  formPollingParties: formPollingParties,
  createStage2Service: createStage2Service,
  validateStage2Request: validateStage2Request,
  validateStage1Run: validateStage1Run,
  validateEmployee: validateEmployee,
  validateOptions: validateOptions,
  formParties: formParties,
  formPartiesWithFallback: formPartiesWithFallback,
  partyIsValid: partyIsValid,
  roleForSlot: roleForSlot,
  dutyForSlot: dutyForSlot,
  buildTeamCode: buildTeamCode,
  electionShortOf: electionShortOf,
  toExcelRows: toExcelRows,
  normalizeMandal: normalizeMandal,
  isMandalBarred: isMandalBarred,
  constants: constants,
  duties: duties,
  errors: errors,
};

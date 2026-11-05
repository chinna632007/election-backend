'use strict';

/**
 * Stage 1 — request validation.
 *
 * NOTE ON CONTRACT FIELDS: docs/API_CONTRACTS.md defines only conceptual
 * boundaries ("start a Stage 1 run for an election"); concrete field names
 * are a Phase-2 team decision. The fields validated here are the minimum
 * proposed contract (marked [P] in stage1README.md) and are intentionally
 * few: the run is scoped by the election configuration; district scope is
 * NEVER taken from the request body — it must come from the authenticated
 * user's claims (see stage1.controller.js), so a client cannot gain access to
 * another district by changing a parameter.
 */

const { Stage1ValidationError } = require('./stage1.errors');
const { PROPOSED_DEFAULT_ROUNDING_RULE, ROUNDING_RULES } = require('./stage1.constants');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * validateExecuteRunRequest(body) -> { electionConfigurationId, roundingRule }
 *
 * Proposed request schema [P]:
 * {
 *   "electionConfigurationId": "ec-2026-001",   // required, non-empty string
 *   "roundingRule": "ceil"                      // optional; must be an approved
 *                                               //  rule if present; otherwise the
 *                                               //  server-side proposal applies
 * }
 */
function validateExecuteRunRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Stage1ValidationError('Request body must be a JSON object.');
  }

  const { electionConfigurationId, roundingRule } = body;

  if (!isNonEmptyString(electionConfigurationId)) {
    throw new Stage1ValidationError(
      'electionConfigurationId is required and must be a non-empty string.',
      { field: 'electionConfigurationId' }
    );
  }
  if (electionConfigurationId.length > 128) {
    throw new Stage1ValidationError(
      'electionConfigurationId must not exceed 128 characters.',
      { field: 'electionConfigurationId' }
    );
  }

  if (roundingRule !== undefined) {
    if (!Object.values(ROUNDING_RULES).includes(roundingRule)) {
      throw new Stage1ValidationError(
        `roundingRule must be one of: ${Object.values(ROUNDING_RULES).join(', ')}.`,
        { field: 'roundingRule', value: roundingRule }
      );
    }
  }

  return {
    electionConfigurationId: electionConfigurationId.trim(),
    roundingRule: roundingRule || PROPOSED_DEFAULT_ROUNDING_RULE,
  };
}

/**
 * validateRunId_param(value) -> normalized run id string
 * Used for GET /runs/:runId style requests.
 */
function validateRunIdParam(value) {
  if (!isNonEmptyString(value) || value.length > 128) {
    throw new Stage1ValidationError(
      'runId path parameter is required and must be a non-empty string (max 128 chars).',
      { field: 'runId' }
    );
  }
  return value.trim();
}

module.exports = {
  validateExecuteRunRequest,
  validateRunIdParam,
};

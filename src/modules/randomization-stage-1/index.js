'use strict';

/**
 * Randomization Stage 1 — module entry point (owned by Teammate 1).
 *
 * Exports the module's public surface. The application wires the Mongo-backed
 * repository through wiring.js. See stage1README.md for rules and API contracts.
 */

const {
  createStage1Service,
  normalizeRequiredStrength,
  validateResultInvariants,
} = require('./stage1.service');
const {
  createInMemoryStage1Repository,
  createMongoStage1Repository,
} = require('./stage1.repository');
const { createStage1Controller, toErrorResponse } = require('./stage1.controller');
const { createStage1Router } = require('./stage1.routes');
const { calculatePoolSize, splitPool } = require('./stage1.pool');
const { isEligible, filterEligible } = require('./stage1.eligibility');
const { selectRandom } = require('./stage1.selection');
const {
  validateExecuteRunRequest,
  validateRunIdParam,
} = require('./stage1.validator');
const constants = require('./stage1.constants');
const errors = require('./stage1.errors');

module.exports = {
  // Factories
  createStage1Service,
  createStage1Repository: createInMemoryStage1Repository, // reference impl alias
  createInMemoryStage1Repository,
  createMongoStage1Repository,
  createStage1Controller,
  createStage1Router,
  // Pure logic (also exported for tests)
  calculatePoolSize,
  splitPool,
  isEligible,
  filterEligible,
  selectRandom,
  validateExecuteRunRequest,
  validateRunIdParam,
  normalizeRequiredStrength,
  validateResultInvariants,
  toErrorResponse,
  // Contracts
  constants,
  errors,
};

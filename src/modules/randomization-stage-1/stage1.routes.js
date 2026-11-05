'use strict';

/**
 * Stage 1 — HTTP routes (PROPOSED paths; see stage1README.md § API contract).
 *
 *   POST   /api/randomization/stage-1/runs            execute Stage 1
 *   GET    /api/randomization/stage-1/runs            list run summaries
 *   GET    /api/randomization/stage-1/runs/:runId     run summary
 *   GET    /api/randomization/stage-1/runs/:runId/results
 *          personnel-level results (required/reserve markings)
 *
 * These paths implement the capabilities named in docs/API_CONTRACTS.md
 * ("start a Stage 1 run for an election, view run status, view the selected
 * pool with reserve markings, list historical runs"); the exact paths are a
 * PROPOSAL pending the Phase-2 team contract.
 *
 * Authentication/authorization: the router factory REQUIRES the shared
 * `authenticate` middleware and an `authorize` function to be injected. Since
 * the shared auth middleware does not exist yet, this factory THROWS when they
 * are not supplied — Stage 1 endpoints can never be mounted unauthenticated.
 * That is deliberate fail-closed behavior.
 */

const express = require('express');
const { createStage1Controller } = require('./stage1.controller');

/**
 * createStage1Router({ service, authenticate, authorize })
 *
 * @param {object} service       From createStage1Service.
 * @param {Function} authenticate  Shared JWT middleware (req,res,next).
 * @param {Function} authorize(permission) -> middleware; the shared permission
 *                                 matrix is unresolved (open question B6); the
 *                                 permission strings used here ('stage1.execute',
 *                                 'stage1.view', 'stage1.viewResults') are a
 *                                 PROPOSAL for the team to ratify.
 */
function createStage1Router({ service, authenticate, authorize }) {
  if (typeof authenticate !== 'function' || typeof authorize !== 'function') {
    throw new Error(
      'createStage1Router requires the shared authenticate middleware and an ' +
        'authorize factory. Stage 1 endpoints must never be mounted without ' +
        'authentication and authorization.'
    );
  }

  const router = express.Router();
  const controller = createStage1Controller({ service });

  router.post(
    '/runs',
    authenticate,
    authorize('stage1.execute'),
    controller.executeRun
  );
  router.get(
    '/runs',
    authenticate,
    authorize('stage1.view'),
    controller.listRuns
  );
  router.get(
    '/runs/:runId',
    authenticate,
    authorize('stage1.view'),
    controller.getRun
  );
  // Personnel-level data: stricter permission than summaries (confidentiality).
  router.get(
    '/runs/:runId/results',
    authenticate,
    authorize('stage1.viewResults'),
    controller.getResults
  );

  return router;
}

module.exports = {
  createStage1Router,
};

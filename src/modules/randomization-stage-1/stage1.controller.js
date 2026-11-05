'use strict';

/**
 * Stage 1 — HTTP controller (thin; no business logic, no SQL).
 *
 * The shared Express app (src/app.js), auth middleware (src/middleware/auth.js)
 * and centralized error handler do NOT exist yet (they are Phase-3 shared
 * infrastructure). This controller therefore:
 *  - derives the actor from `req.actor` — the field the future JWT middleware
 *    is expected to populate (PROPOSED contract: {id, districtId, roles});
 *  - maps known Stage 1 errors to the proposed status codes via toErrorResponse;
 *  - delegates everything else to the service.
 * It is exported for mounting by the shared app later; nothing is wired now.
 */

const {
  Stage1Error,
  Stage1ValidationError,
  Stage1AuthorizationError,
} = require('./stage1.errors');

/**
 * toErrorResponse(err) -> { status, body }
 * Centralized, safe mapping: never leaks SQL, stack traces, or tokens.
 * [P] response shape — to be reconciled with the shared error handler when
 * that middleware exists.
 */
function toErrorResponse(err) {
  if (err instanceof Stage1Error) {
    return {
      status: err.statusCode,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
    };
  }
  // Unknown errors are reported generically; details go to server logs only.
  return {
    status: 500,
    body: {
      error: {
        code: 'STAGE1_INTERNAL_ERROR',
        message: 'An unexpected error occurred while processing Stage 1.',
      },
    },
  };
}

/** Extract the actor from the request (proposed: set by shared JWT middleware). */
function actorFromRequest(req) {
  if (!req || !req.actor) {
    throw new Stage1AuthorizationError('Authentication required.');
  }
  return req.actor;
}

/**
 * createStage1Controller({ service }) -> handlers
 * Handlers: executeRun, getRun, listRuns, getResults.
 */
function createStage1Controller({ service }) {
  if (!service) {
    throw new Stage1ValidationError('Stage 1 controller requires a service.');
  }

  async function executeRun(req, res) {
    try {
      const actor = actorFromRequest(req);
      const summary = await service.executeRun(req.body, actor);
      res.status(201).json(summary);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  }

  async function getRun(req, res) {
    try {
      const actor = actorFromRequest(req);
      const summary = await service.getRunSummary(req.params.runId, actor);
      res.status(200).json(summary);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  }

  async function listRuns(req, res) {
    try {
      const actor = actorFromRequest(req);
      const summaries = await service.listRunSummaries(req.query, actor);
      res.status(200).json({ runs: summaries });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  }

  async function getResults(req, res) {
    try {
      const actor = actorFromRequest(req);
      const payload = await service.getRunResults(req.params.runId, actor);
      res.status(200).json(payload);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  }

  return { executeRun, getRun, listRuns, getResults };
}

module.exports = {
  createStage1Controller,
  toErrorResponse,
};

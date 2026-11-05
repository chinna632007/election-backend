'use strict';

/**
 * Stage 2 — direct-call entry point (pure, no I/O, no DB).
 *
 * formPollingParties({ stage1Run, employees, options }) is the simplest way
 * to run Stage 2 directly (e.g. node -e). It creates a default service with
 * cryptographic randomness and runs one formation attempt set.
 *
 * For deterministic runs (demos, re-verification), pass options.seed or a
 * custom randomInt via createStage2Service instead.
 */

const { createStage2Service } = require('./stage2.service');

function formPollingParties(input, deps) {
  const service = createStage2Service(deps || {});
  return service.executeFormation(input);
}

module.exports = { formPollingParties: formPollingParties };

'use strict';

/**
 * Stage 3 module — in-process API. Mirrors stage2.api.js.
 *
 * This is a plain function interface, NOT an Express router: Stage 3 has no
 * durable run/station tables yet (that is a separate, approved migration
 * step). It consumes the Stage 2 output object directly, so the two stages can
 * be exercised and tested end-to-end in memory before any HTTP surface exists.
 *
 * Consumes Stage 2 output (joined by teamCode):
 *   { stage:2, runId, stage1RunId, electionConfigurationId, districtId,
 *     status:'completed', parties:[{teamCode, teamSize, postingMandal,...}] }
 * Requires caller-supplied pollingStations: [{ stationId, stationCode?, mandal? }].
 *
 * Confidentiality (circular p.62): executeMapping() returns CONFIDENTIAL data;
 * publish() is the only way to reveal it, and the caller must authorize that.
 */

const { createStage3Service } = require('./stage3.service');
const errors = require('./stage3.errors');
const validator = require('./stage3.validator');

function createStage3Api(service) {
  if (!service || typeof service.executeMapping !== 'function') {
    throw new errors.Stage3ValidationError('createStage3Api requires a Stage 3 service.');
  }
  return {
    executeMapping: function (input) {
      return service.executeMapping(input);
    },
    publish: function (run) {
      return service.publish(run);
    },
  };
}

const stage3Service = createStage3Service();

module.exports = {
  errors: errors,
  validator: validator,
  createStage3Service: createStage3Service,
  createStage3Api: createStage3Api,
  executeMapping: stage3Service.executeMapping,
  publish: stage3Service.publish,
};


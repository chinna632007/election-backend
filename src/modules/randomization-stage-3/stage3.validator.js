'use strict';

/**
 * Stage 3 — input validation (pure, no I/O).
 *
 * Consumes the Stage 2 output object (see stage2.service.js return shape):
 *   { stage:2, stage1RunId, electionConfigurationId, districtId, status,
 *     parties:[{ teamCode, teamSize, postingMandal, members:[...] }], ... }
 * plus a caller-supplied list of polling stations.
 *
 * Sensitive fields: Stage 3 never reads or echoes Aadhaar / voter ID / mobile.
 * Only teamCode + station identity cross this boundary.
 */

const { Stage3ValidationError, Stage3UnresolvedRuleError } = require('./stage3.errors');

const SENSITIVE_FIELDS = ['aadhaar', 'aadhar', 'mobile', 'phone', 'contactNo', 'voterId', 'epic'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateStage2Run(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw new Stage3ValidationError('stage2Run must be an object.');
  }
  if (!isNonEmptyString(run.electionConfigurationId)) {
    throw new Stage3ValidationError('stage2Run.electionConfigurationId is required.', {
      field: 'stage2Run.electionConfigurationId',
    });
  }
  if (run.districtId === undefined || run.districtId === null || String(run.districtId).trim() === '') {
    throw new Stage3ValidationError('stage2Run.districtId is required.', { field: 'stage2Run.districtId' });
  }
  if (run.stage !== 2) {
    throw new Stage3ValidationError('stage2Run.stage must be 2.', { field: 'stage2Run.stage' });
  }
  if (run.status !== 'completed') {
    throw new Stage3ValidationError(
      'Stage 3 refuses to run without a completed Stage 2 run.',
      { field: 'stage2Run.status', value: run.status }
    );
  }
  if (!Array.isArray(run.parties) || run.parties.length === 0) {
    throw new Stage3ValidationError('stage2Run.parties must be a non-empty array.', {
      field: 'stage2Run.parties',
    });
  }
  return {
    stage2RunId: run.runId !== undefined && run.runId !== null ? run.runId : null,
    stage1RunId: run.stage1RunId !== undefined ? run.stage1RunId : null,
    electionConfigurationId: run.electionConfigurationId.trim(),
    districtId: run.districtId,
  };
}

function validateParty(raw, index) {
  const where = 'parties[' + index + ']';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Stage3ValidationError(where + ' must be an object.', { field: where });
  }
  if (!isNonEmptyString(raw.teamCode)) {
    throw new Stage3ValidationError(where + '.teamCode is required (Stage 3 join key).', {
      field: where + '.teamCode',
    });
  }
  if (typeof raw.teamSize !== 'number' || !Number.isSafeInteger(raw.teamSize) || raw.teamSize <= 0) {
    throw new Stage3ValidationError(where + '.teamSize must be a positive integer.', {
      field: where + '.teamSize',
    });
  }
  // Only the join-relevant shape is kept, plus member mandals when present
  // (needed for the near-mandal station check; member rosters stay owned by
  // Stage 2 — these are mandals only, never identities).
  const members = Array.isArray(raw.members)
    ? raw.members.map(function (m) {
      return {
        workMandal: m && m.workMandal !== undefined ? m.workMandal : null,
        nativeMandal: m && m.nativeMandal !== undefined ? m.nativeMandal : null,
      };
    })
    : [];
  return {
    teamCode: raw.teamCode.trim(),
    teamSize: raw.teamSize,
    postingMandal: isNonEmptyString(raw.postingMandal) ? raw.postingMandal.trim() : null,
    members: members,
  };
}

function validateStation(raw, index) {
  const where = 'pollingStations[' + index + ']';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Stage3ValidationError(where + ' must be an object.', { field: where });
  }
  if (raw.stationId === undefined || raw.stationId === null || String(raw.stationId).trim() === '') {
    throw new Stage3ValidationError(where + '.stationId is required.', { field: where + '.stationId' });
  }
  const stationCode = isNonEmptyString(raw.stationCode) ? raw.stationCode.trim() : null;
  return {
    stationId: String(raw.stationId).trim(),
    stationCode: stationCode,
    stationName: isNonEmptyString(raw.stationName) ? raw.stationName.trim() : null,
    buildingName: isNonEmptyString(raw.buildingName) ? raw.buildingName.trim() : null,
    street: isNonEmptyString(raw.street) ? raw.street.trim() : null,
    locality: isNonEmptyString(raw.locality) ? raw.locality.trim() : null,
    ward: isNonEmptyString(raw.ward) ? raw.ward.trim() : null,
    district: isNonEmptyString(raw.district) ? raw.district.trim() : null,
    mandal: isNonEmptyString(raw.mandal) ? raw.mandal.trim() : null,
    pinCode: isNonEmptyString(raw.pinCode) ? raw.pinCode.trim() : null,
  };
}


function validateOptions(raw) {
  const options = {};
  if (raw === undefined || raw === null) return options;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Stage3ValidationError('options must be an object.');
  }
  const sensitive = SENSITIVE_FIELDS.filter(function (f) { return raw[f] !== undefined; });
  if (sensitive.length > 0) {
    throw new Stage3ValidationError(
      'Stage 3 does not accept sensitive fields on options: ' + sensitive.join(', ') + '.'
    );
  }
  // Mapping mode: only one_to_one is approved. Fail closed on anything else
  // rather than invent surplus/deficit mapping behaviour.
  let mode = 'one_to_one';
  if (raw.mappingMode !== undefined && raw.mappingMode !== null) {
    if (raw.mappingMode !== 'one_to_one') {
      throw new Stage3UnresolvedRuleError(
        'Only one_to_one mapping is approved. Surplus/deficit handling is unresolved; ' +
        'do not request another mode until ratified.'
      );
    }
    mode = raw.mappingMode;
  }
  options.mappingMode = mode;
  // maxAttempts: number of random bijection retries for the duty-mandala constraint.
  options.maxAttempts = 50;
  if (raw.maxAttempts !== undefined && raw.maxAttempts !== null) {
    if (typeof raw.maxAttempts !== 'number' || !Number.isSafeInteger(raw.maxAttempts) || raw.maxAttempts < 1) {
      throw new Stage3ValidationError('options.maxAttempts must be a positive integer.');
    }
    options.maxAttempts = raw.maxAttempts;
  }
  // Near-mandal adjacency (migration 019): [{ mandal_name, near_mandal_names[] }].
  // When supplied and non-empty, Stage 3 maps each team only to stations in
  // mandals adjacent to every member's work/native mandal. Members arrive via
  // options.teamMembers ({ teamCode: [members] }). Empty/omitted keeps the
  // legacy random mapping.
  let mandalAdjacency = [];
  if (raw.mandalAdjacency !== undefined && raw.mandalAdjacency !== null) {
    if (!Array.isArray(raw.mandalAdjacency)) {
      throw new Stage3ValidationError('mandalAdjacency must be an array.');
    }
    mandalAdjacency = raw.mandalAdjacency;
  }
  options.mandalAdjacency = mandalAdjacency;
  let teamMembers = null;
  if (raw.teamMembers !== undefined && raw.teamMembers !== null) {
    if (typeof raw.teamMembers !== 'object' || Array.isArray(raw.teamMembers)) {
      throw new Stage3ValidationError('teamMembers must be an object keyed by teamCode.');
    }
    teamMembers = raw.teamMembers;
  }
  options.teamMembers = teamMembers;
  return options;
}

function validateStage3Request(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Stage3ValidationError('Request body must be an object.');
  }
  const stage2Run = validateStage2Run(input.stage2Run);
  if (!Array.isArray(input.pollingStations) || input.pollingStations.length === 0) {
    throw new Stage3ValidationError('pollingStations must be a non-empty array.', {
      field: 'pollingStations',
    });
  }
  const parties = input.stage2Run.parties.map(function (p, i) { return validateParty(p, i); });
  const pollingStations = input.pollingStations.map(function (s, i) { return validateStation(s, i); });

  // Duplicate teamCodes / stationIds would make the mapping ambiguous.
  const teamCodes = new Set();
  for (const p of parties) {
    if (teamCodes.has(p.teamCode)) {
      throw new Stage3ValidationError('Duplicate teamCode in parties: ' + p.teamCode + '.');
    }
    teamCodes.add(p.teamCode);
  }
  const stationIds = new Set();
  for (const s of pollingStations) {
    if (stationIds.has(s.stationId)) {
      throw new Stage3ValidationError('Duplicate stationId in pollingStations: ' + s.stationId + '.');
    }
    stationIds.add(s.stationId);
  }

  const options = validateOptions(input.options);
  return { stage2Run: stage2Run, parties: parties, pollingStations: pollingStations, options: options };
}

module.exports.validateStage2Run = validateStage2Run;
module.exports.validateParty = validateParty;
module.exports.validateStation = validateStation;
module.exports.validateOptions = validateOptions;
module.exports.validateStage3Request = validateStage3Request;
module.exports.SENSITIVE_FIELDS = SENSITIVE_FIELDS;

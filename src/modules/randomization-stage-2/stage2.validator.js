'use strict';

const {
  DEFAULT_POLLING_OFFICERS_PER_PARTY,
  SHORTAGE_POLLING_OFFICERS_PER_PARTY,
} = require('./stage2.constants');
const {
  Stage2ValidationError,
  Stage2UnresolvedRuleError,
} = require('./stage2.errors');
const { normalizeMandal } = require('./stage2.mandal');

const SENSITIVE_FIELDS = ['aadhaar', 'aadhar', 'mobile', 'phone', 'contactNo'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateStage1Run(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw new Stage2ValidationError('stage1Run must be an object.');
  }
  if (!isNonEmptyString(run.runId)) {
    throw new Stage2ValidationError('stage1Run.runId is required.', { field: 'stage1Run.runId' });
  }
  if (!isNonEmptyString(run.electionConfigurationId)) {
    throw new Stage2ValidationError('stage1Run.electionConfigurationId is required.', {
      field: 'stage1Run.electionConfigurationId',
    });
  }
  if (run.districtId === undefined || run.districtId === null
      || String(run.districtId).trim() === '') {
    throw new Stage2ValidationError('stage1Run.districtId is required.', {
      field: 'stage1Run.districtId',
    });
  }
  if (run.stage !== 1) {
    throw new Stage2ValidationError('stage1Run.stage must be 1.', { field: 'stage1Run.stage' });
  }
  if (run.status !== 'completed') {
    throw new Stage2ValidationError(
      'Stage 2 refuses to run without a completed Stage 1 run.',
      { field: 'stage1Run.status', value: run.status }
    );
  }
  return {
    runId: run.runId.trim(),
    electionConfigurationId: run.electionConfigurationId.trim(),
    districtId: run.districtId,
  };
}

function validateEmployee(raw, index) {
  const where = 'employees[' + index + ']';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Stage2ValidationError(where + ' must be an object.', { field: where });
  }
  const strippedSensitive = SENSITIVE_FIELDS.filter(function (f) { return raw[f] !== undefined; });
  if (raw.personnelId === undefined || raw.personnelId === null
      || String(raw.personnelId).trim() === '') {
    throw new Stage2ValidationError(where + '.personnelId is required.', { field: where + '.personnelId' });
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new Stage2ValidationError(where + '.name is required.', { field: where + '.name' });
  }
  if (typeof raw.designation !== 'string' || raw.designation.trim() === '') {
    throw new Stage2ValidationError(where + '.designation is required.', { field: where + '.designation' });
  }
  if (raw.officeId === undefined || raw.officeId === null || String(raw.officeId).trim() === '') {
    throw new Stage2ValidationError(where + '.officeId is required (distinct-office rule).', { field: where + '.officeId' });
  }
  if (typeof raw.workMandal !== 'string' || raw.workMandal.trim() === '') {
    throw new Stage2ValidationError(where + '.workMandal is required (posting-ban rule).', { field: where + '.workMandal' });
  }
  if (typeof raw.nativeMandal !== 'string' || raw.nativeMandal.trim() === '') {
    throw new Stage2ValidationError(where + '.nativeMandal is required (posting-ban rule).', { field: where + '.nativeMandal' });
  }
  if (typeof raw.gazettedStatus !== 'string' || raw.gazettedStatus.trim() === '') {
    throw new Stage2ValidationError(where + '.gazettedStatus is required (Gazetted / Non-Gazetted).', { field: where + '.gazettedStatus' });
  }
  if (typeof raw.seniorityRank !== 'number' || !Number.isSafeInteger(raw.seniorityRank)) {
    throw new Stage2UnresolvedRuleError(
      where + '.seniorityRank is required: explicit integer rank (lower = more senior) from the agreed mapping. Never inferred from pay or designation.',
      { field: where + '.seniorityRank' }
    );
  }
  if (typeof raw.presidingEligible !== 'boolean') {
    throw new Stage2UnresolvedRuleError(
      where + '.presidingEligible is required: explicit boolean from the agreed designation mapping. Never inferred.',
      { field: where + '.presidingEligible' }
    );
  }
  let classification = 'required';
  if (raw.classification !== undefined && raw.classification !== null) {
    if (raw.classification !== 'required' && raw.classification !== 'reserve') {
      throw new Stage2ValidationError(where + '.classification must be required|reserve.', { field: where + '.classification' });
    }
    classification = raw.classification;
  }
  return {
    personnelId: raw.personnelId,
    personnelKey: String(raw.personnelId),
    name: raw.name.trim(),
    designation: raw.designation.trim(),
    officeId: raw.officeId,
    officeKey: String(raw.officeId).trim().toLowerCase(),
    officeName: (typeof raw.officeName === 'string' && raw.officeName.trim() !== '') ? raw.officeName.trim() : String(raw.officeId).trim(),
    workMandal: raw.workMandal,
    nativeMandal: raw.nativeMandal,
    gazettedStatus: raw.gazettedStatus.trim(),
    seniorityRank: raw.seniorityRank,
    presidingEligible: raw.presidingEligible,
    classification: classification,
    mandalId: raw.mandalId !== undefined ? raw.mandalId : null,
    _strippedSensitive: strippedSensitive,
  };
}

function validateOptions(raw) {
  raw = raw || {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Stage2ValidationError('options must be an object.');
  }
  let per = DEFAULT_POLLING_OFFICERS_PER_PARTY;
  if (raw.pollingOfficersPerParty !== undefined && raw.pollingOfficersPerParty !== null) {
    if (!Number.isSafeInteger(raw.pollingOfficersPerParty)) {
      throw new Stage2ValidationError('options.pollingOfficersPerParty must be integer.');
    }
    per = raw.pollingOfficersPerParty;
  }
  let shortageReason = null;
  if (typeof raw.shortageReason === 'string' && raw.shortageReason.trim() !== '') {
    shortageReason = raw.shortageReason.trim();
  }
  if (per === SHORTAGE_POLLING_OFFICERS_PER_PARTY && !shortageReason) {
    throw new Stage2UnresolvedRuleError('1+4 needs options.shortageReason.');
  }
  if (per !== 5 && per !== 4) {
    throw new Stage2ValidationError('pollingOfficersPerParty must be 5 or 4+reason.');
  }
  let partiesRequested = 0;
  if (raw.partiesRequested !== undefined && raw.partiesRequested !== null) {
    if (!Number.isSafeInteger(raw.partiesRequested) || raw.partiesRequested < 0) {
      throw new Stage2ValidationError('partiesRequested must be >= 0.');
    }
    partiesRequested = raw.partiesRequested;
  }
  let postingMandals = [];
  if (raw.postingMandals !== undefined && raw.postingMandals !== null) {
    if (!Array.isArray(raw.postingMandals) || raw.postingMandals.length === 0) {
      throw new Stage2ValidationError('postingMandals must be non-empty array.');
    }
    postingMandals = raw.postingMandals.map(function (m, i) {
      const key = normalizeMandal(m);
      if (!key) throw new Stage2ValidationError('postingMandals[' + i + '] invalid.');
      return { raw: m, key: key };
    });
  }
  let prefix = 'PP';
  if (raw.teamCodePrefix !== undefined && raw.teamCodePrefix !== null) {
    prefix = String(raw.teamCodePrefix).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!prefix) throw new Stage2ValidationError('teamCodePrefix invalid.');
  }
  let useReserves = 'hold';
  if (raw.useReserves !== undefined && raw.useReserves !== null) {
    if (raw.useReserves !== 'hold' && raw.useReserves !== 'include') {
      throw new Stage2ValidationError("useReserves must be 'hold'|'include'.");
    }
    useReserves = raw.useReserves;
  }
  let allowShortageFallback = false;
  if (raw.allowShortageFallback !== undefined && raw.allowShortageFallback !== null) {
    if (typeof raw.allowShortageFallback !== 'boolean') {
      throw new Stage2ValidationError('allowShortageFallback must be boolean.');
    }
    allowShortageFallback = raw.allowShortageFallback;
  }
  if (allowShortageFallback && !shortageReason) {
    throw new Stage2UnresolvedRuleError(
      'Shortage fallback (5-member parties with merged 3rd+4th duties) needs options.shortageReason.'
    );
  }
  if (allowShortageFallback && per !== DEFAULT_POLLING_OFFICERS_PER_PARTY) {
    throw new Stage2ValidationError(
      'allowShortageFallback applies only with the default 1+5 request; it falls back to 1+4 per party.'
    );
  }
  // designationRules: { [designation]: { microObserverEligible: boolean } }.
  // Optional; when absent or empty, no designation is MO-eligible (fail
  // closed) — same policy as the orchestrator's original MO step.
  let designationRules = {};
  if (raw.designationRules !== undefined && raw.designationRules !== null) {
    if (typeof raw.designationRules !== 'object' || Array.isArray(raw.designationRules)) {
      throw new Stage2ValidationError('designationRules must be a plain object.');
    }
    designationRules = raw.designationRules;
  }
  // moCandidates: OPTIONAL separate Micro Observer pool (bank staff uploaded
  // via POST /api/imports/micro-observers). When supplied, MOs are drawn
  // ONLY from this list — never from officers. Each entry needs personnelId
  // (unique), name, officeId, workMandal, nativeMandal. When omitted/empty,
  // Stage 2 keeps its legacy behavior (officer pool + designationRules
  // microObserverEligible) so existing single-pool flows still work.
  let moCandidates = null;
  if (raw.moCandidates !== undefined && raw.moCandidates !== null) {
    if (!Array.isArray(raw.moCandidates)) {
      throw new Stage2ValidationError('moCandidates must be an array.');
    }
    moCandidates = raw.moCandidates.map(function (c, i) {
      const where = 'moCandidates[' + i + ']';
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        throw new Stage2ValidationError(where + ' must be an object.');
      }
      if (c.personnelId === undefined || c.personnelId === null || String(c.personnelId).trim() === '') {
        throw new Stage2ValidationError(where + '.personnelId is required.');
      }
      if (typeof c.name !== 'string' || c.name.trim() === '') {
        throw new Stage2ValidationError(where + '.name is required.');
      }
      if (c.officeId === undefined || c.officeId === null || String(c.officeId).trim() === '') {
        throw new Stage2ValidationError(where + '.officeId is required (distinct-office rule).');
      }
      if (typeof c.workMandal !== 'string' || c.workMandal.trim() === '') {
        throw new Stage2ValidationError(where + '.workMandal is required (posting-ban rule).');
      }
      if (typeof c.nativeMandal !== 'string' || c.nativeMandal.trim() === '') {
        throw new Stage2ValidationError(where + '.nativeMandal is required (posting-ban rule).');
      }
      return {
        personnelId: String(c.personnelId).trim(),
        personnelKey: String(c.personnelId).trim().toLowerCase(),
        name: c.name.trim(),
        designation: typeof c.designation === 'string' && c.designation.trim() !== '' ? c.designation.trim() : 'Micro Observer',
        officeId: c.officeId,
        officeName: c.officeName !== undefined && c.officeName !== null ? c.officeName : c.officeId,
        officeKey: String(c.officeId).trim().toLowerCase(),
        workMandal: c.workMandal.trim(),
        nativeMandal: c.nativeMandal.trim(),
      };
    });
    const moSeen = new Set();
    for (const c of moCandidates) {
      if (moSeen.has(c.personnelKey)) {
        throw new Stage2ValidationError('Duplicate personnelId in moCandidates: ' + c.personnelId + '.');
      }
      moSeen.add(c.personnelKey);
    }
  }
  // Near-mandal adjacency (migration 019): [{ mandal_name, near_mandal_names[] }].
  // When supplied and non-empty, Stage 2 picks party postings only from near
  // mandals. Empty/omitted keeps the legacy posting behaviour.
  let mandalAdjacency = [];
  if (raw.mandalAdjacency !== undefined && raw.mandalAdjacency !== null) {
    if (!Array.isArray(raw.mandalAdjacency)) {
      throw new Stage2ValidationError('mandalAdjacency must be an array.');
    }
    mandalAdjacency = raw.mandalAdjacency;
  }
  return { pollingOfficersPerParty: per, shortageReason: shortageReason,
    allowShortageFallback: allowShortageFallback,
    partiesRequested: partiesRequested, postingMandals: postingMandals,
    teamCodePrefix: prefix, useReserves: useReserves,
    designationRules: designationRules, moCandidates: moCandidates,
    mandalAdjacency: mandalAdjacency };
}

function validateStage2Request(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Stage2ValidationError('Request body must be an object.');
  }
  const stage1Run = validateStage1Run(input.stage1Run);
  if (!Array.isArray(input.employees) || input.employees.length === 0) {
    throw new Stage2ValidationError('employees must be non-empty array.');
  }
  const employees = input.employees.map(function (e, i) { return validateEmployee(e, i); });
  const seen = new Set();
  for (const e of employees) {
    if (seen.has(e.personnelKey)) {
      throw new Stage2ValidationError('Duplicate personnelId: ' + e.personnelId + '.');
    }
    seen.add(e.personnelKey);
  }
  const options = validateOptions(input.options);
  return { stage1Run: stage1Run, employees: employees, options: options };
}

module.exports.validateStage1Run = validateStage1Run;
module.exports.validateEmployee = validateEmployee;
module.exports.validateOptions = validateOptions;
module.exports.validateStage2Request = validateStage2Request;
module.exports.SENSITIVE_FIELDS = SENSITIVE_FIELDS;

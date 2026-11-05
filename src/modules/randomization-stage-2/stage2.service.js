'use strict';

const {
  STAGE_NUMBER,
  PRESIDING_OFFICERS_PER_PARTY,
  STAGE2_STATUS,
} = require('./stage2.constants');
const duties = require('./stage2.duties');
const { Stage2ValidationError } = require('./stage2.errors');
const { validateStage2Request } = require('./stage2.validator');
const { isMandalBarred } = require('./stage2.mandal');
const { buildAdjacencyLookup } = require('./stage2.adjacency');
const formation = require('./stage2.formation');
const { MICRO_OBSERVER_ROLE, assignMicroObservers } = require('../randomization/micro-observer');

/** Corrected Stage 2 rule (this submission):
 *   PO   = gazetted + presiding-eligible (e.g. Headmaster), roster slot 0,
 *   APO  = non-gazetted with the APO designation (e.g. School Assistant), roster slot 1,
 *   OPO  = non-gazetted, any other designation (e.g. Teacher), roster slots 2+.
 * Team size is 1 + 1 + 4 (5 operational members + 1 Micro Observer that Stage 3/assignments attach separately).
 * The single aliased form below implements that 3-tier role pool directly.
 */

/**
 * Gazetted / designation invariants per party.
 *   slot 0 (PO): gazetted
 *   slot 1 (APO): non-gazetted AND designation === APO designation
 *   slots 2+  (OPO): non-gazetted AND designation !== APO designation
 */
function verifyMixedInvariants(allEmployees, parties) {
  const poolKeys = new Set(allEmployees.map(function (e) { return e.personnelKey; }));
  const byKey = {};
  allEmployees.forEach(function (e) { byKey[e.personnelKey] = e; });
  const seen = new Set();
  const codes = new Set();
  for (const p of parties) {
    if (codes.has(p.teamCode)) throw new Stage2ValidationError('Duplicate teamCode: ' + p.teamCode + '.');
    codes.add(p.teamCode);
    if (p.members.length < 2) throw new Stage2ValidationError('Wrong size: ' + p.teamCode + '.');

    const po = byKey[String(p.members[0].personnelId)];
    if (!po || po.presidingEligible !== true) throw new Stage2ValidationError('PO not eligible: ' + p.teamCode + '.');
    if (String(p.members[0].gazettedStatus || '').trim().toLowerCase() !== 'gazetted') {
      throw new Stage2ValidationError('PO must be gazetted: ' + p.teamCode + '.');
    }

    for (let gi = 1; gi < p.members.length; gi += 1) {
      const gm = p.members[gi];
      const isGaz = String(gm.gazettedStatus || '').trim().toLowerCase() === 'gazetted';
      const isApoDesig = String(gm.designation || '').trim() === 'School Assistant';
      if (gi === 1) {
        if (isGaz) throw new Stage2ValidationError('APO must be non-gazetted: ' + p.teamCode + '.');
        if (!isApoDesig) throw new Stage2ValidationError('APO must be a School Assistant: ' + p.teamCode + '.');
        continue;
      }
      if (isGaz) throw new Stage2ValidationError('OPO must be non-gazetted: ' + p.teamCode + '.');
      if (isApoDesig) throw new Stage2ValidationError('Only slot 1 may be a School Assistant APO: ' + p.teamCode + '.');
    }

    for (const m of p.members) {
      const key = String(m.personnelId);
      if (!poolKeys.has(key)) throw new Stage2ValidationError('Outside pool: ' + key + '.');
      if (seen.has(key)) throw new Stage2ValidationError('Assigned twice: ' + key + '.');
      seen.add(key);
      const full = byKey[key];
      if (p.postingMandal && isMandalBarred(full, p.postingMandal)) {
        throw new Stage2ValidationError('Mandal-barred: ' + p.teamCode + '.');
      }
    }

    for (let i = 1; i < p.members.length; i += 1) {
      const other = byKey[String(p.members[i].personnelId)];
      if (!(po.seniorityRank < other.seniorityRank)) {
        throw new Stage2ValidationError('Seniority violated: ' + p.teamCode + '.');
      }
    }
  }
}

function createStage2Service(deps) {
  deps = deps || {};
  const randomInt = deps.randomInt;
  const now = deps.now || (function () { return new Date(); });
  const maxAttempts = deps.maxAttempts || 50;

  function executeFormation(input) {
    const t = validateStage2Request(input);
    const required = t.employees.filter(function (e) { return e.classification === 'required'; });
    const reserves = t.employees.filter(function (e) { return e.classification === 'reserve'; });
    const pool = t.options.useReserves === 'include' ? t.employees.slice() : required.slice();
    const reserveHeld = t.options.useReserves === 'include' ? [] : reserves.slice();
    const electionShort = formation.electionShortOf(t.stage1Run.electionConfigurationId);


    // Single corrected formation path (1+1+4 party), no broken 2-phase fallback.
    const partySize = PRESIDING_OFFICERS_PER_PARTY + t.options.pollingOfficersPerParty;

    let parties = [];
    let shortageParties = 0;
    if (t.options.allowShortageFallback) {
      // Two-phase: full 1+5 parties first, then 1+4 parties (merged 3rd+4th
      // duty on ONE person) from whoever is left. partiesRequested caps the
      // total across both phases.
      const adjacency = buildAdjacencyLookup(t.options.mandalAdjacency);
      const phased = formation.formPartiesWithFallback(pool, {
        postings: t.options.postingMandals,
        adjacency: adjacency.size > 0 ? adjacency : null,
        randomInt: randomInt,
        maxAttempts: maxAttempts,
        allowShortageFallback: true,
      });
      const all = phased.full.parties.map(function (p) { return { raw: p, size: 6 }; })
        .concat((phased.shortage ? phased.shortage.parties : []).map(function (p) {
          return { raw: p, size: 5 };
        }));
      const capped = t.options.partiesRequested > 0 ? all.slice(0, t.options.partiesRequested) : all;
      parties = capped.map(function (entry, i) {
        const teamCode = formation.buildTeamCode(t.options.teamCodePrefix, electionShort, i + 1);
        const postingMandal = entry.raw.posting ? String(entry.raw.posting.raw) : null;
        const per = entry.size - PRESIDING_OFFICERS_PER_PARTY;
        const members = entry.raw.members.map(function (m, idx) {
          return {
            role: formation.roleForSlot(idx, per),
            duty: formation.dutyForSlot(idx, per),
            personnelId: m.personnelId, name: m.name, designation: m.designation,
            officeId: m.officeId, officeName: m.officeName,
            workMandal: m.workMandal, nativeMandal: m.nativeMandal,
            gazettedStatus: m.gazettedStatus,
            seniorityRank: m.seniorityRank, classification: m.classification,
          };
        });
        if (per === 4) shortageParties += 1;
        return {
          teamCode: teamCode, postingMandal: postingMandal, members: members,
          teamSize: entry.size, shortageParty: per === 4,
          shortageReason: per === 4 ? t.options.shortageReason : null,
          presidingDutyNeedsConfirmation: duties.PRESIDING_DUTY_NEEDS_CONFIRMATION,
        };
      });
      verifyMixedInvariants(t.employees, parties);
    } else {
      const partySize = PRESIDING_OFFICERS_PER_PARTY + t.options.pollingOfficersPerParty;
      const adjacency = buildAdjacencyLookup(t.options.mandalAdjacency);
      const result = formation.formParties(pool, {
        partySize: partySize,
        postings: t.options.postingMandals,
        adjacency: adjacency.size > 0 ? adjacency : null,
        randomInt: randomInt,
        maxAttempts: maxAttempts,
        partiesRequested: t.options.partiesRequested,
      });
      parties = result.parties.map(function (p, i) {
        const teamCode = formation.buildTeamCode(t.options.teamCodePrefix, electionShort, i + 1);

      const postingMandal = p.posting ? String(p.posting.raw) : null;
      const members = p.members.map(function (m, idx) {
        return {
          role: formation.roleForSlot(idx, t.options.pollingOfficersPerParty),
          duty: formation.dutyForSlot(idx, t.options.pollingOfficersPerParty),
          personnelId: m.personnelId, name: m.name, designation: m.designation,
          officeId: m.officeId, officeName: m.officeName,
          workMandal: m.workMandal, nativeMandal: m.nativeMandal,
          gazettedStatus: m.gazettedStatus,
          seniorityRank: m.seniorityRank, classification: m.classification,
        };
      });
      return {
        teamCode: teamCode, postingMandal: postingMandal, members: members,
        teamSize: partySize, shortageParty: false,
        shortageReason: null,
        presidingDutyNeedsConfirmation: duties.PRESIDING_DUTY_NEEDS_CONFIRMATION,
      };
    });

    verifyMixedInvariants(t.employees, parties);

      // NOTE: one Micro Observer per party is assigned AFTER both formation
      // paths below (full and shortage parties alike) — never silently skipped.
      // No substitutes are added: teams are exactly the officers formed here.
    }
    // --- ONE Micro Observer per formed party (integrated into Stage 2). ----
    // SOURCE (team decision 2026-10-15): a SEPARATE MO candidate list
    // (bank staff uploaded via POST /api/imports/micro-observers) passed as
    // options.moCandidates. When moCandidates is absent/empty, fall back to
    // the legacy path (officer pool + designationRules microObserverEligible)
    // so existing single-pool flows keep working.
    var useSeparateMoPool = Array.isArray(t.options.moCandidates) && t.options.moCandidates.length > 0;
    var moPool;
    var moById;
    if (useSeparateMoPool) {
      moPool = t.options.moCandidates.map(function (c) {
        return {
          id: c.personnelId,
          personnelId: c.personnelId,
          name: c.name,
          designation: c.designation,
          officeId: c.officeId,
          officeName: c.officeName,
          workMandal: c.workMandal,
          nativeMandal: c.nativeMandal,
          seniorityRank: undefined,
          classification: 'micro-observer',
        };
      });
      moById = new Map(moPool.map(function (p) { return [String(p.id), p]; }));
    } else {
      moPool = t.employees.map(function (e) {
      return {
        id: e.personnelKey,
        personnelId: e.personnelId,
        name: e.name,
        designation: e.designation,
        officeId: e.officeId,
        officeName: e.officeName,
        workMandal: e.workMandal,
        nativeMandal: e.nativeMandal,
        seniorityRank: e.seniorityRank,
        classification: e.classification,
      };
    });
      moById = new Map(moPool.map(function (p) { return [String(p.id), p]; }));
    }
    // Separate-pool mode: every MO candidate is eligible by upload (the file
    // IS the authority list); the circular's own mixing rules still apply
    // (distinct office, no own-mandal). Legacy mode keeps the designationRules
    // eligibility gate.
    var moDesignationRules = useSeparateMoPool
      ? {}
      : ((t.options && t.options.designationRules) || {});
    if (useSeparateMoPool) {
      moPool.forEach(function (p) { moDesignationRules[p.designation] = { microObserverEligible: true }; });
    }
    var moPlan = assignMicroObservers({
      parties: parties,
      pool: moPool,
      internalById: moById,
      designationRules: moDesignationRules,
      randomInt: randomInt,
      required: true,
    });
    parties = moPlan.parties;
    var microObserversAssigned = moPlan.assignedCount;

    // excelRows: operational members + appended Micro Observer per party.
    // Source rows stay resolved against full employee records; MO members
    // from a SEPARATE uploaded pool resolve from the MO pool map instead
    // (they were never officers, so t.employees cannot contain them).
    var moSrcById = useSeparateMoPool
      ? new Map(moPool.map(function (p) {
        return [String(p.personnelId), {
          personnelId: p.personnelId, name: p.name, designation: p.designation,
          officeId: p.officeId, officeName: p.officeName,
          seniorityRank: p.seniorityRank, classification: p.classification,
        }];
      }))
      : new Map();
    const excelRows = formation.toExcelRows(parties.map(function (p) {
      return {
        teamCode: p.teamCode, postingMandal: p.postingMandal,
        members: p.members.map(function (m) {
          const src = t.employees.find(function (e) {
            return String(e.personnelId) === String(m.personnelId);
          }) || moSrcById.get(String(m.personnelId));
          return {
            personnelId: m.personnelId, name: m.name, designation: m.designation,
            officeName: m.officeName, officeKey: src.officeKey,
            seniorityRank: m.seniorityRank, role: m.role, duty: m.duty,
            workMandal: src.workMandal, nativeMandal: src.nativeMandal,
          };
        }),
      };
    }));

    const usedKeys = new Set();
    parties.forEach(function (p) {
      p.members.forEach(function (m) { usedKeys.add(String(m.personnelId)); });
    });
    const unassigned = t.employees.filter(function (e) {
      return !usedKeys.has(e.personnelKey);
    }).map(function (e) {
      const held = reserveHeld.some(function (r) { return r.personnelKey === e.personnelKey; });
      return {
        personnelId: e.personnelId, name: e.name, designation: e.designation,
        officeName: e.officeName, classification: e.classification,
        reason: held ? 'reserve_held' : 'no_eligible_party_slot',
      };
    });
    const unmetRequirements = [];
    (moPlan.unmetRequirements || []).forEach(function (u) { unmetRequirements.push(u); });
    if (t.options.partiesRequested > 0 && parties.length < t.options.partiesRequested) {
      unmetRequirements.push({
        code: 'PARTIES_SHORTFALL', requested: t.options.partiesRequested, formed: parties.length,
        message: 'Formed ' + parties.length + ' of ' + t.options.partiesRequested + ' requested; corrected rule not relaxed.',
      });
    }
    if (parties.length === 0 && t.employees.length > 0) {
      unmetRequirements.push({ code: 'NO_PARTY_FORMED', message: 'No complete party without rule violation.' });
    }
    const complete = unmetRequirements.length === 0;
    const teamSizes = parties.map(function (p) { return p.members.length; });
    return {
      status: complete && unmetRequirements.length === 0 ? STAGE2_STATUS.COMPLETED : STAGE2_STATUS.INCOMPLETE,
      stage: STAGE_NUMBER, stage1RunId: t.stage1Run.runId,
      electionConfigurationId: t.stage1Run.electionConfigurationId,
      districtId: t.stage1Run.districtId,
      teamSize: teamSizes.length > 0 ? teamSizes[0] : null,
      teamSizes: teamSizes,

      observedPartySize: partySize,
      fullParties: parties.filter(function (p) { return (p.operationalSize || p.members.length) === 6; }).length,
      shortageParties: parties.filter(function (p) { return (p.operationalSize || p.members.length) === 5; }).length,

      presidingOfficersPerParty: PRESIDING_OFFICERS_PER_PARTY,
      pollingOfficersPerParty: t.options.pollingOfficersPerParty,
      shortageReason: t.options.shortageReason || null,
      parties: parties, excelRows: excelRows, unassigned: unassigned,
      microObserversAssigned: microObserversAssigned,
      reserveHeld: reserveHeld.map(function (e) {
        return { personnelId: e.personnelId, name: e.name, classification: e.classification };
      }),
      unmetRequirements: unmetRequirements,
      counts: {
        poolSize: t.employees.length, requiredCount: required.length,
        reserveCount: reserves.length, partiesFormed: parties.length,
        assignedCount: usedKeys.size, unassignedCount: unassigned.length,
      },
      executedAt: (function () { const d = now(); return d.toISOString ? d.toISOString() : String(d); })(),
    };
  }

  return { executeFormation: executeFormation };
}

module.exports = { createStage2Service: createStage2Service };

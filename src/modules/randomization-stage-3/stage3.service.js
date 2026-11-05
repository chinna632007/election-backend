'use strict';

/**
 * Stage 3 — service (pure, no I/O). Mirrors the Stage 2 service shape so the
 * two modules read the same way and can share a persistence adapter later.
 *
 * Responsibilities:
 *  - validate the Stage 2 output + caller-supplied polling stations,
 *  - run the random one-to-one mapping,
 *  - return a CONFIDENTIAL result (never auto-published),
 *  - expose publish() to reveal a completed mapping (an explicit action that
 *    the caller must authorize against the circular's public-display rule).
 *
 * Nothing is persisted here. A DB-backed repository (like Stage 1's dormant
 * pg repo) is a separate, approved step once station/run tables are ratified.
 */

const {
  STAGE_NUMBER,
  PUBLICATION_STATUS,
  STAGE3_STATUS,
} = require('./stage3.constants');
const { Stage3UnresolvedRuleError } = require('./stage3.errors');
const { validateStage3Request } = require('./stage3.validator');
const mapping = require('./stage3.mapping');

function createStage3Service(deps) {
  deps = deps || {};
  const randomInt = deps.randomInt;
  const now = typeof deps.now === 'function' ? deps.now : function () { return new Date(); };
  const audit = deps.audit || null;

  function executeMapping(input) {
    const t = validateStage3Request(input);
    // Near-mandal mode (migration 019): pass adjacency + per-team member
    // mandals so stations are chosen from near mandals of every member.
    const { buildAdjacencyLookup } = require('../randomization-stage-2/stage2.adjacency');
    const adjacency = buildAdjacencyLookup(t.options.mandalAdjacency);
    let membersByTeam = t.options.teamMembers || null;
    if (!membersByTeam) {
      // Fall back to members carried on the validated parties (Stage 2 shape).
      membersByTeam = {};
      for (const p of t.parties) {
        if (p.members && p.members.length > 0) membersByTeam[p.teamCode] = p.members;
      }
      if (Object.keys(membersByTeam).length === 0) membersByTeam = null;
    }
    const result = mapping.mapTeamsToStations(t.parties, t.pollingStations, randomInt, {
      adjacency: adjacency.size > 0 ? adjacency : null,
      membersByTeam: membersByTeam,
    });

    const unmetRequirements = result.unmetRequirements.slice();
    const complete = unmetRequirements.length === 0;

    // Integrity: every assignment is a unique team↔station pair.
    const stationIds = new Set();
    for (const a of result.assignments) {
      if (stationIds.has(a.stationId)) {
        unmetRequirements.push({ code: 'DUPLICATE_STATION_ASSIGNMENT', stationId: a.stationId,
          message: 'A polling station received more than one party.' });
      }
      stationIds.add(a.stationId);
    }

    const out = {
      status: complete ? STAGE3_STATUS.COMPLETED : STAGE3_STATUS.INCOMPLETE,
      stage: STAGE_NUMBER,
      stage2RunId: t.stage2Run.stage2RunId,
      stage1RunId: t.stage2Run.stage1RunId,
      electionConfigurationId: t.stage2Run.electionConfigurationId,
      districtId: t.stage2Run.districtId,
      publicationStatus: PUBLICATION_STATUS.CONFIDENTIAL,
      mappingMode: t.options.mappingMode,
      counts: {
        parties: t.parties.length,
        pollingStations: t.pollingStations.length,
        assignments: result.assignments.length,
      },
      assignments: result.assignments,
      unmetRequirements: unmetRequirements,
      executedAt: (function () { const d = now(); return d.toISOString ? d.toISOString() : String(d); })(),
    };

    if (audit && typeof audit.record === 'function') {
      audit.record({
        action: 'stage3.mapping_executed',
        electionConfigurationId: out.electionConfigurationId,
        districtId: out.districtId,
        stage2RunId: out.stage2RunId,
        counts: out.counts,
        publicationStatus: out.publicationStatus,
        at: out.executedAt,
      });
    }

    return out;
  }

  /**
   * Reveal a completed mapping for public display (circular p.62). Returns a
   * NEW object; the input is not mutated. Refuses to publish an incomplete
   * mapping or one already published.
   */
  function publish(run) {
    if (!run || typeof run !== 'object') {
      throw new Stage3UnresolvedRuleError('publish() requires a Stage 3 run object.');
    }
    if (run.status !== STAGE3_STATUS.COMPLETED) {
      throw new Stage3UnresolvedRuleError(
        'Cannot publish an incomplete mapping; resolve unmetRequirements first.'
      );
    }
    if (run.publicationStatus === PUBLICATION_STATUS.PUBLISHED) {
      throw new Stage3UnresolvedRuleError('Mapping is already published.');
    }
    const publishedAt = (function () { const d = now(); return d.toISOString ? d.toISOString() : String(d); }());
    const published = Object.assign({}, run, {
      publicationStatus: PUBLICATION_STATUS.PUBLISHED,
      publishedAt: publishedAt,
      assignments: run.assignments.map(function (a) {
        return Object.assign({}, a, { publicationStatus: PUBLICATION_STATUS.PUBLISHED });
      }),
    });
    if (audit && typeof audit.record === 'function') {
      audit.record({
        action: 'stage3.mapping_published',
        electionConfigurationId: published.electionConfigurationId,
        districtId: published.districtId,
        stage2RunId: published.stage2RunId,
        at: publishedAt,
      });
    }
    return published;
  }

  return { executeMapping: executeMapping, publish: publish };
}

module.exports = { createStage3Service: createStage3Service };

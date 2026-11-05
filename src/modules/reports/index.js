'use strict';

/**
 * Reports router — read-only summaries from the last allocation + the two
 * import pipelines. No write surfaces, no sensitive personnel fields.
 *
 *   GET /api/reports/allocation   last run: stage summaries, party/station
 *                                 counts, MO assignments, publication state
 *   GET /api/reports/summary      import data counts (personnel/stations by
 *                                 mandal + designation), batch traceability
 *
 * Personnel rows are never returned — only aggregated counts grouped by
 * non-sensitive columns. Members listed under a party expose name + role
 * only (no contacts, Aadhaar, EPIC).
 *
 * Authorization: session required. Allocation details are deployment-sensitive
 * (Stage 3 confidentiality) -> authorize('authority','admin'). The summary
 * endpoint is read-only counts -> all authenticated roles.
 */

const express = require('express');
const { getCollection } = require('../../database');
const { requireAuth, authorize } = require('../../middleware/auth');
const { getLastRun, getPublication, hydrateOnce, latestStageTables } = require('../randomization/allocation-store');

const router = express.Router();
router.use(requireAuth);

async function findMany(collectionName, filter, options) {
  const cursor = await getCollection(collectionName).find(filter, options);
  return cursor.toArray();
}

async function aggregateMany(collectionName, pipeline) {
  const cursor = await getCollection(collectionName).aggregate(pipeline);
  return cursor.toArray();
}

// --- Allocation report: last completed run + publication state ---------------
router.get('/allocation', authorize('authority', 'admin'), async (req, res) => {
  await hydrateOnce(); // cold start (restart) -> reload latest run from the DB
  const last = getLastRun();
  if (!last) {
    return res.json({ ok: true, run: null, note: 'No allocation run yet in this session of the server.' });
  }

  // --- Officer-level view: frozen Stage-3 roster (migration 016) -----------
  // The roster is the single source of truth for Stage 2/3 rows: it carries
  // the officer's print details (employee_id, designation, mobile, mandals)
  // captured at run time, plus the Stage-3 station verdict (station_id =
  // BOOTH id / ballot, station_code = venue code, station_mandal).
  let roster = null;
  try {
    roster = await latestStageTables();
  } catch (err) {
    // Fall through to the JSON-based allocation view below.
    console.warn('reports: latestStageTables failed, falling back to JSON allocation', err.message);
  }

  let parties = [];
  let assignments = [];
  let personnelByTeam = new Map();

  if (roster) {
    // Build per-team officer lists with the full officer print profile.
    personnelByTeam = new Map();
    for (const m of roster.rows) {
      const team = personnelByTeam.get(m.team_code) || [];
      team.push({
        employeeId: m.employee_id || null,
        name: m.name || null,
        role: m.role || null,
        designation: m.designation || null,
        isMicroObserver: Boolean(m.is_micro_observer),
        workMandal: m.work_mandal || null,
        nativeMandal: m.native_mandal || null,
        venueCode: m.venue_code || null,   // Stage-3 station = polling venue (ballot ID)
        dutyMandal: m.duty_mandal || null, // officer's duty station mandal
      });
      personnelByTeam.set(m.team_code, team);
    }

    // Assignments keyed by teamCode; supply the ballot/station verdict.
    const byTeam = new Map();
    for (const a of (last.stage3 && last.stage3.assignments) || []) {
      byTeam.set(String(a.teamCode || '').trim(), a);
    }
    for (const [teamCode, members] of personnelByTeam) {
      const a = byTeam.get(teamCode) || {};
      assignments.push({
        teamCode,
        stationId: a.stationId || null,    // BOOTH id / ballot id (KKD-0016)
        stationCode: a.stationCode || null,// venue/ballot unit (016)
        stationMandal: a.stationMandal || null,
        stationName: a.stationName || null,
        buildingName: a.buildingName || null,
        street: a.street || null,
        locality: a.locality || null,
        ward: a.ward || null,
        district: a.district || null,
        pinCode: a.pinCode || null,
        venueCode: a.stationCode || null,  // ballot-side view of the same verdict
      });
    }
    parties = (last.stage2 && last.stage2.parties) || [];
  } else {
    // Fallback: JSON allocation view (older runs).
    parties = (last.stage2 && last.stage2.parties) || [];
    assignments = (last.stage3 && last.stage3.assignments) || [];
  }

  const microObservers = parties.reduce(function (n, p) {
    return n + (p.members || []).filter(function (m) { return m.isMicroObserver; }).length;
  }, 0);

  return res.json({
    ok: true,
    runAt: last.runAt,
    runBy: last.runBy,
    stage1: summarizeStage1(last.stage1),
    stage2: {
      status: last.stage2 && last.stage2.status,
      parties: parties.map(function (p) {
        return {
          teamCode: p.teamCode,
          postingMandal: p.postingMandal,
          teamSize: p.teamSize,
          operationalSize: p.operationalSize,
          microObserver: !!p.microObserverPersonnelId,
          members: (p.members || []).map(function (m) {
            return { name: m.name, role: m.role, isMicroObserver: !!m.isMicroObserver };
          }),
        };
      }),
      microObserversAssigned: (last.stage2 && last.stage2.microObserversAssigned) || 0,
      unmetRequirements: (last.stage2 && last.stage2.unmetRequirements) || [],
    },
    // Officer-level Stage-3 allocation view (roster-driven).
    stage3: {
      status: last.stage3 && last.stage3.status,
      publicationStatus: last.stage3 && last.stage3.publicationStatus,
      assignments: assignments.map(function (a) {
        return {
          teamCode: a.teamCode,
          stationId: a.stationId,
          stationCode: a.stationCode,
          stationMandal: a.stationMandal || null,
          stationName: a.stationName || null,
          buildingName: a.buildingName || null,
          street: a.street || null,
          locality: a.locality || null,
          ward: a.ward || null,
          district: a.district || null,
          pinCode: a.pinCode || null,
        };
      }),
    },
    officers: Array.from(personnelByTeam.entries()).map(function ([teamCode, members]) {
      return { teamCode, members };
    }),
    counts: {
      parties: parties.length,
      assignments: assignments.length,
      microObservers,
      officers: personnelByTeam.size,
    },
    publication: getPublication(),
  });
});

function summarizeStage1(stage1) {
  if (!stage1) return null;
  return {
    status: stage1.status,
    runId: stage1.runId,
    requiredCount: stage1.requiredCount,
    reserveCount: stage1.reserveCount,
    selectedCount: (stage1.results || []).length,
  };
}

// --- Data summary: import counts, no personnel detail ------------------------
router.get('/summary', async (req, res) => {
  try {
    const batches = await findMany('import_batches', {}, {
      projection: { _id: 0, id: 1, file_name: 1, kind: 1, total_rows: 1, accepted_rows: 1, status: 1, imported_at: 1 },
      sort: { id: -1 }, limit: 20,
    });
    const personnelByMandal = await aggregateMany('personnel', [
      { $group: { _id: { district: '$district', mandal: '$work_mandal' }, count: { $sum: 1 } } },
      { $sort: { '_id.district': 1, '_id.mandal': 1 } },
      { $project: { _id: 0, district: '$_id.district', mandal: '$_id.mandal', count: 1 } },
    ]);
    const personnelByDesignation = await aggregateMany('personnel', [
      { $group: { _id: '$designation', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, designation: '$_id', count: 1 } },
    ]);
    const stationsByMandal = await aggregateMany('polling_stations', [
      { $group: { _id: { district: '$district', mandal: '$mandal' }, count: { $sum: 1 } } },
      { $sort: { '_id.district': 1, '_id.mandal': 1 } },
      { $project: { _id: 0, district: '$_id.district', mandal: '$_id.mandal', count: 1 } },
    ]);
    res.json({
      ok: true,
      batches,
      personnelByMandal,
      personnelByDesignation,
      stationsByMandal,
    });
  } catch (err) {
    console.error('reports summary failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to build summary' });
  }
});

module.exports = router;

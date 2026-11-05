'use strict';

/**
 * Randomization orchestration router.
 *
 *   POST /api/randomization/run      Stage 1 -> Stage 2 (+MO) -> Stage 3
 *   POST /api/randomization/publish  authorised disclosure of a Stage 3 mapping
 *
 * Executes Stage 1 -> Stage 2 -> Stage 3 in-process over existing pure
 * services, sourcing personnel and polling stations from the database.
 *
 * Authorization: session required + authorize('authority','admin') — random
 * stage execution policy (established in the import-route wiring step).
 *
 * Request body for /run (authority-supplied, never derived by the server):
 *   {
 *     electionConfiguration: { id, requiredStrength: [{mandalId, requiredCount}] },
 *     designationRules: { designation: { seniorityRank, presidingEligible, microObserverEligible } },
 *     personnelImportBatchId?: number,   // default: latest personnel batch
 *     stationImportBatchId: number,      // required: stations scoped to one batch
 *     districtId?: string,               // default 'Kakinada'
 *     seed?: number                      // reproducible demo runs
 *   }
 *
 * Publish body: { stage3Run } — Stage 3's executeMapping output. Refuses
 * anything that is not a completed, still-confidential mapping.
 *
 * Response: { ok, stage1, stage2, stage3, auditEvents } — no sensitive
 * personnel fields are read or returned (explicit column allow-list below).
 */

const express = require('express');
const { getCollection } = require('../../database');
const { requireAuth, authorize } = require('../../middleware/auth');
const { runAllocation } = require('./orchestrator');
const { getSetting } = require('../settings/settings.service');
const { recordRun, recordPublication, hydrateOnce } = require('./allocation-store');
const {
  parseBallotRegister,
  allocateBallots,
  BallotParseError,
} = require('./ballot-allocation');
// Integration hook: register the AUTHORITY-SUPPLIED election configuration so
// the standalone Stage 1 router can resolve it by id. Pure registration.
const { registerElectionConfiguration } = require('../randomization-stage-1/wiring');

const MAX_BALLOT_FILE_BYTES = 15 * 1024 * 1024; // decoded size cap fallback (~15 MB)

const router = express.Router();

// Session first (401), then role gate (403). Never bypass either.
router.use(requireAuth);
router.use(authorize('authority', 'admin'));

// Explicit non-sensitive allow-list. Contact and identity columns are never
// read by the randomization route.
const PERSONNEL_PROJECTION = {
  _id: 0, employee_id: 1, employee_name: 1, designation: 1, is_active: 1,
  district: 1, work_mandal: 1, native_mandal: 1, gazetted_status: 1,
  exempt_category: 1, import_batch_id: 1,
};

router.post('/run', async (req, res) => {
  try {
    const body = req.body || {};
    const electionConfiguration = body.electionConfiguration;
    const designationRules = body.designationRules;

    if (!electionConfiguration || typeof electionConfiguration !== 'object') {
      return res.status(400).json({ ok: false, error: 'electionConfiguration is required' });
    }
    if (!designationRules || typeof designationRules !== 'object' || Array.isArray(designationRules)) {
      return res.status(400).json({ ok: false, error: 'designationRules is required' });
    }
    const stationBatchId = Number(body.stationImportBatchId);
    if (!Number.isSafeInteger(stationBatchId) || stationBatchId <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'stationImportBatchId (positive integer) is required' });
    }

    const districtId = body.districtId ||
      String(await getSetting('election.district_default') || 'Kakinada');

    // --- Load polling stations (scoped to ONE import batch, per decision). --
    const stationCursor = await getCollection('polling_stations').find(
      { import_batch_id: stationBatchId },
      {
        projection: {
          _id: 0,
          station_id: 1,
          station_number: 1,
          station_name: 1,
          building_name: 1,
          street: 1,
          locality: 1,
          ward: 1,
          district: 1,
          mandal: 1,
          pin_code: 1,
        },
        limit: 5000,
      }
    );
    const stationRows = await stationCursor.toArray();
    if (stationRows.length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'No polling stations found for stationImportBatchId ' + stationBatchId });
    }

    // --- Load personnel (one batch: explicit, or the latest personnel batch).
    let personnelBatchId = Number(body.personnelImportBatchId);
    if (!Number.isSafeInteger(personnelBatchId) || personnelBatchId <= 0) {
      const latest = await getCollection('import_batches').findOne(
        { kind: 'personnel', status: 'completed' },
        { sort: { id: -1 }, projection: { _id: 0, id: 1 } }
      );
      if (!latest) {
        return res.status(400).json({ ok: false, error: 'No completed personnel import batch found' });
      }
      personnelBatchId = latest.id;
    }
    const personnelCursor = await getCollection('personnel').find(
      { import_batch_id: personnelBatchId, district: String(districtId) },
      { projection: PERSONNEL_PROJECTION, limit: 5000 }
    );
    const personnelRows = await personnelCursor.toArray();
    if (personnelRows.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'No personnel found in batch ' + personnelBatchId + ' for district ' + districtId,
      });
    }

    // Department name (office grouping fallback for the Stage 2 same-office
    // rule). The proforma has no office/school column, so the request may
    // carry an explicit officeIdOverrides map { employeeId: officeId };
    // without it all rows share the department as their office.
    const batch = await getCollection('import_batches').findOne(
      { id: personnelBatchId }, { projection: { _id: 0, department_name: 1 } }
    );
    const departmentName = batch ? batch.department_name : null;
    const officeIdOverrides =
      body.officeIdOverrides && typeof body.officeIdOverrides === 'object' &&
        !Array.isArray(body.officeIdOverrides)
        ? body.officeIdOverrides
        : undefined;

    // Make the authority-supplied configuration resolvable by id for the
    // standalone Stage 1 endpoints (registered as-is; nothing derived).
    registerElectionConfiguration(electionConfiguration);

    // --- Separate MO upload (bank staff, POST /api/imports/micro-observers).
    // Loaded on every run; when the table is empty the legacy officer-pool
    // MO path applies. Never fails the run when the table is missing.
    let moRows = null;
    try {
      const cursor = await getCollection('micro_observers').find({}, {
        projection: {
          _id: 0, employee_id: 1, employee_name: 1, designation: 1, bank_name: 1,
          working_mandal: 1, native_mandal: 1, residence_mandal: 1
        },
        limit: 5000,
      });
      moRows = await cursor.toArray();
    } catch (err) {
      moRows = null;
    }

    // --- Near-mandal adjacency (migration 019). --------------------------
    // Loaded on every run; empty table keeps the legacy posting/station
    // behaviour. Never fails the run when the table is missing.
    let mandalAdjacencyRows = [];
    try {
      const cursor = await getCollection('mandal_adjacency').find({}, {
        projection: { _id: 0, mandal_name: 1, near_mandal_names: 1 }, limit: 2000,
      });
      mandalAdjacencyRows = await cursor.toArray();
    } catch (err) {
      mandalAdjacencyRows = [];
    }

    // --- Execute the three-stage chain. ---------------------------------
    const result = await runAllocation({
      mandalAdjacencyRows: mandalAdjacencyRows,
      personnelRows: personnelRows,
      stationRows: stationRows,
      departmentName: departmentName,
      officeIdOverrides: officeIdOverrides,
      electionConfiguration: electionConfiguration,
      designationRules: designationRules,
      districtId: districtId,
      actorId: req.session.user.id,
      seed: body.seed,
      moRows: moRows,
      maxAttempts: await getSetting('randomization.max_attempts'),
    });

    // Persist PO/APO rosters (member[0]=PO, member[1]=APO) with FULL
    // personnel rows (sensitive INCLUDED, GOVERNMENT-ONLY). Tables live at
    // po_officers / apo_officers (migration 006). Never silent on failure.
    let poApoRosters = { po: 0, apo: 0, poErrors: null, apoErrors: null };
    try {
      const { persistPoApoRosters } = require('./po-apo-store');
      const runId = (result && result.stage1 && result.stage1.runId) || null;
      poApoRosters = await persistPoApoRosters({
        parties: (result && result.stage2 && result.stage2.parties) || [],
        personnelBatchId: personnelBatchId,
        districtId: districtId,
        runId: runId,
      });
    } catch (poErr) {
      console.error('po/apo roster persist failed:', poErr);
      poApoRosters.poErrors = poApoRosters.poErrors || ('persist crashed: ' + poErr.message);
      poApoRosters.apoErrors = poApoRosters.apoErrors || ('persist crashed: ' + poErr.message);
    }

    // Write-through to the DB; awaited so a restart immediately after the
    // response still finds this run (fixes "stages didn't save").
    const saved = await recordRun({
      runAt: new Date().toISOString(),
      runBy: { id: req.session.user.id, username: req.session.user.username, role: req.session.user.role },
      districtId: districtId,
      personnelBatchId: personnelBatchId,
      ...result,
    });

    res.json({
      ok: true,
      ...result,
      runId: saved.id || null,
      // Honest save status: stageTablesError set => normalized Stage 2/3
      // rows did NOT persist (loud failure, never silent).
      stageTables: saved.stageTables || null,
      stageTablesError: saved.stageTablesError || null,
      poApoRosters: poApoRosters,
    });
  } catch (err) {
    const status = err && err.statusCode ? err.statusCode : 500;
    const message =
      status >= 500 && process.env.NODE_ENV === 'production'
        ? 'Allocation failed'
        : (err && err.message) || 'Allocation failed';
    if (status >= 500) console.error('randomization run failed:', err);
    res.status(status).json({ ok: false, error: message });
  }
});

// --- Phase 3: ballot register upload + officer allocation --------------------
// Body (base64-JSON, same convention as /api/imports uploads so no multipart
// package is needed): { fileName, dataBase64, presidingOfficers: [names],
//                       pollingOfficers: [names] }
// Officers come from Phase 2 (authority supplied, in rank order). Response
// mirrors the frontend contract: { summary, rows } — one row per ballot.
router.post('/ballot-allocation', async (req, res) => {
  try {
    const body = req.body || {};
    const { fileName, dataBase64 } = body;
    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ ok: false, error: 'fileName is required' });
    }
    if (!dataBase64 || typeof dataBase64 !== 'string') {
      return res.status(400).json({ ok: false, error: 'dataBase64 is required' });
    }
    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length === 0) {
      return res.status(400).json({ ok: false, error: 'Uploaded file is empty' });
    }
    const ballotCapMb = Number(await getSetting('uploads.max_ballot_mb')) || 15;
    if (buffer.length > ballotCapMb * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: 'File too large (max ' + ballotCapMb + ' MB)' });
    }
    const presidingOfficers = Array.isArray(body.presidingOfficers) ? body.presidingOfficers : [];
    const pollingOfficers = Array.isArray(body.pollingOfficers) ? body.pollingOfficers : [];
    const parsed = parseBallotRegister(buffer);
    if (parsed.accepted.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Ballot register has no usable rows (need Booth/Ballot ID or Booth/PS Number per row).',
        rejected: parsed.rejected,
      });
    }
    const result = allocateBallots({
      ballots: parsed.accepted,
      presidingOfficers: presidingOfficers,
      pollingOfficers: pollingOfficers,
    });
    res.json({
      ok: true,
      fileName: fileName,
      rejected: parsed.rejected,
      summary: result.summary,
      rows: result.rows,
    });
  } catch (err) {
    if (err instanceof BallotParseError) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    const status = err && err.statusCode ? err.statusCode : 500;
    if (status >= 500) console.error('ballot allocation failed:', err);
    res.status(status).json({ ok: false, error: (err && err.message) || 'Ballot allocation failed' });
  }
});

// Confidential -> published transition for a completed Stage 3 mapping.
// Records WHO confirmed it (session user) and WHEN — the disclosure decision
// is the authorized officer's, not automatic. Refuses incomplete or already
// published runs (fail closed).
router.post('/publish', async (req, res) => {
  try {
    const stage3Run = req.body && req.body.stage3Run;
    if (!stage3Run || typeof stage3Run !== 'object') {
      return res.status(400).json({ ok: false, error: 'stage3Run (Stage 3 mapping object) is required' });
    }
    const { createStage3Service } = require('../randomization-stage-3');
    const service = createStage3Service();
    const published = service.publish(stage3Run);
    const publishedAt = new Date().toISOString();
    const confirmedBy = { id: req.session.user.id, username: req.session.user.username, role: req.session.user.role };
    await hydrateOnce();
    await recordPublication(published, confirmedBy);
    res.json({
      ok: true,
      stage3: published,
      confirmedBy: confirmedBy,
      confirmedAt: publishedAt,
    });
  } catch (err) {
    const status = err && err.statusCode ? err.statusCode : 500;
    if (status >= 500) console.error('randomization publish failed:', err);
    res.status(status).json({ ok: false, error: (err && err.message) || 'Publish failed' });
  }
});

module.exports = router;

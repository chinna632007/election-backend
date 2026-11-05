'use strict';

/**
 * Stage 1 — orchestration service.
 *
 * Workflow (docs/RANDOMIZATION_WORKFLOW.md §1 + APSEC circular):
 *  1 validate request; 2 authorize district scope from `actor` (authenticated
 *  user), NEVER from the request body; 3 validate prerequisites; 4 compute
 *  per-Mandal 120% pools [O] with an explicit rounding rule; 5 fetch eligible
 *  candidates; 6 random distinct selection (injectable RNG seam); 7 classify
 *  required vs reserve (reserve = 20% excess [O]; no ranking — U2); 8 check
 *  invariants; 9 persist run+entries ATOMICALLY; 10 record audit event.
 *
 * Ports are injected ({ repository, audit, randomInt, now, config }) so the
 * service has zero direct dependency on shared infrastructure that does not
 * exist yet (src/database, src/modules/audit).
 */

const {
  STAGE_NUMBER,
  RUN_STATUS,
  POOL_CLASSIFICATION,
} = require('./stage1.constants');
const { calculatePoolSize, splitPool } = require('./stage1.pool');
const { filterEligible } = require('./stage1.eligibility');
const { selectRandom } = require('./stage1.selection');
const {
  Stage1ValidationError,
  Stage1AuthorizationError,
  Stage1NotFoundError,
  Stage1PrerequisiteError,
  Stage1InsufficientPersonnelError,
  Stage1ConflictError,
  Stage1ResultInvalidError,
  Stage1PersistenceError,
  Stage1AuditError,
} = require('./stage1.errors');
const {
  validateExecuteRunRequest,
  validateRunIdParam,
} = require('./stage1.validator');

/**
 * createStage1Service({ repository, audit, randomInt, now, config })
 *
 * @param {object} repository  Port per stage1.repository.js (must also expose
 *                             getEligibleCandidates(tx, {districtId, mandalId})).
 * @param {object} [audit]     Shared audit interface { record(event) }.
 *                             If absent, execution FAILS CLOSED (audit is
 *                             mandatory for traceability).
 * @param {Function} [randomInt] RNG seam (default: crypto.randomInt).
 * @param {Function} [now]     Clock seam (default: () => new Date()).
 * @param {object} [config]
 * @param {string} [config.roundingRule]  Approved rounding rule. If absent,
 *                             the PROPOSED ceil default applies and the
 *                             response sets roundingRuleIsProposed: true so a
 *                             proposal is never mistaken for a ratified rule.
 * @param {string[]} [config.executableStatuses]  Default proposal:
 *                             ['validated','ready_for_randomization'].
 */
function createStage1Service({
  repository,
  audit = null,
  randomInt = undefined,
  now = () => new Date(),
  config = {},
} = {}) {
  if (!repository) {
    throw new Stage1ValidationError('Stage 1 service requires a repository port.');
  }

  const executableStatuses = Array.isArray(config.executableStatuses)
    ? config.executableStatuses
    : ['validated', 'ready_for_randomization'];

  async function executeRun(rawBody, actor) {
    // Step 1: request validation ----------------------------------------
    const body = validateExecuteRunRequest(rawBody);
    if (!actor || actor.id === undefined || actor.id === null) {
      throw new Stage1AuthorizationError('Authentication required.');
    }
    if (actor.districtId === undefined || actor.districtId === null) {
      throw new Stage1AuthorizationError(
        'Authenticated user has no district scope; Stage 1 cannot be executed.'
      );
    }
    if (typeof audit?.record !== 'function') {
      throw new Stage1PrerequisiteError(
        'Audit interface is not available; Stage 1 refuses to run unaudited.'
      );
    }

    const districtId = actor.districtId;

    // Step 3: prerequisites ---------------------------------------------
    const cfg = await repository.getElectionConfiguration(
      null,
      body.electionConfigurationId,
      districtId
    );
    if (!cfg) {
      // Also covers "exists outside caller's district" — no cross-district leak.
      throw new Stage1NotFoundError('Election configuration not found.');
    }
    if (!executableStatuses.includes(cfg.status)) {
      throw new Stage1PrerequisiteError(
        'Election configuration status does not permit Stage 1 execution.',
        { currentStatus: cfg.status, permittedStatuses: executableStatuses }
      );
    }
    const requiredStrength = normalizeRequiredStrength(cfg);
    if (requiredStrength.length === 0) {
      throw new Stage1PrerequisiteError(
        'Election configuration has no approved required-strength figures.'
      );
    }
    if (await repository.hasActiveRun(null, cfg.id)) {
      throw new Stage1ConflictError(
        'A completed Stage 1 run already exists for this election configuration. ' +
          'Superseding a completed run is an unresolved policy (open question); ' +
          'refusing to run.'
      );
    }

    // Step 4: pool-size calculation (per Mandal, 120% [O]) ---------------
    const roundingRule = body.roundingRule;
    const roundingRuleIsProposed = !config.roundingRule;
    const mandalPlan = requiredStrength.map((req) => ({
      ...req,
      poolSize: calculatePoolSize(req.requiredCount, { roundingRule }),
    }));

    // Steps 5-7: fetch, select, classify ---------------------------------
    const entries = [];
    const selectedIdsGlobal = new Set();
    for (const mandal of mandalPlan) {
      const candidates = await fetchCandidates(districtId, mandal.mandalId);
      const { eligible } = filterEligible(candidates, { districtId });

      if (eligible.length < mandal.poolSize) {
        throw new Stage1InsufficientPersonnelError(
          'Insufficient eligible personnel for a Mandal; aborting the whole run ' +
            '(no partial selection is recorded).',
          {
            mandalId: mandal.mandalId,
            requiredPoolSize: mandal.poolSize,
            eligibleCount: eligible.length,
          }
        );
      }

      const drawn = selectRandom(eligible, mandal.poolSize, { randomInt });
      const { required, reserve } = splitPool(mandal.poolSize, mandal.requiredCount);

      let requiredPlaced = 0;
      for (const person of drawn) {
        const key = String(person.id);
        if (selectedIdsGlobal.has(key)) {
          throw new Stage1ResultInvalidError(
            'Selection produced a duplicate personnel identifier.',
            { personnelId: person.id, mandalId: mandal.mandalId }
          );
        }
        selectedIdsGlobal.add(key);
        const classification =
          requiredPlaced < required
            ? POOL_CLASSIFICATION.REQUIRED
            : POOL_CLASSIFICATION.RESERVE;
        if (classification === POOL_CLASSIFICATION.REQUIRED) requiredPlaced += 1;
        entries.push({
          personnelId: person.id,
          mandalId: mandal.mandalId,
          classification,
        });
      }
      mandal.requiredSelected = required;
      mandal.reserveSelected = reserve;
    }

    // Step 8: result invariants -----------------------------------------
    validateResultInvariants(mandalPlan, entries);

    // Step 9: ordered persistence with compensating cleanup -------------
    const totals = mandalPlan.reduce(
      (acc, m) => ({
        targetPoolCount: acc.targetPoolCount + m.poolSize,
        requiredCount: acc.requiredCount + m.requiredCount,
        selectedCount: acc.selectedCount + m.requiredSelected + m.reserveSelected,
        reserveCount: acc.reserveCount + m.reserveSelected,
      }),
      { targetPoolCount: 0, requiredCount: 0, selectedCount: 0, reserveCount: 0 }
    );

    const runRecord = {
      electionConfigurationId: cfg.id,
      districtId,
      stage: STAGE_NUMBER,
      executedBy: actor.id,
      executedAt: now().toISOString(),
      status: RUN_STATUS.COMPLETED,
      ...totals,
    };

    const tx = await repository.beginTransaction();
    let runId;
    try {
      ({ runId } = await repository.insertRun(tx, runRecord));
      await repository.insertResults(tx, runId, entries);
      await repository.commitTransaction(tx);
    } catch (err) {
      try {
        await repository.rollbackTransaction(tx);
      } catch (cleanupError) {
        throw new Stage1PersistenceError(
          `Stage 1 persistence failed (${err.message}); compensating cleanup also failed (${cleanupError.message}). Run ${tx.runId || 'record'} may require manual reconciliation.`,
          { cause: err.message, cleanupError: cleanupError.message, runId: tx.runId || null }
        );
      }
      if (err instanceof Stage1ConflictError) throw err;
      throw new Stage1PersistenceError(
        'Stage 1 run could not be persisted; compensating cleanup was completed.',
        { cause: err.message }
      );
    }

    // Step 10: audit -----------------------------------------------------
    try {
      await audit.record({
        actorId: actor.id,
        action: 'randomization.stage1.execute',
        targetType: 'randomization_run',
        targetId: runId,
        electionConfigurationId: cfg.id,
        districtId,
        outcome: 'success',
        metadata: {
          stage: STAGE_NUMBER,
          mandalCount: mandalPlan.length,
          ...totals,
          roundingRule,
          roundingRuleIsProposed,
        },
        timestamp: now().toISOString(),
      });
    } catch (err) {
      // Honest reporting: the run IS persisted; only the audit failed.
      throw new Stage1AuditError(
        'Stage 1 run was persisted, but the audit event could not be recorded. ' +
          'Manual reconciliation of the audit trail is required.',
        { runId, cause: err.message }
      );
    }

    return {
      runId,
      electionConfigurationId: cfg.id,
      districtId,
      status: RUN_STATUS.COMPLETED,
      stage: STAGE_NUMBER,
      ...totals,
      mandals: mandalPlan.map((m) => ({
        mandalId: m.mandalId,
        requiredCount: m.requiredCount,
        targetPoolSize: m.poolSize,
        requiredSelected: m.requiredSelected,
        reserveSelected: m.reserveSelected,
      })),
      roundingRule,
      roundingRuleIsProposed,
    };
  }

  /* -------------------------------------------------------------------------
   * Read APIs (summaries + results), all district-scoped via the actor.
   * ---------------------------------------------------------------------- */

  async function getRunSummary(runIdParam, actor) {
    const runId = validateRunIdParam(runIdParam);
    assertActorScope(actor);
    const run = await repository.getRun(null, runId, actor.districtId);
    if (!run) throw new Stage1NotFoundError('Stage 1 run not found.');
    return toSummary(run);
  }

  async function listRunSummaries(query, actor) {
    assertActorScope(actor);
    const runs = await repository.listRuns(null, {
      electionConfigurationId: query?.electionConfigurationId ?? null,
      districtId: actor.districtId,
      limit: clampInt(query?.limit, 1, 200, 50),
      offset: clampInt(query?.offset, 0, Number.MAX_SAFE_INTEGER, 0),
    });
    return runs.map(toSummary);
  }

  async function getRunResults(runIdParam, actor) {
    const runId = validateRunIdParam(runIdParam);
    assertActorScope(actor);
    const run = await repository.getRun(null, runId, actor.districtId);
    if (!run) throw new Stage1NotFoundError('Stage 1 run not found.');
    const entries = await repository.getResults(null, runId, actor.districtId);
    return {
      runId,
      electionConfigurationId: run.electionConfigurationId,
      status: run.status,
      selectedCount: run.selectedCount,
      requiredCount: run.requiredCount,
      reserveCount: run.reserveCount,
      results: entries.map((e) => ({
        personnelId: e.personnelId,
        mandalId: e.mandalId,
        classification: e.classification,
      })),
    };
  }

  /* -------------------------------------------------------------------------
   * Private helpers.
   * ---------------------------------------------------------------------- */

  function assertActorScope(actor) {
    if (!actor || actor.id === undefined || actor.id === null) {
      throw new Stage1AuthorizationError('Authentication required.');
    }
    if (actor.districtId === undefined || actor.districtId === null) {
      throw new Stage1AuthorizationError(
        'Authenticated user has no district scope.'
      );
    }
  }

  async function fetchCandidates(districtId, mandalId) {
    if (typeof repository.getEligibleCandidates !== 'function') {
      throw new Stage1PrerequisiteError(
        'Repository does not implement getEligibleCandidates; cannot build the ' +
          'eligible pool. The personnel access layer is a Phase-3 shared ' +
          'dependency (see stage1README.md).'
      );
    }
    return repository.getEligibleCandidates(null, { districtId, mandalId });
  }

  function toSummary(run) {
    return {
      runId: run.runId,
      electionConfigurationId: run.electionConfigurationId,
      districtId: run.districtId,
      stage: run.stage,
      status: run.status,
      executedBy: run.executedBy,
      executedAt: run.executedAt,
      targetPoolCount: run.targetPoolCount,
      selectedCount: run.selectedCount,
      requiredCount: run.requiredCount,
      reserveCount: run.reserveCount,
    };
  }

  return {
    executeRun,
    getRunSummary,
    listRunSummaries,
    getRunResults,
  };
}

/* -------------------------------------------------------------------------
 * Module-level helpers (pure).
 * ---------------------------------------------------------------------- */

/**
 * normalizeRequiredStrength(cfg) -> [{mandalId, requiredCount}]
 *
 * Extracts the approved per-Mandal required-strength figures from an election
 * configuration. CONFIRMED [O]: the 120% base is per-Mandal (circular p.5(b)).
 * The exact storage shape of these figures on the shared election-configuration
 * record is a Phase-2 schema decision; this helper accepts the proposed shape
 * { requiredStrength: [{mandalId, requiredCount}] } and validates it strictly
 * rather than guessing.
 */
function normalizeRequiredStrength(cfg) {
  const rows = cfg.requiredStrength;
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      throw new Stage1PrerequisiteError(
        'Required-strength entries must be objects with mandalId and requiredCount.'
      );
    }
    if (row.mandalId === undefined || row.mandalId === null) {
      throw new Stage1PrerequisiteError(
        'Required-strength entries must include a mandalId.'
      );
    }
    if (
      typeof row.requiredCount !== 'number' ||
      !Number.isSafeInteger(row.requiredCount) ||
      row.requiredCount < 0
    ) {
      throw new Stage1PrerequisiteError(
        'Required-strength entries must include a non-negative integer requiredCount.',
        { mandalId: row.mandalId }
      );
    }
    const key = String(row.mandalId);
    if (seen.has(key)) {
      throw new Stage1PrerequisiteError(
        'Required-strength figures contain a duplicate mandalId.',
        { mandalId: row.mandalId }
      );
    }
    seen.add(key);
    out.push({ mandalId: row.mandalId, requiredCount: row.requiredCount });
  }
  return out;
}

/**
 * validateResultInvariants(mandalPlan, entries)
 * Runs BEFORE persistence; any failure aborts the run (nothing saved).
 */
function validateResultInvariants(mandalPlan, entries) {
  const targetPoolCount = mandalPlan.reduce((s, m) => s + m.poolSize, 0);
  if (entries.length !== targetPoolCount) {
    throw new Stage1ResultInvalidError('Selected count does not match target pool size.', {
      targetPoolCount,
      selectedCount: entries.length,
    });
  }
  const ids = entries.map((e) => String(e.personnelId));
  if (new Set(ids).size !== ids.length) {
    throw new Stage1ResultInvalidError('Duplicate personnel identifiers in result.');
  }
  const requiredActual = entries.filter(
    (e) => e.classification === POOL_CLASSIFICATION.REQUIRED
  ).length;
  const requiredExpected = mandalPlan.reduce((s, m) => s + m.requiredCount, 0);
  if (requiredActual !== requiredExpected) {
    throw new Stage1ResultInvalidError('Required/reserve counts do not reconcile.', {
      requiredExpected,
      requiredActual,
    });
  }
  for (const e of entries) {
    const mandal = mandalPlan.find((m) => String(m.mandalId) === String(e.mandalId));
    if (!mandal) {
      throw new Stage1ResultInvalidError('Result entry references an unknown mandal.', {
        mandalId: e.mandalId,
      });
    }
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

module.exports = {
  createStage1Service,
  normalizeRequiredStrength,
  validateResultInvariants,
};

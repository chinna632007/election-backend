'use strict';

/**
 * Contract tests — the Stage 1 -> Stage 2 handoff and the dormant PG guards.
 * Run: node --test tests/stage1/contract.test.js
 *
 * Stage 2 will consume Stage 1 output ONLY through the shared database
 * contract: a completed run for an election configuration, with personnel
 * references and required/reserve markings (docs/API_CONTRACTS.md §3,
 * docs/TEAM_RESPONSIBILITIES.md §4). These tests pin that shape so the
 * handoff is testable even before Stage 2 exists.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const stage1 = require('../../src/modules/randomization-stage-1');

function makeLcg(seed) {
  let state = seed >>> 0;
  return (maxExclusive) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % maxExclusive;
  };
}

test('completed run + results satisfy the agreed downstream contract shape', async () => {
  const repository = stage1.createInMemoryStage1Repository({
    electionConfigurations: [
      {
        id: 'ec-2026-mp',
        districtId: 'd1',
        status: 'ready_for_randomization',
        requiredStrength: [{ mandalId: 'm1', requiredCount: 5 }],
      },
    ],
    personnel: Array.from({ length: 15 }, (_, i) => ({
      id: `pers-${i + 1}`,
      isActive: true,
      districtId: 'd1',
      mandalId: 'm1',
    })),
  });
  const audit = { async record() {} };
  const service = stage1.createStage1Service({
    repository,
    audit,
    randomInt: makeLcg(5),
    config: { roundingRule: 'ceil' },
  });
  const actor = { id: 'deA-1', districtId: 'd1' };

  const summary = await service.executeRun(
    { electionConfigurationId: 'ec-2026-mp' },
    actor
  );

  // --- Contract invariants a Stage 2 consumer relies on ---
  // 1. Run is identified, completed, staged, and scoped.
  assert.equal(typeof summary.runId, 'string');
  assert.equal(summary.electionConfigurationId, 'ec-2026-mp');
  assert.equal(summary.districtId, 'd1');
  assert.equal(summary.stage, 1);
  assert.equal(summary.status, 'completed');

  // 2. Persisted run row carries the same scope + counts.
  const run = await repository.getRun(null, summary.runId);
  assert.equal(run.electionConfigurationId, 'ec-2026-mp');
  assert.equal(run.stage, 1);
  assert.equal(run.status, 'completed');

  // 3. Persisted entries reference shared personnel identifiers with
  //    required/reserve markings — the data Stage 2 forms teams from.
  const entries = await repository.getResults(null, summary.runId);
  assert.equal(entries.length, summary.selectedCount);
  for (const e of entries) {
    assert.ok(e.runId === summary.runId);
    assert.ok(['required', 'reserve'].includes(e.classification));
    assert.equal(typeof e.personnelId, 'string');
    assert.equal(e.mandalId, 'm1');
  }

  // 4. The required portion exactly matches the requirement; the reserve
  //    portion is the 20% excess.
  assert.equal(
    entries.filter((e) => e.classification === 'required').length,
    summary.requiredCount
  );
  assert.equal(
    entries.filter((e) => e.classification === 'reserve').length,
    summary.reserveCount
  );

  // 5. hasActiveRun now guards a Stage 2 precondition ("a completed Stage 1
  //    run exists") and a Stage 1 re-run guard.
  assert.equal(await repository.hasActiveRun(null, 'ec-2026-mp'), true);
});

test('MongoDB repository is part of the Stage 1 public contract', () => {
  assert.equal(typeof stage1.createMongoStage1Repository, 'function');
});

'use strict';

/**
 * Service read-side tests + rounding-proposal flag behavior.
 * Run: node --test tests/stage1/reads.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createStage1Service,
} = require('../../src/modules/randomization-stage-1/stage1.service');
const {
  createInMemoryStage1Repository,
} = require('../../src/modules/randomization-stage-1/stage1.repository');
const {
  Stage1NotFoundError,
  Stage1AuthorizationError,
} = require('../../src/modules/randomization-stage-1/stage1.errors');

function makeLcg(seed) {
  let state = seed >>> 0;
  return (maxExclusive) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % maxExclusive;
  };
}

function makeWorld(overrides = {}) {
  const repository = createInMemoryStage1Repository({
    electionConfigurations: [
      {
        id: 'ec1',
        districtId: 'd1',
        status: 'ready_for_randomization',
        requiredStrength: [{ mandalId: 'm1', requiredCount: 5 }],
      },
    ],
    personnel: Array.from({ length: 20 }, (_, i) => ({
      id: `d1-m1-p${i + 1}`,
      isActive: true,
      districtId: 'd1',
      mandalId: 'm1',
    })),
  });
  const audit = { async record() {} };
  const service = createStage1Service({
    repository,
    audit,
    randomInt: makeLcg(11),
    config: overrides.config || { roundingRule: 'ceil' },
  });
  return {
    service,
    repository,
    actor: { id: 'u1', districtId: 'd1' },
    otherDistrictActor: { id: 'u2', districtId: 'd2' },
  };
}

test('getRunSummary returns the summary; unknown id -> NotFound', async () => {
  const { service, actor } = makeWorld();
  const summary = await service.executeRun({ electionConfigurationId: 'ec1' }, actor);
  const got = await service.getRunSummary(summary.runId, actor);
  assert.equal(got.runId, summary.runId);
  assert.equal(got.status, 'completed');
  await assert.rejects(
    service.getRunSummary('s1run-does-not-exist', actor),
    Stage1NotFoundError
  );
});

test('cross-district read of a run -> NotFound (scoping)', async () => {
  const { service, actor, otherDistrictActor } = makeWorld();
  const summary = await service.executeRun({ electionConfigurationId: 'ec1' }, actor);
  await assert.rejects(
    service.getRunSummary(summary.runId, otherDistrictActor),
    Stage1NotFoundError
  );
  await assert.rejects(
    service.getRunResults(summary.runId, otherDistrictActor),
    Stage1NotFoundError
  );
});

test('listRunSummaries filters by election configuration', async () => {
  const { service, repository, actor } = makeWorld();
  const summary = await service.executeRun({ electionConfigurationId: 'ec1' }, actor);
  const all = await service.listRunSummaries({}, actor);
  assert.equal(all.length, 1);
  const filtered = await service.listRunSummaries(
    { electionConfigurationId: 'other' },
    actor
  );
  assert.equal(filtered.length, 0);
  // Sanity: repository state holds exactly the one completed run.
  assert.equal(repository.__state.runs.length, 1);
  assert.equal(all[0].runId, summary.runId);
});

test('getRunResults returns personnel with reserve markings (Stage 2 contract)', async () => {
  const { service, actor } = makeWorld();
  const summary = await service.executeRun({ electionConfigurationId: 'ec1' }, actor);
  const payload = await service.getRunResults(summary.runId, actor);
  assert.equal(payload.runId, summary.runId);
  assert.equal(payload.electionConfigurationId, 'ec1');
  assert.equal(payload.results.length, 6);
  assert.equal(payload.reserveCount, 1);
  const classes = new Set(payload.results.map((r) => r.classification));
  assert.deepEqual([...classes].sort(), ['required', 'reserve']);
  for (const r of payload.results) {
    assert.ok(r.personnelId);
    assert.equal(r.mandalId, 'm1');
  }
});

test('unauthenticated reads are rejected', async () => {
  const { service, actor } = makeWorld();
  const summary = await service.executeRun({ electionConfigurationId: 'ec1' }, actor);
  await assert.rejects(service.getRunSummary(summary.runId, null), Stage1AuthorizationError);
  await assert.rejects(service.listRunSummaries({}, { id: 'u9' }), Stage1AuthorizationError);
  await assert.rejects(service.getRunResults(summary.runId, null), Stage1AuthorizationError);
});

test('when no ratified rounding rule is configured, the proposal flag is set', async () => {
  const { service, actor } = makeWorld({ config: {} }); // no config.roundingRule
  const summary = await service.executeRun({ electionConfigurationId: 'ec1' }, actor);
  assert.equal(summary.roundingRule, 'ceil');
  assert.equal(
    summary.roundingRuleIsProposed,
    true,
    'default must be visibly flagged as a PROPOSAL, not a ratified rule'
  );
});

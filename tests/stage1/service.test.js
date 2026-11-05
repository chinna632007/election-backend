'use strict';

/**
 * Service tests — Stage 1 workflow with injected fake ports.
 * Run: node --test tests/stage1/service.test.js
 *
 * Uses the in-memory reference repository + a recording audit port. Covers:
 * success path, prerequisite failures, cross-district denial, insufficient
 * personnel, conflict on repeat execution, rollback on write failure, audit
 * failure reporting, unresolved-rounding behavior, and reconciliation.
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
  Stage1AuthorizationError,
  Stage1NotFoundError,
  Stage1PrerequisiteError,
  Stage1InsufficientPersonnelError,
  Stage1ConflictError,
  Stage1PersistenceError,
  Stage1AuditError,
} = require('../../src/modules/randomization-stage-1/stage1.errors');

function makeLcg(seed) {
  let state = seed >>> 0;
  return (maxExclusive) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % maxExclusive;
  };
}

function makePersonnel(districtId, mandalId, count, { startId = 1, ...props } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${districtId}-${mandalId}-p${startId + i}`,
    isActive: true,
    districtId,
    mandalId,
    ...props,
  }));
}

function makeAudit() {
  return {
    events: [],
    async record(event) {
      this.events.push(event);
    },
  };
}

function makeWorld(overrides = {}) {
  const electionConfigurations = overrides.electionConfigurations || [
    {
      id: 'ec1',
      districtId: 'd1',
      status: 'ready_for_randomization',
      requiredStrength: [{ mandalId: 'm1', requiredCount: 5 }],
    },
  ];
  const personnel = overrides.personnel || makePersonnel('d1', 'm1', 20);
  const repository = createInMemoryStage1Repository({
    electionConfigurations,
    personnel,
  });
  const audit = overrides.audit ?? makeAudit();
  const service = createStage1Service({
    repository,
    audit,
    randomInt: makeLcg(2026),
    now: () => new Date('2026-04-01T10:00:00Z'),
    config: overrides.config || { roundingRule: 'ceil' },
  });
  const actor = overrides.actor || { id: 'user-1', districtId: 'd1' };
  return { service, repository, audit, actor };
}

test('happy path: run persists atomically and reconciles counts', async () => {
  const { service, repository, audit, actor } = makeWorld();
  const summary = await service.executeRun(
    { electionConfigurationId: 'ec1' },
    actor
  );

  assert.equal(summary.status, 'completed');
  assert.equal(summary.stage, 1);
  assert.equal(summary.targetPoolCount, 6);
  assert.equal(summary.selectedCount, 6);
  assert.equal(summary.requiredCount, 5);
  assert.equal(summary.reserveCount, 1);
  assert.equal(summary.roundingRule, 'ceil');
  assert.equal(summary.roundingRuleIsProposed, false);

test('U3 (proposed): a second execution for the same config conflicts', async () => {
  const { service, actor } = makeWorld();
  await service.executeRun({ electionConfigurationId: 'ec1' }, actor);
  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, actor),
    Stage1ConflictError
  );
});

test('missing configuration -> NotFound (no cross-district leak)', async () => {
  const { service, actor } = makeWorld();
  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'nope' }, actor),
    Stage1NotFoundError
  );
});

test('cross-district: config of another district is not found for this actor', async () => {
  const { service } = makeWorld();
  const otherActor = { id: 'user-2', districtId: 'd2' };
  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, otherActor),
    Stage1NotFoundError
  );
});

test('non-executable configuration status -> PrerequisiteError', async () => {
  const { service, actor } = makeWorld({
    electionConfigurations: [
      {
        id: 'ec1',
        districtId: 'd1',
        status: 'importing',
        requiredStrength: [{ mandalId: 'm1', requiredCount: 5 }],
      },
    ],
  });
  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, actor),
    (err) =>
      err instanceof Stage1PrerequisiteError &&
      err.details.currentStatus === 'importing'
  );
});

test('missing required-strength figures -> PrerequisiteError', async () => {
  const { service, actor } = makeWorld({
    electionConfigurations: [
      { id: 'ec1', districtId: 'd1', status: 'ready_for_randomization' },
    ],
  });

test('rollback: mid-transaction write failure persists nothing', async () => {
  const { service, repository, audit, actor } = makeWorld();
  // Sabotage the next insertRun call to fail after the transaction begins.
  const originalInsertRun = repository.insertRun;
  repository.insertRun = async (...args) => {
    repository.insertRun = originalInsertRun; // only fail once
    throw new Stage1PersistenceError('Simulated mid-transaction failure.');
  };

  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, actor),
    Stage1PersistenceError
  );
  assert.equal((await repository.listRuns(null, {})).length, 0);
  assert.equal(repository.__state.results.length, 0, 'no orphan result rows');
  assert.equal(audit.events.length, 0, 'no audit on failure');
});

test('audit failure is reported honestly (run persisted, audit missing)', async () => {
  const audit = {
    async record() {
      throw new Error('audit backend down');
    },
  };
  const { service, repository, actor } = makeWorld({ audit });
  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, actor),
    (err) =>
      err instanceof Stage1AuditError && err.details.runId !== undefined
  );
  const runs = await repository.listRuns(null, {});
  assert.equal(runs.length, 1, 'run itself WAS persisted');
  assert.equal(runs[0].status, 'completed');
});

test('service refuses to run without an audit port (fail closed)', async () => {
  const { repository, actor } = makeWorld();
  const svc = createStage1Service({
    repository,
    audit: null,
    config: { roundingRule: 'ceil' },
  });
  await assert.rejects(
    svc.executeRun({ electionConfigurationId: 'ec1' }, actor),
    Stage1PrerequisiteError
  );
});

test('unauthenticated or district-less actor is rejected', async () => {
  const { service } = makeWorld();
  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, null),
    Stage1AuthorizationError
  );
  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, { id: 'u9' }),
    Stage1AuthorizationError
  );
});

test('invalid request bodies are rejected by validation', async () => {
  const { service, actor } = makeWorld();
  for (const bad of [null, 'x', [], {}, { electionConfigurationId: '' },
    { electionConfigurationId: 42 }]) {
    await assert.rejects(service.executeRun(bad, actor), (err) => err.statusCode === 400);
  }
});

test('multi-mandal election: pools computed per Mandal [O p.5(b)]', async () => {
  const { service, repository, actor } = makeWorld({
    electionConfigurations: [
      {
        id: 'ec2',
        districtId: 'd1',
        status: 'validated', // also an approved status in the default proposal
        requiredStrength: [
          { mandalId: 'm1', requiredCount: 5 }, // pool 6
          { mandalId: 'm2', requiredCount: 3 }, // pool 4 (ceil of 3.6)
          { mandalId: 'm3', requiredCount: 10 }, // pool 12
        ],
      },
    ],
    personnel: [
      ...makePersonnel('d1', 'm1', 12),
      ...makePersonnel('d1', 'm2', 10),
      ...makePersonnel('d1', 'm3', 15),
    ],
  });
  const summary = await service.executeRun({ electionConfigurationId: 'ec2' }, actor);
  assert.equal(summary.targetPoolCount, 22);
  assert.equal(summary.requiredCount, 18);
  assert.equal(summary.reserveCount, 4);
  assert.equal(summary.selectedCount, 22);
  const entries = await repository.getResults(null, summary.runId);
  const byMandal = {};
  for (const e of entries) {
    byMandal[e.mandalId] = byMandal[e.mandalId] || { required: 0, reserve: 0 };
    byMandal[e.mandalId][e.classification] += 1;
  }
  assert.deepEqual(byMandal, {
    m1: { required: 5, reserve: 1 },
    m2: { required: 3, reserve: 1 },
    m3: { required: 10, reserve: 2 },
  });
});

  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, actor),
    Stage1PrerequisiteError
  );
});

test('insufficient eligible personnel aborts the whole run (no partial save)', async () => {
  const { service, repository, actor } = makeWorld({
    personnel: makePersonnel('d1', 'm1', 4), // target pool is 6
  });
  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, actor),
    (err) =>
      err instanceof Stage1InsufficientPersonnelError &&
      err.details.requiredPoolSize === 6 &&
      err.details.eligibleCount === 4
  );
  assert.equal((await repository.listRuns(null, {})).length, 0);
});

test('ineligible surplus does not count toward the pool', async () => {
  const { service, actor } = makeWorld({
    personnel: [
      ...makePersonnel('d1', 'm1', 3),
      ...makePersonnel('d1', 'm1', 3, { startId: 100, isActive: false }),
    ],
  });
  await assert.rejects(
    service.executeRun({ electionConfigurationId: 'ec1' }, actor),
    Stage1InsufficientPersonnelError
  );
});


  const run = await repository.getRun(null, summary.runId);
  assert.equal(run.status, 'completed');
  assert.equal(run.executedBy, 'user-1');
  assert.equal(run.executedAt, '2026-04-01T10:00:00.000Z');

  const entries = await repository.getResults(null, summary.runId);
  assert.equal(entries.length, 6);
  const required = entries.filter((e) => e.classification === 'required');
  const reserve = entries.filter((e) => e.classification === 'reserve');
  assert.equal(required.length, 5);
  assert.equal(reserve.length, 1);
  for (const e of entries) {
    assert.ok(e.personnelId.startsWith('d1-m1-'));
  }

  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0].action, 'randomization.stage1.execute');
  assert.equal(audit.events[0].targetId, summary.runId);
  assert.equal(audit.events[0].outcome, 'success');
});

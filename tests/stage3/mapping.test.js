'use strict';

/**
 * tests/stage3/mapping.test.js
 *
 * Stage 3 — team↔station mapping engine + service behavior (pure, no DB).
 * Run: node --test tests/stage3/mapping.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const stage3 = require('../../src/modules/randomization-stage-3');
const { Stage3ValidationError, Stage3UnresolvedRuleError } = stage3.errors;

// Deterministic RNG so shuffle-based tests are reproducible.
function seededRandom(seed) {
  let s = seed;
  return function (n) {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % n;
  };
}

function makeStage2Run(partyCount) {
  const parties = [];
  for (let i = 1; i <= partyCount; i += 1) {
    parties.push({ teamCode: 'PP-' + i, teamSize: 6, postingMandal: 'M' + i });
  }
  return {
    stage: 2,
    runId: 'r2',
    stage1RunId: 'r1',
    electionConfigurationId: 'ec1',
    districtId: 'KAKINADA',
    status: 'completed',
    parties: parties,
  };
}

function makeStations(stationCount) {
  const out = [];
  for (let i = 1; i <= stationCount; i += 1) {
    out.push({ stationId: 'PS-' + i, stationCode: 'A' + i, mandal: 'M' + i });
  }
  return out;
}

test('refuses a Stage 2 run that is not completed', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(7) });
  const run = makeStage2Run(2);
  run.status = 'draft';
  assert.throws(
    () => svc.executeMapping({ stage2Run: run, pollingStations: makeStations(2) }),
    (e) => e instanceof Stage3ValidationError && /completed Stage 2 run/.test(e.message)
  );
});

test('rejects a stage2Run with wrong stage or missing district', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(7) });
  assert.throws(
    () => svc.executeMapping({ stage2Run: { stage: 1, electionConfigurationId: 'ec', districtId: 'D', status: 'completed', parties: [{ teamCode: 't', teamSize: 1 }] }, pollingStations: [{ stationId: 's' }] }),
    Stage3ValidationError
  );
  const run = makeStage2Run(1);
  run.districtId = '';
  assert.throws(
    () => svc.executeMapping({ stage2Run: run, pollingStations: [{ stationId: 's' }] }),
    Stage3ValidationError
  );
});

test('rejects empty parties or empty pollingStations', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(7) });
  const run = makeStage2Run(0);
  run.parties = [];
  assert.throws(() => svc.executeMapping({ stage2Run: run, pollingStations: makeStations(2) }), Stage3ValidationError);
  assert.throws(() => svc.executeMapping({ stage2Run: makeStage2Run(2), pollingStations: [] }), Stage3ValidationError);
});

test('rejects duplicate teamCodes and duplicate stationIds', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(7) });
  const dupRun = makeStage2Run(2);
  dupRun.parties[1].teamCode = dupRun.parties[0].teamCode;
  assert.throws(() => svc.executeMapping({ stage2Run: dupRun, pollingStations: makeStations(2) }), /Duplicate teamCode/);
  const stations = makeStations(2);
  stations[1].stationId = stations[0].stationId;
  assert.throws(() => svc.executeMapping({ stage2Run: makeStage2Run(2), pollingStations: stations }), /Duplicate stationId/);
});

test('sensitive fields on options are rejected', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(7) });
  assert.throws(
    () => svc.executeMapping({ stage2Run: makeStage2Run(1), pollingStations: makeStations(1), options: { aadhaar: '1234' } }),
    /sensitive fields/
  );
});

test('non one_to_one mapping mode fails closed as unresolved', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(7) });
  assert.throws(
    () => svc.executeMapping({ stage2Run: makeStage2Run(1), pollingStations: makeStations(1), options: { mappingMode: 'one_to_many' } }),
    (e) => e instanceof Stage3UnresolvedRuleError
  );
});



test('balanced input yields a completed, confidential one-to-one mapping', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(123) });
  const res = svc.executeMapping({ stage2Run: makeStage2Run(5), pollingStations: makeStations(5) });
  assert.equal(res.status, 'completed');
  assert.equal(res.publicationStatus, 'confidential');
  assert.equal(res.counts.assignments, 5);
  assert.equal(res.unmetRequirements.length, 0);
  const teams = new Set(res.assignments.map((a) => a.teamCode));
  const stations = new Set(res.assignments.map((a) => a.stationId));
  assert.equal(teams.size, 5, 'every team used exactly once');
  assert.equal(stations.size, 5, 'every station used exactly once');
});

test('station address components survive validation and randomized assignment', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(12) });
  const [station] = makeStations(1);
  Object.assign(station, {
    stationName: 'North Primary School',
    buildingName: 'Main Block',
    street: 'Market Road',
    locality: 'Ward 4',
    ward: '4',
    district: 'Kakinada',
    pinCode: '533001',
  });
  const res = svc.executeMapping({ stage2Run: makeStage2Run(1), pollingStations: [station] });
  assert.deepEqual(
    Object.fromEntries(Object.entries(res.assignments[0]).filter(([key]) => key !== 'publicationStatus')),
    {
      teamCode: 'PP-1',
      teamSize: 6,
      postingMandal: 'M1',
      stationId: 'PS-1',
      stationCode: 'A1',
      stationName: 'North Primary School',
      buildingName: 'Main Block',
      street: 'Market Road',
      locality: 'Ward 4',
      ward: '4',
      district: 'Kakinada',
      stationMandal: 'M1',
      pinCode: '533001',
    }
  );
});

test('assignments never carry sensitive or personnel fields', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(99) });
  const res = svc.executeMapping({ stage2Run: makeStage2Run(3), pollingStations: makeStations(3) });
  const keys = new Set();
  for (const a of res.assignments) Object.keys(a).forEach((k) => keys.add(k));
  const forbidden = ['aadhaar', 'aadhar', 'mobile', 'phone', 'voterId', 'epic', 'member', 'members', 'name', 'designation'];
  for (const k of forbidden) {
    assert.ok(!keys.has(k), 'assignment must not contain ' + k);
  }
});

test('deterministic RNG yields reproducible mapping', () => {
  const a = stage3.createStage3Service({ randomInt: seededRandom(555) });
  const b = stage3.createStage3Service({ randomInt: seededRandom(555) });
  const ra = a.executeMapping({ stage2Run: makeStage2Run(6), pollingStations: makeStations(6) });
  const rb = b.executeMapping({ stage2Run: makeStage2Run(6), pollingStations: makeStations(6) });
  assert.deepEqual(
    ra.assignments.map((x) => x.teamCode + '->' + x.stationId),
    rb.assignments.map((x) => x.teamCode + '->' + x.stationId)
  );
});

test('more parties than stations: incomplete, surplus reported, never force-assigned', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(31) });
  const res = svc.executeMapping({ stage2Run: makeStage2Run(5), pollingStations: makeStations(3) });
  assert.equal(res.status, 'incomplete');
  assert.equal(res.counts.assignments, 3);
  const surplus = res.unmetRequirements.find((u) => u.code === 'TEAMS_WITHOUT_STATION');
  assert.ok(surplus, 'surplus requirement must be reported');
  assert.equal(surplus.count, 2);
});

test('more stations than parties: incomplete, deficit reported, no double-staffing', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(31) });
  const res = svc.executeMapping({ stage2Run: makeStage2Run(3), pollingStations: makeStations(6) });
  assert.equal(res.status, 'incomplete');
  assert.equal(res.counts.assignments, 3);
  const deficit = res.unmetRequirements.find((u) => u.code === 'STATIONS_WITHOUT_TEAM');
  assert.ok(deficit, 'deficit requirement must be reported');
  assert.equal(deficit.count, 3);
});

test('publish reveals a completed mapping and does not mutate the input', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(8) });
  const res = svc.executeMapping({ stage2Run: makeStage2Run(2), pollingStations: makeStations(2) });
  const published = svc.publish(res);
  assert.equal(published.publicationStatus, 'published');
  assert.ok(published.assignments.every((a) => a.publicationStatus === 'published'));
  assert.equal(typeof published.publishedAt, 'string');
  assert.equal(res.publicationStatus, 'confidential');
});

test('publish refuses an incomplete mapping and a double publish', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(8) });
  const incomplete = svc.executeMapping({ stage2Run: makeStage2Run(3), pollingStations: makeStations(1) });
  assert.throws(() => svc.publish(incomplete), (e) => e instanceof Stage3UnresolvedRuleError);
  const done = svc.executeMapping({ stage2Run: makeStage2Run(1), pollingStations: makeStations(1) });
  const once = svc.publish(done);
  assert.throws(() => svc.publish(once), (e) => e instanceof Stage3UnresolvedRuleError);
});

test('duty mandal must differ from every member work/native mandal', () => {
  // Member A: work_mandal=M1, nativeMandal=M2 (blocked from M1/M2)
  // Member B: work_mandal=M2, nativeMandal=M3 (blocked from M2/M3)
  // Member C: work_mandal=M3, nativeMandal=M4 (blocked from M3/M4)
  const compliantParty = {
    teamCode: 'PP-1', teamSize: 3, postingMandal: 'M1',
    members: [
      { personnelId: 'E1', name: 'A', workMandal: 'M1', nativeMandal: 'M2' },
      { personnelId: 'E2', name: 'B', workMandal: 'M2', nativeMandal: 'M3' },
      { personnelId: 'E3', name: 'C', workMandal: 'M3', nativeMandal: 'M4' },
    ],
  };
  const blockedParty = {
    teamCode: 'PP-2', teamSize: 3, postingMandal: 'M9',
    members: [
      { personnelId: 'E4', name: 'D', workMandal: 'M9', nativeMandal: 'M1' },
      { personnelId: 'E5', name: 'E', workMandal: 'M9', nativeMandal: 'M2' },
      { personnelId: 'E6', name: 'F', workMandal: 'M9', nativeMandal: 'M3' },
    ],
  };
  const stations = [
    { stationId: 'PS-1', stationCode: 'A1', mandal: 'M5' },
    { stationId: 'PS-2', stationCode: 'A2', mandal: 'M9' }, // blocked by E4/E5/E6
    { stationId: 'PS-3', stationCode: 'A3', mandal: 'M1' }, // blocked by E1/E4
  ];

  const svc = stage3.createStage3Service({ randomInt: seededRandom(123) });
  const res = svc.executeMapping({
    stage2Run: { stage: 2, runId: 'r2', stage1RunId: 'r1', electionConfigurationId: 'ec', districtId: 'D', status: 'completed', parties: [compliantParty, blockedParty] },
    pollingStations: stations,
  });
  // compliantParty should be assignable; blockedParty should fail the mandal rule.
  assert.equal(res.status, 'incomplete');
  const compliant = res.assignments.find((a) => a.teamCode === 'PP-1');
  assert.ok(compliant, 'compliant party should be assigned');
  assert.ok(!['M1', 'M2', 'M3', 'M4'].includes(compliant.stationMandal),
    'compliant party must not map to any member work/native mandal');
});

test('without adjacency data, teams are not assigned to a member work or native mandal', () => {
  const svc = stage3.createStage3Service({ randomInt: seededRandom(42) });
  const party = {
    teamCode: 'PP-1', teamSize: 2, postingMandal: 'M3',
    members: [{ workMandal: 'M1', nativeMandal: 'M2' }],
  };
  const res = svc.executeMapping({
    stage2Run: {
      stage: 2, electionConfigurationId: 'ec1', districtId: 'D', status: 'completed', parties: [party],
    },
    pollingStations: [{ stationId: 'PS-1', stationCode: 'A1', mandal: 'M1' }],
  });
  assert.equal(res.status, 'incomplete');
  assert.equal(res.assignments.length, 0);
  assert.equal(res.unmetRequirements[0].code, 'TEAMS_WITHOUT_ELIGIBLE_STATION');
});

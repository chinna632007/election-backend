'use strict';

/**
 * tests/randomization/mandal-adjacency.test.js — rule 2 (near-mandal posting
 * in BOTH Stage 2 and Stage 3) via the mandal_adjacency intake (migration 019).
 * Rule 1 (distinct office per party) is enforced by formation and re-checked
 * here in near mode.
 *
 * Run: node --test tests/randomization/mandal-adjacency.test.js
 */

const test = require('node:test');
const assert = require('node:assert');

const { parseMandalAdjacency } = require('../../src/modules/imports/intake');
const {
  buildAdjacencyLookup,
  eligiblePostingMandals,
  stationEligibleForTeam,
} = require('../../src/modules/randomization-stage-2/stage2.adjacency');
const { formParties } = require('../../src/modules/randomization-stage-2/stage2.formation');
const { mapTeamsToStations } = require('../../src/modules/randomization-stage-3/stage3.mapping');

const ADJ_ROWS = [
  { mandal_name: 'Kakinada Urban', near_mandal_names: ['Kakinada Rural', 'Pedapudi'] },
  { mandal_name: 'Kakinada Rural', near_mandal_names: ['Kakinada Urban', 'Tuni'] },
  { mandal_name: 'Tuni', near_mandal_names: ['Kakinada Rural'] },
  { mandal_name: 'Pedapudi', near_mandal_names: ['Kakinada Urban'] },
  { mandal_name: 'Lonely Mandal', near_mandal_names: [] },
];

// --- parser -----------------------------------------------------------------

test('parseMandalAdjacency splits near names, dedupes, drops self', () => {
  const header = 'Mandal_Name,Near_Mandal_Names\n';
  const body = 'Kakinada Urban,"Kakinada Rural, Pedapudi; Kakinada Rural | Kakinada Urban"\n' +
    'Tuni,Kakinada Rural\n' +
    'Kakinada Urban,Repeat Row\n';
  const { accepted, rejected } = parseMandalAdjacency(Buffer.from(header + body));
  assert.equal(accepted.length, 2);
  assert.deepEqual(accepted[0].near_mandal_names, ['Kakinada Rural', 'Pedapudi']);
  assert.deepEqual(accepted[1].near_mandal_names, ['Kakinada Rural']);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reasons.includes('duplicate_mandal_in_file'));
});

// --- lookup -----------------------------------------------------------------

test('lookup: unknown mandal fails closed (null), empty near set allowed', () => {
  const lookup = buildAdjacencyLookup(ADJ_ROWS);
  assert.deepEqual(lookup.nearOf('kakinada urban'), ['Kakinada Rural', 'Pedapudi']);
  assert.equal(lookup.nearOf('Unknown Mandal'), null);
  const lonely = lookup.nearKeysOf('Lonely Mandal');
  assert.ok(lonely instanceof Set);
  assert.equal(lonely.size, 0);
  assert.equal(lookup.size, 5);
});

function emp(name, office, work, native, rank) {
  return {
    personnelId: name, personnelKey: name, name, designation: 'Teacher',
    officeId: office, officeKey: office.toLowerCase(), officeName: office,
    workMandal: work, nativeMandal: native,
    seniorityRank: rank, presidingEligible: false, classification: 'required',
  };
}

test('eligiblePostingMandals: intersection of near(work) and near(native)', () => {
  const lookup = buildAdjacencyLookup(ADJ_ROWS);
  const postings = [
    { raw: 'Kakinada Urban', key: 'kakinada urban' },
    { raw: 'Tuni', key: 'tuni' },
    { raw: 'Pedapudi', key: 'pedapudi' },
  ];
  // A: near(Urban)={Rural,Pedapudi} ∩ near(Rural)={Urban,Tuni} = {}
  const a = eligiblePostingMandals([emp('A', 'O1', 'Kakinada Urban', 'Kakinada Rural', 1)], postings, lookup);
  assert.equal(a.length, 0);
  // B: near(Rural)={Urban,Tuni} ∩ near(Pedapudi)={Urban} = {Urban}
  const b = eligiblePostingMandals([emp('B', 'O1', 'Kakinada Rural', 'Pedapudi', 1)], postings, lookup);
  assert.deepEqual(b.map((p) => p.raw), ['Kakinada Urban']);
});

test('eligiblePostingMandals: unknown member mandal vetoes everything (fail closed)', () => {
  const lookup = buildAdjacencyLookup(ADJ_ROWS);
  const out = eligiblePostingMandals(
    [emp('C', 'O1', 'Nowhere', 'Kakinada Urban', 1)],
    [{ raw: 'Tuni', key: 'tuni' }],
    lookup
  );
  assert.equal(out.length, 0);
});

test('empty adjacency table -> no eligible postings (legacy path not taken)', () => {
  const lookup = buildAdjacencyLookup([]);
  assert.equal(lookup.size, 0);
  const out = eligiblePostingMandals(
    [emp('D', 'O1', 'Kakinada Urban', 'Pedapudi', 1)],
    [{ raw: 'Tuni', key: 'tuni' }],
    lookup
  );
  assert.equal(out.length, 0);
});

// --- Stage 2 formation in near mode ----------------------------------------

function makePool(n) {
  // n PO-eligible + n officers, distinct offices.
  // work=Rural native=Pedapudi: near(Rural)={Urban,Tuni} ∩ near(Pedapudi)={Urban}
  // = {Urban} -> only the Urban posting is eligible (and != own mandals).
  const pool = [];
  for (let i = 0; i < n; i += 1) {
    const p = emp('PO' + i, 'Sch' + i, 'Kakinada Rural', 'Pedapudi', i + 1);
    p.presidingEligible = true;
    pool.push(p);
    pool.push(emp('OF' + i, 'Sch' + i + 'x', 'Kakinada Rural', 'Pedapudi', n + i + 1));
  }
  return pool;
}

test('formParties near mode: every party posted in near mandal of EVERY member', () => {
  const lookup = buildAdjacencyLookup(ADJ_ROWS);
  const pool = makePool(6);
  const postings = [
    { raw: 'Kakinada Urban', key: 'kakinada urban' },
    { raw: 'Tuni', key: 'tuni' },
  ];
  const result = formParties(pool, {
    partySize: 2,
    postings,
    adjacency: lookup,
    maxAttempts: 20,
    randomInt: (max) => 0,
  });
  assert.ok(result.parties.length > 0, 'should form at least one party');
  for (const p of result.parties) {
    assert.equal(p.posting.raw, 'Kakinada Urban');
    // rule 1: distinct office still holds in near mode
    const offices = new Set(p.members.map((m) => m.officeKey));
    assert.equal(offices.size, p.members.length);
  }
});

test('formParties near mode: unfillable -> all unassigned, no forced parties', () => {
  const lookup = buildAdjacencyLookup(ADJ_ROWS);
  const pool = [
    // work=Urban native=Pedapudi: near(Urban)={Rural,Pedapudi} ∩ near(Pedapudi)={Urban}
    // = {} -> no eligible posting at all, regardless of PO eligibility below.
    emp('PO1', 'SchA', 'Kakinada Urban', 'Pedapudi', 1),
    emp('OF1', 'SchB', 'Kakinada Urban', 'Pedapudi', 5),
  ];
  pool[0].presidingEligible = true;
  const result = formParties(pool, {
    partySize: 2,
    postings: [{ raw: 'Kakinada Rural', key: 'kakinada rural' }],
    adjacency: lookup,
    maxAttempts: 5,
    randomInt: () => 0,
  });
  assert.equal(result.parties.length, 0);
  assert.equal(result.unassigned.length, 2);
});

// --- Stage 3 near mapping ---------------------------------------------------

test('mapTeamsToStations near mode: station must be adjacent to every member', () => {
  const lookup = buildAdjacencyLookup(ADJ_ROWS);
  const parties = [
    { teamCode: 'T1', teamSize: 2, postingMandal: 'Kakinada Urban' },
    { teamCode: 'T2', teamSize: 2, postingMandal: 'Kakinada Urban' },
  ];
  const membersByTeam = {
    // near(Rural)={Urban,Tuni} ∩ near(Pedapudi)={Urban} = {Urban} -> eligible.
    T1: [{ workMandal: 'Kakinada Rural', nativeMandal: 'Pedapudi' }],
    T2: [{ workMandal: 'Nowhere', nativeMandal: 'Pedapudi' }],        // unknown mandal
  };
  const stations = [
    { stationId: 'S1', stationCode: 'PS-1', mandal: 'Kakinada Urban' },
    { stationId: 'S2', stationCode: 'PS-2', mandal: 'Tuni' },
    { stationId: 'S3', stationCode: 'PS-3', mandal: 'Pedapudi' },
  ];
  const { assignments, unmetRequirements } = mapTeamsToStations(
    parties, stations, () => 0,
    { adjacency: lookup, membersByTeam }
  );
  assert.equal(assignments.length, 1, 'only T1 can be placed');
  assert.equal(assignments[0].teamCode, 'T1');
  assert.equal(assignments[0].stationMandal, 'Kakinada Urban');
  const bad = unmetRequirements.find((u) => u.code === 'TEAMS_WITHOUT_NEAR_STATION');
  assert.ok(bad, 'T2 reported, never force-assigned');
  assert.deepEqual(bad.teamCodes, ['T2']);
});

test('mapTeamsToStations legacy mode unchanged when no adjacency passed', () => {
  const parties = [{ teamCode: 'T1', teamSize: 1, postingMandal: 'M1' }];
  const stations = [{ stationId: 'S1', stationCode: 'PS-1', mandal: 'M1' }];
  const { assignments, unmetRequirements } = mapTeamsToStations(parties, stations, () => 0, {});
  assert.equal(assignments.length, 1);
  assert.equal(unmetRequirements.length, 0);
});

test('stationEligibleForTeam rejects member home mandal even when adjacent', () => {
  const lookup = buildAdjacencyLookup(ADJ_ROWS);
  // near(Rural)={Urban,Tuni} ∩ near(Pedapudi)={Urban} = {Urban} -> eligible.
  const ok = stationEligibleForTeam(
    'Kakinada Urban',
    [{ workMandal: 'Kakinada Rural', nativeMandal: 'Pedapudi' }],
    lookup
  );
  assert.equal(ok.ok, true);
  // Station = native mandal itself -> barred regardless of adjacency.
  const bad = stationEligibleForTeam(
    'Tuni',
    [{ workMandal: 'Kakinada Rural', nativeMandal: 'Tuni' }],
    lookup
  );
  assert.equal(bad.ok, false);
});

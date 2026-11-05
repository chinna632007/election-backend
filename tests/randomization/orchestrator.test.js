'use strict';

/**
 * Orchestrator chain test — Stage 1 -> Stage 2 -> Stage 3 in-process.
 * Pure in-memory (no database, no HTTP). Run:
 *   node --test tests/randomization/orchestrator.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { runAllocation } = require('../../src/modules/randomization/orchestrator');

function personnel(count, mandal) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    // 3-tier split matching the corrected PO/APO/OPO rule:
    //   i%6===0 -> Headmaster   (Gazetted,     rank 1, PO-eligible)
    //   i%6===1 -> School Asst  (Non-Gazetted, rank 3, APO slot 1)
    //   else    -> Teacher      (Non-Gazetted, rank 5, OPO slots 2+)
    const mod = i % 6;
    const designation = mod === 0 ? 'Headmaster'
      : mod === 1 ? 'School Assistant' : 'Teacher';
    rows.push({
      employee_id: 'EMP-' + mandal.slice(0, 3).toUpperCase() + '-' + String(i + 1).padStart(3, '0'),
      employee_name: 'Officer ' + mandal + ' ' + (i + 1),
      designation: designation,
      is_active: true,
      district: 'Kakinada',
      work_mandal: mandal,
      native_mandal: 'Anaparthi',
      gazetted_status: mod === 0 ? 'Gazetted' : 'Non-Gazetted',
      exempt_category: null,
    });
  }
  return rows;
}

function stations(count, mandal) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      station_id: 'ST-' + mandal.slice(0, 3).toUpperCase() + '-' + String(i + 1).padStart(3, '0'),
      station_number: String(100 + i),
      station_name: 'Polling Station ' + String(i + 1),
      building_name: 'School Block',
      street: 'Main Road',
      locality: 'Village ' + String(i + 1),
      ward: 'Ward 1',
      district: 'Kakinada',
      mandal: mandal,
      pin_code: '533001',
    });
  }
  return rows;
}

const designationRules = {
  // Lower rank = more senior. PO (Headmaster) strictly more senior than
  // APO (School Assistant), who is more senior than OPOs (Teachers).
  Headmaster: { seniorityRank: 1, presidingEligible: true, microObserverEligible: true },
  'School Assistant': { seniorityRank: 3, presidingEligible: false, microObserverEligible: true },
  Teacher: { seniorityRank: 5, presidingEligible: false, microObserverEligible: true },
};

function baseInput() {
  // Pool math after MO integration: stage2 assigns ONE Micro Observer per
  // party BEFORE drawing 20% substitutes, so the pool must cover operational
  // (3 x 6 = 18) + MOs (3) + substitutes (3 x 2 = 6) = 27.
  // Stage 1 supplies a 120% pool: requiredCount 18+5 = 23 -> 22+6 = 28 total
  // (required 23 + reserve 5), enough for all three buckets with 1 spare.
  const all = [...personnel(24, 'Kakinada'), ...personnel(12, 'Pithapuram')];
  const officeIdOverrides = {};
  all.forEach(function (p, i) {
    officeIdOverrides[p.employee_id] = 'SCHOOL-' + String(i + 1).padStart(2, '0');
  });
  return {
    personnelRows: all,
    stationRows: [...stations(2, 'Tuni'), ...stations(1, 'Mandapeta')], // 3 stations = 3 parties; posting mandals differ from work (Kakinada/Pithapuram) + native (Anaparthi)
    departmentName: 'School Education Dept',
    electionConfiguration: {
      id: 'EC-DEMO-1',
      districtId: 'Kakinada',
      status: 'ready_for_randomization',
      requiredStrength: [
        { mandalId: 'Kakinada', requiredCount: 18 }, // 120% -> ceil(18 x 1.2) = 22 of 24 input
        { mandalId: 'Pithapuram', requiredCount: 5 }, // 120% -> ceil(5 x 1.2) = 6 of 12 input (28-pool)
      ],
    },
    designationRules: { ...designationRules }, // clone: tests mutate safely
    officeIdOverrides: officeIdOverrides,
    districtId: 'Kakinada',
    actorId: 7,
    seed: 42,
  };
}

test('full chain: Stage 1 -> Stage 2 -> Stage 3 succeeds', async () => {
  const out = await runAllocation(baseInput());

  // Stage 1: 120% pool sized for teams + MOs + substitutes below: 18+5
  // required over a 28-person pool (22 + 6 selected incl. reserves).
  assert.equal(out.stage1.stage, 1);
  assert.equal(out.stage1.status, 'completed');
  const required = out.stage1.results.filter((r) => r.classification === 'required');
  const reserve = out.stage1.results.filter((r) => r.classification === 'reserve');
  assert.equal(out.stage1.results.length, 28, 'pool = 22 + 6 (120%)');
  assert.equal(required.length, 23, 'required = 18 + 5');
  assert.equal(reserve.length, 5, 'reserve = 20% of required (rounded per mandal)');


  // Stage 2: parties formed from the pool, each with a teamCode.
  assert.equal(out.stage2.stage, 2);
  assert.equal(out.stage2.status, 'completed');
  assert.ok(Array.isArray(out.stage2.parties) && out.stage2.parties.length > 0);
  const codes = new Set(out.stage2.parties.map((p) => p.teamCode));
  assert.equal(codes.size, out.stage2.parties.length, 'teamCodes unique');

  // Micro Observer: exactly one per party, counted in teamSize but flagged
  // separately from the operational (PO + Polling Officers) members.
  const { MICRO_OBSERVER_ROLE } = require('../../src/modules/randomization/micro-observer');
  for (const p of out.stage2.parties) {
    const mos = p.members.filter((m) => m.role === MICRO_OBSERVER_ROLE);
    assert.equal(mos.length, 1, p.teamCode + ' must have exactly one Micro Observer');
    assert.equal(mos[0].isMicroObserver, true, 'MO member is flagged');
    // operationalSize = PO + Polling Officers (excludes MO); teamSize includes MO.
    assert.equal(p.operationalSize, p.members.length - 1, 'operationalSize excludes the MO');
    assert.equal(p.teamSize, p.members.length, 'teamSize includes the MO');
    assert.equal(p.teamSize, p.operationalSize + 1, 'teamSize = operational + 1 MO');
    // MO personnel must not also appear as an operational member.
    const opIds = p.members.filter((m) => !m.isMicroObserver).map((m) => String(m.personnelId));
    assert.ok(!opIds.includes(String(mos[0].personnelId)), 'MO is not double-counted as operational');
  }
  assert.equal(
    out.stage2.microObserversAssigned, out.stage2.parties.length,
    'one MO assigned per party'
  );

  // Stage 3: teams mapped to stations, confidential.
  assert.equal(out.stage3.stage, 3);
  assert.equal(out.stage3.publicationStatus, 'confidential');
  assert.ok(out.stage3.assignments.length > 0);
  assert.equal(out.stage3.assignments[0].stationName.startsWith('Polling Station '), true);
  assert.equal(out.stage3.assignments[0].buildingName, 'School Block');
  assert.equal(out.stage3.assignments[0].pinCode, '533001');
  assert.deepEqual(
    out.stage3.unmetRequirements, [],
    'equal-or-surplus stations: no unresolved deficits'
  );

  // Audit trail recorded Stage 1 execution.
  assert.ok(out.auditEvents.length > 0, 'audit events recorded');
});

test('separate MO upload: MOs drawn from moRows (bank staff), substitutes officer-only', async () => {
  const input = baseInput();
  // Bank-staff MO upload: 3 candidates (one per party), distinct banks so
  // the distinct-office rule is satisfiable, mandals far from postings.
  input.moRows = [
    { employee_id: 'BANK-001', employee_name: 'Bank Officer 1', designation: 'Assistant Manager', bank_name: 'APGB', working_mandal: 'Amadaguru', native_mandal: 'Amadaguru', residence_mandal: 'Amadaguru' },
    { employee_id: 'BANK-002', employee_name: 'Bank Officer 2', designation: 'Clerk', bank_name: 'SBI', working_mandal: 'Bukkapatnam', native_mandal: 'Bukkapatnam', residence_mandal: 'Bukkapatnam' },
    { employee_id: 'BANK-003', employee_name: 'Bank Officer 3', designation: 'Officer', bank_name: 'Canara', working_mandal: 'Nallacheruvu', native_mandal: 'Nallacheruvu', residence_mandal: 'Nallacheruvu' },
  ];
  const out = await runAllocation(input);

  assert.equal(out.stage2.parties.length, 3);
  const bankIds = new Set(['BANK-001', 'BANK-002', 'BANK-003']);
  for (const p of out.stage2.parties) {
    const mos = p.members.filter((m) => m.isMicroObserver === true);
    assert.equal(mos.length, 1, p.teamCode + ' must have exactly one MO');
    assert.ok(bankIds.has(String(mos[0].personnelId)), p.teamCode + ' MO must be bank staff, got ' + mos[0].personnelId);
    // Substitutes are officer-only: ranked EMP- ids, never BANK- ids.
    for (const s of p.substitutes || []) {
      assert.ok(!bankIds.has(String(s.personnelId)), 'substitute must never be bank MO staff');
      assert.ok(/^EMP-/.test(String(s.personnelId)), 'substitute must be an officer, got ' + s.personnelId);
    }
  }
  assert.equal(out.stage2.microObserversAssigned, 3);
  assert.equal(out.stage2.status, 'completed');
});

test('fails closed when designationRules lack a used designation', async () => {
  const input = baseInput();
  delete input.designationRules.Teacher;
  await assert.rejects(() => runAllocation(input), /designationRules is missing/);
});

test('fails closed without electionConfiguration.requiredStrength', async () => {
  const input = baseInput();
  input.electionConfiguration = { id: 'EC-X', status: 'ready_for_randomization' };
  await assert.rejects(() => runAllocation(input), /requiredStrength/);
});

test('fails closed with empty personnel', async () => {
  const input = baseInput();
  input.personnelRows = [];
  await assert.rejects(() => runAllocation(input), /personnelRows/);
});

test('fails closed when no Micro Observer is eligible', async () => {
  const input = baseInput();
  // Strip MO eligibility from every designation -> no MO can be placed.
  input.designationRules = {
    Headmaster: { seniorityRank: 1, presidingEligible: true, microObserverEligible: false },
    'School Assistant': { seniorityRank: 3, presidingEligible: false, microObserverEligible: false },
    Teacher: { seniorityRank: 5, presidingEligible: false, microObserverEligible: false },
  };
  const out = await runAllocation(input);
  // Stage 2 still formed parties, but MO placement failed -> flagged incomplete
  // and reported as an unmet requirement (never silently dropped).
  assert.equal(out.stage2.status, 'incomplete');
  assert.ok(
    out.stage2.unmetRequirements.some((u) => u.code === 'MICRO_OBSERVER_NOT_ASSIGNED'),
    'MO placement failure is reported'
  );
  // Stage 3 must NOT run on an incomplete Stage 2.
  assert.equal(out.stage3.status, 'not_run');
});

test('seeded runs are reproducible', async () => {
  const a = await runAllocation(baseInput());
  const b = await runAllocation(baseInput());
  assert.deepEqual(
    a.stage2.parties.map((p) => p.teamCode),
    b.stage2.parties.map((p) => p.teamCode)
  );
  assert.deepEqual(
    a.stage3.assignments.map((x) => x.teamCode + '@' + x.stationId),
    b.stage3.assignments.map((x) => x.teamCode + '@' + x.stationId)
  );
});

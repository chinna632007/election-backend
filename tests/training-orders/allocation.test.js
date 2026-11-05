'use strict';

/**
 * tests/training-orders/allocation.test.js
 * Pure + stubbed-pool tests for PO/APO split, MO skip, tagged template merge.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const { installMongoStub } = require('../helpers/mongo-stub');
const mongo = installMongoStub();
const mongoose = require('../../src/database').mongoose;
const orderMerge = require('../../src/modules/imports/order-merge.service');
const store = require('../../src/modules/randomization/allocation-store');
const {
  classifyRole,
  parseTrainingDate,
  allocateTraining,
  assignBatchLocation,
  buildOrdersZip,
} = require('../../src/modules/training-orders/index');

test('classifyRole: PO / APO / OPO / MO', () => {
  assert.equal(classifyRole('Presiding Officer'), 'PO');
  assert.equal(classifyRole('Assistant Polling Officer'), 'APO');
  assert.equal(classifyRole('1st Polling Officer'), 'OPO');
  assert.equal(classifyRole('2nd Polling Officer'), 'OPO');
  assert.equal(classifyRole('3rd Polling Officer'), 'OPO');
  assert.equal(classifyRole('4th Polling Officer'), 'OPO');
  assert.equal(classifyRole('5th Polling Officer'), 'OPO');
  assert.equal(classifyRole('Polling Officer 1'), 'OPO');
  assert.equal(classifyRole('Polling Officer 5'), 'OPO');
  assert.equal(classifyRole('Micro Observer'), 'MO');
  assert.equal(classifyRole('micro observer (bank)'), 'MO');
  assert.equal(store.classifyStage2Role('4th Polling Officer'), 'OPO');
  assert.equal(store.classifyStage2Role('Assistant Polling Officer'), 'APO');
});

test('parseTrainingDate supports dd.mm.yyyy', () => {
  const p = parseTrainingDate('20.10.2026');
  assert.equal(p.dd, '20');
  assert.equal(p.mm, '10');
  assert.equal(p.yyyy, '2026');
  assert.ok(p.weekday);
});

test('batch location assignment preserves MongoDB ids and enforces the batch mandal', async () => {
  const batchId = new mongoose.Types.ObjectId();
  const locationId = new mongoose.Types.ObjectId();
  mongo.collection('opo_training_batches').splice(0, 1, {
    _id: batchId,
    mandal: 'Kakinada',
    location_id: null,
  });
  mongo.collection('opo_training_orders').splice(0, 1, {
    _id: new mongoose.Types.ObjectId(),
    batch_id: String(batchId),
    venue: 'Old Centre',
  });
  mongo.collection('training_locations').splice(0, 1, {
    _id: locationId,
    mandal: 'Kakinada',
    location_name: 'Kakinada Centre',
  });

  const result = await assignBatchLocation('OPO', String(batchId), String(locationId));
  assert.equal(result.locationId, String(locationId));
  assert.equal(mongo.collection('opo_training_batches')[0].location_id, String(locationId));
  assert.equal(mongo.collection('opo_training_orders').length, 0, 'old venue orders are invalidated');

  mongo.collection('training_locations')[0].mandal = 'Tuni';
  await assert.rejects(
    () => assignBatchLocation('OPO', String(batchId), String(locationId)),
    /Location mandal must match batch duty mandal/
  );
});

test('built-in tagged PO template merges officer + training fields', () => {
  // Template renamed to PO_Training_Order.docx; tags are single-brace and
  // officer-scoped (officer_working_addr = Working Office Address line).
  const templatePath = path.join(__dirname, '../../docs/PO_Training_Order.docx');
  assert.ok(fs.existsSync(templatePath), 'PO_Training_Order.docx must exist');
  const out = orderMerge.mergeDocx(fs.readFileSync(templatePath), {
    sl: '7',
    district: 'Kakinada',
    officer_id: 'EMP9',
    officer_name: 'Rama Rao',
    officer_designation: 'Clerk / Revenue',
    officer_working_addr: 'Kakinada Mandal, Kakinada City',
    officer_working_mandal: 'Kakinada',
    officer_mobile: '9000000000',
    date: '15.10.2026',
    place: 'Kakinada',
    training_day: '20',
    training_month: '10',
    training_time_H: '10',
    training_time_min: '00',
    training_venue: 'ZPHS Samalkot',
    training_mandal: 'Samalkot',
  });
  const xml = new PizZip(out).file('word/document.xml').asText();
  assert.ok(xml.includes('Rama Rao'), 'officer name merged');
  assert.ok(xml.includes('9000000000'), 'mobile merged');
  assert.ok(xml.includes('Samalkot'), 'duty mandal merged');
  assert.ok(xml.includes('Kakinada Mandal, Kakinada City'), 'working office address merged');
  assert.ok(!xml.includes('{officer_name}'), 'no unfilled single-brace tag left');
  assert.ok(!xml.includes('{{officer_name}}'), 'no unfilled double-brace tag left');
});

test('allocateTraining splits PO/APO/OPO per mandal and skips MO (stubbed Mongo)', async () => {
  for (const name of ['allocation_runs', 'team_rosters', 'team_roster_members', 'po_training_batches',
    'po_training_batch_members', 'po_training_orders', 'apo_training_batches', 'apo_training_batch_members',
    'apo_training_orders', 'opo_training_batches', 'opo_training_batch_members', 'opo_training_orders', 'personnel']) {
    mongo.collection(name).splice(0);
  }
  store._reset();
  await store.recordRun({
    runAt: new Date().toISOString(),
    runBy: { id: 1, username: 't', role: 'authority' },
    stage1: { status: 'completed' },
    stage2: {
      status: 'completed',
      excelRows: [
        { teamCode: 'T1', mandal: 'M1', role: 'Presiding Officer', employeeId: 'E101', name: 'PO1' },
        { teamCode: 'T1', mandal: 'M1', role: 'Polling Officer 1', employeeId: 'E102', name: 'APO1' },
        { teamCode: 'T1', mandal: 'M1', role: 'Polling Officer 2', employeeId: 'E103', name: 'APO2' },
        { teamCode: 'T1', mandal: 'M1', role: 'Micro Observer', employeeId: 'MO1', name: 'MO1' },
        { teamCode: 'T2', mandal: 'M2', role: 'Presiding Officer', employeeId: 'E104', name: 'PO2' },
      ],
    },
    stage3: { status: 'completed' },
  });

  const personnel = mongo.collection('personnel');
  for (const [index, [employee_id, employee_name]] of [
    ['E101', 'PO1'], ['E102', 'APO1'], ['E103', 'APO2'], ['E104', 'PO2'],
  ].entries()) {
    personnel.push({
      _id: new mongoose.Types.ObjectId(),
      employee_id,
      employee_name,
      designation: 'D',
      mobile_no: null,
      work_mandal: 'W',
      residence_address: null,
      department_name: 'Dept',
      fixture_index: index,
    });
  }

  try {
    const result = await allocateTraining({ createdBy: 1 });
    assert.equal(result.errors.length, 0);
    assert.equal(result.skippedMo, 1);
    assert.equal(result.skippedOpo, 0);
    assert.equal(result.batches.length, 3);
    const groups = result.batches.map((b) => b.group + '/' + b.mandal).sort();
    assert.deepEqual(groups, ['OPO/M1', 'PO/M1', 'PO/M2']);
  } finally {
    store._reset();
  }
});

test('allocateTraining prefers frozen team roster over run JSON', async () => {
  for (const name of ['allocation_runs', 'team_rosters', 'team_roster_members', 'po_training_batches',
    'po_training_batch_members', 'po_training_orders', 'apo_training_batches', 'apo_training_batch_members',
    'apo_training_orders', 'opo_training_batches', 'opo_training_batch_members', 'opo_training_orders', 'personnel']) {
    mongo.collection(name).splice(0);
  }
  store._reset();
  const runId = new mongoose.Types.ObjectId();
  const stageRows = [
    { run_id: runId, team_code: 'T1', employee_id: 'E201', personnel_id: '100000000000000000000001', role: 'Presiding Officer', duty: null, training_group: 'PO', name: 'PO9', designation: 'D', department_name: 'Dept', mobile_no: null, work_mandal: 'W', native_mandal: 'N', duty_mandal: null, venue_code: null },
    { run_id: runId, team_code: 'T1', employee_id: 'E202', personnel_id: '100000000000000000000002', role: 'Polling Officer 1', duty: null, training_group: 'APO', name: 'APO9', designation: 'D', department_name: 'Dept', mobile_no: null, work_mandal: 'W', native_mandal: 'N', duty_mandal: null, venue_code: null },
  ];
  mongo.collection('allocation_runs').push({ _id: runId, run_at: new Date(), stage1: {}, stage2: {}, stage3: {} });
  mongo.collection('team_rosters').push({ _id: new mongoose.Types.ObjectId(), run_id: runId, team_code: 'T1', posting_mandal: 'M9' });
  mongo.collection('team_roster_members').push(...stageRows);
  for (const [employee_id, name] of [['E201', 'PO9'], ['E202', 'APO9']]) {
    mongo.collection('personnel').push({
      _id: new mongoose.Types.ObjectId(), employee_id, employee_name: name,
      designation: 'D', mobile_no: null, work_mandal: 'W',
    });
  }

  try {
    const result = await allocateTraining({ createdBy: 1 });
    assert.equal(result.errors.length, 0);
    assert.equal(result.source, 'stage_tables');
    assert.equal(result.stageRunId, String(runId));
    assert.equal(result.skippedMo, 0);
    const groups = result.batches.map((b) => b.group + '/' + b.mandal).sort();
    assert.deepEqual(groups, ['APO/M9', 'PO/M9']);
  } finally {
    store._reset();
  }
});

test('buildOrdersZip 404 when empty (stubbed Mongo collections)', async () => {
  mongo.collection('po_training_orders').splice(0);
  await assert.rejects(() => buildOrdersZip('PO'), (err) => err.statusCode === 404);
});

test.after(() => mongo.close());

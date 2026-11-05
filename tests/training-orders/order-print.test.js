'use strict';

/**
 * Training-order generation/download tests against safe in-memory Mongo
 * collection stubs. These tests never connect to the configured database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PizZip = require('pizzip');
const { installMongoStub } = require('../helpers/mongo-stub');

const mongo = installMongoStub();
const mongoose = require('../../src/database').mongoose;
const realMkdirSync = fs.mkdirSync;
const realWriteFileSync = fs.writeFileSync;
fs.mkdirSync = function (dir, ...args) {
  if (String(dir).includes('generated-documents')) return undefined;
  return realMkdirSync.call(fs, dir, ...args);
};
fs.writeFileSync = function (file, ...args) {
  if (String(file).includes('generated-documents')) return undefined;
  return realWriteFileSync.call(fs, file, ...args);
};

const {
  generateOrders,
  envMergeDefaults,
  downloadTrainingOrder,
  buildOrdersZip,
} = require('../../src/modules/training-orders/index');

function isZip(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 4 &&
    buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function isDocx(buffer) {
  return isZip(buffer);
}

function seedGroup(group, count = 2) {
  const { batches: batchName, members: memberName } = group === 'PO'
    ? { batches: 'po_training_batches', members: 'po_training_batch_members' }
    : group === 'APO'
      ? { batches: 'apo_training_batches', members: 'apo_training_batch_members' }
      : { batches: 'opo_training_batches', members: 'opo_training_batch_members' };
  const batchId = new mongoose.Types.ObjectId();
  mongo.collection(batchName).push({
    _id: batchId,
    batch_no: 1,
    mandal: 'Kakinada',
    location_id: null,
    created_by: null,
    created_at: new Date(),
  });
  for (let index = 0; index < count; index += 1) {
    const personId = new mongoose.Types.ObjectId();
    const employeeId = `${group}-EMP-${index + 1}`;
    mongo.collection('personnel').push({
      _id: personId,
      employee_id: employeeId,
      employee_name: `${group} Officer ${index + 1}`,
      designation: 'Polling Officer',
      work_mandal: 'Kakinada',
      working_constituency_name: 'Kakinada City',
      mobile_no: '9000000000',
      import_batch_id: null,
    });
    mongo.collection(memberName).push({
      _id: new mongoose.Types.ObjectId(),
      batch_id: String(batchId),
      personnel_id: String(personId),
      employee_id: employeeId,
      role: group === 'PO' ? 'Presiding Officer' : 'Assistant Presiding Officer',
      team_code: 'T1',
      duty_mandal: 'Kakinada',
      venue_code: null,
    });
  }
}

test('manual training date/time override order defaults', () => {
  const defaults = envMergeDefaults({ trainingDate: '2026-11-04', trainingTime: '14:30' });
  assert.equal(defaults.training_day, '04');
  assert.equal(defaults.training_month, '11');
  assert.equal(defaults.training_year, '2026');
  assert.equal(defaults.training_time_H, '02');
  assert.equal(defaults.training_time_min, '30');
  assert.equal(defaults.training_time_ampm, 'PM');
  assert.throws(() => envMergeDefaults({ trainingDate: 'not-a-date' }), /trainingDate/);
  assert.throws(() => envMergeDefaults({ trainingTime: 'not-a-time' }), /trainingTime/);
});

function reset() {
  for (const name of [
    'personnel',
    'import_batches',
    'team_roster_members',
    'training_locations',
    'po_training_batches',
    'po_training_batch_members',
    'po_training_orders',
    'apo_training_batches',
    'apo_training_batch_members',
    'apo_training_orders',
    'opo_training_batches',
    'opo_training_batch_members',
    'opo_training_orders',
    'app_settings',
  ]) mongo.collection(name).splice(0);
}

test('generateOrders persists valid DOCX orders from Mongo collection fixtures', async () => {
  reset();
  seedGroup('PO');
  seedGroup('APO');

  const poResult = await generateOrders({ group: 'PO', createdBy: null });
  assert.equal(poResult.generated, 2);
  assert.equal(poResult.errors.length, 0);
  const poOrders = mongo.collection('po_training_orders');
  assert.equal(poOrders.length, 2);
  for (const order of poOrders) {
    assert.ok(isDocx(order.order_docx));
    assert.ok(order.order_docx.length > 1000);
    assert.match(String(order._id), /^[a-f\d]{24}$/i);
  }

  const apoResult = await generateOrders({ group: 'APO', createdBy: null });
  assert.equal(apoResult.generated, 2);
  assert.equal(mongo.collection('apo_training_orders').length, 2);

  seedGroup('OPO');
  const opoResult = await generateOrders({ group: 'OPO', createdBy: null });
  assert.equal(opoResult.generated, 2);
  assert.equal(mongo.collection('opo_training_orders').length, 2);
});

test('generateOrders works without opening a MongoDB session', async () => {
  reset();
  seedGroup('PO', 1);
  const originalStartSession = mongoose.connection.startSession;
  mongoose.connection.startSession = async () => {
    throw new Error('sessions are unavailable on a standalone MongoDB server');
  };
  try {
    const result = await generateOrders({ group: 'PO', createdBy: null });
    assert.equal(result.generated, 1);
    assert.equal(mongo.collection('po_training_orders').length, 1);
  } finally {
    mongoose.connection.startSession = originalStartSession;
  }
});

test('downloadTrainingOrder returns stored DOCX bytes', async () => {
  reset();
  seedGroup('PO', 1);
  await generateOrders({ group: 'PO', createdBy: null });
  const stored = mongo.collection('po_training_orders')[0];

  const downloaded = await downloadTrainingOrder('PO', String(stored._id));
  assert.ok(isDocx(downloaded.buffer));
  assert.ok(downloaded.buffer.length >= stored.order_docx.length);
  assert.equal(downloaded.order.id, String(stored._id));
  assert.equal(downloaded.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(downloaded.filename.endsWith('.docx'));
});

test('buildOrdersZip emits group and combined ZIPs', async () => {
  reset();
  seedGroup('PO');
  seedGroup('APO');
  seedGroup('OPO');
  await generateOrders({ group: 'PO', createdBy: null });
  await generateOrders({ group: 'APO', createdBy: null });
  await generateOrders({ group: 'OPO', createdBy: null });

  const poZip = await buildOrdersZip('PO');
  assert.ok(isZip(poZip.buffer));
  assert.equal(poZip.count, 2);
  assert.equal(Object.keys(new PizZip(poZip.buffer).files).length, 2);

  const allZip = await buildOrdersZip(null);
  assert.ok(isZip(allZip.buffer));
  assert.equal(allZip.count, 6);
  assert.equal(Object.keys(new PizZip(allZip.buffer).files).length, 6);
  const opoZip = await buildOrdersZip('OPO');
  assert.equal(opoZip.count, 2);
});

test('downloadTrainingOrder returns 404 for absent/un-generated orders', async () => {
  reset();
  await assert.rejects(() => downloadTrainingOrder('PO', 'ffffffffffffffffffffffff'), (err) => err.statusCode === 404);
  const row = { _id: new mongoose.Types.ObjectId(), order_id: 'TR-EMPTY', order_docx: null };
  mongo.collection('po_training_orders').push(row);
  await assert.rejects(() => downloadTrainingOrder('PO', String(row._id)), (err) => err.statusCode === 404);
});

test('built-in templates exist and parse as DOCX archives', () => {
  for (const name of ['PO_Training_Order.docx', 'APO_Training_Order.docx', 'OPO_Training_Order.docx']) {
    const template = require('node:path').join(__dirname, '../../docs', name);
    assert.ok(fs.existsSync(template), `${name} exists`);
    const zip = new PizZip(fs.readFileSync(template));
    assert.ok(zip.file('word/document.xml'), `${name} has document XML`);
  }
});

test.after(() => {
  fs.mkdirSync = realMkdirSync;
  fs.writeFileSync = realWriteFileSync;
  mongo.close();
});

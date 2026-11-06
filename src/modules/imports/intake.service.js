'use strict';

/**
 * Phase-1 intake persistence. Uploads replace their target collection with
 * compensating cleanup; training batches are generated in code and can only be
 * re-created after the existing batches have been cleared.
 */

const crypto = require('crypto');
const { getCollection } = require('../../database');

function collection(name) {
  const result = getCollection(name);
  return result.collection || result;
}

const MAX_BATCH_SIZE = 100;
const ALLOWED_KINDS = [
  'polling_team',
  'stage_officer_ii',
  'counting_team',
  'po_apo_training',
  'po_apo_training_gp',
  'id_card',
];

async function reserveIds(collectionName, count) {
  if (count === 0) return [];
  const result = await collection('counters').findOneAndUpdate(
    { _id: collectionName },
    { $inc: { sequence: count } },
    { upsert: true, returnDocument: 'after' }
  );
  const sequence = (result.value || result).sequence;
  return Array.from({ length: count }, (_value, index) => sequence - count + index + 1);
}

function importSummary(accepted, rejected) {
  return {
    count: accepted.length,
    replaced: accepted.length,
    totalRows: accepted.length + rejected.length,
    acceptedRows: accepted.length,
    rejectedRows: rejected.length,
    rejected,
  };
}

async function replaceCollection(collectionName, documents) {
  const target = collection(collectionName);
  const previous = await target.find({}).toArray();
  try {
    await target.deleteMany({});
    if (documents.length) await target.insertMany(documents, { ordered: true });
  } catch (error) {
    try {
      await target.deleteMany({});
      if (previous.length) await target.insertMany(previous, { ordered: true });
    } catch (cleanupError) {
      throw new Error(
        `Replacing ${collectionName} failed (${error.message}); restoring the prior data also failed (${cleanupError.message}). Manual reconciliation is required.`,
        { cause: error }
      );
    }
    throw error;
  }
}

async function replaceMicroObservers({ buffer }) {
  const { parseMicroObservers } = require('./intake');
  const { accepted, rejected } = parseMicroObservers(buffer);
  const ids = await reserveIds('micro_observers', accepted.length);
  const docs = accepted.map((row, index) => ({ id: ids[index], ...row }));
  await replaceCollection('micro_observers', docs);
  return importSummary(accepted, rejected);
}

async function replaceTrainingLocations({ buffer }) {
  const { parseTrainingLocations } = require('./intake');
  const { accepted, rejected } = parseTrainingLocations(buffer);
  const linked = await collection('training_batches').findOne(
    { location_id: { $ne: null } },
    { projection: { _id: 0, id: 1 } }
  );
  if (linked) {
    const err = new Error('training batches already reference locations; clear batches before re-uploading locations');
    err.statusCode = 409;
    throw err;
  }
  const ids = await reserveIds('training_locations', accepted.length);
  const docs = accepted.map((row, index) => ({ id: ids[index], ...row }));
  await replaceCollection('training_locations', docs);
  return importSummary(accepted, rejected);
}

async function replaceRequirements({ buffer }) {
  const { parseRequirements } = require('./intake');
  const { accepted, rejected } = parseRequirements(buffer);
  const ids = await reserveIds('election_requirements', accepted.length);
  const docs = [];
  for (let i = 0; i < accepted.length; i += 1) docs.push({ id: ids[i], ...accepted[i] });
  await replaceCollection('election_requirements', docs);
  return importSummary(accepted, rejected);
}

async function replaceMandalAdjacency({ buffer }) {
  const { parseMandalAdjacency } = require('./intake');
  const { accepted, rejected } = parseMandalAdjacency(buffer);
  const ids = await reserveIds('mandal_adjacency', accepted.length);
  const docs = [];
  for (let i = 0; i < accepted.length; i += 1) {
    docs.push({
      id: ids[i],
      ...accepted[i],
      updated_at: new Date(),
    });
  }
  await replaceCollection('mandal_adjacency', docs);
  return importSummary(accepted, rejected);
}

async function replaceTrainingSessions({ buffer, createdBy }) {
  const { parseTrainingSessions } = require('./intake');
  const { accepted, rejected } = parseTrainingSessions(buffer);
  const ids = await reserveIds('training_sessions', accepted.length);
  const docs = [];
  for (let i = 0; i < accepted.length; i += 1) {
    docs.push({
      id: ids[i],
      ...accepted[i],
      created_by_user_id: createdBy,
    });
  }
  await replaceCollection('training_sessions', docs);
  return importSummary(accepted, rejected);
}

/**
 * Randomly groups eligible personnel within each mandal, at most 100 per
 * batch. Existing batches block regeneration until explicitly cleared.
 */
async function createTrainingBatches({ createdBy }) {
  const batches = collection('training_batches');
  const members = collection('training_batch_members');
  if (await batches.countDocuments({}) > 0) {
    const err = new Error('training batches already exist; clear them first to re-create');
    err.statusCode = 409;
    throw err;
  }
  const officers = await collection('personnel').find(
    {
      is_active: true,
      district: 'Kakinada',
      $or: [{ exempt_category: null }, { exempt_category: '' }, { exempt_category: { $exists: false } }],
    },
    { projection: { _id: 0, id: 1, work_mandal: 1 } }
  ).sort({ id: 1 }).toArray();
  if (officers.length === 0) {
    const err = new Error('no eligible officers found (import personnel first)');
    err.statusCode = 409;
    throw err;
  }

  const byMandal = new Map();
  for (const officer of officers) {
    const mandal = (officer.work_mandal || 'UNSPECIFIED').trim() || 'UNSPECIFIED';
    if (!byMandal.has(mandal)) byMandal.set(mandal, []);
    byMandal.get(mandal).push(officer.id);
  }
  let batchCount = 0;
  let memberCount = 0;
  for (const ids of byMandal.values()) {
    batchCount += Math.ceil(ids.length / MAX_BATCH_SIZE);
    memberCount += ids.length;
  }
  const batchIds = await reserveIds('training_batches', batchCount);
  const memberIds = await reserveIds('training_batch_members', memberCount);
  const batchDocs = [];
  const memberDocs = [];
  let batchIdIndex = 0;
  let memberIdIndex = 0;
  for (const [mandal, ids] of byMandal) {
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    let batchNo = 1;
    for (let start = 0; start < ids.length; start += MAX_BATCH_SIZE) {
      const batchId = batchIds[batchIdIndex++];
      batchDocs.push({ id: batchId, batch_no: batchNo, mandal, location_id: null, created_by: createdBy ?? null });
      for (const personnelId of ids.slice(start, start + MAX_BATCH_SIZE)) {
        memberDocs.push({
          id: memberIds[memberIdIndex++],
          batch_id: batchId,
          personnel_id: personnelId,
          added_by_code: true,
        });
      }
      batchNo += 1;
    }
  }
  try {
    if (batchDocs.length) await batches.insertMany(batchDocs, { ordered: true });
    if (memberDocs.length) await members.insertMany(memberDocs, { ordered: true });
  } catch (error) {
    try {
      await members.deleteMany({ batch_id: { $in: batchIds } });
      await batches.deleteMany({ id: { $in: batchIds } });
    } catch (cleanupError) {
      throw new Error(
        `Training batch creation failed (${error.message}); cleanup also failed (${cleanupError.message}). Partial batches may require manual cleanup.`,
        { cause: error }
      );
    }
    throw error;
  }
  return { batches: batchDocs.length, officers: officers.length };
}

async function clearTrainingBatches() {
  const members = collection('training_batch_members');
  const batches = collection('training_batches');
  const previousMembers = await members.find({}).toArray();
  const previousBatches = await batches.find({}).toArray();
  try {
    await members.deleteMany({});
    await batches.deleteMany({});
  } catch (error) {
    try {
      await members.deleteMany({});
      await batches.deleteMany({});
      if (previousBatches.length) await batches.insertMany(previousBatches, { ordered: true });
      if (previousMembers.length) await members.insertMany(previousMembers, { ordered: true });
    } catch (cleanupError) {
      throw new Error(
        `Clearing training batches failed (${error.message}); restoring the previous batches also failed (${cleanupError.message}). Manual reconciliation is required.`,
        { cause: error }
      );
    }
    throw error;
  }
  return { cleared: true };
}

async function upsertOrderTemplate({ kind, display_name, file_name, file, uploadedBy }) {
  if (!ALLOWED_KINDS.includes(kind)) {
    const err = new Error('unknown template kind: ' + kind);
    err.statusCode = 400;
    throw err;
  }
  const templates = collection('order_templates');
  const previous = await templates.find({ kind }).toArray();
  try {
    const existing = await templates.findOne({ kind }, { projection: { _id: 0, id: 1 } });
    const id = existing ? existing.id : (await reserveIds('order_templates', 1))[0];
    await templates.updateMany(
      { kind },
      { $set: { active: false, updated_at: new Date() } }
    );
    await templates.updateOne(
      { kind, id },
      {
        $set: {
          id,
          kind,
          display_name,
          file_name,
          file,
          uploaded_by: uploadedBy,
          active: true,
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (error) {
    try {
      await templates.deleteMany({ kind });
      if (previous.length) await templates.insertMany(previous, { ordered: true });
    } catch (cleanupError) {
      throw new Error(
        `Updating order template failed (${error.message}); restoring the previous template also failed (${cleanupError.message}).`,
        { cause: error }
      );
    }
    throw error;
  }
  return { kind, display_name, file_name };
}

async function getOrderTemplates({ kind } = {}) {
  const query = kind ? { kind } : {};
  const templates = await collection('order_templates').find(query, {
    projection: { _id: 0, id: 1, kind: 1, display_name: 1, file_name: 1, active: 1, updated_at: 1 },
  }).sort({ kind: 1, id: 1 }).toArray();
  return { templates };
}

async function getOrderTemplate(kind) {
  const row = await collection('order_templates').findOne(
    { kind, active: true },
    { projection: { _id: 0, id: 1, kind: 1, display_name: 1, file_name: 1, file: 1, uploaded_by: 1, updated_at: 1 } }
  );
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    display_name: row.display_name,
    file_name: row.file_name,
    filename: row.file_name,
    buffer: row.file,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.updated_at,
  };
}

const ORDER_CONFIG_FIELDS = [
  'election_title', 'district', 'order_date', 'order_place',
  'distribution_center', 'distribution_report_time', 'polling_date_time',
  'training_venue', 'training_date_time', 'warning_text', 'extra_note',
];

async function getOrderConfig() {
  const config = await collection('order_config').findOne(
    { id: 1 },
    { projection: { _id: 0 } }
  );
  return { config: config || {} };
}

async function upsertOrderConfig({ config, updatedBy }) {
  const values = {};
  for (const field of ORDER_CONFIG_FIELDS) values[field] = config[field] || '';
  values.updated_by = updatedBy;
  values.updated_at = new Date();
  await collection('order_config').updateOne({ id: 1 }, { $set: { id: 1, ...values } }, { upsert: true });
  return { ok: true };
}

async function upsertIdCardDesign({ design, updatedBy }) {
  await collection('id_card_design').updateOne(
    { id: 1 },
    { $set: { id: 1, design, updated_by: updatedBy, updated_at: new Date() } },
    { upsert: true }
  );
  return { ok: true };
}

async function getIdCardDesign() {
  const record = await collection('id_card_design').findOne(
    { id: 1 },
    { projection: { _id: 0, design: 1 } }
  );
  return { design: record ? record.design : {} };
}

module.exports = {
  replaceMicroObservers,
  replaceTrainingLocations,
  replaceTrainingSessions,
  replaceMandalAdjacency,
  replaceRequirements,
  createTrainingBatches,
  clearTrainingBatches,
  MAX_BATCH_SIZE,
  upsertOrderTemplate,
  getOrderTemplates,
  getOrderTemplate,
  getOrderConfig,
  upsertOrderConfig,
  upsertIdCardDesign,
  getIdCardDesign,
  ALLOWED_KINDS,
};

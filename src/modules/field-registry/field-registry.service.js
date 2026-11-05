'use strict';

/**
 * Field-registry service — custom fields are soft-deactivated and sensitive
 * fields cannot be unmarked while collected data exists.
 */

const { getCollection, mongoose } = require('../../database');
const { FieldRegistryError, validateDefinitionInput, validatePatch } = require('./field-registry.validator');

const WRITE = { writeConcern: { w: 'majority', j: true } };
const FIELD_COLLECTION = 'field_definitions';
const DATA_COLLECTION = { personnel: 'personnel', station: 'polling_stations' };

function rowToField(row) {
  return {
    id: String(row._id),
    entity: row.entity,
    fieldKey: row.field_key,
    label: row.label,
    dataType: row.data_type,
    isCore: row.is_core,
    isRequired: row.is_required,
    isSensitive: row.is_sensitive,
    importColumn: row.import_column,
    exportVisible: row.export_visible,
    enumOptions: row.enum_options,
    sortOrder: row.sort_order,
    active: row.active,
    updatedAt: row.updated_at,
  };
}

function objectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)
    ? new mongoose.Types.ObjectId(id)
    : null;
}

async function listFields(entity) {
  const rows = await getCollection(FIELD_COLLECTION)
    .find({ entity, active: true })
    .sort({ sort_order: 1, field_key: 1 })
    .toArray();
  return rows.map(rowToField);
}

async function createField(body, userId) {
  const input = validateDefinitionInput(body);
  const fields = getCollection(FIELD_COLLECTION);
  await fields.createIndex({ entity: 1, field_key: 1 }, { unique: true, name: 'field_entity_key_unique' });
  const duplicate = await fields.findOne({ entity: input.entity, field_key: input.fieldKey });
  if (duplicate) {
    throw FieldRegistryError('fieldKey ' + input.fieldKey + ' already exists for ' + input.entity + '.');
  }
  const now = new Date();
  const row = {
    _id: new mongoose.Types.ObjectId(),
    entity: input.entity,
    field_key: input.fieldKey,
    label: input.label,
    data_type: input.dataType,
    is_core: false,
    is_required: input.isRequired,
    is_sensitive: input.isSensitive,
    import_column: input.importColumn,
    export_visible: input.exportVisible,
    enum_options: input.enumOptions || null,
    sort_order: 100,
    active: true,
    created_by: userId == null ? null : String(userId),
    updated_by: userId == null ? null : String(userId),
    created_at: now,
    updated_at: now,
  };
  try {
    await fields.insertOne(row, WRITE);
  } catch (err) {
    if (err && err.code === 11000) {
      throw FieldRegistryError('fieldKey ' + input.fieldKey + ' already exists for ' + input.entity + '.');
    }
    throw err;
  }
  return rowToField(row);
}

async function updateField(id, body, userId) {
  const fields = getCollection(FIELD_COLLECTION);
  const _id = objectId(id);
  const current = _id && await fields.findOne({ _id });
  if (!current) {
    const err = FieldRegistryError('Field ' + id + ' not found.');
    err.statusCode = 404;
    throw err;
  }
  const patch = validatePatch(body, current);
  if (current.is_sensitive && patch.isSensitive === false) {
    const dataCollection = DATA_COLLECTION[current.entity];
    if (dataCollection && await getCollection(dataCollection).findOne({
      ['custom_fields.' + current.field_key]: { $exists: true },
    }, { projection: { _id: 1 } })) {
      const err = FieldRegistryError(
        'Cannot un-mark ' + current.field_key + ' as sensitive: data already collected under it.'
      );
      err.statusCode = 409;
      throw err;
    }
  }

  const update = {};
  for (const [key, value] of Object.entries(patch)) {
    const field = {
      label: 'label',
      isRequired: 'is_required',
      isSensitive: 'is_sensitive',
      exportVisible: 'export_visible',
      importColumn: 'import_column',
      sortOrder: 'sort_order',
      enumOptions: 'enum_options',
    }[key];
    update[field] = value;
  }
  update.updated_by = userId == null ? null : String(userId);
  update.updated_at = new Date();
  const result = await fields.findOneAndUpdate(
    { _id },
    { $set: update },
    { returnDocument: 'after', includeResultMetadata: false, ...WRITE }
  );
  return rowToField(result);
}

async function deactivateField(id, userId) {
  const fields = getCollection(FIELD_COLLECTION);
  const _id = objectId(id);
  const current = _id && await fields.findOne({ _id });
  if (!current) {
    const err = FieldRegistryError('Field ' + id + ' not found.');
    err.statusCode = 404;
    throw err;
  }
  if (current.is_core) {
    throw FieldRegistryError('Core fields cannot be deactivated.');
  }
  const result = await fields.findOneAndUpdate(
    { _id, is_core: { $ne: true } },
    { $set: { active: false, updated_by: userId == null ? null : String(userId), updated_at: new Date() } },
    { returnDocument: 'after', includeResultMetadata: false, ...WRITE }
  );
  return rowToField(result);
}

module.exports = {
  listFields,
  createField,
  updateField,
  deactivateField,
};

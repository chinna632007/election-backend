'use strict';

/**
 * Settings service — reads admin-editable settings and appends an immutable
 * audit entry for every successful update.
 */

const { getCollection } = require('../../database');
const { getEntry } = require('./settings.registry');
const { validateValue, SettingsValidationError } = require('./settings.validator');

function rowToSetting(row) {
  return {
    key: row.key,
    value: row.value,
    type: row.value_type,
    group: row.group_name,
    label: row.label,
    isPublic: row.is_public,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

async function listSettings(options) {
  const role = options && options.role;
  const rows = await getCollection('app_settings')
    .find(role === 'staff' ? { is_public: true } : {})
    .sort({ group_name: 1, key: 1 })
    .toArray();
  return rows.map(rowToSetting);
}

const DEFAULTS = Object.freeze({
  'uploads.max_file_mb': 100,
  'uploads.max_ballot_mb': 15,
  'uploads.max_stations': 5000,
  'training.max_batch_size': 100,
  'election.district_default': 'Kakinada',
  'randomization.max_attempts': 50,
});

async function getSetting(key) {
  const row = await getCollection('app_settings').findOne({ key }, { projection: { value: 1 } });
  if (row) return row.value;
  return Object.prototype.hasOwnProperty.call(DEFAULTS, key) ? DEFAULTS[key] : undefined;
}

async function updateSetting(options) {
  const key = options && options.key;
  const userId = options && options.userId;
  const value = validateValue(key, options && options.value);
  const settings = getCollection('app_settings');
  await settings.createIndex({ key: 1 }, { unique: true, name: 'app_settings_key_unique' });
  const audit = getCollection('settings_audit');
  const current = await settings.findOne({ key });
  if (!current) throw SettingsValidationError('Unknown setting: ' + key + '.');
  const now = new Date();
  const updatedBy = userId == null ? null : String(userId);
  const updated = await settings.updateOne(
    { key, updated_at: current.updated_at ?? null },
    { $set: { value, updated_by: updatedBy, updated_at: now } }
  );
  if (updated.matchedCount !== 1) {
    const conflict = SettingsValidationError('Setting changed concurrently; reload and retry.');
    conflict.statusCode = 409;
    throw conflict;
  }
  try {
    await audit.insertOne({
      setting_key: key,
      old_value: current.value,
      new_value: value,
      changed_by: updatedBy,
      changed_at: now,
    }, { writeConcern: { w: 'majority', j: true } });
  } catch (error) {
    try {
      const restore = {
        $set: { value: current.value, updated_by: current.updated_by ?? null },
      };
      if (current.updated_at === undefined) restore.$unset = { updated_at: '' };
      else restore.$set.updated_at = current.updated_at;
      const restored = await settings.updateOne(
        { key, updated_at: now },
        restore
      );
      if (restored.matchedCount !== 1) {
        throw new Error('setting changed concurrently; rollback was not applied');
      }
    } catch (cleanupError) {
      throw new Error(
        `Settings audit write failed (${error.message}); restoring the setting also failed (${cleanupError.message}).`,
        { cause: error }
      );
    }
    throw error;
  }
  const updatedRow = await settings.findOne({ key });
  if (!updatedRow) throw new Error('Setting was updated but could not be read back.');
  return rowToSetting(updatedRow);
}

async function recentChanges(options) {
  const limit = options && Number.isSafeInteger(options.limit) && options.limit > 0
    ? Math.min(options.limit, 100)
    : 20;
  const rows = await getCollection('settings_audit')
    .find({})
    .sort({ changed_at: -1, _id: -1 })
    .limit(limit)
    .toArray();
  return rows.map(function (row) {
    return {
      key: row.setting_key,
      oldValue: row.old_value,
      newValue: row.new_value,
      changedBy: row.changed_by,
      changedAt: row.changed_at,
    };
  });
}

module.exports = {
  listSettings,
  getSetting,
  updateSetting,
  recentChanges,
  _entry: getEntry,
};

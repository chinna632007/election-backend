'use strict';

/**
 * Field-registry validation — fail-closed (docs/CUSTOMIZATION_ROADMAP.md §8).
 * Admins define FIELDS, never SQL. Core-field locks are enforced here.
 */

const { isCoreField } = require('./field-registry.registry');

const ENTITIES = ['personnel', 'station'];
const DATA_TYPES = ['string', 'number', 'date', 'boolean', 'enum'];
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

function FieldRegistryError(message) {
  const err = new Error(message);
  err.name = 'FieldRegistryError';
  err.statusCode = 400;
  return err;
}

function requireString(value, name, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw FieldRegistryError(name + ' is required.');
  }
  if (maxLength && value.length > maxLength) {
    throw FieldRegistryError(name + ' must be at most ' + maxLength + ' characters.');
  }
  return value.trim();
}

function validateDefinitionInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw FieldRegistryError('Request body must be an object.');
  }
  const entity = requireString(body.entity, 'entity', 20);
  if (ENTITIES.indexOf(entity) === -1) {
    throw FieldRegistryError('entity must be one of: ' + ENTITIES.join(', ') + '.');
  }
  const fieldKey = requireString(body.fieldKey, 'fieldKey', 40);
  if (!FIELD_KEY_RE.test(fieldKey)) {
    throw FieldRegistryError('fieldKey must be lowercase snake_case (a-z, 0-9, _), starting with a letter.');
  }
  if (isCoreField(entity, fieldKey)) {
    throw FieldRegistryError('fieldKey ' + fieldKey + ' is a locked core field; create a different key.');
  }
  const label = requireString(body.label, 'label', 120);
  const dataType = requireString(body.dataType, 'dataType', 20);
  if (DATA_TYPES.indexOf(dataType) === -1) {
    throw FieldRegistryError('dataType must be one of: ' + DATA_TYPES.join(', ') + '.');
  }
  const out = {
    entity: entity,
    fieldKey: fieldKey,
    label: label,
    dataType: dataType,
    isRequired: body.isRequired === true,
    isSensitive: body.isSensitive === true,
    exportVisible: body.exportVisible !== false,
    importColumn: typeof body.importColumn === 'string' && body.importColumn.trim() !== ''
      ? body.importColumn.trim().slice(0, 120)
      : null,
  };
  if (dataType === 'enum') {
    const opts = body.enumOptions;
    if (!Array.isArray(opts) || opts.length === 0 || opts.some(function (v) { return typeof v !== 'string' || v.trim() === ''; })) {
      throw FieldRegistryError('enumOptions must be a non-empty array of non-empty strings for enum fields.');
    }
    out.enumOptions = opts.map(function (v) { return v.trim(); }).slice(0, 100);
  } else if (body.enumOptions !== undefined) {
    throw FieldRegistryError('enumOptions is only allowed for enum fields.');
  }
  return out;
}

/** Validate a PATCH against the current row. Core fields: label/export only. */
function validatePatch(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw FieldRegistryError('Request body must be an object.');
  }
  const allowed = current.is_core
    ? ['label', 'exportVisible']
    : ['label', 'isRequired', 'isSensitive', 'exportVisible', 'importColumn', 'enumOptions', 'sortOrder'];
  const unknown = Object.keys(input).filter(function (k) { return allowed.indexOf(k) === -1; });
  if (unknown.length > 0) {
    throw FieldRegistryError(
      'Field ' + (current.is_core ? 'core fields allow only label/exportVisible; ' : '') +
      'cannot change: ' + unknown.join(', ') + '.'
    );
  }
  const patch = {};
  if (input.label !== undefined) patch.label = requireString(input.label, 'label', 120);
  if (input.exportVisible !== undefined) patch.exportVisible = input.exportVisible === true;
  if (!current.is_core) {
    if (input.isRequired !== undefined) patch.isRequired = input.isRequired === true;
    if (input.isSensitive !== undefined) patch.isSensitive = input.isSensitive === true;
    if (input.importColumn !== undefined) {
      patch.importColumn = typeof input.importColumn === 'string' && input.importColumn.trim() !== ''
        ? input.importColumn.trim().slice(0, 120)
        : null;
    }
    if (input.sortOrder !== undefined) {
      if (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 10000) {
        throw FieldRegistryError('sortOrder must be an integer between 0 and 10000.');
      }
      patch.sortOrder = input.sortOrder;
    }
    if (input.enumOptions !== undefined) {
      if (current.data_type !== 'enum') {
        throw FieldRegistryError('enumOptions is only allowed for enum fields.');
      }
      const opts = input.enumOptions;
      if (!Array.isArray(opts) || opts.length === 0 || opts.some(function (v) { return typeof v !== 'string' || v.trim() === ''; })) {
        throw FieldRegistryError('enumOptions must be a non-empty array of non-empty strings.');
      }
      patch.enumOptions = opts.map(function (v) { return v.trim(); }).slice(0, 100);
    }
  }
  if (Object.keys(patch).length === 0) {
    throw FieldRegistryError('No valid changes supplied.');
  }
  return patch;
}

module.exports = {
  FieldRegistryError: FieldRegistryError,
  ENTITIES: ENTITIES,
  validateDefinitionInput: validateDefinitionInput,
  validatePatch: validatePatch,
};

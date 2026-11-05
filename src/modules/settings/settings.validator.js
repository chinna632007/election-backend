'use strict';

/**
 * Settings validation — fail-closed. Unknown keys, wrong types, and
 * out-of-range values are rejected (400); there is no "allow all" path.
 */

const { getEntry } = require('./settings.registry');

function SettingsValidationError(message) {
  const err = new Error(message);
  err.name = 'SettingsValidationError';
  err.statusCode = 400;
  return err;
}

function validateValue(key, value) {
  const entry = getEntry(key);
  if (!entry) {
    throw SettingsValidationError('Unknown setting: ' + key + '.');
  }
  switch (entry.type) {
    case 'string':
      if (typeof value !== 'string') {
        throw SettingsValidationError(key + ' must be a string.');
      }
      if (entry.maxLength && value.length > entry.maxLength) {
        throw SettingsValidationError(key + ' must be at most ' + entry.maxLength + ' characters.');
      }
      if (entry.allowed && entry.allowed.indexOf(value) === -1) {
        throw SettingsValidationError(key + ' must be one of: ' + entry.allowed.join(', ') + '.');
      }
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw SettingsValidationError(key + ' must be a number.');
      }
      if (entry.min !== undefined && value < entry.min) {
        throw SettingsValidationError(key + ' must be at least ' + entry.min + '.');
      }
      if (entry.max !== undefined && value > entry.max) {
        throw SettingsValidationError(key + ' must be at most ' + entry.max + '.');
      }
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw SettingsValidationError(key + ' must be a boolean.');
      }
      return value;
    case 'string_array':
      if (!Array.isArray(value) || value.some(function (v) { return typeof v !== 'string' || v.trim() === ''; })) {
        throw SettingsValidationError(key + ' must be an array of non-empty strings.');
      }
      return value;
    default:
      throw SettingsValidationError('Setting ' + key + ' has an unknown type.');
  }
}

module.exports = { SettingsValidationError: SettingsValidationError, validateValue: validateValue };

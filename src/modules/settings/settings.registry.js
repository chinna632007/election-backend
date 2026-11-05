'use strict';

/**
 * Settings registry — the single source of truth for every admin-editable
 * knob (see docs/CUSTOMIZATION_ROADMAP.md §2).
 *
 * Adding a new customizable thing = one entry here + one seeded row in the
 * migration. Never a new table, never code.
 *
 * Entry shape:
 *   type: 'string' | 'number' | 'boolean' | 'string_array'
 *   group: admin UI section
 *   label: admin UI display text
 *   isPublic: staff may read (never secrets)
 *   min/max: number bounds (optional)
 *   maxLength: string length cap (optional)
 *   allowed: explicit allow-list of values (optional, strings only)
 */

const REGISTRY = Object.freeze({
  'uploads.max_file_mb': {
    type: 'number', group: 'uploads', label: 'Max upload file size (MB)',
    isPublic: true, min: 1, max: 1024,
  },
  'uploads.max_ballot_mb': {
    type: 'number', group: 'uploads', label: 'Max ballot register size (MB)',
    isPublic: true, min: 1, max: 1024,
  },
  'uploads.max_stations': {
    type: 'number', group: 'uploads', label: 'Max polling stations per import',
    isPublic: true, min: 1, max: 100000,
  },
  'training.max_batch_size': {
    type: 'number', group: 'training', label: 'Max officers per training batch',
    isPublic: true, min: 1, max: 1000,
  },
  'election.district_default': {
    type: 'string', group: 'election', label: 'Default district',
    isPublic: true, maxLength: 120,
  },
  'randomization.max_attempts': {
    type: 'number', group: 'election', label: 'Max formation attempts',
    isPublic: false, min: 1, max: 500,
  },
  'notify.preview_required': {
    type: 'boolean', group: 'notifications', label: 'Require preview before send',
    isPublic: true,
  },
  'notify.send_window': {
    type: 'string', group: 'notifications', label: 'Allowed send window (IST)',
    isPublic: true, maxLength: 32,
  },
  'portal.district_name': {
    type: 'string', group: 'portal', label: 'District display name',
    isPublic: true, maxLength: 120,
  },
  'portal.state_line': {
    type: 'string', group: 'portal', label: 'State commission line',
    isPublic: true, maxLength: 200,
  },
  'portal.support_contact': {
    type: 'string', group: 'portal', label: 'Helpdesk contact shown on portal',
    isPublic: true, maxLength: 200,
  },
});

function getEntry(key) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, key) ? REGISTRY[key] : null;
}

module.exports = { REGISTRY: REGISTRY, getEntry: getEntry };

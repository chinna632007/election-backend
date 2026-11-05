'use strict';

/**
 * Field-registry registry — the locked core-field list per entity
 * (docs/CUSTOMIZATION_ROADMAP.md §8.4). Mirrors the migration seeds.
 */

const CORE = Object.freeze({
  personnel: Object.freeze([
    'employee_id', 'employee_name', 'designation', 'gender', 'district',
    'work_mandal', 'native_mandal', 'gazetted_status', 'employment_type', 'is_active',
  ]),
  station: Object.freeze([
    'station_id', 'station_number', 'station_name', 'district', 'mandal',
    'building_name', 'locality', 'pin_code', 'required_officers',
  ]),
});

function isCoreField(entity, fieldKey) {
  return Array.isArray(CORE[entity]) && CORE[entity].indexOf(fieldKey) !== -1;
}

module.exports = { CORE: CORE, isCoreField: isCoreField };

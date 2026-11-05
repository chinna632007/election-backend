'use strict';

/**
 * Master data — polling-station row validation (pure, no DB).
 *
 * Source of truth is the polling_stations table (migration 003), whose columns
 * map 1:1 to the official "Booths" workbook. The official workbook is NOT in
 * the workspace, so this module accepts a validated JSON array of station
 * records using the confirmed database fields. The rules below are the minimal
 * set from the approved schema proposal — no invented official rules.
 *
 * Rules (per row):
 *   - station_id, station_number, station_name, mandal, district: required,
 *     non-empty (they drive identity and scoping).
 *   - pin_code: optional; when present must be exactly 6 digits.
 *   - required_officers: optional; when present must be a positive integer.
 *   - building_name, street, locality, ward: optional free text.
 *   - duplicate station_id WITHIN one payload -> later rows rejected
 *     (cross-batch dedupe is an open question, deliberately not enforced).
 */

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * validateStations(rows) -> { accepted, rejected }
 *   accepted: [{ stationId, stationNumber, stationName, buildingName, street,
 *                locality, ward, mandal, district, pinCode, requiredOfficers }]
 *   rejected: [{ index, stationId, reasons: [codes] }]
 */
function validateStations(rows) {
  const accepted = [];
  const rejected = [];
  const seenIds = new Map(); // station_id -> first index

  rows.forEach((raw, index) => {
    const reasons = [];

    const stationId = cleanText(raw && raw.stationId);
    const stationNumber = cleanText(raw && raw.stationNumber);
    const stationName = cleanText(raw && raw.stationName);
    const mandal = cleanText(raw && raw.mandal);
    const district = cleanText(raw && raw.district);

    if (!stationId) reasons.push('station_id_required');
    if (!stationNumber) reasons.push('station_number_required');
    if (!stationName) reasons.push('station_name_required');
    if (!mandal) reasons.push('mandal_required');
    if (!district) reasons.push('district_required');

    // pin_code: optional, 6 digits when present.
    const pinCode = cleanText(raw && raw.pinCode);
    if (pinCode !== null && !/^\d{6}$/.test(pinCode)) {
      reasons.push('pin_code_invalid');
    }

    // required_officers: optional, positive integer when present.
    let requiredOfficers = null;
    const rawOfficers = raw ? raw.requiredOfficers : undefined;
    if (rawOfficers !== undefined && rawOfficers !== null && String(rawOfficers).trim() !== '') {
      const n = Number(rawOfficers);
      if (!Number.isSafeInteger(n) || n <= 0) {
        reasons.push('required_officers_invalid');
      } else {
        requiredOfficers = n;
      }
    }

    // Duplicate within the file (only meaningful when station_id is present).
    if (stationId) {
      if (seenIds.has(stationId)) {
        reasons.push('duplicate_station_id_in_file');
      } else {
        seenIds.set(stationId, index);
      }
    }

    if (reasons.length > 0) {
      rejected.push({ index, stationId: stationId || null, reasons });
    } else {
      accepted.push({
        stationId,
        stationNumber,
        stationName,
        buildingName: cleanText(raw.buildingName),
        street: cleanText(raw.street),
        locality: cleanText(raw.locality),
        ward: cleanText(raw.ward),
        mandal,
        district,
        pinCode,
        requiredOfficers,
      });
    }
  });

  return { accepted, rejected };
}

module.exports = { validateStations, cleanText };

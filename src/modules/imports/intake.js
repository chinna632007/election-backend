'use strict';

/**
 * Stage: imports — Phase-1 intake parsers (pure, no DB).
 *
 * Three intake files (team decisions 2026-10-15):
 *  1. Micro Observer allotment file (emp_mo shape). Excel or CSV.
 *     Old-file columns (Phase, random_no, allotted_ps, *_code) are example
 *     data and are deliberately ignored. Bank staff etc. live HERE as their
 *     own role/table — never in personnel.
 *  2. Training locations file (locations shape): location + mandal required;
 *     extra columns tolerated (panchayat, category, code, ps_ls...).
 *  3. Requirement file: per-mandal REQUIRED/RESERVE/TOTAL for Stage 1.
 *
 * Every parser: first non-empty row = header; tolerant header match
 * (case/space/punctuation-insensitive); rows without required fields are
 * rejected with reason codes, accepted rows returned verbatim-ish.
 */

const XLSX = require('xlsx');
const { isMedicalDesignation } = require('./validation');

class IntakeParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IntakeParseError';
  }
}

function normalizeHeader(cell) {
  return String(cell ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\w+#]/g, '')
    .toLowerCase();
}

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  return String(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Read first sheet as array-of-arrays (works for .xlsx and .csv buffers). */
function readGrid(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  } catch (err) {
    throw new IntakeParseError('File could not be read as an Excel workbook.');
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new IntakeParseError('Workbook has no sheets.');
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
}

/**
 * Map header cells to field names using per-parser candidates.
 * candidates: { field: [alias, ...] } — first alias hit wins.
 * Returns { colMap: {field: colIdx}, headerRow: idx }.
 */
function mapHeader(grid, candidates) {
  for (let i = 0; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const colMap = {};
    row.forEach((cell, col) => {
      const h = normalizeHeader(cell);
      if (!h) return;
      for (const [field, aliases] of Object.entries(candidates)) {
        if (colMap[field] !== undefined) continue;
        if (aliases.some((a) => h === a || h.includes(a))) colMap[field] = col;
      }
    });
    if (Object.keys(colMap).length > 0) return { colMap, headerRow: i };
  }
  throw new IntakeParseError('Header row not found.');
}

function toIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return normalizeCell(value);
}

/**
 * parseMicroObservers(buffer) -> { accepted, rejected }
 * Required: employee_id + employee_name. Duplicates in file -> rejected.
 * Medical / clinical designations are HARD-rejected (same authority decision
 * 2026-10-15 as the personnel import): doctors, nurses/ANM, homeopaths,
 * Ayurveda/Unani, compounders, pharmacists and related clinical roles must
 * never enter the MO pool either.
 */
function parseMicroObservers(buffer) {
  const grid = readGrid(buffer);
  const { colMap, headerRow } = mapHeader(grid, {
    sl_no: ['eleid', 'slno'],
    employee_id: ['employeeid', 'empid'],
    employee_name: ['nameoftheemployee', 'employeename', 'name'],
    designation: ['designationinform', 'designation', 'desig'],
    bank_name: ['bankname', 'bank'],
    gender: ['gender', 'sex'],
    mobile_no: ['mobileno', 'mobile', 'contact'],
    native_mandal: ['nativemandal'],
    residence_mandal: ['residencemandal'],
    working_mandal: ['workingmandal'],
    alloted_mandal: ['allottedmandal', 'allotedmandal'],
  });
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const get = (f) => (colMap[f] !== undefined ? normalizeCell(row[colMap[f]]) : '');
    const employeeId = get('employee_id');
    const employeeName = get('employee_name');
    if (!employeeId && !employeeName && !get('designation')) continue; // blank row
    const reasons = [];
    if (!employeeId) reasons.push('employee_id_required');
    if (!employeeName) reasons.push('employee_name_required');
    // Same authority decision as the personnel import: medical / clinical
    // designations must never enter the MO pool either.
    if (isMedicalDesignation(get('designation'))) reasons.push('medical_designation_not_eligible');
    if (employeeId) {
      if (seen.has(employeeId)) reasons.push('duplicate_employee_id_in_file');
      else seen.add(employeeId);
    }
    const record = {
      sl_no: get('sl_no') || null,
      employee_id: employeeId,
      employee_name: employeeName,
      designation: get('designation') || null,
      bank_name: get('bank_name') || null,
      gender: get('gender') || null,
      mobile_no: get('mobile_no') || null,
      native_mandal: get('native_mandal') || null,
      residence_mandal: get('residence_mandal') || null,
      working_mandal: get('working_mandal') || null,
      alloted_mandal: get('alloted_mandal') || null,
      raw_sheet_row: i + 1,
    };
    if (reasons.length > 0) rejected.push({ sheetRow: i + 1, employeeId: employeeId || null, reasons });
    else accepted.push(record);
  }
  return { accepted, rejected };
}

/**
 * parseTrainingLocations(buffer) -> { accepted, rejected }
 * Required: location_name + mandal.
 */
function parseTrainingLocations(buffer) {
  const grid = readGrid(buffer);
  const { colMap, headerRow } = mapHeader(grid, {
    location_name: ['location', 'venuename', 'venue'],
    mandal: ['mandal'],
    panchayat: ['panchayat'],
    category: ['category', 'sensitivity'],
  });
  if (colMap.location_name === undefined || colMap.mandal === undefined) {
    throw new IntakeParseError('Training locations sheet requires Location, Location Name or Venue, and Mandal columns.');
  }
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const get = (f) => (colMap[f] !== undefined ? normalizeCell(row[colMap[f]]) : '');
    const locationName = get('location_name');
    const mandal = get('mandal');
    if (!locationName && !mandal) continue;
    const reasons = [];
    if (!locationName) reasons.push('location_name_required');
    if (!mandal) reasons.push('mandal_required');
    // Same building name repeats across panchayats within a mandal
    // (e.g. "ZPH SCHOOL" in two panchayats) — dedupe on all three.
    const key = (locationName + '|' + get('panchayat') + '|' + mandal).toLowerCase();
    if (!reasons.length) {
      if (seen.has(key)) reasons.push('duplicate_location_in_file');
      else seen.add(key);
    }
    const record = {
      location_name: locationName,
      mandal,
      panchayat: get('panchayat') || null,
      category: get('category') || null,
    };
    if (reasons.length > 0) rejected.push({ sheetRow: i + 1, employeeId: null, reasons });
    else accepted.push(record);
  }
  return { accepted, rejected };
}

/**
 * parseRequirements(buffer) -> { accepted, rejected }
 * Required: mandal + integer REQUIRED/RESERVE/TOTAL.
 */
function parseRequirements(buffer) {
  const grid = readGrid(buffer);
  const { colMap, headerRow } = mapHeader(grid, {
    phase: ['phase'],
    division_name: ['divisionname', 'division'],
    mandal: ['mandalname', 'mandal'],
    no_of_gps: ['noofgps', 'gps'],
    sensitive_loc: ['sensitiveloc', 'sensitive'],
    hyper_sensitive_loc: ['hypersensitiveloc', 'hypersensitive'],
    required_count: ['required'],
    reserve_count: ['reserve'],
    total_count: ['total'],
  });
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  const asInt = (v) => {
    const n = Number.parseInt(String(v).replace(/\.0+$/, ''), 10);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const get = (f) => (colMap[f] !== undefined ? normalizeCell(row[colMap[f]]) : '');
    const mandal = get('mandal');
    const requiredCount = asInt(get('required_count'));
    const reserveCount = asInt(get('reserve_count'));
    const totalCount = asInt(get('total_count'));
    if (!mandal && requiredCount === null) continue;
    const reasons = [];
    if (!mandal) reasons.push('mandal_required');
    if (requiredCount === null) reasons.push('required_count_invalid');
    if (reserveCount === null) reasons.push('reserve_count_invalid');
    if (totalCount === null) reasons.push('total_count_invalid');
    if (mandal) {
      if (seen.has(mandal.toLowerCase())) reasons.push('duplicate_mandal_in_file');
      else seen.add(mandal.toLowerCase());
    }
    const record = {
      phase: get('phase') || null,
      division_name: get('division_name') || null,
      mandal,
      no_of_gps: get('no_of_gps') || null,
      sensitive_loc: get('sensitive_loc') || null,
      hyper_sensitive_loc: get('hyper_sensitive_loc') || null,
      required_count: requiredCount,
      reserve_count: reserveCount,
      total_count: totalCount,
    };
    if (reasons.length > 0) rejected.push({ sheetRow: i + 1, employeeId: null, reasons });
    else accepted.push(record);
  }
  return { accepted, rejected };
}

/**
 * parseTrainingSessions(buffer) -> { accepted, rejected }
 * Training *sessions* schedule (title, session_type, mandal, venue, scheduled_at, ...).
 * Required: district + title + session_type ('theory'|'practical').
 * `id` / `created_at` are server defaults and are intentionally ignored if present.
 */
function parseTrainingSessions(buffer) {
  const grid = readGrid(buffer);
  const { colMap, headerRow } = mapHeader(grid, {
    district: ['district'],
    title: ['title'],
    session_type: ['sessiontype', 'session_type', 'session type'],
    mandal: ['mandalname', 'mandal'],
    venue: ['venue'],
    scheduled_at: ['scheduledat', 'scheduled_at', 'scheduled at'],
    duration_minutes: ['durationminutes', 'duration_minutes', 'duration'],
    conducted_by: ['conductedby', 'conducted_by', 'conducted by'],
    status: ['status'],
  });
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  const asInt = (v) => {
    const n = Number.parseInt(String(v).replace(/\.0+$/, ''), 10);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const get = (f) => (colMap[f] !== undefined ? normalizeCell(row[colMap[f]]) : '');
    const district = get('district');
    const title = get('title');
    const sessionType = get('session_type');
    if (!district && !title && !sessionType) continue;
    const reasons = [];
    if (!district) reasons.push('district_required');
    if (!title) reasons.push('title_required');
    if (!sessionType) reasons.push('session_type_required');
    else if (!['theory', 'practical'].includes(sessionType.toLowerCase())) reasons.push('session_type_invalid');
    const key = (title + '|' + get('mandal') + '|' + get('venue')).toLowerCase();
    if (!reasons.length) {
      if (seen.has(key)) reasons.push('duplicate_session_in_file');
      else seen.add(key);
    }
    const record = {
      district,
      title,
      session_type: sessionType.toLowerCase(),
      mandal: get('mandal') || null,
      venue: get('venue') || null,
      scheduled_at: get('scheduled_at') || null,
      duration_minutes: asInt(get('duration_minutes')),
      conducted_by: get('conducted_by') || null,
      status: get('status') || 'planned',
    };
    if (reasons.length > 0) rejected.push({ sheetRow: i + 1, employeeId: null, reasons });
    else accepted.push(record);
  }
  return { accepted, rejected };
}

/**
 * parseMandalAdjacency(buffer) -> { accepted, rejected }
 * Required: mandal_name. Near mandals come from a single
 * near_mandal_names column holding comma/semicolon/newline-separated names
 * (e.g. "Kajuluru, Karapa; Samalkota"). A mandal with no near names is
 * accepted with an empty list (fail-closed at run time: no eligible duty
 * mandal -> reported in unmetRequirements).
 */
function parseMandalAdjacency(buffer) {
  const grid = readGrid(buffer);
  const { colMap, headerRow } = mapHeader(grid, {
    mandal_name: ['mandalname', 'mandal'],
    near_mandal_names: ['near', 'adjacent', 'neighbour', 'neighbor'],
  });
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const get = (f) => (colMap[f] !== undefined ? normalizeCell(row[colMap[f]]) : '');
    const mandalName = get('mandal_name');
    if (!mandalName) continue;
    const reasons = [];
    const key = mandalName.toLowerCase();
    if (seen.has(key)) reasons.push('duplicate_mandal_in_file');
    else seen.add(key);
    // Split near names on comma, semicolon, pipe or newline; drop empties and
    // self-references; dedupe case-insensitively preserving first spelling.
    const nearSeen = new Set();
    const near = [];
    for (const part of String(get('near_mandal_names') || '').split(/[,\n;|]/)) {
      const name = String(part).replace(/\s+/g, ' ').trim();
      if (!name) continue;
      if (name.toLowerCase() === key) continue;
      if (nearSeen.has(name.toLowerCase())) continue;
      nearSeen.add(name.toLowerCase());
      near.push(name);
    }
    const record = { mandal_name: mandalName, near_mandal_names: near };
    if (reasons.length > 0) rejected.push({ sheetRow: i + 1, employeeId: null, reasons });
    else accepted.push(record);
  }
  return { accepted, rejected };
}

module.exports = {
  IntakeParseError,
  parseMicroObservers,
  parseTrainingLocations,
  parseTrainingSessions,
  parseRequirements,
  parseMandalAdjacency,
};
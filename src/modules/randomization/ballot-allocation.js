'use strict';

/**
 * Ballot register parsing + officer allocation (pure, no DB).
 *
 * Used by POST /api/randomization/ballot-allocation (Phase 3 – Ballot
 * Allocation page). The uploaded register lists one row per ballot /
 * polling station (real sample: "Booths" sheet with Booth ID, Booth
 * Number, Mandal). Tolerant header matching (case/space/punctuation
 * insensitive) like the Phase-1 intake parsers.
 *
 * Allocation rule [P — proposed wording; the verified circular pages do
 * not describe this page's flow]:
 *   - ONE ballot row is served by ONE Presiding Officer + ONE Polling
 *     Officer, consumed strictly IN ORDER of the officer lists that
 *     Phase 2 produced.
 *   - An officer is NEVER used twice (one person stands at ONE polling
 *     station); no randomization here — ordering is Phase 2's team/rank
 *     order, authority supplied.
 *   - Shortfall is FAIL-CLOSED and visible: remaining ballot rows get
 *     status 'Unassigned' with a remark naming the missing role(s).
 *     Never silently dropped, never faked.
 */

const XLSX = require('xlsx');

class BallotParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BallotParseError';
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

/** Read first sheet as array-of-arrays (.xlsx / .xls / .csv buffers). */
/* Read first sheet as array-of-arrays (.xlsx / .xls / .csv buffers). */
function readGrid(buffer) {
  let data;
  if (buffer instanceof Buffer) {
    data = buffer;
  } else if (typeof buffer === 'string') {
    data = require('fs').readFileSync(buffer);
  } else {
    throw new BallotParseError('Ballot register file could not be read.');
  }
  const XLSX = require('xlsx');
  let workbook;
  try {
    workbook = XLSX.read(data, { type: 'buffer', cellDates: true, raw: false });
  } catch (err) {
    throw new BallotParseError('File could not be read as an Excel workbook.');
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new BallotParseError('Workbook has no sheets.');
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
}

/**
 * Locate the header row and map identity columns.
 *   ballotId <- Booth ID / Ballot ID / Ballot No / Ballot Number
 *   psNo     <- Booth Number / PS No / Polling Station / Ballot Unit / Unit
 *   mandal   <- Mandal / Mandal Name
 * Mandal is optional (some registers are single-mandal); at least one of
 * ballotId / psNo must exist or the file is rejected outright.
 */
function mapHeader(grid) {
  const candidates = {
    ballotId: [
      'stationid', 'station_id', 'boothid', 'ballotid', 'ballotno', 'ballotnumber', 'ballot',
      'unit', 'pollingstationnumber', 'chartno',
    ],
    psNo: [
      'stationnumber', 'stationno', 'station_number', 'boothnumber', 'psno', 'psnumber',
      'pollingstationnumber', 'ballotunit',
    ],
    stationName: [
      'stationname', 'station_name', 'pollingstationname', 'boothname', 'locationname',
    ],
    buildingName: [
      'buildingname', 'building_name', 'building', 'school', 'college', 'institution',
    ],
    street: ['street', 'streetname', 'road', 'address'],
    locality: ['locality', 'villagelocality', 'village', 'area'],
    ward: ['ward', 'wardname', 'wardnumber', 'wardno'],
    mandal: ['mandalname', 'mandal', 'block', 'tehsil'],
    district: ['district', 'districtname'],
    pinCode: ['pincode', 'pin_code', 'pin', 'postalcode'],
    requiredOfficers: ['requiredofficers', 'required_officers', 'officersrequired'],
  };
  for (let i = 0; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const colMap = {};
    for (let col = 0; col < row.length; col += 1) {
      const raw = row[col];
      const h = normalizeHeader(raw);
      if (!h) continue;
      for (const [field, aliases] of Object.entries(candidates)) {
        if (colMap[field] !== undefined) continue;
        if (aliases.some((a) => h === a || h.includes(a))) colMap[field] = col;
      }
    }
    if (colMap.ballotId !== undefined || colMap.psNo !== undefined || colMap.stationName !== undefined) {
      return { colMap, headerRow: i };
    }
  }
  throw new BallotParseError(
    'Ballot register header not found (need a Booth/Ballot ID, Booth/PS Number, or Station Name column).'
  );
}

/**
 * Format a complete, readable polling station address from address components.
 */
function buildStationAddress({ buildingName, street, locality, ward, mandal, district, pinCode }) {
  const parts = [];
  if (buildingName) parts.push(buildingName);
  if (street) parts.push(street);
  if (locality) parts.push(locality);
  if (ward) parts.push(String(ward).toLowerCase().startsWith('ward') ? ward : `Ward ${ward}`);
  if (mandal) parts.push(mandal);
  if (district) parts.push(district);
  if (pinCode) parts.push(`PIN: ${pinCode}`);
  return parts.filter(Boolean).join(', ');
}

/**
 * parseBallotRegister(buffer) -> { accepted, rejected }
 * Required: ballotId OR psNo OR stationName on every data row; duplicate ballot identity
 * in one file rejects the later rows (same policy as duplicate employee_id).
 */
function parseBallotRegister(buffer) {
  const grid = readGrid(buffer);
  const { colMap, headerRow } = mapHeader(grid);
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const get = (f) => (colMap[f] !== undefined ? normalizeCell(row[colMap[f]]) : '');
    const ballotId = get('ballotId');
    let psNo = get('psNo');
    const stationName = get('stationName');
    const buildingName = get('buildingName');
    const street = get('street');
    const locality = get('locality');
    const ward = get('ward');
    const mandal = get('mandal');
    const district = get('district');
    const pinCode = get('pinCode');
    const requiredOfficers = get('requiredOfficers');

    if (!ballotId && !psNo && !stationName) continue; // blank / separator row

    if (!psNo && stationName) {
      psNo = stationName;
    }

    const reasons = [];
    const identity = (ballotId || psNo || stationName).toLowerCase();
    if (seen.has(identity)) reasons.push('duplicate_ballot_in_file');
    else seen.add(identity);

    const stationAddress = buildStationAddress({
      buildingName,
      street,
      locality,
      ward,
      mandal,
      district,
      pinCode,
    });

    const record = {
      ballotId: ballotId || null,
      psNo: psNo || null,
      psName: stationName || buildingName || (psNo ? `PS #${psNo}` : null),
      stationName: stationName || null,
      buildingName: buildingName || null,
      street: street || null,
      locality: locality || null,
      ward: ward || null,
      mandal: mandal || null,
      district: district || null,
      pinCode: pinCode || null,
      stationAddress: stationAddress || null,
      requiredOfficers: requiredOfficers ? Number(requiredOfficers) : null,
    };
    if (reasons.length > 0) rejected.push({ sheetRow: i + 1, ballotId: ballotId || psNo || null, reasons });
    else accepted.push(record);
  }
  return { accepted: accepted, rejected: rejected };
}

/**
 * allocateBallots({ ballots, presidingOfficers, pollingOfficers })
 *   -> { summary: { totalBallots, allocated, presidingCount, pollingCount },
 *        rows: [{ sno, ballotId, psNo, psName, buildingName, street, locality,
 *                 ward, mandal, district, pinCode, stationAddress,
 *                 presidingOfficer, pollingOfficer, status, remarks }] }
 * Officers are consumed IN ORDER, one ballot per officer (never reused),
 * shortfall surfaced per row (status 'Unassigned' + remark naming the
 * missing role) — fail closed, never silently dropped.
 */
function allocateBallots(args) {
  const list = Array.isArray(args && args.ballots) ? args.ballots : [];
  const pres = (Array.isArray(args && args.presidingOfficers) ? args.presidingOfficers : [])
    .map((n) => normalizeCell(n)).filter((n) => n !== '');
  const poll = (Array.isArray(args && args.pollingOfficers) ? args.pollingOfficers : [])
    .map((n) => normalizeCell(n)).filter((n) => n !== '');
  const rows = list.map((b, i) => {
    const po = pres[i] || null;
    const pOff = poll[i] || null;
    const base = {
      sno: i + 1,
      ballotId: b.ballotId || '—',
      psNo: b.psNo || '—',
      psName: b.psName || b.stationName || (b.psNo && b.psNo !== '—' ? `PS #${b.psNo}` : '—'),
      stationName: b.stationName || '—',
      buildingName: b.buildingName || '—',
      street: b.street || '—',
      locality: b.locality || '—',
      ward: b.ward || '—',
      mandal: b.mandal || '—',
      district: b.district || '—',
      pinCode: b.pinCode || '—',
      stationAddress: b.stationAddress || '—',
      requiredOfficers: b.requiredOfficers || null,
    };
    if (po && pOff) {
      return Object.assign(base, {
        presidingOfficer: po,
        pollingOfficer: pOff,
        status: 'Allocated',
        remarks: '',
      });
    }
    const missing = [!po ? 'Presiding Officer' : null, !pOff ? 'Polling Officer' : null]
      .filter(Boolean).join(' and ');
    return Object.assign(base, {
      presidingOfficer: po || '—',
      pollingOfficer: pOff || '—',
      status: 'Unassigned',
      remarks: 'Officer shortfall: no ' + missing + ' left for this ballot.',
    });
  });
  const allocatedRows = rows.filter((r) => r.status === 'Allocated');
  return {
    summary: {
      totalBallots: rows.length,
      allocated: allocatedRows.length,
      presidingCount: new Set(allocatedRows.map((r) => r.presidingOfficer)).size,
      pollingCount: new Set(allocatedRows.map((r) => r.pollingOfficer)).size,
    },
    rows: rows,
  };
}

module.exports = {
  BallotParseError: BallotParseError,
  readGrid,
  mapHeader,
  parseBallotRegister,
  allocateBallots,
};
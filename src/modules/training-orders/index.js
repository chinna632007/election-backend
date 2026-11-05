'use strict';

/**
 * Training orders — PO / APO allocation + per-officer DOCX print + ZIP download.
 *
 * Spec: TRAINING-ORDERS-ANALYSIS.md
 *  - Separate tables: po_* / apo_*
 *  - Allocate from last Stage-2 excelRows (duty/posting mandal); skip MO
 *  - Re-allocate = wipe all six tables then refill
 *  - Print = built-in tagged templates, one DOCX per officer, auto SL
 *  - Download = ZIP of generated orders
 *  - Config from .env via src/config
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PizZip = require('pizzip');
const { getCollection, mongoose } = require('../../database');
const config = require('../../config');
const { getLastRun, hydrateOnce, latestStageTables } = require('../randomization/allocation-store');
const { mergeDocx } = require('../imports/order-merge.service');

const MAX_BATCH_SIZE = 100;
const { getSetting } = require('../settings/settings.service');
const WRITE = { writeConcern: { w: 'majority', j: true } };

function objectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)
    ? new mongoose.Types.ObjectId(id)
    : null;
}

const TABLES = Object.freeze({
  PO: {
    batches: 'po_training_batches',
    members: 'po_training_batch_members',
    orders: 'po_training_orders',
    template: path.join(__dirname, '../../../docs/PO_Training_Order.docx'),
  },
  APO: {
    batches: 'apo_training_batches',
    members: 'apo_training_batch_members',
    orders: 'apo_training_orders',
    template: path.join(__dirname, '../../../docs/APO_Training_Order.docx'),
  },
  OPO: {
    batches: 'opo_training_batches',
    members: 'opo_training_batch_members',
    orders: 'opo_training_orders',
    template: path.join(__dirname, '../../../docs/OPO_Training_Order.docx'),
  },
});

function tablesFor(group) {
  const g = String(group || '').toUpperCase();
  if (!TABLES[g]) {
    const err = new Error('group must be PO, APO or OPO');
    err.statusCode = 400;
    throw err;
  }
  return TABLES[g];
}

/** Classify Stage-2 role → training group. */
function classifyRole(role) {
  const r = String(role || '').toLowerCase().trim();
  if (r.includes('micro') && r.includes('observer')) return 'MO';
  if (r === 'mo' || r.startsWith('micro observer')) return 'MO';
  if (r.includes('assistant') || r.includes('asst')) return 'APO';
  if (r.includes('presid')) return 'PO';
  return 'OPO';
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** Parse TRAINING_DATE (dd.mm.yyyy or yyyy-mm-dd) → { dd, mm, yyyy, weekday }. */
function parseTrainingDate(raw) {
  const s = String(raw || '').trim();
  let d = null;
  let m = null;
  let y = null;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const ymd = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (dmy) {
    d = dmy[1].padStart(2, '0');
    m = dmy[2].padStart(2, '0');
    y = dmy[3];
  } else if (ymd) {
    y = ymd[1];
    m = ymd[2].padStart(2, '0');
    d = ymd[3].padStart(2, '0');
  }
  let weekday = '';
  if (d && m && y) {
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    if (!Number.isNaN(dt.getTime())) {
      weekday = dt.toLocaleDateString('en-IN', { weekday: 'long' });
    }
  }
  return { dd: d || '', mm: m || '', yyyy: y || '', weekday };
}

/**
 * Split TRAINING_TIME_FROM (e.g. "09:30" or "9:30 AM") into hour / minute /
 * am-pm for the {{training_time_H}} / {{training_time_min}} /
 * {{training_time_ampm}} template tags. 24h input is converted to 12h+ampm.
 */
function parseTrainingTime(timeFrom) {
  const raw = String(timeFrom || '').trim();
  if (!raw) return { h: '', min: '', ampm: '' };
  const m = raw.match(/^(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)?$/);
  if (!m) return { h: '', min: '', ampm: '' };
  let h = Number(m[1]);
  const min = m[2];
  let ampm = (m[3] || '').toUpperCase();
  if (!ampm) {
    ampm = h >= 12 ? 'PM' : 'AM';
  }
  h = h % 12;
  if (h === 0) h = 12;
  return { h: String(h).padStart(2, '0'), min, ampm };
}

function envMergeDefaults(overrides = {}) {
  const training = config.training || {};
  const orders = config.orders || {};
  const trainingDate = overrides.trainingDate || training.date;
  const trainingTime = overrides.trainingTime || training.timeFrom;
  const parsed = parseTrainingDate(trainingDate);
  const time = parseTrainingTime(trainingTime);
  if (overrides.trainingDate && !parsed.dd) {
    const err = new Error('trainingDate must be a valid date.');
    err.statusCode = 400;
    throw err;
  }
  if (overrides.trainingTime && !time.h) {
    const err = new Error('trainingTime must be a valid time.');
    err.statusCode = 400;
    throw err;
  }
  const year =
    config.electionYear ||
    parsed.yyyy ||
    String(new Date().getFullYear());
  const district = config.districtName || 'Kakinada';
  return {
    district,
    date: config.orderDate || orders.pollingDateTime || '',
    place: config.orderPlace || district,
    order_date: config.orderDate || orders.pollingDateTime || '',
    order_place: config.orderPlace || district,
    election_year: year,
    training_day: parsed.dd,
    training_month: parsed.mm,
    training_year: parsed.yyyy,
    training_weekday: parsed.weekday,
    training_time_H: time.h,
    training_time_min: time.min,
    training_time_ampm: time.ampm,
    training_venue: training.venue || '',
    training_mandal: training.mandal || '',
    training_time_from: trainingTime || '',
    training_time_to: training.timeTo || '',
  };
}

/**
 * Wipe all PO + APO + OPO training batch/member/order rows (cascade members
 * via FK).
 */
async function wipeAllTraining() {
  for (const group of Object.values(TABLES)) {
    await getCollection(group.orders).deleteMany({}, WRITE);
    await getCollection(group.members).deleteMany({}, WRITE);
    await getCollection(group.batches).deleteMany({}, WRITE);
  }
}

async function wipePoApoTraining() {
  for (const name of ['PO', 'APO', 'OPO']) {
    const group = TABLES[name];
    await getCollection(group.orders).deleteMany({}, WRITE);
    await getCollection(group.members).deleteMany({}, WRITE);
    await getCollection(group.batches).deleteMany({}, WRITE);
  }
}

async function snapshotTraining() {
  const snapshot = new Map();
  for (const group of Object.values(TABLES)) {
    for (const name of [group.orders, group.members, group.batches]) {
      snapshot.set(name, await getCollection(name).find({}).toArray());
    }
  }
  return snapshot;
}

async function restoreTraining(snapshot) {
  for (const [name, docs] of snapshot) {
    await getCollection(name).deleteMany({}, WRITE);
    if (docs.length) await getCollection(name).insertMany(docs, { ...WRITE, ordered: true });
  }
}

/**
 * Wipe every collection except auth and randomization source data.
 */
async function wipeAllData() {
  const protectedTables = new Set([
    'users',
    'roles',
    'allocation_runs',
    'allocation_publications',
    'team_rosters',
    'team_roster_members',
    'settings_audit',
  ]);
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  const toDelete = collections.map((item) => item.name)
    .filter((name) => !protectedTables.has(name) && !name.startsWith('system.'));
  for (const name of toDelete) await getCollection(name).deleteMany({}, WRITE);
  return { truncated: toDelete };
}

async function loadPersonnelByEmployeeIds(employeeIds) {
  const ids = [...new Set(employeeIds.map((x) => String(x).trim()).filter(Boolean))];
  const map = new Map();
  if (ids.length === 0) return map;
  const rows = await getCollection('personnel').find({ employee_id: { $in: ids } }).toArray();
  const batchIds = [...new Set(rows.map((row) => objectId(row.import_batch_id)).filter(Boolean))];
  const batches = batchIds.length
    ? await getCollection('import_batches').find({ _id: { $in: batchIds } }).toArray()
    : [];
  const departmentByBatch = new Map(batches.map((batch) => [String(batch._id), batch.department_name]));
  for (const row of rows) {
    row.department_name = departmentByBatch.get(String(row.import_batch_id)) || null;
    map.set(String(row.employee_id).trim(), row);
  }
  return map;
}

/**
 * Allocate: wipe → split Stage-2 rows into PO/APO by duty mandal → batches ≤100.
 */
async function allocateTraining({ createdBy } = {}) {
  await hydrateOnce();

  // Source priority: normalized Stage 2/3 DB tables (migration 014) first —
  // they carry the stored training_group + duty mandal per officer and prove
  // Stage 2/3 actually persisted. Fall back to last-run JSON only when the
  // run predates migration 014.
  let teamRows = [];
  let source = 'none';
  let stageRunId = null;
  try {
    const tables = await latestStageTables();
    if (tables && tables.rows.length > 0) {
      stageRunId = tables.runId;
      source = 'stage_tables';
      teamRows = tables.rows.map((r) => ({
        teamCode: r.team_code,
        mandal: r.mandal,
        role: r.role,
        duty: r.duty,
        employeeId: r.employee_id,
        trainingGroup: r.training_group,
        // Stage 3 enrichment: officer's real duty station (mandal) + ballot ID
        // (station / venue code) from the published Stage-3 allotment.
        dutyMandal: r.duty_mandal || r.station_mandal || '',
        venueCode: r.venue_code || r.station_code || '',
        // Frozen roster snapshot (migration 016): when present these are the
        // run-time officer details; they make the member row self-contained
        // even if the live personnel row is later edited or deleted.
        rosterPersonnelId: r.personnel_id || null,
        rosterName: r.name || null,
        rosterDesignation: r.designation || null,
        rosterDepartment: r.department_name || null,
        rosterMobile: r.mobile_no || null,
        rosterWorkMandal: r.work_mandal || null,
      }));
    }
  } catch (err) {
    // Table read failed (e.g. migration not applied) — fall through to JSON.
    if (process.env.NODE_ENV !== 'test') {
      console.warn('allocateTraining: stage tables unreadable, trying run JSON (' + (err.message || err) + ')');
    }
  }
  if (teamRows.length === 0) {
    const lastRun = getLastRun();
    let jsonRows = [];
    let jsonSource = 'none';
    if (lastRun && lastRun.stage2) {
      // Prefer excelRows (legacy run-JSON format); fall back to parties
      // (the actual Stage 2 structure the run produces). excelRows never
      // exists in current code — persistStageTables writes stage2.parties
      // to the DB instead — so this fallback is what makes Training see
      // data when migration 014 stage tables are unavailable.
      if (Array.isArray(lastRun.stage2.excelRows)) {
        jsonRows = lastRun.stage2.excelRows;
        jsonSource = 'excelRows';
      } else if (Array.isArray(lastRun.stage2.parties)) {
        let partyIdx = 0;
        for (const p of lastRun.stage2.parties) {
          const teamCode = `T${String(partyIdx + 1).padStart(3, '0')}`;
          const mandal = String(p.posting || 'UNSPECIFIED').trim() || 'UNSPECIFIED';
          for (const m of p.members || []) {
            jsonRows.push({
              employeeId: m.personnelId || m.employee_id || null,
              employee_id: m.personnelId || m.employee_id || null,
              role: m.role || 'Polling Officer',
              duty: m.duty || null,
              teamCode,
              training_group: classifyRole(m.role),
              trainingGroup: classifyRole(m.role),
              mandal,
              dutyMandal: '',
              venueCode: '',
            });
          }
          partyIdx += 1;
        }
        jsonSource = 'parties';
      }
    }
    if (jsonRows.length > 0) {
      source = 'run_json';
      teamRows = jsonRows;
    }
  }
  if (teamRows.length === 0) {
    // Diagnostics: what does the DB actually contain? Helps the operator
    // tell whether (a) no run was ever saved, (b) migrations are missing,
    // or (c) stage tables exist but are empty.
    let dbState = null;
    try {
      const allocationRunsRows = await getCollection('allocation_runs').countDocuments({});
      const teamRosterMembersRows = await getCollection('team_roster_members').countDocuments({});
      const teamRostersRows = await getCollection('team_rosters').countDocuments({});
      const lastRun = getLastRun();
      const jsonExcelRows = lastRun && lastRun.stage2 && Array.isArray(lastRun.stage2.excelRows)
        ? lastRun.stage2.excelRows.length
        : (lastRun ? 0 : null);
      const jsonParties = lastRun && lastRun.stage2 && Array.isArray(lastRun.stage2.parties)
        ? lastRun.stage2.parties.length
        : (lastRun ? 0 : null);
      dbState = {
        allocationRunsRows,
        teamRosterMembersRows,
        teamRostersRows,
        inMemoryRun: !!lastRun,
        inMemoryRunStage2ExcelRows: jsonExcelRows,
        inMemoryRunStage2Parties: jsonParties,
      };
    } catch (diagErr) {
      dbState = { error: diagErr.message || String(diagErr) };
    }

    const hints = [];
    if (source === 'none') {
      hints.push(
        'No Stage 2/3 data source was found. Check that migrations 012 (allocation_runs) and 014 (stage results) are applied to the database, then run POST /api/randomization/run.'
      );
    } else if (source === 'run_json') {
      hints.push(
        'A run exists but its Stage-2 excelRows is empty — re-run POST /api/randomization/run so Stage 2/3 rows persist to the stage tables.'
      );
    } else {
      hints.push(
        'Stage tables exist but are empty — re-run POST /api/randomization/run so Stage 2/3 rows persist.'
      );
    }
    return {
      batches: [],
      errors: [
        'No completed randomization run found. Run Stage 2/3 first (POST /api/randomization/run).',
        ...hints,
      ],
      skippedMo: 0,
      skippedOpo: 0,
      unresolved: 0,
      source,
      stageRunId,
      dbState,
    };
  }

  const groups = { PO: [], APO: [], OPO: [] };
  let skippedMo = 0;
  let skippedOpo = 0;
  for (const row of teamRows) {
    // DB-table rows carry the stored training_group (classified at run time);
    // run-JSON rows are classified live. Both skip MO.
    const stored = ['PO', 'APO', 'OPO'].includes(row.trainingGroup)
      ? row.trainingGroup
      : null;
    const kind = stored || (row.trainingGroup === 'MO' ? 'MO' : classifyRole(row.role));
    if (kind === 'MO') {
      skippedMo += 1;
      continue;
    }
    groups[kind].push(row);
  }

  const allEmpIds = Object.values(groups).flatMap((members) => members.map((row) => row.employeeId));
  const batchSize = Number(await getSetting('training.max_batch_size')) || MAX_BATCH_SIZE;
  const batches = [];
  let unresolved = 0;
  const snapshot = await snapshotTraining();
  try {
    await wipePoApoTraining();
    const personnelMap = await loadPersonnelByEmployeeIds(allEmpIds);
    for (const group of ['PO', 'APO', 'OPO']) {
      const t = TABLES[group];
      const members = groups[group];
      if (members.length === 0) continue;
      const byMandal = new Map();
      for (const m of members) {
        const mandal = String(m.mandal || 'UNSPECIFIED').trim() || 'UNSPECIFIED';
        if (!byMandal.has(mandal)) byMandal.set(mandal, []);
        byMandal.get(mandal).push(m);
      }
      for (const [mandal, officers] of byMandal) {
        const shuffled = shuffleInPlace(officers.slice());
        let batchNo = 1;
        for (let start = 0; start < shuffled.length; start += batchSize) {
          const chunk = shuffled.slice(start, start + batchSize);
          const batchObjectId = new mongoose.Types.ObjectId();
          const batchId = String(batchObjectId);
          await getCollection(t.batches).insertOne({
            _id: batchObjectId,
            batch_no: batchNo,
            mandal,
            location_id: null,
            created_by: createdBy == null ? null : String(createdBy),
            created_at: new Date(),
          }, WRITE);
          let inserted = 0;
          for (const officer of chunk) {
            const empKey = String(officer.employeeId || '').trim();
            const per = personnelMap.get(empKey);
            // Frozen roster (migration 016) carries the same ids/details at
            // run time; use it when the live personnel row is gone (re-import,
            // edit) so the training batch still records the officer.
            const rosterId = officer.rosterPersonnelId ? String(officer.rosterPersonnelId) : null;
            if (!per && !rosterId) {
              unresolved += 1;
              continue;
            }
            await getCollection(t.members).updateOne(
              { batch_id: batchId, personnel_id: per ? String(per._id) : rosterId },
              {
                $setOnInsert: {
                  _id: new mongoose.Types.ObjectId(),
                  batch_id: batchId,
                  personnel_id: per ? String(per._id) : rosterId,
                  employee_id: per ? per.employee_id : empKey || null,
                  role: officer.role || null,
                  team_code: officer.teamCode || null,
                  duty_mandal: officer.dutyMandal || null,
                  venue_code: officer.venueCode || null,
                  added_by_code: true,
                  roster_name: officer.rosterName || null,
                  roster_designation: officer.rosterDesignation || null,
                  roster_department: officer.rosterDepartment || null,
                  roster_mobile: officer.rosterMobile || null,
                  roster_work_mandal: officer.rosterWorkMandal || null,
                }
              },
              { upsert: true }
            );
            inserted += 1;
          }
          batches.push({
            id: batchId,
            batch_no: batchNo,
            mandal,
            group,
            officer_count: inserted,
          });
          batchNo += 1;
        }
      }
    }
    return { batches, errors: [], skippedMo, skippedOpo, unresolved, source, stageRunId };
  } catch (err) {
    try {
      await wipePoApoTraining();
      await restoreTraining(snapshot);
      return { batches: [], errors: [err.message], skippedMo, skippedOpo, unresolved, source, stageRunId };
    } catch (cleanupError) {
      return {
        batches,
        errors: [
          err.message,
          `Restoring the previous training batches also failed: ${cleanupError.message}. Manual reconciliation is required.`,
        ],
        skippedMo,
        skippedOpo,
        unresolved,
        source,
        stageRunId,
      };
    }
  }
}

/** List batches for PO or APO (with location name + member count). */
async function listBatches(group) {
  const t = tablesFor(group);
  const batches = await getCollection(t.batches).find({}).toArray();
  const locations = await getCollection('training_locations').find({}).toArray();
  const members = await getCollection(t.members).find({}).toArray();
  const locationById = new Map(locations.map((location) => [String(location._id), location]));
  const countByBatch = new Map();
  for (const member of members) {
    countByBatch.set(String(member.batch_id), (countByBatch.get(String(member.batch_id)) || 0) + 1);
  }
  batches.sort((a, b) => String(a.mandal).localeCompare(String(b.mandal)) || a.batch_no - b.batch_no);
  return {
    group: String(group).toUpperCase(),
    batches: batches.map((batch) => ({
      id: String(batch._id),
      batch_no: batch.batch_no,
      mandal: batch.mandal,
      location_id: batch.location_id == null ? null : String(batch.location_id),
      location_name: (locationById.get(String(batch.location_id)) || {}).location_name || null,
      member_count: countByBatch.get(String(batch._id)) || 0,
      created_at: batch.created_at,
    })),
  };
}

/** List members of one batch. */
async function listBatchMembers(group, batchId) {
  const t = tablesFor(group);
  const id = objectId(String(batchId));
  if (!id) {
    const err = new Error('batchId must be a MongoDB ObjectId');
    err.statusCode = 400;
    throw err;
  }
  const batch = await getCollection(t.batches).findOne(
    { _id: id },
    { projection: { batch_no: 1, mandal: 1, location_id: 1 } }
  );
  if (!batch) {
    const err = new Error('Batch not found');
    err.statusCode = 404;
    throw err;
  }
  batch.id = String(batch._id);
  batch.location_id = batch.location_id == null ? null : String(batch.location_id);
  delete batch._id;
  const members = await getCollection(t.members).find({ batch_id: String(id) }).toArray();
  const employeeIds = [...new Set(members.map((member) => member.employee_id).filter(Boolean))];
  const personnelIds = [...new Set(members.map((member) => member.personnel_id).filter((value) => value != null))];
  const personObjectIds = personnelIds.map(objectId).filter(Boolean);
  const [personnel, roster] = await Promise.all([
    personObjectIds.length
      ? getCollection('personnel').find({ _id: { $in: personObjectIds } }).toArray()
      : [],
    employeeIds.length
      ? getCollection('team_roster_members').find({ employee_id: { $in: employeeIds } }).sort({ run_id: -1 }).toArray()
      : [],
  ]);
  const peopleById = new Map(personnel.map((row) => [String(row._id), row]));
  const rosterByEmployee = new Map();
  for (const row of roster) {
    if (!rosterByEmployee.has(String(row.employee_id))) rosterByEmployee.set(String(row.employee_id), row);
  }
  const importBatchIds = [...new Set(personnel.map((row) => objectId(row.import_batch_id)).filter(Boolean))];
  const importBatches = importBatchIds.length
    ? await getCollection('import_batches').find({ _id: { $in: importBatchIds } }).toArray()
    : [];
  const departmentByBatch = new Map(importBatches.map((row) => [String(row._id), row.department_name]));
  const result = members.map((member) => {
    const person = peopleById.get(String(member.personnel_id)) || {};
    const rosterRow = rosterByEmployee.get(String(member.employee_id)) || {};
    const workMandal = rosterRow.work_mandal || person.work_mandal || '';
    const constituency = person.working_constituency_name || '';
    const department = rosterRow.department_name || departmentByBatch.get(String(person.import_batch_id)) || '';
    const output = {
      personnel_id: member.personnel_id == null ? null : String(member.personnel_id),
      employee_id: member.employee_id,
      role: member.role,
      team_code: member.team_code,
      employee_name: rosterRow.name || person.employee_name || null,
      designation: rosterRow.designation || person.designation || null,
      native_mandal: rosterRow.native_mandal || person.native_mandal || null,
      work_mandal: workMandal,
      working_constituency_name: constituency,
      department_name: department,
      mobile_no: rosterRow.mobile_no || person.mobile_no || null,
      venue_code: rosterRow.venue_code || member.venue_code || null,
      duty_mandal: rosterRow.duty_mandal || member.duty_mandal || null,
    };
    output.working_office_address = officeAddressFor({
      department_name: department,
      work_mandal: workMandal,
      working_constituency_name: constituency,
    });
    return output;
  }).sort((a, b) => String(a.employee_name || '').localeCompare(String(b.employee_name || '')));
  return { group: String(group).toUpperCase(), batch, members: result };
}

/** Same-mandal locations for a batch. */
async function listBatchLocations(group, batchId) {
  const t = tablesFor(group);
  const id = objectId(String(batchId));
  const batch = id && await getCollection(t.batches).findOne({ _id: id }, { projection: { mandal: 1 } });
  if (!batch) {
    const err = new Error('Batch not found');
    err.statusCode = 404;
    throw err;
  }
  const mandal = batch.mandal;
  const locations = await getCollection('training_locations')
    .find({
      $expr: {
        $eq: [
          { $toLower: { $trim: { input: { $ifNull: ['$mandal', ''] } } } },
          String(mandal || '').trim().toLowerCase(),
        ],
      },
    })
    .project({ _id: 1, location_name: 1, panchayat: 1, mandal: 1, category: 1 })
    .sort({ location_name: 1 })
    .toArray();
  const locationsWithIds = locations.map(({ _id, ...location }) => ({ id: String(_id), ...location }));
  return { locations: locationsWithIds, mandal };
}

/** Assign / clear location (same-mandal guard). */
async function assignBatchLocation(group, batchId, locationId) {
  const t = tablesFor(group);
  const id = objectId(String(batchId));
  if (!id) {
    const err = new Error('batchId must be a MongoDB ObjectId');
    err.statusCode = 400;
    throw err;
  }
  const locId = locationId == null || locationId === '' ? null : objectId(String(locationId));
  if (locationId != null && locationId !== '' && !locId) {
    const err = new Error('locationId must be a MongoDB ObjectId or null');
    err.statusCode = 400;
    throw err;
  }
  const batchCollection = getCollection(t.batches);
  const batch = await batchCollection.findOne({ _id: id });
  if (!batch) {
    const err = new Error('Batch not found');
    err.statusCode = 404;
    throw err;
  }
  if (locId !== null) {
    const location = await getCollection('training_locations').findOne({ _id: locId });
    if (!location) {
      const err = new Error('Location not found');
      err.statusCode = 404;
      throw err;
    }
    if (String(location.mandal || '').trim().toLowerCase() !== String(batch.mandal || '').trim().toLowerCase()) {
      const err = new Error('Location mandal must match batch duty mandal');
      err.statusCode = 400;
      throw err;
    }
  }
  const nextLocationId = locId ? String(locId) : null;
  const previousLocationId = batch.location_id == null ? null : String(batch.location_id);
  await batchCollection.updateOne(
    { _id: id },
    { $set: { location_id: nextLocationId } },
    WRITE
  );
  if (previousLocationId !== nextLocationId) {
    await getCollection(t.orders).deleteMany({ batch_id: String(id) }, WRITE);
  }
  return { ok: true, batchId: String(id), locationId: nextLocationId };
}

function officeAddressFor(per) {
  // Working Office Address: department (import batch) when present, else the
  // officer's working mandal + working constituency (both frozen in the
  // roster at run time). Never blank while we know where they work.
  const dept = (per.department_name && String(per.department_name).trim()) || '';
  if (dept) return dept;
  const mandal = (per.work_mandal && String(per.work_mandal).trim()) || '';
  const constituency = (per.working_constituency_name && String(per.working_constituency_name).trim()) || '';
  if (mandal && constituency && mandal.toLowerCase() !== constituency.toLowerCase()) {
    return mandal + ' Mandal, ' + constituency;
  }
  return mandal || constituency || '';
}

function designationDeptFor(per) {
  const desig = (per.designation && String(per.designation).trim()) || '';
  const dept = (per.department_name && String(per.department_name).trim()) || '';
  if (desig && dept) return `${desig} / ${dept}`;
  return desig || dept || '';
}

/**
 * Generate one DOCX per officer for PO, APO, or OPO. Replaces prior orders for that group.
 * Returns { generated, skippedNoLocation, errors }.
 */
async function generateOrders({ group, createdBy, trainingDate, trainingTime } = {}) {
  const t = tablesFor(group);
  const g = String(group).toUpperCase();
  if (!fs.existsSync(t.template)) {
    const err = new Error(`Built-in template missing: ${path.basename(t.template)}`);
    err.statusCode = 500;
    throw err;
  }
  const templateBytes = fs.readFileSync(t.template);
  const defaults = envMergeDefaults({ trainingDate, trainingTime });

  const orders = getCollection(t.orders);
  const previousOrders = await orders.find({}).toArray();
  try {
    let sl = 0;
    let generated = 0;
    let skippedNoLocation = 0;
    const errors = [];
    let totalMembers = 0;
    await orders.deleteMany({}, WRITE);
    const members = await getCollection(t.members).find({}).toArray();
    const batchIds = [...new Set(members.map((member) => objectId(member.batch_id)).filter(Boolean))];
    const personnelIds = [...new Set(members.map((member) => objectId(member.personnel_id)).filter(Boolean))];
    const employeeIds = [...new Set(members.map((member) => member.employee_id).filter(Boolean))];
    const [batches, personnel, locations, roster] = await Promise.all([
      getCollection(t.batches).find({ _id: { $in: batchIds } }).toArray(),
      personnelIds.length ? getCollection('personnel').find({ _id: { $in: personnelIds } }).toArray() : [],
      getCollection('training_locations').find({}).toArray(),
      employeeIds.length
        ? getCollection('team_roster_members').find({ employee_id: { $in: employeeIds } }).sort({ run_id: -1 }).toArray()
        : [],
    ]);
    const batchById = new Map(batches.map((batch) => [String(batch._id), batch]));
    const personById = new Map(personnel.map((person) => [String(person._id), person]));
    const locationById = new Map(locations.map((location) => [String(location._id), location]));
    const rosterByEmployee = new Map();
    for (const item of roster) {
      if (!rosterByEmployee.has(String(item.employee_id))) rosterByEmployee.set(String(item.employee_id), item);
    }
    const importBatchIds = [...new Set(personnel.map((person) => objectId(person.import_batch_id)).filter(Boolean))];
    const importBatches = importBatchIds.length
      ? await getCollection('import_batches').find({ _id: { $in: importBatchIds } }).toArray()
      : [];
    const departmentByBatch = new Map(importBatches.map((item) => [String(item._id), item.department_name]));
    const rows = members.filter((member) => batchById.has(String(member.batch_id))).map((member) => {
      const batch = batchById.get(String(member.batch_id));
      const person = personById.get(String(member.personnel_id)) || {};
      const rosterRow = rosterByEmployee.get(String(member.employee_id)) || {};
      const location = locationById.get(String(batch.location_id)) || {};
      return {
        ...member,
        batch_mandal: batch.mandal,
        batch_no: batch.batch_no,
        duty_mandal: member.duty_mandal || batch.mandal,
        venue: location.location_name || null,
        employee_name: rosterRow.name || person.employee_name || null,
        designation: rosterRow.designation || person.designation || null,
        mobile_no: rosterRow.mobile_no || person.mobile_no || null,
        work_mandal: rosterRow.work_mandal || person.work_mandal || null,
        working_constituency_name: person.working_constituency_name || null,
        department_name: rosterRow.department_name || departmentByBatch.get(String(person.import_batch_id)) || null,
      };
    }).sort((a, b) => String(a.batch_mandal).localeCompare(String(b.batch_mandal)) ||
      a.batch_no - b.batch_no || String(a.employee_name || '').localeCompare(String(b.employee_name || '')));
    totalMembers = rows.length;
    for (const row of rows) {
      if (!row.venue) {
        skippedNoLocation += 1;
        // Still print with blank venue (fail-soft on venue) — user can assign later and re-generate.
      }
      sl += 1;
      const per = {
        department_name: row.department_name,
        designation: row.designation,
        work_mandal: row.work_mandal,
        working_constituency_name: row.working_constituency_name,
      };
      // Placeholder map matches docs/{PO,APO,OPO}_Training_Order.docx exactly.
      // .env supplies district/date/place/training time+venue+mandal; the DB
      // (roster snapshot first) supplies the officer + Stage-3 duty details.
      const data = {
        ...defaults,
        sl: String(sl),
        officer_id: row.employee_id || '',
        officer_name: row.employee_name || '',
        officer_designation: designationDeptFor(per),
        officer_working_addr: officeAddressFor(per),
        officer_mobile: row.mobile_no || '',
        officer_working_mandal: row.work_mandal || '',
        // Order-level location: batch venue (training centre) or .env default.
        training_venue: row.venue || defaults.training_venue || '',
        // Duty mandal = Stage-3 station mandal (falls back to batch mandal).
        training_mandal: row.duty_mandal || defaults.training_mandal || '',
      };
      let docx;
      try {
        docx = mergeDocx(templateBytes, data);
      } catch (e) {
        errors.push(`personnel ${row.personnel_id}: ${e.message}`);
        continue;
      }
      const orderId = `TR-${g}-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(100000, 999999)}-${sl}`;
      // Persist a copy on disk so orders can be printed straight off the
      // server (generated-documents/<GROUP>/). Best-effort: DB is the source
      // of truth; a disk failure never fails the order.
      const safeName = String(row.employee_name || row.employee_id || 'officer')
        .replace(/[^\w.\- ]+/g, '_')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 60) || 'officer';
      const diskDir = path.join(__dirname, '../../../generated-documents', g);
      try {
        fs.mkdirSync(diskDir, { recursive: true });
        const slp = String(sl).padStart(4, '0');
        fs.writeFileSync(
          path.join(diskDir, `${slp}_${safeName}_${orderId}.docx`),
          docx
        );
      } catch (diskErr) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('[generateOrders] disk save failed:', diskErr.message);
        }
      }
      await orders.insertOne({
        _id: new mongoose.Types.ObjectId(),
        order_id: orderId,
        sl_no: sl,
        batch_id: String(row.batch_id),
        personnel_id: row.personnel_id == null ? null : String(row.personnel_id),
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        mandal: row.duty_mandal,
        venue: row.venue || null,
        venue_code: row.venue_code || null,
        status: 'generated',
        order_docx: docx,
        created_by: createdBy == null ? null : String(createdBy),
        created_at: new Date(),
        updated_at: new Date(),
      }, WRITE);
      generated += 1;
    }

    return { group: g, generated, skippedNoLocation, errors, totalMembers };
  } catch (err) {
    try {
      await orders.deleteMany({}, WRITE);
      if (previousOrders.length) {
        await orders.insertMany(previousOrders, { ...WRITE, ordered: true });
      }
    } catch (cleanupError) {
      const error = new Error(
        `${err.message}. Restoring previous ${g} training orders failed: ${cleanupError.message}. Manual reconciliation is required.`
      );
      error.cause = err;
      error.statusCode = 500;
      throw error;
    }
    throw err;
  }
}

/** List stored orders (optional group filter). */
async function listTrainingOrders({ group, page = 1, perPage = 50 } = {}) {
  const pageN = Math.max(1, Number(page) || 1);
  const per = Math.min(200, Math.max(1, Number(perPage) || 50));
  let groups;
  if (group) {
    const g = String(group).toUpperCase();
    tablesFor(g);
    groups = [g];
  } else {
    groups = ['PO', 'APO', 'OPO'];
  }
  const orders = [];
  for (const g of groups) {
    const docs = await getCollection(TABLES[g].orders).find({}, {
      projection: {
        _id: 1,
        order_id: 1,
        sl_no: 1,
        batch_id: 1,
        personnel_id: 1,
        employee_id: 1,
        employee_name: 1,
        mandal: 1,
        venue_code: 1,
        venue: 1,
        status: 1,
        created_at: 1,
      },
    }).toArray();
    orders.push(...docs.map(({ _id, ...order }) => ({ ...order, id: String(_id), training_group: g })));
  }
  orders.sort((a, b) => a.sl_no - b.sl_no || a.id.localeCompare(b.id));
  const total = orders.length;
  return {
    orders: orders.slice((pageN - 1) * per, pageN * per),
    page: pageN,
    perPage: per,
    total,
    totalPages: Math.ceil(total / per) || 1,
  };
}

/** Single order download. */
async function downloadTrainingOrder(group, id) {
  const t = tablesFor(group);
  const _id = objectId(String(id));
  const order = _id && await getCollection(t.orders).findOne(
    { _id },
    { projection: { order_id: 1, employee_id: 1, employee_name: 1, order_docx: 1 } }
  );
  if (!order) {
    const err = new Error('Training order not found');
    err.statusCode = 404;
    throw err;
  }
  if (!order.order_docx) {
    const err = new Error('Training order has not been generated yet — run Generate/Print first');
    err.statusCode = 404;
    throw err;
  }
  return {
    order: { id: String(order._id), ...order },
    buffer: Buffer.from(order.order_docx.buffer || order.order_docx),
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    filename: `${order.order_id || 'order'}.docx`,
  };
}

/**
 * ZIP generated orders for one group or all groups when group omitted/ALL.
 */
async function buildOrdersZip(group) {
  const zip = new PizZip();
  let count = 0;

  async function addGroup(g) {
    const t = TABLES[g];
    const rows = await getCollection(t.orders).find({}, {
      projection: { order_id: 1, employee_id: 1, employee_name: 1, order_docx: 1, sl_no: 1 },
    }).sort({ sl_no: 1, _id: 1 }).toArray();
    for (const row of rows) {
      if (!row.order_docx) continue;
      const safeName = String(row.employee_name || row.employee_id || 'officer')
        .replace(/[^\w.\- ]+/g, '_')
        .slice(0, 60);
      const fname = `${g}/${String(row.sl_no).padStart(4, '0')}_${safeName}_${row.order_id}.docx`;
      zip.file(fname, Buffer.from(row.order_docx.buffer || row.order_docx));
      count += 1;
    }
  }

  const g = group ? String(group).toUpperCase() : 'ALL';
  if (g === 'ALL') {
    await addGroup('PO');
    await addGroup('APO');
    await addGroup('OPO');
  } else {
    if (!['PO', 'APO', 'OPO'].includes(g)) {
      const err = new Error('Training ZIP downloads are available for PO, APO, OPO or ALL only.');
      err.statusCode = 400;
      throw err;
    }
    tablesFor(g);
    await addGroup(g);
  }

  if (count === 0) {
    const err = new Error('No generated orders to download. Run Print/Generate first.');
    err.statusCode = 404;
    throw err;
  }

  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const filename =
    g === 'ALL' ? 'training-orders-PO-APO.zip' : `training-orders-${g}.zip`;
  return { buffer, filename, count };
}

module.exports = {
  MAX_BATCH_SIZE,
  TABLES,
  classifyRole,
  parseTrainingDate,
  envMergeDefaults,
  allocateTraining,
  listBatches,
  listBatchMembers,
  listBatchLocations,
  assignBatchLocation,
  generateOrders,
  listTrainingOrders,
  downloadTrainingOrder,
  buildOrdersZip,
  wipeAllTraining,
  wipeAllData,
};

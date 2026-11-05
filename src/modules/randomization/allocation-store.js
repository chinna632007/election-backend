'use strict';

/**
 * Durable MongoDB allocation and frozen-roster persistence with a small
 * in-process read cache. Allocation JSON is the canonical run snapshot;
 * normalized roster collections preserve the existing reporting contract.
 */

const { getCollection, mongoose } = require('../../database');

const store = { lastRun: null, publication: null, hydrated: false };

function objectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id;
}

function rowToRun(doc) {
  return {
    id: String(doc._id),
    runAt: doc.run_at instanceof Date ? doc.run_at.toISOString() : doc.run_at,
    runBy: { id: doc.run_by_id, username: doc.run_by_username, role: doc.run_by_role },
    stage1: doc.stage1,
    stage2: doc.stage2,
    stage3: doc.stage3,
    auditEvents: doc.audit_events || [],
  };
}

async function hydrateOnce() {
  if (store.hydrated) return;
  store.hydrated = true;
  try {
    const latest = await getCollection('allocation_runs').findOne({}, { sort: { run_at: -1, _id: -1 } });
    if (!latest) return;
    store.lastRun = rowToRun(latest);
    const publication = await getCollection('allocation_publications').findOne(
      { run_id: latest._id }, { sort: { confirmed_at: -1, _id: -1 } }
    );
    if (publication) {
      store.publication = {
        publishedStage3: publication.published_stage3,
        confirmedBy: { id: publication.confirmed_by_id, username: publication.confirmed_by_username },
        confirmedAt: publication.confirmed_at instanceof Date
          ? publication.confirmed_at.toISOString() : publication.confirmed_at,
      };
    }
  } catch (err) {
    store.hydrated = false;
    if (process.env.NODE_ENV !== 'test') console.warn('allocation-store: Mongo hydrate failed (' + (err.message || err) + ')');
  }
}

function classifyStage2Role(role) {
  const r = String(role || '').toLowerCase().trim();
  if (r.includes('micro') && r.includes('observer')) return 'MO';
  if (r === 'mo' || r.startsWith('micro observer')) return 'MO';
  if (r.includes('assistant') || r.includes('asst')) return 'APO';
  if (r.includes('presid')) return 'PO';
  return 'OPO';
}

async function persistStageTables(runId, result) {
  const stage2 = result.stage2 || {};
  const stage3 = result.stage3 || {};
  const parties = Array.isArray(stage2.parties) ? stage2.parties : [];
  const assignments = Array.isArray(stage3.assignments) ? stage3.assignments : [];
  await getCollection('team_rosters').createIndex(
    { run_id: 1, team_code: 1 }, { unique: true, name: 'team_rosters_run_team_unique' }
  );
  await getCollection('team_roster_members').createIndex(
    { run_id: 1, team_code: 1, employee_id: 1 },
    { unique: true, name: 'team_roster_members_run_team_employee_unique' }
  );
  const runObjectId = objectId(runId);
  const employeeIds = [...new Set(parties.flatMap((p) => (p.members || [])
    .map((m) => m.personnelId == null ? '' : String(m.personnelId).trim()).filter(Boolean)))];
  const districtId = result.districtId || (result.stage1 && result.stage1.districtId);
  const query = { employee_id: { $in: employeeIds } };
  if (districtId != null) query.district = String(districtId);
  if (result.personnelBatchId != null) query.import_batch_id = result.personnelBatchId;
  const personnelCursor = employeeIds.length
    ? await getCollection('personnel').find(query, {
      projection: {
        _id: 0, id: 1, employee_id: 1, employee_name: 1, designation: 1, mobile_no: 1,
        work_mandal: 1, native_mandal: 1, import_batch_id: 1,
      },
    }) : null;
  const personnel = personnelCursor ? await personnelCursor.toArray() : [];
  const byEmployee = new Map(personnel.map((row) => [String(row.employee_id).trim(), row]));
  const batch = result.personnelBatchId == null ? null : await getCollection('import_batches').findOne(
    { id: result.personnelBatchId }, { projection: { department_name: 1 } }
  );
  const assignmentByTeam = new Map(assignments.map((a) => [String(a.teamCode || '').trim(), a]));
  const rosterDocs = [];
  const memberDocs = [];

  for (const party of parties) {
    const teamCode = String(party.teamCode || '').trim();
    if (!teamCode) continue;
    const assignment = assignmentByTeam.get(teamCode) || {};
    const mo = (party.members || []).find((member) => classifyStage2Role(member.role) === 'MO');
    rosterDocs.push({
      run_id: runObjectId,
      team_code: teamCode,
      district_id: districtId == null ? null : String(districtId),
      posting_mandal: party.postingMandal || null,
      team_size: party.teamSize || (party.members ? party.members.length : null),
      operational_size: party.operationalSize || null,
      micro_observer_personnel_id: mo && mo.personnelId != null ? String(mo.personnelId) : null,
      station_id: assignment.stationId == null ? null : String(assignment.stationId),
      station_code: assignment.stationCode == null ? null : String(assignment.stationCode),
      station_name: assignment.stationName || null,
      building_name: assignment.buildingName || null,
      street: assignment.street || null,
      locality: assignment.locality || null,
      ward: assignment.ward || null,
      station_district: assignment.district || null,
      station_mandal: assignment.stationMandal || null,
      pin_code: assignment.pinCode || null,
      publication_status: assignment.publicationStatus || 'confidential',
    });
    for (const member of party.members || []) {
      const employeeId = member.personnelId == null ? '' : String(member.personnelId).trim();
      if (!employeeId) continue;
      const person = byEmployee.get(employeeId) || {};
      const group = classifyStage2Role(member.role);
      memberDocs.push({
        run_id: runObjectId,
        team_code: teamCode,
        employee_id: employeeId,
        district_id: districtId == null ? null : String(districtId),
        personnel_id: person.id == null ? null : String(person.id),
        name: member.name || person.employee_name || null,
        designation: member.designation || person.designation || null,
        department_name: batch && batch.department_name || null,
        mobile_no: person.mobile_no || null,
        work_mandal: member.workMandal || person.work_mandal || null,
        native_mandal: member.nativeMandal || null,
        role: member.role || 'Polling Officer',
        duty: member.duty == null ? null : String(member.duty),
        training_group: group,
        is_micro_observer: group === 'MO',
        duty_mandal: assignment.stationMandal || null,
        venue_code: assignment.stationCode == null ? null : String(assignment.stationCode),
      });
    }
  }

  const rosters = getCollection('team_rosters');
  const members = getCollection('team_roster_members');
  const previousRosters = await rosters.find({ run_id: runObjectId }).toArray();
  const previousMembers = await members.find({ run_id: runObjectId }).toArray();
  try {
    await members.deleteMany({ run_id: runObjectId });
    await rosters.deleteMany({ run_id: runObjectId });
    for (const document of rosterDocs) {
      await rosters.updateOne(
        { run_id: runObjectId, team_code: document.team_code },
        {
          $set: {
            ...document,
          }
        }, { upsert: true }
      );
    }
    for (const document of memberDocs) {
      await members.updateOne(
        { run_id: runObjectId, team_code: document.team_code, employee_id: document.employee_id },
        { $set: { ...document } },
        { upsert: true }
      );
    }
    return { teams: rosterDocs.length, members: memberDocs.length, assignments: assignments.length };
  } catch (error) {
    try {
      await members.deleteMany({ run_id: runObjectId });
      await rosters.deleteMany({ run_id: runObjectId });
      if (previousRosters.length) await rosters.insertMany(previousRosters, { ordered: true });
      if (previousMembers.length) await members.insertMany(previousMembers, { ordered: true });
    } catch (cleanupError) {
      throw new Error(
        `Stage roster persistence failed (${error.message}); restoring the prior roster also failed (${cleanupError.message}). Run ${runId} may require manual reconciliation.`,
        { cause: error }
      );
    }
    throw error;
  }
}

async function latestStageTables() {
  const latestRun = await getCollection('allocation_runs').findOne({}, {
    sort: { run_at: -1, _id: -1 }, projection: { _id: 1 },
  });
  if (!latestRun) return null;
  const headerCursor = await getCollection('team_rosters').find({ run_id: latestRun._id });
  const headers = await headerCursor.toArray();
  if (!headers.length) return null;
  const headerByTeam = new Map(headers.map((row) => [row.team_code, row]));
  const memberCursor = await getCollection('team_roster_members').find(
    { run_id: latestRun._id }, { projection: { _id: 0 }, sort: { team_code: 1, role: 1 } }
  );
  const members = await memberCursor.toArray();
  if (!members.length) return null;
  const rows = members.map((member) => {
    const team = headerByTeam.get(member.team_code) || {};
    return {
      ...member,
      mandal: member.duty_mandal || team.posting_mandal || null,
      station_id: team.station_id || null,
      station_code: team.station_code || null,
      station_mandal: team.station_mandal || null,
      station_name: team.station_name || null,
      building_name: team.building_name || null,
      street: team.street || null,
      locality: team.locality || null,
      ward: team.ward || null,
      station_district: team.station_district || null,
      pin_code: team.pin_code || null,
      publication_status: team.publication_status || null,
    };
  });
  return { runId: String(latestRun._id), rows, source: 'team_rosters' };
}

function recordRun(entry) {
  store.hydrated = true;
  store.lastRun = entry;
  store.publication = null;
  return (async () => {
    let inserted;
    const runAt = entry.runAt ? new Date(entry.runAt) : new Date();
    try {
      inserted = await getCollection('allocation_runs').insertOne({
        run_at: runAt,
        run_by_id: entry.runBy && entry.runBy.id || null,
        run_by_username: entry.runBy && entry.runBy.username || null,
        run_by_role: entry.runBy && entry.runBy.role || null,
        district_id: entry.districtId || entry.stage1 && entry.stage1.districtId || null,
        personnel_batch_id: entry.personnelBatchId || null,
        stage1: entry.stage1 || {},
        stage2: entry.stage2 || {},
        stage3: entry.stage3 || {},
        audit_events: entry.auditEvents || [],
      });
    } catch (err) {
      const msg = 'allocation_runs insert FAILED: ' + (err.message || String(err));
      entry.saveError = msg;
      const error = new Error(msg);
      error.statusCode = 500;
      error.cause = err;
      throw error;
    }
    if (!inserted || !inserted.insertedId) {
      const error = new Error('allocation_runs insert returned no id — run was NOT saved');
      error.statusCode = 500;
      entry.saveError = error.message;
      throw error;
    }
    entry.id = String(inserted.insertedId);
    if (!entry.runAt) entry.runAt = runAt.toISOString();
    try {
      entry.stageTables = await persistStageTables(inserted.insertedId, entry);
    } catch (err) {
      entry.stageTablesError = err.message || String(err);
      if (process.env.NODE_ENV !== 'test') console.error('allocation-store: stage tables persist FAILED:', err);
    }
    return store.lastRun;
  })();
}

function recordPublication(publishedStage3, confirmedBy) {
  if (!store.lastRun) return null;
  store.publication = { publishedStage3, confirmedBy, confirmedAt: new Date().toISOString() };
  return (async () => {
    try {
      if (store.lastRun.id) {
        await getCollection('allocation_publications').insertOne({
          run_id: objectId(store.lastRun.id),
          published_stage3: publishedStage3,
          confirmed_by_id: confirmedBy && confirmedBy.id || null,
          confirmed_by_username: confirmedBy && confirmedBy.username || null,
          confirmed_at: new Date(store.publication.confirmedAt),
        });
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('allocation-store: Mongo publication persist skipped (' + (err.message || err) + ')');
      }
    }
    return store.publication;
  })();
}

function getLastRun() { return store.lastRun; }
function getPublication() { return store.publication; }
function _reset() { store.lastRun = null; store.publication = null; store.hydrated = false; }

module.exports = {
  recordRun, recordPublication, getLastRun, getPublication, hydrateOnce,
  latestStageTables, classifyStage2Role, persistStageTables, _reset,
};

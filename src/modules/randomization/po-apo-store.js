'use strict';

/**
 * Government-only frozen PO/APO personnel snapshots in Mongo collections.
 * Aadhaar, voter ID, mobile and other source fields remain restricted to
 * these protected roster collections, as in the former SQL tables.
 */

const { getCollection } = require('../../database');

const PO_TABLE = 'po_officers';
const APO_TABLE = 'apo_officers';
const PERSONNEL_SNAPSHOT_COLS = [
  'district', 'is_active', 'exempt_category', 'sl_no', 'employee_id',
  'employee_name', 'designation', 'gender', 'age', 'aadhar_number',
  'languages_known', 'employment_sector', 'scale_of_pay', 'basic_pay',
  'gazetted_status', 'date_of_birth', 'date_of_retirement',
  'employment_type', 'enrolled_assembly_constituency', 'part_no_vote_sl_no',
  'voter_id', 'residence_address', 'residence_constituency_code',
  'residence_constituency_name', 'work_mandal', 'working_constituency_code',
  'working_constituency_name', 'native_mandal', 'native_constituency_code',
  'native_constituency_name', 'previous_po_duty', 'mobile_no',
  'service_in_district_4y', 'ph_category', 'criminal_case_or_eci_orders',
  'exceeded_3_years', 'eci_ceo_order_details', 'remarks',
];

function emptyRunStats() { return { po: 0, apo: 0, poErrors: null, apoErrors: null }; }

async function persistPoApoRosters(args = {}) {
  const parties = Array.isArray(args.parties) ? args.parties : [];
  const { personnelBatchId, districtId, runId = null } = args;
  const stats = emptyRunStats();
  if (parties.length === 0) return stats;

  await Promise.all([PO_TABLE, APO_TABLE].map((collectionName) =>
    getCollection(collectionName).createIndex(
      { run_id: 1, employee_id: 1 },
      { unique: true, name: collectionName + '_run_employee_unique' }
    )
  ));

  let personnelRows;
  try {
    const projection = Object.fromEntries(PERSONNEL_SNAPSHOT_COLS.map((column) => [column, 1]));
    const query = { import_batch_id: personnelBatchId, district: String(districtId) };
    const cursor = await getCollection('personnel').find(query, { projection, limit: 5000 });
    personnelRows = await cursor.toArray();
  } catch (err) {
    stats.poErrors = stats.apoErrors = 'Failed to read personnel for PO/APO rosters: ' + err.message;
    return stats;
  }

  const byEmployeeId = new Map(personnelRows.map((row) => [String(row.employee_id), row]));
  const jobs = [];
  for (const party of parties) {
    const members = party && party.members || [];
    if (members.length < 2) continue;
    const [poMember, apoMember] = members;
    const poRow = byEmployeeId.get(String(poMember.personnelId));
    const apoRow = byEmployeeId.get(String(apoMember.personnelId));
    if (poRow) jobs.push({ collection: PO_TABLE, row: poRow, party });
    else stats.poErrors = (stats.poErrors ? stats.poErrors + '; ' : '') +
      'PO ' + poMember.personnelId + ' not found in personnel batch ' + personnelBatchId;
    if (apoRow) jobs.push({ collection: APO_TABLE, row: apoRow, party });
    else stats.apoErrors = (stats.apoErrors ? stats.apoErrors + '; ' : '') +
      'APO ' + apoMember.personnelId + ' not found in personnel batch ' + personnelBatchId;
  }

  for (const job of jobs) {
    const data = Object.fromEntries(PERSONNEL_SNAPSHOT_COLS.map((column) => [
      column, job.row[column] === undefined ? null : job.row[column],
    ]));
    Object.assign(data, {
      run_id: runId,
      team_code: job.party.teamCode || null,
      posting_mandal: job.party.postingMandal || null,
    });
    try {
      await getCollection(job.collection).updateOne(
        { run_id: runId, employee_id: String(data.employee_id) },
        { $set: data },
        { upsert: true }
      );
      if (job.collection === PO_TABLE) stats.po += 1;
      else stats.apo += 1;
    } catch (err) {
      const message = 'Failed to persist ' + job.collection + ' row for ' + data.employee_id + ': ' + err.message;
      const key = job.collection === PO_TABLE ? 'poErrors' : 'apoErrors';
      stats[key] = (stats[key] ? stats[key] + '; ' : '') + message;
    }
  }
  return stats;
}

module.exports = { persistPoApoRosters, PO_TABLE, APO_TABLE, PERSONNEL_SNAPSHOT_COLS };

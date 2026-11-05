'use strict';

/** Training PO / APO allocator.
 *
 * Reads Stage 2 output (PO and APO officers) and allocates training batches by
 * each officer's WORK mandal (NOT duty mandal). PO and APO are stored in
 * separate tables so they can be fetched, checked and trained independently.
 *
 * This matches the agreed spec:
 *  - PO = Presiding Officers (team heads)
 *  - APO = all remaining teammates (Assistant Polling Officers, non-gazetted)
 *  - MO = excluded (no training / no orders)
 *  - Training batches grouped by work_mandal; venues at the work Mandal.
 *
 * No database access here — data comes in as arguments. A separate adapter
 * persists the output to po_training_batches / apo_training_batches.
 */

function classifyRole(gazettedStatus, role, designation) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'po' || r === 'presiding officer') return 'PO';
  if (r === 'apo' || r === 'assistant polling officer') return 'APO';
  const desig = String(designation || '').trim().toLowerCase();
  // APO = non-gazetted School Assistant; OPO/MO/others are never trained as PO/APO.
  if (desig === 'school assistant') return 'APO';
  return null;
}

/** Build a training batch list grouped by work_mandal.
 *
 * Input: Stage 2 party objects (each with .members[{workMandal, nativeMandal,
 * gazettedStatus, name, designation, role}]).
 *
 * Output: {
 *   poBatches:  [{ workMandal, venue, members: [{personnelId,name,designation,...}] }],
 *   apoBatches: [{ workMandal, venue, members: [...] }],
 * }
 */
function buildTrainingBatches(stage2Parties, venueByMandal) {
  const poBatches = {};
  const apoBatches = {};

  for (const party of stage2Parties || []) {
    const members = party.members || [];
    for (const m of members) {
      const role = classifyRole(m.gazettedStatus, m.role, m.designation);
      if (role === null) continue; // MO / unassigned: skip

      const workMandal = m.workMandal || m.nativeMandal || null;
      if (!workMandal) continue;

      const batchMap = role === 'PO' ? poBatches : apoBatches;
      if (!batchMap[workMandal]) {
        batchMap[workMandal] = {
          workMandal: workMandal,
          venue: venueByMandal ? venueByMandal[workMandal] || null : null,
          members: [],
        };
      }
      batchMap[workMandal].members.push({
        personnelId: m.personnelId,
        name: m.name,
        designation: m.designation,
        gazettedStatus: m.gazettedStatus,
        role: m.role,
      });
    }
  }

  const poOut = Object.keys(poBatches).map((m) => poBatches[m]);
  const apoOut = Object.keys(apoBatches).map((m) => apoBatches[m]);
  return { poBatches: poOut, apoBatches: apoOut };
}

/** Merge two lists of batches by work_mandal. */
function mergeBatches(listA, listB) {
  const map = {};
  const all = listA.concat(listB);
  for (const b of all) {
    const key = b.workMandal;
    if (!map[key]) {
      map[key] = { workMandal: key, venue: b.venue, members: [] };
    }
    // Members are already distinct; append them.
    map[key].members = map[key].members.concat(b.members || []);
  }
  return Object.keys(map).map((k) => map[k]);
}

module.exports = {
  classifyRole,
  buildTrainingBatches,
  mergeBatches,
};

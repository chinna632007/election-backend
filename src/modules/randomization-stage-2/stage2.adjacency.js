'use strict';

/**
 * Stage 2/3 — mandal adjacency helpers (pure, testable, no I/O).
 *
 * The `mandal_adjacency` intake (migration 019) holds one row per mandal:
 *   mandal_name -> near_mandal_names[].
 * An officer whose work OR native mandal is M may receive duty ONLY in one of
 * M's near mandals — never in M itself (that is the old isMandalBarred rule,
 * kept as-is) and never in a non-adjacent mandal.
 *
 * Two entry points, one per stage:
 *  - buildAdjacencyLookup(rows): rows = [{ mandal_name, near_mandal_names }]
 *    -> { nearOf(normalizedName) } where nearOf returns the canonical near
 *    set (strings as spelled in the upload) or null when M is unknown.
 *  - eligiblePostingMandals(members, postings, lookup): postings (posting
 *    mandal objects {key, raw}) narrowed to those EVERY member may serve in
 *    (each member: posting in near(work) INTERSECT near(native)). Returns the
 *    narrowed posting list; empties mean the party cannot be placed (caller
 *    reports UNRESOLVED — never relaxes).
 *  - stationEligibleForTeam(assignment, members, lookup): Stage 3 check —
 *    station mandal must be in every member's near set. Returns
 *    { ok } or { ok:false, reason }.
 */

const { isMandalBarred, normalizeMandal } = require('./stage2.mandal');

function buildAdjacencyLookup(rows) {
  const byName = new Map();
  for (const r of rows || []) {
    const name = normalizeMandal(r && (r.mandal_name ?? r.mandalName));
    if (!name) continue;
    const raw = (r && (r.near_mandal_names ?? r.nearMandalNames)) || [];
    const list = Array.isArray(raw) ? raw : [raw];
    const seen = new Set();
    const near = [];
    for (const n of list) {
      const key = normalizeMandal(n);
      if (!key || key === name || seen.has(key)) continue;
      seen.add(key);
      near.push(String(n).trim());
    }
    if (!byName.has(name)) byName.set(name, near);
  }
  function nearKeysOf(mandalValue) {
    const name = normalizeMandal(mandalValue);
    if (!name || !byName.has(name)) return null;
    const out = new Set();
    for (const n of byName.get(name)) out.add(normalizeMandal(n));
    return out;
  }
  function nearOf(mandalValue) {
    const name = normalizeMandal(mandalValue);
    if (!name || !byName.has(name)) return null;
    return byName.get(name).slice();
  }
  function hasMandal(mandalValue) {
    const name = normalizeMandal(mandalValue);
    return !!name && byName.has(name);
  }
  return { nearOf, nearKeysOf, hasMandal, size: byName.size };
}

/**
 * Intersection of near(work) and near(native) for one officer.
 * null when either mandal is unknown to the adjacency table (fail closed).
 */
function officerNearSet(employee, lookup) {
  if (!employee || typeof employee !== 'object' || !lookup) return null;
  const work = lookup.nearKeysOf(employee.workMandal);
  const native = lookup.nearKeysOf(employee.nativeMandal);
  if (!work || !native) return null;
  const out = new Set();
  for (const m of work) if (native.has(m)) out.add(m);
  return out;
}

/**
 * Narrow candidate postings to those every member may serve in.
 * Members with an uncomputable near set (unknown mandal) veto everything
 * (fail closed — caller reports UNRESOLVED).
 */
function eligiblePostingMandals(members, postings, lookup) {
  if (!lookup || lookup.size === 0) return [];
  const sets = [];
  for (const m of members || []) {
    const s = officerNearSet(m, lookup);
    if (!s) return [];
    sets.push(s);
  }
  return (postings || []).filter(function (p) {
    const key = normalizeMandal(p && (p.key ?? p.raw ?? p));
    if (!key) return false;
    // Belt-and-braces: the posting must also not be anyone's own mandal.
    for (const m of members) {
      if (isMandalBarred(m, p.key ?? p.raw ?? p)) return false;
    }
    return sets.every(function (s) { return s.has(key); });
  });
}

/**
 * Stage 3 check: station mandal must be in every member's near set AND not
 * be any member's own work/native mandal.
 */
function stationEligibleForTeam(stationMandal, members, lookup) {
  const posting = normalizeMandal(stationMandal);
  if (!posting) return { ok: false, reason: 'missing station mandal' };
  if (!lookup || lookup.size === 0) {
    return { ok: false, reason: 'no mandal adjacency data loaded' };
  }
  for (const m of members || []) {
    if (isMandalBarred(m, stationMandal)) {
      return { ok: false, reason: 'station mandal is a member home mandal' };
    }
    const s = officerNearSet(m, lookup);
    if (!s) return { ok: false, reason: 'member mandal missing from adjacency table' };
    if (!s.has(posting)) return { ok: false, reason: 'station mandal not adjacent to member mandal' };
  }
  return { ok: true };
}

module.exports = {
  buildAdjacencyLookup,
  officerNearSet,
  eligiblePostingMandals,
  stationEligibleForTeam,
};
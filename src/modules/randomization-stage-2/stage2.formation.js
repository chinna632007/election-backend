'use strict';

/**
 * Stage 2 — party formation engine (pure, testable, no I/O).
 *
 * Algorithm: randomized greedy with retries.
 *  1. Shuffle PO-eligible candidates (Fisher-Yates, injectable RNG).
 *  2. For each party slot: pick the next eligible Presiding Officer, then
 *     greedily fill polling officers from a fresh shuffle, enforcing:
 *       (a) PO seniorityRank strictly lower (more senior) than every PO in
 *           the same party;
 *       (b) all members have distinct officeKey;
 *       (c) nobody posted to their work/native mandal.
 *  3. Retry whole formation up to maxAttempts with fresh shuffles; keep the
 *     best (most complete parties) attempt. Never relax a rule: shortfall is
 *     reported as INCOMPLETE with unmetRequirements.
 */

const { randomInt: cryptoRandomInt } = require('crypto');
const { TEAM_ROLES } = require('./stage2.constants');
const { isMandalBarred, normalizeMandal } = require('./stage2.mandal');

function shuffleInPlace(arr, randomInt) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function defaultRandomInt(maxExclusive) {
  return cryptoRandomInt(maxExclusive);
}

function checkRandomInt(fn) {
  if (fn === undefined || fn === null) return defaultRandomInt;
  if (typeof fn !== 'function') throw new Error('randomInt must be a function.');
  return fn;
}

function partyIsValid(members) {
  if (!members || members.length === 0) return false;
  const po = members[0];
  const offices = new Set();
  for (const m of members) {
    if (offices.has(m.officeKey)) return false;
    offices.add(m.officeKey);
  }
  for (let i = 1; i < members.length; i += 1) {
    if (!(po.seniorityRank < members[i].seniorityRank)) return false;
  }
  return true;
}

function tryFormOnce(pool, partySize, postings, randomInt, startIndex, apoDesignation) {
  const avail = pool.slice();
  shuffleInPlace(avail, randomInt);
  const parties = [];
  const used = new Set();
  let postingIdx = startIndex || 0;
  const targetParties = postings.length > 0 ? postings.length : Number.MAX_SAFE_INTEGER;
  const opoSlots = partySize - 2; // 1 PO + 1 APO + opoSlots OPOs

  // Role pools:
  //   PO  = gazetted + presiding-eligible (e.g. Headmaster).
  //   APO = non-gazetted with the APO designation (School Assistant).
  //   OPO = non-gazetted, any other designation (e.g. Teacher).
  const apoDesig = apoDesignation || 'School Assistant';
  const gazettedPool = avail.filter(function (e) {
    return e.gazettedStatus && String(e.gazettedStatus).trim().toLowerCase() === 'gazetted';
  });
  const nonGazettedPool = avail.filter(function (e) {
    return !e.gazettedStatus || String(e.gazettedStatus).trim().toLowerCase() !== 'gazetted';
  });
  // APO candidates: non-gazetted carrying the APO designation.
  const apoPool = nonGazettedPool.filter(function (e) {
    return String(e.designation || '').trim() === apoDesig;
  });
  // OPO candidates: non-gazetted, NOT the APO designation.
  const opoPool = nonGazettedPool.filter(function (e) {
    return String(e.designation || '').trim() !== apoDesig;
  });

  for (const po of gazettedPool) {
    if (parties.length >= targetParties) break;
    if (!po.presidingEligible) continue; // PO must be presiding-eligible
    if (used.has(po.personnelKey)) continue;
    const posting = postings.length > 0 ? postings[postingIdx % postings.length] : null;
    const postingKey = posting ? posting.key : null;
    if (postingKey && isMandalBarred(po, postingKey)) continue;

    const members = [po];
    const usedOffices = new Set([po.officeKey]);

    // Pick APO from non-gazetted School Assistants (not the PO).
    const apoCandidates = apoPool.filter(function (e) {
      return !used.has(e.personnelKey) && e.personnelKey !== po.personnelKey;
    });
    shuffleInPlace(apoCandidates, randomInt);
    let apoFound = false;
    for (const apo of apoCandidates) {
      if (usedOffices.has(apo.officeKey)) continue;
      if (postingKey && isMandalBarred(apo, postingKey)) continue;
      if (!(po.seniorityRank < apo.seniorityRank)) continue;
      members.push(apo);
      usedOffices.add(apo.officeKey);
      apoFound = true;
      break;
    }
    if (!apoFound) continue;

    // Pick OPOs from non-gazetted, non-APO-designation pool.
    const opoCandidates = opoPool.filter(function (e) {
      return !used.has(e.personnelKey);
    });
    shuffleInPlace(opoCandidates, randomInt);
    let opoCount = 0;
    for (const opo of opoCandidates) {
      if (opoCount >= opoSlots) break;
      if (usedOffices.has(opo.officeKey)) continue;
      if (postingKey && isMandalBarred(opo, postingKey)) continue;
      if (!(po.seniorityRank < opo.seniorityRank)) continue;
      members.push(opo);
      usedOffices.add(opo.officeKey);
      opoCount += 1;
    }
    if (opoCount < opoSlots) continue;

    members.forEach(function (m) { used.add(m.personnelKey); });
    parties.push({ members: members, posting: posting });
    postingIdx += 1;
  }
  const unassigned = avail.filter(function (e) { return !used.has(e.personnelKey); });
  return { parties: parties, unassigned: unassigned };
}

function formParties(pool, opts) {
  opts = opts || {};
  const partySize = opts.partySize || 6;
  const postings = Array.isArray(opts.postings) ? opts.postings : [];
  const adjacency = opts.adjacency || null; // stage2.adjacency lookup or null
  const randomInt = checkRandomInt(opts.randomInt);
  const maxAttempts = opts.maxAttempts || 50;
  const partiesRequested = opts.partiesRequested || 0;
  const apoDesignation = opts.apoDesignation;

  // --- Near-mandal mode: pick each party's posting FIRST (random among
  // candidates), then fill members that may all serve there. A party's duty
  // mandal must lie in near(work)/near(native) of EVERY member and in none
  // of their own mandals.
  if (adjacency && adjacency.size > 0 && postings.length > 0) {
    return formPartiesNearMandal(pool, partySize, postings, adjacency, randomInt, partiesRequested, maxAttempts);
  }

  let best = { parties: [], unassigned: pool.slice() };
  for (let a = 0; a < maxAttempts; a += 1) {
    const attempt = tryFormOnce(pool, partySize, postings, randomInt, a, apoDesignation);
    if (attempt.parties.length > best.parties.length) best = attempt;
    if (partiesRequested > 0 && attempt.parties.length >= partiesRequested) {
      best = attempt;
      break;
    }
    // When partiesRequested === 0, keep trying all maxAttempts to find the
    // best (most complete) formation; only stop early when everyone is assigned.
    if (partiesRequested === 0 && attempt.unassigned.length === 0) break;
  }
  if (partiesRequested > 0) {
    best.parties = best.parties.slice(0, partiesRequested);
    const usedKeys = new Set();
    best.parties.forEach(function (p) {
      p.members.forEach(function (m) { usedKeys.add(m.personnelKey); });
    });
    best.unassigned = pool.filter(function (e) { return !usedKeys.has(e.personnelKey); });
  }
  return best;
}

function formPartiesWithFallback(pool, opts) {
  // Phase 1: form as many full 6-member (1+5) parties as the rules allow.
  // Phase 2 (only when allowShortageFallback): from the leftover pool, form
  // 5-member (1+4) parties where ONE person carries the merged 3rd+4th duty
  // (MPTC + ZPTC ballot papers, circular p.59). Anyone still unfillable is
  // reported via unassigned — rules are never relaxed to force a party.
  const full = formParties(pool, {
    partySize: 6,
    postings: opts.postings,
    adjacency: opts.adjacency || null,
    randomInt: opts.randomInt,
    maxAttempts: opts.maxAttempts,
    partiesRequested: 0,
  });
  if (!opts.allowShortageFallback) return { full: full, shortage: null };
  const usedKeys = new Set();
  full.parties.forEach(function (p) {
    p.members.forEach(function (m) { usedKeys.add(m.personnelKey); });
  });
  const leftover = pool.filter(function (e) { return !usedKeys.has(e.personnelKey); });
  if (leftover.length === 0) return { full: full, shortage: null };
  const shortage = formParties(leftover, {
    partySize: 5,
    postings: [],
    adjacency: null,
    randomInt: opts.randomInt,
    maxAttempts: opts.maxAttempts,
    partiesRequested: 0,
  });
  return { full: full, shortage: shortage };
}

function buildTeamCode(prefix, electionShort, seq) {
  const n = String(seq).padStart(3, '0');
  return prefix + '-' + electionShort + '-' + n;
}

function electionShortOf(electionConfigurationId) {
  const s = String(electionConfigurationId).replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  return s || 'EC';
}

function roleForSlot(slotIndex, pollingOfficersPerParty) {
  // slotIndex 0 = Presiding Officer (PO, gazetted).
  // slotIndex 1 = Assistant Polling Officer / APO (NON-gazetted School Assistant).
  //   The APO carries the 1st polling post duty; OPOs cover the rest.
  // Shortage 1+4 keeps the 5th duty and merges the 3rd + 4th duties.
  if (slotIndex === 0) return TEAM_ROLES.PRESIDING_OFFICER;
  if (slotIndex === 1) return TEAM_ROLES.ASSISTANT_POLLING_OFFICER;
  if (pollingOfficersPerParty === 4) {
    if (slotIndex === 2) return TEAM_ROLES.POLLING_OFFICER_2;
    if (slotIndex === 3) return TEAM_ROLES.POLLING_OFFICER_3;
    if (slotIndex === 4) return TEAM_ROLES.POLLING_OFFICER_5;
  }
  if (slotIndex === 2) return TEAM_ROLES.POLLING_OFFICER_2;
  if (slotIndex === 3) return TEAM_ROLES.POLLING_OFFICER_3;
  if (slotIndex === 4) return TEAM_ROLES.POLLING_OFFICER_4;
  return TEAM_ROLES.POLLING_OFFICER_5;
}

function dutyForSlot(slotIndex, pollingOfficersPerParty) {
  const duties = require('./stage2.duties');
  if (slotIndex === 0) return duties.PRESIDING_OFFICER_DUTY;
  if (pollingOfficersPerParty === 4) {
    if (slotIndex === 1) return duties.POLLING_OFFICER_DUTIES[1];
    if (slotIndex === 2) return duties.POLLING_OFFICER_DUTIES[2];
    if (slotIndex === 3) return duties.SHORTAGE_MERGED_DUTY_3;
    return duties.POLLING_OFFICER_DUTIES[5];
  }
  return duties.POLLING_OFFICER_DUTIES[slotIndex] || null;
}

function toExcelRows(parties) {
  const rows = [];
  for (const p of parties) {
    p.members.forEach(function (m) {
      rows.push({
        teamCode: p.teamCode,
        mandal: p.postingMandal,
        role: m.role,
        duty: m.duty === undefined ? null : m.duty,
        employeeId: m.personnelId,
        name: m.name,
        designation: m.designation,
        office: m.officeName,
      });
    });
  }
  return rows;
}


/**
 * Near-mandal formation: for each party, cycle shuffled candidate postings and
 * take the first posting with a fillable crew (near-eligible PO + members,
 * distinct offices, PO senior). Whole-run retries keep the best (most
 * parties) attempt. Never relaxes: shortfall -> unassigned.
 */
function formPartiesNearMandal(pool, partySize, postings, adjacency, randomInt, partiesRequested, maxAttempts) {
  const adj = require('./stage2.adjacency');
  let best = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const avail = pool.slice();
    shuffleInPlace(avail, randomInt);
    const postingOrder = postings.slice();
    shuffleInPlace(postingOrder, randomInt);
    const parties = [];
    const used = new Set();
    const wanted = partiesRequested > 0 ? partiesRequested : Number.MAX_SAFE_INTEGER;
    let cursor = 0;
    let idleCycles = 0;
    while (parties.length < wanted) {
      if (avail.every(function (e) { return used.has(e.personnelKey); })) break;
      if (cursor >= postingOrder.length * 6) break; // bounded scan per attempt
      const posting = postingOrder[cursor % postingOrder.length];
      cursor += 1;
      const poCands = avail.filter(function (e) {
        return e.presidingEligible && !used.has(e.personnelKey) &&
          adj.eligiblePostingMandals([e], [posting], adjacency).length > 0;
      });
      if (poCands.length === 0) { idleCycles += 1; continue; }
      shuffleInPlace(poCands, randomInt);
      let placed = false;
      for (const po of poCands) {
        const members = [po];
        const usedOffices = new Set([po.officeKey]);
        const rest = avail.filter(function (e) {
          return !used.has(e.personnelKey) && e.personnelKey !== po.personnelKey &&
            adj.eligiblePostingMandals([e], [posting], adjacency).length > 0;
        });
        shuffleInPlace(rest, randomInt);
        for (const cand of rest) {
          if (members.length >= partySize) break;
          if (usedOffices.has(cand.officeKey)) continue;
          if (!(po.seniorityRank < cand.seniorityRank)) continue;
          members.push(cand);
          usedOffices.add(cand.officeKey);
        }
        if (members.length === partySize && partyIsValid(members)) {
          members.forEach(function (m) { used.add(m.personnelKey); });
          parties.push({ members: members, posting: posting });
          placed = true;
          idleCycles = 0;
          break;
        }
      }
      if (!placed) idleCycles += 1;
      if (idleCycles > postingOrder.length * 2) break;
    }
    const unassigned = avail.filter(function (e) { return !used.has(e.personnelKey); });
    const result = { parties: parties, unassigned: unassigned };
    if (!best || result.parties.length > best.parties.length) best = result;
    if (result.unassigned.length === 0 && !partiesRequested) return result;
    if (partiesRequested && best.parties.length >= partiesRequested) {
      best.parties = best.parties.slice(0, partiesRequested);
      const usedKeys = new Set();
      best.parties.forEach(function (x) { x.members.forEach(function (m) { usedKeys.add(m.personnelKey); }); });
      best.unassigned = pool.filter(function (e) { return !usedKeys.has(e.personnelKey); });
      return best;
    }
  }
  return best || { parties: [], unassigned: pool.slice() };
}

module.exports = {
  formParties: formParties,
  formPartiesWithFallback: formPartiesWithFallback,
  partyIsValid: partyIsValid,
  roleForSlot: roleForSlot,
  dutyForSlot: dutyForSlot,
  buildTeamCode: buildTeamCode,
  electionShortOf: electionShortOf,
  toExcelRows: toExcelRows,
  normalizeMandal: normalizeMandal,
};

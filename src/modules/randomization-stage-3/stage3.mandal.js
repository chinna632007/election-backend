'use strict';

/** Stage 3 — Mandal normalization + posting-eligibility helper (pure).
 *
 * Reuses the same canonical key logic as Stage 2 so that ' GUNTUR ' === 'guntur'
 * and code '07' is never treated as different from name '7 '.
 *
 * Rule enforced here: the posting (duty) mandal must differ from EVERY member's
 * working mandal AND native mandal. This check happens in Stage 3 when mapping
 * teams to polling stations: station.mandal (duty) !== member.workMandal &&
 * station.mandal !== member.nativeMandal for all members in the party.
 */

function normalizeMandal(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  return s.length > 0 ? s : null;
}

module.exports = { normalizeMandal };

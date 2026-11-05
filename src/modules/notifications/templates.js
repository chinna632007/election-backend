'use strict';

/**
 * Notification message templates (pure, reusable across SMS / WhatsApp / email).
 *
 * Content is driven ONLY by the confirmed allocation + authority-supplied
 * config. Nothing official (reporting time, venue, election reference,
 * helpdesk) is invented — those appear only when the caller provides them.
 *
 * Privacy: messages include party members' NAMES and ROLES only. They NEVER
 * include any person's mobile number, Aadhaar number, EPIC/voter id, or any
 * other sensitive field. Each recipient receives their OWN assignment.
 */

/**
 * Build the structured notification payload for one recipient.
 *
 * @param {object} args
 * @param {object} args.recipient  { personnelId, name, role, isMicroObserver }
 * @param {object} args.party      { teamCode, operationalSize, teamSize,
 *                                   postingMandal, members:[{role,name}] }
 * @param {object} args.station    { stationId, stationCode, stationNumber,
 *                                   stationName, building, locality, mandal,
 *                                   district }
 * @param {object} [args.election] { reference, reportingDateTime }
 * @param {object} [args.config]   { reportingInstructions, helpdeskContact,
 *                                   officialNotice }
 * @returns {{ subject, lines, whatsapp, email:{subject,body}, sms, meta }}
 */
function buildNotification(args) {
  const r = (args && args.recipient) || {};
  const party = (args && args.party) || {};
  const station = (args && args.station) || {};
  const election = (args && args.election) || {};
  const config = (args && args.config) || {};

  const partyCode = party.teamCode || '(party code unavailable)';
  const recipientName = r.name || 'Officer';
  const recipientRole = r.role || 'Polling Party Member';

  // --- Section A: election + assignment ------------------------------------
  const assignment = [];
  if (election.reference) assignment.push('Election: ' + election.reference);
  assignment.push('Polling Party: ' + partyCode);
  const stationLabel = [station.stationNumber, station.stationName]
    .filter(function (v) { return v; }).join(' - ');
  assignment.push('Polling Station: ' + (stationLabel || station.stationId || '(station TBC)'));
  const addr = [station.building, station.locality, station.mandal, station.district]
    .filter(function (v) { return v; }).join(', ');
  if (addr) assignment.push('Location: ' + addr);
  if (election.reportingDateTime) assignment.push('Report at: ' + election.reportingDateTime);

  // --- Section B: party structure ------------------------------------------
  // Role counts exclude the Micro Observer from the operational tally but
  // still list it as a party role.
  const roleCounts = {};
  (party.members || []).forEach(function (m) {
    roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
  });
  const structure = [];
  structure.push('Party size: ' + (party.teamSize || (party.members || []).length) +
    ' (incl. Micro Observer)');
  if (party.operationalSize) {
    structure.push('Operational members: ' + party.operationalSize);
  }
  Object.keys(roleCounts).forEach(function (role) {
    structure.push('  ' + role + ': ' + roleCounts[role]);
  });
  structure.push('Your role: ' + recipientRole);
  // Fellow members: names + roles ONLY (no contacts / sensitive data).
  const mates = (party.members || [])
    .filter(function (m) { return String(m.personnelId) !== String(r.personnelId); })
    .map(function (m) { return m.name + ' (' + m.role + ')'; });
  if (mates.length > 0) structure.push('Party members: ' + mates.join('; '));

  // --- Section C: instructions ---------------------------------------------
  const instructions = [];
  if (config.reportingInstructions) instructions.push(config.reportingInstructions);
  if (config.helpdeskContact) instructions.push('Helpdesk: ' + config.helpdeskContact);
  instructions.push(config.officialNotice ||
    'This allocation is official only after authorized confirmation by the election authority.');

  const lines = [
    'Dear ' + recipientName + ',',
    '',
    'You have been assigned polling duty.',
    '',
  ].concat(assignment).concat(['']).concat(structure).concat(['']).concat(instructions);

  const subject = 'Polling Duty Assignment - Party ' + partyCode +
    ' - Station ' + (station.stationNumber || station.stationId || 'TBC');

  const fullText = lines.join('\n');

  return {
    subject: subject,
    lines: lines,
    text: fullText,
    email: { subject: subject, body: fullText },
    // SMS is the full text; callers apply provider length/segment rules.
    sms: fullText,
    meta: {
      partyCode: partyCode,
      recipientPersonnelId: r.personnelId,
      role: recipientRole,
      isMicroObserver: !!r.isMicroObserver,
      stationId: station.stationId,
      stationCode: station.stationCode,
    },
  };
}

/** Rough GSM-7 SMS segment split (160 chars single / 153 concatenated). */
function smsSegments(text) {
  const len = String(text || '').length;
  if (len <= 160) return 1;
  return Math.ceil(len / 153);
}

module.exports = {
  buildNotification: buildNotification,
  smsSegments: smsSegments,
};

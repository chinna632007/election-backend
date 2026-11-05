'use strict';

/**
 * Stage 2 — circular duty descriptions for numbered Polling Officer roles.
 *
 * Verbatim source: APSEC Circular No.121/SEC-B1/2026 dated 27.03.2026,
 * p.59 "Their duties in brief are given below" (OCR-verified 2026-10-13
 * in this task; OCR normalises "%/°/"" artefacts to 1st..5th):
 *  1st Polling Officer — "Incharge of identification of electors and
 *    Marked copy of Electoral Roll";
 *  2nd Polling Officer — "Responsible for application of Indelible Ink";
 *  3rd Polling Officer — "Incharge of MPTC Ballot Papers";
 *  4th Polling Officer — "Incharge of ZPTC Ballot Papers";
 *  5th Polling Officer — "Incharge of Arrow Cross Mark Rubber Stamps. He
 *    will take first vertically(?) papers. He will first fold the MPTC
 *    ballot paper first vertically and then horizontally and thereafter
 *    unfold & hand it over to the voter to enable him to vote. After the
 *    voter has proceeded to the voting compartment and while he is
 *    recording his vote, the 5th Polling Officer will fold the ZPTC ballot
 *    paper and hand over to the voter to enable him to proceed to another
 *    voting compartment to record his vote on the ZPTC ballot paper. Both
 *    the ballot papers will be dropped in the same ballot box by the voter."
 *    (Fold/sequence wording condensed from the OCR; ballot-paper + stamp
 *    responsibility kept verbatim in meaning; no duty invented.)
 * Shortage 1+4 (same page): "the duties entrusted to 3rd and 4th Polling
 *  Officers may be merged, i.e., the MPTC Ballot Papers and ZPTC Ballot
 *  Papers shall be taken care of by the 3rd Polling Officer."
 *
 * Presiding Officer: NO duty description on the verified pages — recorded
 * as null with presidingDutyNeedsConfirmation: true.
 */

const POLLING_OFFICER_DUTIES = Object.freeze({
  1: 'Incharge of identification of electors and Marked copy of Electoral Roll.',
  2: 'Responsible for application of Indelible Ink.',
  3: 'Incharge of MPTC Ballot Papers.',
  4: 'Incharge of ZPTC Ballot Papers.',
  5: 'Incharge of Arrow Cross Mark Rubber Stamps; folds the MPTC ballot paper '
    + 'first vertically and then horizontally, unfolds and hands it to the voter; '
    + 'while the voter records that vote, folds the ZPTC ballot paper and hands it '
    + 'over for the second voting compartment; both ballot papers are dropped in '
    + 'the same ballot box by the voter.',
});

const SHORTAGE_MERGED_DUTY_3 = 'Incharge of MPTC Ballot Papers and ZPTC Ballot Papers '
  + '(merged 3rd + 4th Polling Officer duties for 1+4 shortage party).';

const PRESIDING_OFFICER_DUTY = null;
const PRESIDING_DUTY_NEEDS_CONFIRMATION = true;

module.exports = {
  POLLING_OFFICER_DUTIES: POLLING_OFFICER_DUTIES,
  SHORTAGE_MERGED_DUTY_3: SHORTAGE_MERGED_DUTY_3,
  PRESIDING_OFFICER_DUTY: PRESIDING_OFFICER_DUTY,
  PRESIDING_DUTY_NEEDS_CONFIRMATION: PRESIDING_DUTY_NEEDS_CONFIRMATION,
};

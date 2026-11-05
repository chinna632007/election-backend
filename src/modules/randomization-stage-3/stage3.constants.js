'use strict';

/**
 * Stage 3 — approved constants and their sources.
 *
 * Source legend:
 *  [O] Official — APSEC circular, pages 62–63 + Annexure III pp.78–81 (text
 *      supplied by the district authority; the source PDF is scanned, so these
 *      restate the authority-confirmed transcription, NOT an OCR guess).
 *  [P] Proposed — Stage 3 implementation proposal, NOT an official rule. Team
 *      must ratify.
 *  [U] Unresolved — official source silent or not re-verified; the module fails
 *      closed instead of guessing.
 *
 * What Stage 3 does [O] (circular p.62 + Annexure III p.80):
 *  - Third randomization maps ALREADY-FORMED polling parties (Stage 2 output)
 *    to polling stations.
 *  - Done on the day before polling; the mapping must stay CONFIDENTIAL until
 *    it is displayed publicly before polling ("no candidate knows which polling
 *    party is allotted to which polling station until the allocation is
 *    displayed publicly before polling").
 *  - Software sequence (Annexure III p.80): (1) select required fields,
 *    (2) "Team Size Mapping with PS's" assigns the team size for each polling
 *    station going to polls, (3) save the mapping, (4) "Mapping Teams with
 *    Polling Stations" randomly maps polling stations to the generated teams.
 *
 * Join key [P]: Stage 3 consumes Stage 2 by `teamCode` (documented in
 * stage2.constants.js as the intended join key). teamCode format itself is
 * [P]; Stage 3 treats it as an opaque unique string and never parses it.
 */

const STAGE_NUMBER = 3;

/** [O] One polling party is allotted to one polling station (p.2/p.62). */
const PARTIES_PER_STATION = 1;

/** [P] Mapping cardinality policy. 1:1 is the only approved mode; the module
 *  refuses any other value rather than inventing surplus/deficit handling. */
const MAPPING_MODE = Object.freeze({
  ONE_TO_ONE: 'one_to_one',
});

/**
 * [O] Confidentiality lifecycle (circular p.62). A mapping run is created in
 * the CONFIDENTIAL state and may be revealed publicly only by an explicit,
 * authorized publish action. Auto-reveal is never performed.
 */
const PUBLICATION_STATUS = Object.freeze({
  CONFIDENTIAL: 'confidential',
  PUBLISHED: 'published',
});

/** [P] Stage 3 run outcome — never claim complete when mapping is incomplete. */
const STAGE3_STATUS = Object.freeze({
  COMPLETED: 'completed',
  INCOMPLETE: 'incomplete',
});

/**
 * [U] Polling-station master data and its source are NOT established by the
 * circular text. Stations are accepted as caller-supplied records here; the
 * real source (master-data table, another import, election config) must be
 * ratified before this module touches a database.
 */
const STATION_DATA_SOURCE = Object.freeze({
  POLICY: 'caller_supplied_pending_ratification',
});

module.exports = {
  STAGE_NUMBER,
  PARTIES_PER_STATION,
  MAPPING_MODE,
  PUBLICATION_STATUS,
  STAGE3_STATUS,
  STATION_DATA_SOURCE,
};

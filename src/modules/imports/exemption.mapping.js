'use strict';

/**
 * Import-time exemption resolution — grounded in APSEC circular p.61
 * "Exempted Categories: (a)(i)-(viii)" (official text supplied by the
 * District Election Authority; see the exemption section).
 *
 * What this module resolves automatically (sheet Department + row
 * Designation — the only two signals the proforma carries):
 *  (i)   Veterinary hospitals: Doctors and Compounders. A designation
 *        containing "veterinary" carries its own context; a bare
 *        "Compounder" counts only on a veterinary sheet (Health-Department
 *        compounders are NOT listed in (ii)).
 *  (ii)  Health Department: Doctors, Nurses, ANMs. BOTH signals required —
 *        a "Doctor" elsewhere (Railways, ESI, private) is NOT exempt, and a
 *        "Clerk" on a Health sheet is NOT exempt. NOTE: this needs the new
 *        HEALTH_MEDICAL category (doctors were missing from the enum).
 *  (iii) Ayush Department: Ayurvedic / Unani / Homeopathic Medical Officers.
 *        A designation stating the system (BAMS/BHMS/BUMS, Ayurvedic, Unani,
 *        Homeopathic) carries its own context; a bare "Medical Officer" or
 *        "Doctor" counts only on an Ayush sheet.
 *  (iv)  All India Radio — the whole sheet (circular exempts the STAFF).
 *  (v)   Doordarshan — the whole sheet.
 *  (vi)  BSNL/MTNL operational technical staff. Soft rule: the circular says
 *        "only in unavoidable circumstances" (not a blanket ban), so these
 *        are marked exempt by default and the authority may override later.
 *
 * Deliberately NOT auto-exempt (data absent — marked pending instead):
 *  (vii) Rural single-officer bank branches: the sheet carries neither the
 *        posting location nor the branch staffing, so bank postings resolve to
 *        pending_authority_confirmation via the overridable BANK_REVIEW
 *        patterns. The authority resolves each one to an official category or
 *        clears it; Stage 1 finalizes nothing until then.
 *  (viii) Pregnancy / breastfeeding / medical unfitness: personal medical
 *        status, not present in any spreadsheet. Set only through the
 *        authorized personnel-exemption endpoint (audit-logged), never by
 *        import matching.
 *
 * resolveExemption(departmentName, designation, opts?) ->
 *   { category, rule } | null
 * `category` matches the EXEMPT_CATEGORY string values (or the procedural
 * pending marker) so Stage 1's filter works without any change.
 * opts.bankReview overrides BANK_REVIEW for tests / confirmed criteria.
 */

const DEPT = {
  VETERINARY: /veterin/i,
  HEALTH: /health/i,
  AYUSH: /ayush|ayurved|unani|homeopath/i,
  AIR: /all\s*india\s*radio|\bair\b|prasar\s*bharati/i,
  DOORDARSHAN: /doordarshan/i,
  BSNL: /\bbsnl\b|\bmtnl\b/i,
  BANK: /\bbank\b|\bsbi\b|canara|union\s*bank|bank\s*of|andhra\s*bank/i,
};

/**
 * [P] Bank review patterns (circular p.61(a)(vii)): personnel whose bank
 * posting matches these signals need rural/single-officer-branch criteria the
 * sheet does not carry, so they are marked pending_authority_confirmation —
 * never silently eligible, never silently exempt.
 *
 * Frozen (accidental tightening/loosening is a policy change); callers needing
 * different matchers (tests, future authority-confirmed criteria) pass them
 * via resolveExemption(dept, desig, { bankReview }). The official decision
 * criteria themselves stay unresolved — see the module docblock.
 */
const BANK_REVIEW = Object.freeze({
  department: DEPT.BANK,
  designation: /\bbank\b|bank\s*(officer|clerk|manager|cashier)|cashier|\bpo\b.*bank/i,
  employmentSector: /\bbank\b/i,
});

const MASKED_MEDICAL_CATEGORIES = Object.freeze(['pregnant', 'breastfeeding']);

/**
 * Project personnel.exempt_category for ordinary read responses.
 * Personal medical categories are masked to the generic 'exempt' so medical
 * status is never exposed outside the authorized marking workflow. All other
 * stored values (official categories, pending marker, null) pass through.
 */
function maskExemptCategory(value) {
  if (MASKED_MEDICAL_CATEGORIES.includes(value)) return 'exempt';
  return value;
}

const DESIG = {
  VETERINARY: /veterin/i,
  COMPOUNDER: /compound/i,
  HEALTH_CLINICAL: /doctor|medical\s*officer|\bnurse\b|\banm\b/i,
  AYUSH_EXPLICIT: /ayurved|unani|homeopath|\bbams\b|\bbhms\b|\bbums\b/i,
  MEDICAL_OFFICER: /medical\s*officer|\bdoctor\b/i,
  BSNL_TECH: /telecom|technician|mechanic|electrician|operator|installer|lineman|wireman|\bjto\b|\bsdo\b/i,
};

function has(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function resolveExemption(departmentName, designation, opts) {
  const dept = has(departmentName, /.+/s) ? departmentName : '';
  const desig = designation || '';
  const sector = (opts && opts.employmentSector) || '';
  const review = (opts && opts.bankReview) || BANK_REVIEW;

  // (i) Veterinary hospitals.
  if (has(desig, DESIG.VETERINARY)) {
    return { category: 'veterinary_staff', rule: 'p61(i)-designation' };
  }
  if (has(desig, DESIG.COMPOUNDER) && has(dept, DEPT.VETERINARY)) {
    return { category: 'veterinary_staff', rule: 'p61(i)-compounder' };
  }

  // (iv) All India Radio, (v) Doordarshan — whole-sheet exemptions.
  if (has(dept, DEPT.AIR)) {
    return { category: 'all_india_radio', rule: 'p61(iv)-department' };
  }
  if (has(dept, DEPT.DOORDARSHAN)) {
    return { category: 'doordarshan', rule: 'p61(v)-department' };
  }

  // (ii) Health Department clinical staff — designation AND department.
  if (has(desig, DESIG.HEALTH_CLINICAL) && has(dept, DEPT.HEALTH)) {
    if (/nurse|\banm\b/i.test(desig)) {
      return { category: 'nurse_anm', rule: 'p61(ii)-health' };
    }
    return { category: 'health_medical', rule: 'p61(ii)-health' };
  }

  // (iii) Ayush medical officers.
  if (has(desig, DESIG.AYUSH_EXPLICIT)) {
    return { category: 'ayush_medical', rule: 'p61(iii)-designation' };
  }
  if (has(desig, DESIG.MEDICAL_OFFICER) && has(dept, DEPT.AYUSH)) {
    return { category: 'ayush_medical', rule: 'p61(iii)-department' };
  }

  // (vi) BSNL/MTNL operational-technical staff (soft: mark exempt by default).
  if (has(dept, DEPT.BSNL) && has(desig, DESIG.BSNL_TECH)) {
    return { category: 'bsnl_mtnl_ops', rule: 'p61(vi)-technical' };
  }

  // (vii) Bank postings with unverifiable rural/single-officer criteria:
  // pending, never auto-exempt, never silently eligible. Runs AFTER the
  // genuine exemptions above so a bank-sheet doctor stays a doctor.
  if (
    has(dept, review.department) ||
    has(desig, review.designation) ||
    has(sector, review.employmentSector)
  ) {
    return { category: 'pending_authority_confirmation', rule: 'p61(vii)-pending-review' };
  }

  return null;
}

module.exports = { resolveExemption, maskExemptCategory, BANK_REVIEW, MASKED_MEDICAL_CATEGORIES, DEPT, DESIG };

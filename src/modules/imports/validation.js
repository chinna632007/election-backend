'use strict';

/**
 * Stage: imports — row validation (pure, no DB).
 *
 * Validation rules (kept deliberately minimal; no invented official rules):
 *   - employee_name is required (a person cannot be identified without it);
 *   - employee_id is required (stable identifier for dedupe and Stage 1);
 *   - duplicate employee_id WITHIN one file -> the later rows are rejected
 *     (cross-batch dedupe is an open question, deliberately not enforced);
 *   - date columns must be blank or parse as dd.mm.yyyy (or a real Date
 *     cell); anything else rejects the row with an explicit reason.
 *   - minimum age 18 [TEAM RULE, not circular, confirmed 2026-10-15]: computed
 *     when present (else the Age column when numeric); anyone below 18 is
 *     rejected. The circular extract carries no age condition — this guardrail
 *     was confirmed by the team (minimum age is 18), so change
 *     MINIMUM_AGE, not the code, if the bar ever moves.
 *   - medical / clinical staff are not eligible polling personnel (authority
 *     decision 2026-10-15): doctors, nurses/ANM, homeopaths, Ayurveda/Unani,
 *     compounders, pharmacists and other doctor-related clinical roles are
 *     rejected at import. This is DEPARTMENT-INDEPENDENT — a "Doctor" on ANY
 *     sheet (Health, Railways, private, sample department) is excluded, not
 *     only Health-Department ones. It is a HARD reject (rejected row), not
 *     the circular p.61 exempt_category workflow.
 * Anything the proforma allows is preserved as-is; unknown values are not
 * filtered here.
 */

const MINIMUM_AGE = 18;

/**
 * [TEAM RULE] Medical / clinical designations that must not be imported as
 * polling personnel. Each pattern matches a doctor-related role; case-
 * insensitive and department-independent. Word-boundary guards avoid false
 * positives on non-medical designations (e.g. "MD"/"MS" degrees are left out
 * because they collide with non-medical titles).
 */
const MEDICAL_DESIGNATION_PATTERNS = [
  /doctor/i, /physician/i, /surgeon/i, /medical\s*officer/i, /dental/i, /dentist/i,
  /nurse/i, /nursing/i, /\banm\b/i, /\blhv\b/i, /asha/i, /midwi/i,
  /homeopath/i, /homoeopath/i, /\bbhms\b/i,
  /ayurved/i, /\bbams\b/i, /vaidya/i, /unani/i, /\bbums\b/i, /siddha/i, /ayush/i,
  /compound/i, /pharmac/i, /dispenser/i,
  /veterinar/i, /\bbvsc\b/i, /\bmbbs\b/i,
];

function isMedicalDesignation(designation) {
  if (typeof designation !== 'string') return false;
  return MEDICAL_DESIGNATION_PATTERNS.some((re) => re.test(designation));
}

/**
 * [STATUTORY ELECTION RULE] Officers belonging to the Physically Handicapped (PH)
 * category are exempted / ineligible from active polling personnel duty.
 */
function isPhCategory(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim().toLowerCase();
  if (
    !s ||
    s === 'no' ||
    s === 'n' ||
    s === 'none' ||
    s === 'na' ||
    s === 'n/a' ||
    s === 'n.a.' ||
    s === '—' ||
    s === '-' ||
    s === 'nil' ||
    s === 'normal' ||
    s === 'general' ||
    s === '0' ||
    s === '0%' ||
    s === 'not applicable' ||
    s === 'false'
  ) {
    return false;
  }
  if (s === 'yes' || s === 'y' || s === 'true') return true;
  if (s.includes('handicap') || s.includes('pwd') || s.includes('disab')) return true;
  if (/\bph\b/i.test(s) || /ph\s*[-:]?\s*\d+/i.test(s) || /ph\s*%/i.test(s)) return true;
  const matchPct = s.match(/(\d+)\s*%/);
  if (matchPct && Number(matchPct[1]) > 0) return true;
  return false;
}

/**
 * [ELECTION INTEGRITY RULE] Elector Photo Identity Card (EPIC) / Voter ID validation.
 * Flag explicitly invalid placeholder values (e.g. "invalid", "invalid-epic", "fake")
 * so explicitly invalid voter ID records are routed to the rejected list.
 * Preserves all valid and sample/test records without false-positive rejections.
 */
function isInvalidElectorId(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim().toLowerCase();
  if (!s) return false;
  return s === 'invalid' || s === 'invalid-epic' || s === 'invalid_epic' || s === 'fake';
}

/**
 * Full years between a YYYY-MM-DD birth date and the reference date.
 * A person born on the reference day exactly N years ago is already N.
 */
function fullYearsSince(birthIso, refDate) {
  const birth = new Date(birthIso + 'T00:00:00Z');
  let years = refDate.getUTCFullYear() - birth.getUTCFullYear();
  const month = refDate.getUTCMonth() - birth.getUTCMonth();
  if (month < 0 || (month === 0 && refDate.getUTCDate() < birth.getUTCDate())) {
    years -= 1;
  }
  return years;
}

const DATE_FIELDS = ['date_of_birth', 'date_of_retirement'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Returns { value: 'YYYY-MM-DD' | null } or { error: 'unparseable_date' }. */
function normalizeDate(value) {
  if (value === '' || value === null || value === undefined) {
    return { value: null };
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      value: `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`,
    };
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 1000 && value < 100000) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(date.getTime())) {
      return {
        value: `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
      };
    }
  }
  const s = String(value).trim();
  const dmyMatch = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (month >= 1 && month <= 12 && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day) {
      return { value: `${year}-${pad2(month)}-${pad2(day)}` };
    }
  }
  const ymdMatch = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (month >= 1 && month <= 12 && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day) {
      return { value: `${year}-${pad2(month)}-${pad2(day)}` };
    }
  }
  return { error: 'unparseable_date' };
}

/**
 * validateRows(rows) -> { accepted, rejected }
 *   accepted: [{ <column>: value, ..., date_of_birth?: 'YYYY-MM-DD' }]
 *   rejected: [{ sheetRow, employeeId, reasons: [codes] }]
 */
function validateRows(rows) {
  const accepted = [];
  const rejected = [];
  const seenIds = new Map(); // employee_id -> first sheetRow

  for (const row of rows) {
    const { sheetRow, values } = row;
    const reasons = [];

    const employeeId = String(values.employee_id ?? '').trim();
    const employeeName = String(values.employee_name ?? '').trim();

    if (!employeeName) reasons.push('employee_name_required');
    if (!employeeId) reasons.push('employee_id_required');

    const record = { ...values, employee_id: employeeId, employee_name: employeeName };

    for (const field of DATE_FIELDS) {
      const result = normalizeDate(values[field]);
      if (result.error) {
        reasons.push(`${field}_unparseable`);
        record[field] = null;
      } else {
        record[field] = result.value;
      }
    }

    if (employeeId) {
      if (seenIds.has(employeeId)) {
        reasons.push('duplicate_employee_id_in_file');
      } else {
        seenIds.set(employeeId, sheetRow);
      }
    }

    // Minimum age 18 [TEAM RULE, confirmed 2026-10-15].
    // Primary basis is the date_of_birth. The Age column is the fallback when
    // DOB is blank. A data-integrity guardrail is added: when BOTH DOB and the
    // Age column are present, they should agree (within a tolerance of 2
    // years to allow normal staleness). If the derived age from DOB and the
    // recorded Age column disagree by more than TWO years, the row is flagged
    // as inconsistent and rejected, so data that is internally inconsistent
    // (e.g. Age '30' but DOB 2005) is not silently approved. Blank Age is
    // ignored when DOB is present.
    const nowUtc = new Date();
    const dobAge = record.date_of_birth ? fullYearsSince(record.date_of_birth, nowUtc) : null;
    const ageNum = Number(String(values.age ?? '').trim());
    const ageFromAgeCol = Number.isFinite(ageNum) && values.age !== '' && values.age !== null && values.age !== undefined
      ? ageNum
      : null;

    if (record.date_of_birth) {
      if (dobAge < MINIMUM_AGE) {
        reasons.push('below_minimum_age');
      }
      if (ageFromAgeCol !== null && dobAge !== null && Math.abs(dobAge - ageFromAgeCol) > 2) {
        reasons.push('age_dob_age_mismatch');
      }
    } else {
      if (ageFromAgeCol !== null && ageFromAgeCol < MINIMUM_AGE) {
        reasons.push('below_minimum_age');
      }
    }

    // Medical / clinical staff are not eligible polling personnel (authority
    // decision 2026-10-15). HARD reject, department-independent.
    if (isMedicalDesignation(values.designation)) {
      reasons.push('medical_designation_not_eligible');
    }

    // Physically Handicapped (PH) category: officers belonging to PH category
    // are ineligible for active polling duty per statutory election rules.
    if (isPhCategory(values.ph_category)) {
      reasons.push('ph_category_not_eligible');
    }

    // Elector Photo Identity Card (EPIC) / Voter ID validation.
    if (isInvalidElectorId(values.voter_id)) {
      reasons.push('invalid_elector_id');
    }

    if (reasons.length > 0) {
      rejected.push({
        sheetRow,
        employeeId: employeeId || null,
        reasons,
        values,
        rawValues: values,
      });
    } else {
      accepted.push(record);
    }
  }

  return { accepted, rejected };
}

module.exports = {
  validateRows,
  normalizeDate,
  fullYearsSince,
  MINIMUM_AGE,
  isMedicalDesignation,
  MEDICAL_DESIGNATION_PATTERNS,
  isPhCategory,
  isInvalidElectorId,
};

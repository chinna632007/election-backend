'use strict';

/**
 * Stage 2 module errors.
 * Mirrors the Stage 1 pattern: statusCode + code + safe public message.
 * Never include SQL, stack traces, tokens, Aadhaar or mobile numbers.
 */

class Stage2Error extends Error {
  constructor(message, { statusCode = 500, code = 'STAGE2_ERROR', details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Malformed or invalid input. */
class Stage2ValidationError extends Stage2Error {
  constructor(message, details = null) {
    super(message, { statusCode: 400, code: 'STAGE2_VALIDATION_ERROR', details });
  }
}

/** Caller may not act on this election configuration / district. */
class Stage2AuthorizationError extends Stage2Error {
  constructor(message = 'Not authorized to perform this operation.') {
    super(message, { statusCode: 403, code: 'STAGE2_AUTHORIZATION_ERROR' });
  }
}

/** Referenced Stage 1 run not found (or outside caller scope). */
class Stage2NotFoundError extends Stage2Error {
  constructor(message = 'Stage 1 run not found.') {
    super(message, { statusCode: 404, code: 'STAGE2_NOT_FOUND' });
  }
}

/** Prerequisites (completed Stage 1 run, pool, posting mandals) not met. */
class Stage2PrerequisiteError extends Stage2Error {
  constructor(message, details = null) {
    super(message, { statusCode: 422, code: 'STAGE2_PREREQUISITE_ERROR', details });
  }
}

/**
 * A required policy has no approved value (e.g. seniority/PO-eligibility
 * mapping, shortage authorisation). Fail closed, never guess.
 */
class Stage2UnresolvedRuleError extends Stage2Error {
  constructor(message, details = null) {
    super(message, { statusCode: 422, code: 'STAGE2_UNRESOLVED_RULE', details });
  }
}

/** Eligible personnel cannot satisfy the requested parties under the rules. */
class Stage2InsufficientPersonnelError extends Stage2Error {
  constructor(message, details = null) {
    super(message, { statusCode: 422, code: 'STAGE2_INSUFFICIENT_PERSONNEL', details });
  }
}

/** A conflicting Stage 2 run already exists for this Stage 1 run. */
class Stage2ConflictError extends Stage2Error {
  constructor(message, details = null) {
    super(message, { statusCode: 409, code: 'STAGE2_CONFLICT', details });
  }
}

/** A result invariant failed before completion; nothing saved as completed. */
class Stage2ResultInvalidError extends Stage2Error {
  constructor(message, details = null) {
    super(message, { statusCode: 500, code: 'STAGE2_RESULT_INVALID', details });
  }
}

/** Transaction/persistence failure; the run was rolled back. */
class Stage2PersistenceError extends Stage2Error {
  constructor(message = 'Failed to persist Stage 2 run.', details = null) {
    super(message, { statusCode: 500, code: 'STAGE2_PERSISTENCE_ERROR', details });
  }
}

/** Audit write failed. Reported honestly; never silently swallowed. */
class Stage2AuditError extends Stage2Error {
  constructor(message = 'Failed to record audit event.', details = null) {
    super(message, { statusCode: 500, code: 'STAGE2_AUDIT_ERROR' });
  }
}

module.exports = {
  Stage2Error,
  Stage2ValidationError,
  Stage2AuthorizationError,
  Stage2NotFoundError,
  Stage2PrerequisiteError,
  Stage2UnresolvedRuleError,
  Stage2InsufficientPersonnelError,
  Stage2ConflictError,
  Stage2ResultInvalidError,
  Stage2PersistenceError,
  Stage2AuditError,
};

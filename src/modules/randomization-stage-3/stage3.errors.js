'use strict';

/**
 * Stage 3 module errors.
 * Mirrors the Stage 1 / Stage 2 pattern: statusCode + code + safe public
 * message. Never include SQL, stack traces, tokens, Aadhaar or mobile numbers.
 */

class Stage3Error extends Error {
  constructor(message, { statusCode = 500, code = 'STAGE3_ERROR', details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Malformed or invalid input. */
class Stage3ValidationError extends Stage3Error {
  constructor(message, details = null) {
    super(message, { statusCode: 400, code: 'STAGE3_VALIDATION_ERROR', details });
  }
}

/** Caller may not act on this election configuration / district. */
class Stage3AuthorizationError extends Stage3Error {
  constructor(message = 'Not authorized to perform this operation.') {
    super(message, { statusCode: 403, code: 'STAGE3_AUTHORIZATION_ERROR' });
  }
}

/** Referenced Stage 2 run not found (or outside caller scope). */
class Stage3NotFoundError extends Stage3Error {
  constructor(message = 'Stage 2 run not found.') {
    super(message, { statusCode: 404, code: 'STAGE3_NOT_FOUND' });
  }
}

/** Prerequisites (completed Stage 2 run, formed parties, stations) not met. */
class Stage3PrerequisiteError extends Stage3Error {
  constructor(message, details = null) {
    super(message, { statusCode: 422, code: 'STAGE3_PREREQUISITE_ERROR', details });
  }
}

/**
 * A required policy has no approved value (e.g. surplus/deficit handling,
 * team-size↔station matching, who may publish). Fail closed, never guess.
 */
class Stage3UnresolvedRuleError extends Stage3Error {
  constructor(message, details = null) {
    super(message, { statusCode: 422, code: 'STAGE3_UNRESOLVED_RULE', details });
  }
}

/** A conflicting Stage 3 run already exists for this Stage 2 run. */
class Stage3ConflictError extends Stage3Error {
  constructor(message, details = null) {
    super(message, { statusCode: 409, code: 'STAGE3_CONFLICT', details });
  }
}

/** A result invariant failed before completion; nothing saved as completed. */
class Stage3ResultInvalidError extends Stage3Error {
  constructor(message, details = null) {
    super(message, { statusCode: 500, code: 'STAGE3_RESULT_INVALID', details });
  }
}

/** Transaction/persistence failure; the run was rolled back. */
class Stage3PersistenceError extends Stage3Error {
  constructor(message = 'Failed to persist Stage 3 run.', details = null) {
    super(message, { statusCode: 500, code: 'STAGE3_PERSISTENCE_ERROR', details });
  }
}

/** Audit write failed. Reported honestly; never silently swallowed. */
class Stage3AuditError extends Stage3Error {
  constructor(message = 'Failed to record audit event.', details = null) {
    super(message, { statusCode: 500, code: 'STAGE3_AUDIT_ERROR', details });
  }
}

module.exports = {
  Stage3Error,
  Stage3ValidationError,
  Stage3AuthorizationError,
  Stage3NotFoundError,
  Stage3PrerequisiteError,
  Stage3UnresolvedRuleError,
  Stage3ConflictError,
  Stage3ResultInvalidError,
  Stage3PersistenceError,
  Stage3AuditError,
};

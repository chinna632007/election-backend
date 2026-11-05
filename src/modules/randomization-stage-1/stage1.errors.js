'use strict';

/**
 * Stage 1 module errors.
 *
 * These follow the pattern of a statusCode + code + safe public message so a
 * centralized error handler (once the shared middleware exists) can map them
 * without leaking internals. Messages are written for authorized district
 * clients; they never include SQL, stack traces, or tokens.
 */

class Stage1Error extends Error {
  constructor(message, { statusCode = 500, code = 'STAGE1_ERROR', details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Malformed or invalid request input. */
class Stage1ValidationError extends Stage1Error {
  constructor(message, details = null) {
    super(message, { statusCode: 400, code: 'STAGE1_VALIDATION_ERROR', details });
  }
}

/** The authenticated user may not act on this election configuration/district. */
class Stage1AuthorizationError extends Stage1Error {
  constructor(message = 'Not authorized to perform this operation.') {
    super(message, { statusCode: 403, code: 'STAGE1_AUTHORIZATION_ERROR' });
  }
}

/** A referenced Stage 1 run does not exist (or is outside the caller's scope). */
class Stage1NotFoundError extends Stage1Error {
  constructor(message = 'Stage 1 run not found.') {
    super(message, { statusCode: 404, code: 'STAGE1_NOT_FOUND' });
  }
}

/** Prerequisites (configuration, status, master data, imports) are not satisfied. */
class Stage1PrerequisiteError extends Stage1Error {
  constructor(message, details = null) {
    super(message, { statusCode: 422, code: 'STAGE1_PREREQUISITE_ERROR', details });
  }
}

/**
 * A required business rule has no approved value (e.g. rounding rule not
 * ratified by the team). The module refuses to guess and fails closed.
 */
class Stage1UnresolvedRuleError extends Stage1Error {
  constructor(message, details = null) {
    super(message, { statusCode: 422, code: 'STAGE1_UNRESOLVED_RULE', details });
  }
}

/** Eligible personnel are fewer than the computed pool size. */
class Stage1InsufficientPersonnelError extends Stage1Error {
  constructor(message, details = null) {
    super(message, { statusCode: 422, code: 'STAGE1_INSUFFICIENT_PERSONNEL', details });
  }
}

/** Conflicting run exists (duplicate execution, supersession rules, etc.). */
class Stage1ConflictError extends Stage1Error {
  constructor(message, details = null) {
    super(message, { statusCode: 409, code: 'STAGE1_CONFLICT', details });
  }
}

/** A result invariant failed before persistence; nothing was saved as completed. */
class Stage1ResultInvalidError extends Stage1Error {
  constructor(message, details = null) {
    super(message, { statusCode: 500, code: 'STAGE1_RESULT_INVALID', details });
  }
}

/** Persistence failure; compensation was attempted for any partial run. */
class Stage1PersistenceError extends Stage1Error {
  constructor(message = 'Failed to persist Stage 1 run.', details = null) {
    super(message, { statusCode: 500, code: 'STAGE1_PERSISTENCE_ERROR', details });
  }
}

/** Audit write failed. Reported honestly; never silently swallowed. */
class Stage1AuditError extends Stage1Error {
  constructor(message = 'Failed to record audit event.', details = null) {
    super(message, { statusCode: 500, code: 'STAGE1_AUDIT_ERROR', details });
  }
}

module.exports = {
  Stage1Error,
  Stage1ValidationError,
  Stage1AuthorizationError,
  Stage1NotFoundError,
  Stage1PrerequisiteError,
  Stage1UnresolvedRuleError,
  Stage1InsufficientPersonnelError,
  Stage1ConflictError,
  Stage1ResultInvalidError,
  Stage1PersistenceError,
  Stage1AuditError,
};

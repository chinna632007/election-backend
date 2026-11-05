function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }
  next();
}

/**
 * Role-based authorization, fail-closed.
 *
 * Usage: authorize('authority', 'admin')
 *
 * Behavior:
 *   - Unauthenticated (no session user) -> 401, the SAME response as requireAuth.
 *   - Authenticated but role missing or not in the allowed set -> 403.
 *   - Otherwise -> next().
 *
 * Misconfiguration is caught at setup time (when routes are defined), not at
 * request time, mirroring the Stage 1 fail-closed router factory: calling
 * authorize() with no roles, or with any non-string / empty-string role, throws.
 * There is intentionally no "allow all" form — omitting roles is a bug, not a
 * wildcard.
 *
 * Role vocabulary comes from the seeded roles table (admin / authority / staff).
 * The initial policy (subject to wiring in a separately approved step):
 *   staff     -> read-only, approved non-sensitive resources
 *   authority -> personnel import and authorized randomization operations
 *   admin     -> administrative operations, incl. user and role management
 * Adding this middleware does NOT secure existing routes; each route must be
 * wired to it explicitly.
 */
function authorize(...roles) {
  if (roles.length === 0) {
    throw new Error('authorize(...roles) requires at least one role');
  }
  for (const role of roles) {
    if (typeof role !== 'string' || role.trim() === '') {
      throw new Error('authorize(...roles) requires non-empty string role names');
    }
  }
  const allowed = new Set(roles);
  return function authorizeMiddleware(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }
    const role = req.session.user.role;
    if (typeof role !== 'string' || !allowed.has(role)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, authorize };


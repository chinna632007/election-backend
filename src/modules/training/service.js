'use strict';

/**
 * Training service (in-memory; durable schema is migration 005, unapplied).
 *
 * Supported by circular p.63 (documented in TRAINING_WORKFLOW.md):
 *  - at least two training classes for POs/APOs and for other polling
 *    personnel, including one practical session;
 *  - 50-60 minutes each; venues at the work Mandal or nearby/divisional HQ;
 *  - conducted by experienced officials; covers reserve personnel as applicable.
 *
 * NOT invented here: no pass/fail, substitute rules, venues or schedules —
 * all session attributes are authority-supplied free text. Attendance records
 * presence only. Micro Observers are ordinary participants where applicable.
 */

function createTrainingService(deps) {
  deps = deps || {};
  const now = deps.now || function () { return new Date(); };
  let seq = 1;
  const sessions = deps.sessions || [];
  const attendance = deps.attendance || []; // { sessionId, personnelId, present, role, isReserve }

  const SESSION_TYPES = ['theory', 'practical'];
  const SESSION_STATUSES = ['planned', 'held', 'cancelled'];

  function listSessions() {
    return sessions.map(function (s) {
      return Object.assign({}, s, {
        attended: attendance.filter((a) => a.sessionId === s.id && a.present).length,
      });
    });
  }

  function createSession(input, createdBy) {
    const body = input || {};
    if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
      throw badRequest('title is required');
    }
    if (!body.sessionType || SESSION_TYPES.indexOf(body.sessionType) === -1) {
      throw badRequest('sessionType must be one of: ' + SESSION_TYPES.join(', '));
    }
    const session = {
      id: seq++,
      district: body.district || 'Kakinada',
      title: body.title.trim(),
      sessionType: body.sessionType,
      mandal: body.mandal || null,
      venue: body.venue || null,
      scheduledAt: body.scheduledAt || null,
      durationMinutes: body.durationMinutes !== undefined ? body.durationMinutes : null,
      conductedBy: body.conductedBy || null,
      status: 'planned',
      createdByUserId: createdBy,
      createdAt: now().toISOString(),
    };
    sessions.push(session);
    return session;
  }

  function markAttendance(sessionId, records) {
    const session = sessions.find(function (s) { return s.id === sessionId; });
    if (!session) throw notFound('Training session not found');
    if (!Array.isArray(records) || records.length === 0) {
      throw badRequest('attendance records (array) are required');
    }
    const written = [];
    for (const r of records) {
      if (!r || r.personnelId === undefined || r.personnelId === null) {
        throw badRequest('each record needs personnelId');
      }
      const existing = attendance.find(function (a) {
        return a.sessionId === sessionId && String(a.personnelId) === String(r.personnelId);
      });
      const row = {
        sessionId: sessionId,
        personnelId: String(r.personnelId),
        present: r.present === true,
        role: r.role || null,
        isReserve: r.isReserve === true,
      };
      if (existing) {
        Object.assign(existing, row);
        written.push(existing);
      } else {
        attendance.push(row);
        written.push(row);
      }
    }
    return written;
  }

  function sessionAttendance(sessionId) {
    const session = sessions.find(function (s) { return s.id === sessionId; });
    if (!session) throw notFound('Training session not found');
    return attendance.filter(function (a) { return a.sessionId === sessionId; });
  }

  function badRequest(message) {
    const e = new Error(message); e.statusCode = 400; return e;
  }
  function notFound(message) {
    const e = new Error(message); e.statusCode = 404; return e;
  }

  return { listSessions, createSession, markAttendance, sessionAttendance };
}

// --- Phase 3-B: separate PO / APO training batches (designation-based) ------
// NOTE: allocation lives in src/modules/training-orders (from the last
// completed run's team rows). This module stays a dependency-free,
// unit-testable helper: split officers by presiding eligibility.
function splitPoApoLocal(officers) {
  const groups = { PO: [], APO: [] };
  for (const o of officers || []) {
    const po = o && o.presidingEligible === true;
    groups[po ? 'PO' : 'APO'].push(o);
  }
  return groups;
}

module.exports = { createTrainingService, splitPoApoLocal };

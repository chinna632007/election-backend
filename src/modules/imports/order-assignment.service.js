'use strict';

/**
 * order-assignment.service.js — manual appointments (migration 008).
 *
 * Stage Officer II and counting-team staff are NOT produced by randomization
 * (Stage 1/2/3). An admin picks personnel for these roles by hand; the server
 * only validates and persists — it never invents a person, a role, or a team.
 *
 * Table order_assignments:
 *   id, order_kind, personnel_id, role, team_no, table_no, body_name,
 *   created_by, created_at
 *
 * order_kind allow-list (fixed in code, mirrors the template kinds):
 *   'stage_officer_ii' | 'counting_team'
 * role / team_no / table_no / body_name are authority-supplied free text
 * (the circular's counting-role vocabulary is not yet ratified — Q open),
 * so we validate shape only, never the semantics.
 */

const { getCollection } = require('../../database');

function collection(name) {
  const result = getCollection(name);
  return result.collection || result;
}

const ALLOWED_ORDER_KINDS = ['stage_officer_ii', 'counting_team'];

// Text fields we accept from the client. role is required; the rest optional.
function cleanText(value, { max = 200, required = false, field }) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      const err = new Error(field + ' is required');
      err.statusCode = 400;
      throw err;
    }
    return null;
  }
  if (typeof value !== 'string') {
    const err = new Error(field + ' must be a string');
    err.statusCode = 400;
    throw err;
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    const err = new Error(field + ' must be at most ' + max + ' characters');
    err.statusCode = 400;
    throw err;
  }
  return trimmed === '' ? null : trimmed;
}

function parseId(value, field) {
  const n = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    const err = new Error('invalid ' + field);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/**
 * listAssignments({ orderKind }) — all appointments, newest first, joined to
 * the personnel's non-sensitive identity columns (employee_id/name/designation
 * /work_mandal). Never selects Aadhaar / voter ID / mobile.
 */
async function listAssignments({ orderKind } = {}) {
  if (orderKind) {
    if (!ALLOWED_ORDER_KINDS.includes(orderKind)) {
      const err = new Error('unknown order kind');
      err.statusCode = 400;
      throw err;
    }
  }
  const query = orderKind ? { order_kind: orderKind } : {};
  const assignments = await collection('order_assignments').find(query, {
    projection: { _id: 0 },
  }).sort({ order_kind: 1, team_no: 1, table_no: 1, id: 1 }).toArray();
  const ids = [...new Set(assignments.map((row) => row.personnel_id))];
  const people = ids.length
    ? await collection('personnel').find(
      { id: { $in: ids } },
      { projection: { _id: 0, id: 1, employee_id: 1, employee_name: 1, designation: 1, work_mandal: 1 } }
    ).toArray()
    : [];
  const byId = new Map(people.map((person) => [person.id, person]));
  return assignments.flatMap((row) => {
    const person = byId.get(row.personnel_id);
    return person ? [{
      ...row,
      employee_id: person.employee_id,
      employee_name: person.employee_name,
      designation: person.designation,
      work_mandal: person.work_mandal,
    }] : [];
  });
}

async function nextAssignmentId() {
  const result = await collection('counters').findOneAndUpdate(
    { _id: 'order_assignments' },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return (result.value || result).sequence;
}

function assignmentFields(id, values, createdBy, createdAt = new Date()) {
  return {
    id,
    order_kind: values.order_kind,
    personnel_id: values.personnel_id,
    role: values.role,
    team_no: values.team_no,
    table_no: values.table_no,
    body_name: values.body_name,
    created_by: createdBy,
    created_at: createdAt,
  };
}

/**
 * createAssignment({ orderKind, personnelId, role, teamNo, tableNo, bodyName,
 *   createdBy }) — validate then insert. Fails closed if the personnel row does
 * not exist. A person may hold only ONE appointment per order_kind (no double
 * booking a Stage Officer II or the same officer twice in counting).
 */
async function createAssignment(input) {
  const orderKind = cleanText(input.orderKind, { max: 40, required: true, field: 'order_kind' });
  if (!ALLOWED_ORDER_KINDS.includes(orderKind)) {
    const err = new Error('order_kind must be one of: ' + ALLOWED_ORDER_KINDS.join(', '));
    err.statusCode = 400;
    throw err;
  }
  const personnelId = parseId(input.personnelId, 'personnelId');
  const role = cleanText(input.role, { max: 120, required: true, field: 'role' });
  const teamNo = cleanText(input.teamNo, { max: 40, field: 'team_no' });
  const tableNo = cleanText(input.tableNo, { max: 40, field: 'table_no' });
  const bodyName = cleanText(input.bodyName, { max: 200, field: 'body_name' });
  const createdBy = input.createdBy == null ? null : parseId(input.createdBy, 'createdBy');

  const assignments = collection('order_assignments');
  await assignments.createIndex(
    { order_kind: 1, personnel_id: 1 },
    { unique: true, name: 'one_personnel_assignment_per_order_kind' }
  );
  const person = await collection('personnel').findOne(
    { id: personnelId },
    { projection: { _id: 0, id: 1 } }
  );
  if (!person) {
    const err = new Error('personnel not found');
    err.statusCode = 404;
    throw err;
  }
  const duplicate = await assignments.findOne(
    { order_kind: orderKind, personnel_id: personnelId },
    { projection: { _id: 0, id: 1 } }
  );
  if (duplicate) {
    const err = new Error('personnel already has a ' + orderKind + ' appointment');
    err.statusCode = 409;
    throw err;
  }
  const created = assignmentFields(await nextAssignmentId(), {
    order_kind: orderKind, personnel_id: personnelId, role, team_no: teamNo, table_no: tableNo, body_name: bodyName,
  }, createdBy);
  try {
    await assignments.insertOne(created);
  } catch (error) {
    if (error && error.code === 11000) {
      const conflict = new Error('personnel already has a ' + orderKind + ' appointment');
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
  return created;
}

/**
 * updateAssignment({ id, role, teamNo, tableNo, bodyName, personnelId? }) —
 * edit an existing appointment's role/team/table/body (and optionally move it
 * to a different person). role stays required. Unknown id -> 404.
 */
async function updateAssignment(input) {
  const id = parseId(input.id, 'assignment id');
  const role = cleanText(input.role, { max: 120, required: true, field: 'role' });
  const teamNo = cleanText(input.teamNo, { max: 40, field: 'team_no' });
  const tableNo = cleanText(input.tableNo, { max: 40, field: 'table_no' });
  const bodyName = cleanText(input.bodyName, { max: 200, field: 'body_name' });
  const moveTo = input.personnelId === undefined || input.personnelId === null
    ? null : parseId(input.personnelId, 'personnelId');

  const assignments = collection('order_assignments');
  await assignments.createIndex(
    { order_kind: 1, personnel_id: 1 },
    { unique: true, name: 'one_personnel_assignment_per_order_kind' }
  );
  const row = await assignments.findOne({ id }, { projection: { _id: 0 } });
  if (!row) {
    const err = new Error('assignment not found');
    err.statusCode = 404;
    throw err;
  }
  const targetPersonnel = moveTo == null ? row.personnel_id : moveTo;
  if (moveTo != null) {
    const person = await collection('personnel').findOne(
      { id: moveTo },
      { projection: { _id: 0, id: 1 } }
    );
    if (!person) {
      const err = new Error('personnel not found');
      err.statusCode = 404;
      throw err;
    }
    const duplicate = await assignments.findOne(
      { order_kind: row.order_kind, personnel_id: moveTo, id: { $ne: id } },
      { projection: { _id: 0, id: 1 } }
    );
    if (duplicate) {
      const err = new Error('personnel already has a ' + row.order_kind + ' appointment');
      err.statusCode = 409;
      throw err;
    }
  }
  try {
    const changed = await assignments.updateOne({ id }, {
      $set: { role, team_no: teamNo, table_no: tableNo, body_name: bodyName, personnel_id: targetPersonnel },
    });
    if (changed.matchedCount !== 1) {
      const err = new Error('assignment changed concurrently; reload and retry');
      err.statusCode = 409;
      throw err;
    }
  } catch (error) {
    if (error && error.code === 11000) {
      const conflict = new Error('personnel already has a ' + row.order_kind + ' appointment');
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
  return { ...row, role, team_no: teamNo, table_no: tableNo, body_name: bodyName, personnel_id: targetPersonnel };
}

/** deleteAssignment({ id }) — remove one appointment. Unknown id -> 404. */
async function deleteAssignment({ id }) {
  const numId = parseId(id, 'assignment id');
  const r = await collection('order_assignments').deleteOne({ id: numId });
  if (r.deletedCount === 0) {
    const err = new Error('assignment not found');
    err.statusCode = 404;
    throw err;
  }
  return { id: numId, deleted: true };
}

module.exports = {
  ALLOWED_ORDER_KINDS,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
};

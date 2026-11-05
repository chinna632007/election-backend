'use strict';

/**
 * order-generation.service.js — generate an order .docx for an appointment.
 *
 * Flow for generateOrder({ assignmentId, actorId }):
 *   1. load the manual appointment + its personnel (non-sensitive columns)
 *   2. load the active template for the appointment's order_kind
 *   3. load order_config (election metadata)
 *   4. build the merge data + merge the .docx (order-merge.service)
 *   5. record metadata in generated_documents (the .docx bytes are NOT stored
 *      in the DB — scope_id points at the assignment; file on disk optional)
 *
 * Nothing is invented: if there is no template we fail closed with a clear
 * reason (never a fake success). Delivery is out of scope — the caller
 * downloads the .docx from the generate response.
 */

const { getCollection } = require('../../database');
const { getOrderTemplate, getOrderConfig } = require('./intake.service');
const { mergeDocx, buildMergeData, filenameFor } = require('./order-merge.service');

function collection(name) {
  const result = getCollection(name);
  return result.collection || result;
}

// order_kind -> template kind. Manual appointments map 1:1 to a template kind.
const KIND_TO_TEMPLATE = {
  stage_officer_ii: 'stage_officer_ii',
  counting_team: 'counting_team',
};

async function loadAssignmentWithPersonnel(assignmentId) {
  const assignment = await collection('order_assignments').findOne(
    { id: assignmentId },
    { projection: { _id: 0 } }
  );
  if (!assignment) return null;
  const person = await collection('personnel').findOne(
    { id: assignment.personnel_id },
    { projection: { _id: 0, employee_id: 1, employee_name: 1, designation: 1, work_mandal: 1, native_mandal: 1 } }
  );
  return person ? {
    ...assignment,
    employee_id: person.employee_id,
    employee_name: person.employee_name,
    designation: person.designation,
    work_mandal: person.work_mandal,
    native_mandal: person.native_mandal,
  } : null;
}

async function recordGeneratedDocument({ kind, templateKind, scopeType, scopeId, fileName, createdBy }) {
  // file_path is a logical reference (assignment-scoped); the bytes themselves
  // are attached to the email, not persisted to disk by this service.
  const filePath = 'generated/' + scopeType + '/' + scopeId + '/' + fileName;
  const counterResult = await collection('counters').findOneAndUpdate(
    { _id: 'generated_documents' },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const counter = counterResult.value || counterResult;
  const document = {
    id: counter.sequence,
    kind,
    template_kind: templateKind,
    scope_type: scopeType,
    scope_id: String(scopeId),
    file_name: fileName,
    file_path: filePath,
    created_by: createdBy == null ? null : createdBy,
    created_at: new Date(),
  };
  await collection('generated_documents').insertOne(document);
  return document;
}

/**
 * generateOrderDocx(assignmentId) -> { fileName, buffer, assignment, doc }
 * Pure generation (no email, no DB write to generated_documents).
 */
async function generateOrderDocx(assignmentId) {
  const id = Number.parseInt(assignmentId, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const err = new Error('invalid assignment id');
    err.statusCode = 400;
    throw err;
  }
  const assignment = await loadAssignmentWithPersonnel(id);
  if (!assignment) {
    const err = new Error('assignment not found');
    err.statusCode = 404;
    throw err;
  }
  const templateKind = KIND_TO_TEMPLATE[assignment.order_kind];
  if (!templateKind) {
    const err = new Error('no template mapping for order kind ' + assignment.order_kind);
    err.statusCode = 400;
    throw err;
  }
  const template = await getOrderTemplate(templateKind);
  if (!template) {
    const err = new Error('no active template uploaded for kind ' + templateKind);
    err.statusCode = 409;
    throw err;
  }
  const { config } = await getOrderConfig();
  const personnel = {
    employee_id: assignment.employee_id,
    employee_name: assignment.employee_name,
    designation: assignment.designation,
    work_mandal: assignment.work_mandal,
    native_mandal: assignment.native_mandal,
  };
  const appointment = {
    role: assignment.role,
    team_no: assignment.team_no,
    table_no: assignment.table_no,
    body_name: assignment.body_name,
  };
  const data = buildMergeData({ orderConfig: config, personnel, assignment: appointment });
  const buffer = mergeDocx(template.buffer, data);
  const fileName = filenameFor({ kind: templateKind, personnel, assignment: appointment });
  return { fileName, buffer, assignment, templateKind };
}

/**
 * generateOrder({ assignmentId, actorId }):
 *   generates the .docx and records generated_documents metadata.
 *   Returns { ok, document, fileName, bytes, docxBase64 }.
 */
async function generateOrder({ assignmentId, actorId } = {}) {
  const { fileName, buffer, assignment, templateKind } = await generateOrderDocx(assignmentId);

  const doc = await recordGeneratedDocument({
    kind: 'order_docx',
    templateKind,
    scopeType: 'assignment',
    scopeId: assignment.id,
    fileName,
    createdBy: actorId,
  });

  return {
    ok: true,
    document: doc,
    fileName,
    bytes: buffer.length,
    // base64 so the client can download/save without a disk round-trip.
    docxBase64: buffer.toString('base64'),
  };
}

module.exports = {
  KIND_TO_TEMPLATE,
  generateOrderDocx,
  generateOrder,
};

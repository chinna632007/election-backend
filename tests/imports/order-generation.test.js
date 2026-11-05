'use strict';

/**
 * tests/imports/order-generation.test.js
 *
 * Route-level tests for order generation (mail send system removed):
 *   POST /api/imports/order-assignments/:id/generate
 *   POST /api/imports/order-assignments/:id/generate-and-send  -> 404 (removed)
 *
 * Stubs the DB pool AND the generation seam so no live template or database
 * call happens. Verifies: auth (401/403), 404 unknown assignment, 409 no
 * template, 200 generate returns base64 docx, and the removed mail route is
 * gone (fail closed, never a fake success).
 *
 * Run: node --test tests/imports/order-generation.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const PizZip = require('pizzip');

const importsRouter = require('../../src/modules/imports');
const genService = require('../../src/modules/imports/order-generation.service');

// Minimal .docx template bytes for the happy path.
function templateBytes() {
  const zip = new PizZip();
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{employee_name} {role}</w:t></w:r></w:p></w:body></w:document>');
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  return zip.generate({ type: 'nodebuffer' });
}

// Swap the generation service exports for controllable fakes.
const realGenerate = genService.generateOrderDocx;
const realGenerateOrder = genService.generateOrder;
let genImpl = realGenerate;
let orderImpl = realGenerateOrder;
genService.generateOrderDocx = (...a) => genImpl(...a);
genService.generateOrder = (...a) => orderImpl(...a);

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user !== undefined) app.use((req, _res, next) => { req.session = { user }; next(); });
  app.use('/api/imports', importsRouter);
  return app;
}

async function request(app, method, path) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const AUTHORITY = { id: 1, username: 'auth1', role: 'authority' };
const STAFF = { id: 2, username: 'staff1', role: 'staff' };

function restore() {
  genImpl = realGenerate;
  orderImpl = realGenerateOrder;
}

test('generate: unauthenticated -> 401', async () => {
  const { status } = await request(buildApp(undefined), 'POST', '/api/imports/order-assignments/1/generate');
  assert.equal(status, 401);
});

test('generate: staff -> 403', async () => {
  const { status } = await request(buildApp(STAFF), 'POST', '/api/imports/order-assignments/1/generate');
  assert.equal(status, 403);
});

test('generate: 404 when assignment missing', async () => {
  orderImpl = async () => { const e = new Error('assignment not found'); e.statusCode = 404; throw e; };
  const { status, body } = await request(buildApp(AUTHORITY), 'POST', '/api/imports/order-assignments/999/generate');
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  restore();
});

test('generate: 409 when no active template', async () => {
  orderImpl = async () => { const e = new Error('no active template uploaded for kind stage_officer_ii'); e.statusCode = 409; throw e; };
  const { status, body } = await request(buildApp(AUTHORITY), 'POST', '/api/imports/order-assignments/1/generate');
  assert.equal(status, 409);
  assert.match(body.error, /no active template/i);
  restore();
});

test('generate: 200 returns base64 docx + metadata', async () => {
  orderImpl = async () => ({ ok: true, document: { id: 3 }, fileName: 'stage_officer_ii_E1.docx', bytes: templateBytes().length, docxBase64: templateBytes().toString('base64') });
  const { status, body } = await request(buildApp(AUTHORITY), 'POST', '/api/imports/order-assignments/1/generate');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.fileName, 'stage_officer_ii_E1.docx');
  assert.ok(body.bytes > 0);
  assert.ok(typeof body.docxBase64 === 'string' && body.docxBase64.length > 0);
  assert.equal(body.emailed, undefined, 'mail system removed: no emailed flag');
  restore();
});

test('generate: 500 surfaces a service throw', async () => {
  orderImpl = async () => { throw new Error('boom'); };
  const { status, body } = await request(buildApp(AUTHORITY), 'POST', '/api/imports/order-assignments/1/generate');
  assert.equal(status, 500);
  assert.equal(body.ok, false);
  restore();
});

test('generate-and-send route was removed (mail system gone) -> 404', async () => {
  const { status } = await request(buildApp(AUTHORITY), 'POST', '/api/imports/order-assignments/1/generate-and-send');
  assert.equal(status, 404, 'removed mail route must not exist');
});

test('service no longer exports generateAndSend', () => {
  assert.equal(genService.generateAndSend, undefined, 'generateAndSend removed with the mail system');
  assert.equal(typeof genService.generateOrder, 'function', 'generateOrder is the replacement');
});

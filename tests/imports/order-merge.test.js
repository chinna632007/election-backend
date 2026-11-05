'use strict';

/**
 * tests/imports/order-merge.test.js
 *
 * Unit tests for the order-merge engine. The Gmail mail path was removed
 * with the mail send system — the final test proves it stays gone.
 * Pure — builds a minimal .docx in memory, merges, and inspects the encoded
 * Gmail message. No database, no live API.
 *
 * Run: node --test tests/imports/order-merge.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');

const { mergeDocx, buildMergeData, filenameFor } = require('../../src/modules/imports/order-merge.service');
const providers = require('../../src/modules/notifications/providers');

// Minimal valid .docx whose body contains two tags.
function makeTemplate() {
  const zip = new PizZip();
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Order for {employee_name} as {role}</w:t></w:r></w:p></w:body></w:document>'
  );
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  return zip.generate({ type: 'nodebuffer' });
}

test('mergeDocx fills tags and leaves none behind', () => {
  const out = mergeDocx(makeTemplate(), buildMergeData({
    personnel: { employee_name: 'Asha Rao' },
    assignment: { role: 'Stage Officer II' },
  }));
  const xml = new PizZip(out).file('word/document.xml').asText();
  assert.ok(xml.includes('Asha Rao'));
  assert.ok(xml.includes('Stage Officer II'));
  assert.ok(!xml.includes('{employee_name}'));
});

test('mergeDocx: missing data renders blank (nullGetter), never throws', () => {
  const out = mergeDocx(makeTemplate(), { employee_name: 'Bhanu' });
  const xml = new PizZip(out).file('word/document.xml').asText();
  assert.ok(xml.includes('Bhanu'));
  assert.ok(!xml.includes('{role}'));
});

test('mergeDocx: empty buffer -> 400', () => {
  assert.throws(() => mergeDocx(Buffer.alloc(0), {}), (e) => e.statusCode === 400);
});

test('buildMergeData flattens order_config + personnel + assignment + extra', () => {
  const data = buildMergeData({
    orderConfig: { election_title: 'GP Election 2026', district: 'Kakinada' },
    personnel: { employee_id: 'E1', employee_name: 'Asha', designation: 'SA' },
    assignment: { role: 'CS', team_no: '1', table_no: '3', body_name: 'Ward 5' },
    extra: { custom_tag: 'X' },
  });
  assert.equal(data.election_title, 'GP Election 2026');
  assert.equal(data.district, 'Kakinada');
  assert.equal(data.name, 'Asha'); // alias of employee_name
  assert.equal(data.role, 'CS');
  assert.equal(data.team_no, '1');
  assert.equal(data.body_name, 'Ward 5');
  assert.equal(data.custom_tag, 'X');
});

test('filenameFor is deterministic and filesystem-safe', () => {
  const fn = filenameFor({ kind: 'stage_officer_ii', personnel: { employee_id: 'E1' }, assignment: { role: 'Stage Officer II' } });
  assert.equal(fn, 'stage_officer_ii_E1_Stage_Officer_II.docx');
  assert.ok(!/[^a-zA-Z0-9._-]/.test(fn));
});

// --- Mail system removal -------------------------------------------------

test('mail send system removed: no Gmail provider, no attachments path', () => {
  assert.equal(providers.createGmailProvider, undefined,
    'createGmailProvider must no longer be exported');
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../src/modules/notifications/providers.js'), 'utf8');
  assert.ok(!/gmail/i.test(src), 'providers.js must contain no Gmail code');
});

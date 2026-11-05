'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMongoStub, installMongoStub } = require('./mongo-stub');

const mongo = createMongoStub();
const restoreMongo = installMongoStub(mongo);
const { patchPersonnelExemption } = require('../../src/modules/imports/import.service');

function reset() {
  mongo.data.personnel ||= [];
  mongo.data.personnel_exemptions ||= [];
  mongo.data.counters ||= [];
  mongo.data.personnel.splice(0, mongo.data.personnel.length,
    { id: 5, employee_id: 'EMP5', exempt_category: 'health_medical', import_batch_id: 1 },
    { id: 7, employee_id: 'EMP7', exempt_category: null, import_batch_id: 1 },
    { id: 9, employee_id: 'EMP9', exempt_category: null, import_batch_id: 1 });
  mongo.data.personnel_exemptions.splice(0);
  mongo.data.counters.splice(0);
}

test('authorization rejects unknown categories before persistence', async () => {
  reset();
  await assert.rejects(
    () => patchPersonnelExemption({ id: 1, exemptCategory: 'unknown_category' }),
    { message: 'unauthorized category' }
  );
  assert.equal(mongo.data.personnel_exemptions.length, 0);
});

test('validation preserves id and note error messages', async () => {
  reset();
  await assert.rejects(
    () => patchPersonnelExemption({ id: 1, exemptCategory: 'made_up_category' }),
    { message: 'unauthorized category' }
  );
  await assert.rejects(
    () => patchPersonnelExemption({ id: -1, exemptCategory: null }),
    { message: 'invalid personnel id' }
  );
  await assert.rejects(
    () => patchPersonnelExemption({ id: 1, exemptCategory: null, note: 'x'.repeat(401) }),
    { message: /up to 400 characters/ }
  );
});

test('unknown personnel remains a 404-domain error and writes no audit row', async () => {
  reset();
  await assert.rejects(
    () => patchPersonnelExemption({ id: 999, exemptCategory: 'pregnant' }),
    { message: 'personnel not found' }
  );
  assert.equal(mongo.data.personnel_exemptions.length, 0);
});

test('successful exemption updates personnel and appends an audit document', async () => {
  reset();
  await patchPersonnelExemption({
    id: 5,
    exemptCategory: 'pregnant',
    note: 'authority confirmed p.61(a)(viii)',
    req: { session: { user: { id: '42', username: 'authority' } } },
  });
  const person = mongo.data.personnel.find((row) => row.id === 5);
  assert.equal(person.exempt_category, 'pregnant');
  assert.deepEqual(mongo.data.personnel_exemptions, [{
    id: 1,
    personnel_id: 5,
    employee_id: 'EMP5',
    new_exempt_category: 'pregnant',
    old_exempt_category: 'health_medical',
    reason: 'authority_mark',
    requested_by_user_id: '42',
    note: 'authority confirmed p.61(a)(viii)',
  }]);
});

test('bank pending marker is retained in the append-only audit', async () => {
  reset();
  await patchPersonnelExemption({
    id: 7,
    exemptCategory: 'pending_authority_confirmation',
    note: 'bank review criteria not on sheet',
    req: { session: { user: { id: '42' } } },
  });
  assert.equal(mongo.data.personnel[1].exempt_category, 'pending_authority_confirmation');
  assert.equal(mongo.data.personnel_exemptions[0].new_exempt_category, 'pending_authority_confirmation');
});

test('clearing exemption preserves old/new audit values on each transition', async () => {
  reset();
  await patchPersonnelExemption({
    id: 9,
    exemptCategory: 'health_medical',
    req: { session: { user: { id: '42' } } },
  });
  await patchPersonnelExemption({
    id: 9,
    exemptCategory: null,
    req: { session: { user: { id: '42' } } },
  });
  assert.equal(mongo.data.personnel.find((row) => row.id === 9).exempt_category, null);
  assert.equal(mongo.data.personnel_exemptions.length, 2);
  assert.equal(mongo.data.personnel_exemptions[0].new_exempt_category, 'health_medical');
  assert.equal(mongo.data.personnel_exemptions[1].old_exempt_category, 'health_medical');
  assert.equal(mongo.data.personnel_exemptions[1].new_exempt_category, null);
});

test.after(restoreMongo);

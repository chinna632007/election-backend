'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMongoStub, installMongoStub } = require('./mongo-stub');

async function withMongo(fn) {
  const mongo = createMongoStub();
  const restore = installMongoStub(mongo);
  try {
    await fn(mongo);
  } finally {
    restore();
  }
}

test('template service: upload replaces the kind-row, only one active', async () => {
  await withMongo(async (mongo) => {
    const { upsertOrderTemplate, getOrderTemplates } = require('../../src/modules/imports/intake.service');
    const template = {
      kind: 'polling_team',
      display_name: 'Polling Team Order 2026',
      file_name: 'polling-team.docx',
      file: Buffer.from('PK'),
      uploadedBy: 3,
    };
    await upsertOrderTemplate(template);
    await upsertOrderTemplate({ ...template, display_name: 'Updated order' });

    assert.equal(mongo.data.order_templates.length, 1);
    assert.equal(mongo.data.order_templates[0].active, true);
    assert.equal(mongo.data.order_templates[0].display_name, 'Updated order');
    assert.deepEqual((await getOrderTemplates()).templates.map((row) => row.kind), ['polling_team']);
  });
});

test('template service: order config and id-card design persist', async () => {
  await withMongo(async (mongo) => {
    const { upsertOrderConfig, upsertIdCardDesign, getOrderConfig, getIdCardDesign } =
      require('../../src/modules/imports/intake.service');
    await upsertOrderConfig({
      config: { election_title: 'Mahajan', district: 'Kakinada' },
      updatedBy: 3,
    });
    await upsertIdCardDesign({
      design: { headerTitle: 'D' },
      updatedBy: 3,
    });

    assert.deepEqual((await getOrderConfig()).config.election_title, 'Mahajan');
    assert.deepEqual((await getIdCardDesign()).design, { headerTitle: 'D' });
  });
});

test('template service: id-card design read-back', async () => {
  await withMongo(async () => {
    const { upsertIdCardDesign, getIdCardDesign } = require('../../src/modules/imports/intake.service');
    await upsertIdCardDesign({ design: { headerTitle: 'D', body: 'B' }, updatedBy: 3 });
    assert.deepEqual((await getIdCardDesign()).design, { headerTitle: 'D', body: 'B' });
  });
});

test('order config upsert and read-back', async () => {
  await withMongo(async () => {
    const { upsertOrderConfig, getOrderConfig } = require('../../src/modules/imports/intake.service');
    await upsertOrderConfig({
      config: { election_title: 'Mahajan', district: 'Kakinada' },
      updatedBy: 3,
    });
    assert.deepEqual((await getOrderConfig()).config.election_title, 'Mahajan');
    assert.equal((await getOrderConfig()).config.district, 'Kakinada');
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveRole } = require('../../scripts/create-account');

const roles = [
  { id: 1, name: 'admin' },
  { id: 2, name: 'authority' },
  { id: 3, name: 'staff' },
];

test('create-account resolves a role by numeric ID', () => {
  assert.deepEqual(resolveRole(roles, '2'), roles[1]);
});

test('create-account resolves a role by case-insensitive name', () => {
  assert.deepEqual(resolveRole(roles, ' ADMIN '), roles[0]);
});

test('create-account rejects an unknown role', () => {
  assert.equal(resolveRole(roles, 'unknown'), undefined);
});

'use strict';

/**
 * Application wiring for Stage 1. Candidate reads, runs, results, and audit
 * events use durable MongoDB collections; the district is never request-owned.
 */

const { requireAuth, authorize } = require('../../middleware/auth');
const { getCollection } = require('../../database');
const { createStage1Service, createStage1Router } = require('./index');
const { createMongoStage1Repository } = require('./stage1.repository');

const DEFAULT_DISTRICT_ID = 'Kakinada';
const configurationRegistry = new Map();
const auditEvents = [];

function registerElectionConfiguration(cfg) {
  if (cfg && typeof cfg.id === 'string' && cfg.id.trim()) configurationRegistry.set(cfg.id, cfg);
  return cfg;
}

function getRegisteredConfiguration(id) {
  return configurationRegistry.get(id) || null;
}

function createAppStage1Audit() {
  return {
    async record(event) {
      const record = { at: new Date().toISOString(), ...event };
      await getCollection('audit_events').insertOne(record);
      auditEvents.push(record);
    },
  };
}

function stage1Authenticate(req, res, next) {
  requireAuth(req, res, function () {
    const user = req.session.user;
    req.actor = {
      id: user.id,
      username: user.username,
      role: user.role,
      districtId: DEFAULT_DISTRICT_ID,
    };
    next();
  });
}

const PERMISSION_ROLES = Object.freeze({
  'stage1.execute': ['authority', 'admin'],
  'stage1.view': ['staff', 'authority', 'admin'],
  'stage1.viewResults': ['staff', 'authority', 'admin'],
});

function stage1Authorize(permission) {
  const roles = PERMISSION_ROLES[permission];
  if (!roles) throw new Error('Unknown Stage 1 permission "' + permission + '" — refusing to mount.');
  return authorize(...roles);
}

function createAppStage1Router() {
  const service = createStage1Service({
    repository: createMongoStage1Repository({ getRegisteredConfiguration }),
    audit: createAppStage1Audit(),
  });
  return createStage1Router({ service, authenticate: stage1Authenticate, authorize: stage1Authorize });
}

module.exports = {
  registerElectionConfiguration,
  getRegisteredConfiguration,
  createAppStage1Router,
  stage1Authenticate,
  stage1Authorize,
  DEFAULT_DISTRICT_ID,
};

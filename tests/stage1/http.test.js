'use strict';

/**
 * Controller/router tests — error mapping, auth fail-closed behavior.
 * Run: node --test tests/stage1/http.test.js
 *
 * NOTE: full end-to-end HTTP tests (real Express app + JWT middleware) are
 * NOT possible yet: the shared app and auth middleware are empty placeholders
 * (Phase-3 shared work). These tests cover what exists today: the controller's
 * response mapping and the router's refusal to mount without auth.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createStage1Controller,
  toErrorResponse,
} = require('../../src/modules/randomization-stage-1/stage1.controller');
const { createStage1Router } = require('../../src/modules/randomization-stage-1/stage1.routes');
const {
  Stage1ValidationError,
  Stage1ConflictError,
  Stage1NotFoundError,
  Stage1AuthorizationError,
} = require('../../src/modules/randomization-stage-1/stage1.errors');

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('toErrorResponse maps Stage 1 errors to safe status/body pairs', () => {
  const cases = [
    [new Stage1ValidationError('bad field'), 400, 'STAGE1_VALIDATION_ERROR'],
    [new Stage1AuthorizationError(), 403, 'STAGE1_AUTHORIZATION_ERROR'],
    [new Stage1NotFoundError(), 404, 'STAGE1_NOT_FOUND'],
    [new Stage1ConflictError('exists'), 409, 'STAGE1_CONFLICT'],
  ];
  for (const [err, status, code] of cases) {
    const { status: s, body } = toErrorResponse(err);
    assert.equal(s, status);
    assert.equal(body.error.code, code);
    assert.ok(typeof body.error.message === 'string');
  }
});

test('unknown errors never leak internals', () => {
  const { status, body } = toErrorResponse(
    new Error('SELECT * FROM users WHERE secret = 1 at /internal/path.js:42')
  );
  assert.equal(status, 500);
  assert.equal(body.error.code, 'STAGE1_INTERNAL_ERROR');
  assert.ok(!body.error.message.includes('SELECT'));
  assert.ok(!JSON.stringify(body).includes('internal/path'));
});

test('controller returns 401-ish 403 when no actor is on the request', async () => {
  const controller = createStage1Controller({
    service: {
      async executeRun() {
        throw new Error('should not be reached');
      },
    },
  });
  const res = makeRes();
  await controller.executeRun({ body: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'STAGE1_AUTHORIZATION_ERROR');
});

test('controller delegates to the service and returns 201 on success', async () => {
  const calls = [];
  const controller = createStage1Controller({
    service: {
      async executeRun(body, actor) {
        calls.push({ body, actor });
        return { runId: 'r1', status: 'completed' };
      },
    },
  });
  const res = makeRes();
  await controller.executeRun(
    { body: { electionConfigurationId: 'ec1' }, actor: { id: 'u1', districtId: 'd1' } },
    res
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.runId, 'r1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actor.id, 'u1');
});

test('router factory FAILS CLOSED without authenticate + authorize', () => {
  const service = {};
  assert.throws(() => createStage1Router({ service }), /requires the shared authenticate/);
  assert.throws(
    () => createStage1Router({ service, authenticate: async () => {} }),
    /requires the shared authenticate/
  );
});

test('router mounts the four proposed endpoints when auth is provided', () => {
  const noop = (req, res, next) => next();
  const router = createStage1Router({
    service: {},
    authenticate: noop,
    authorize: () => noop,
  });
  assert.ok(router, 'router constructed');
  // Express 5 router exposes a stack; check the four paths are registered.
  const paths = router.stack.map((l) => l.route && l.route.path).filter(Boolean);
  assert.deepEqual(paths.sort(), [
    '/runs',
    '/runs/:runId',
    '/runs/:runId/results',
    '/runs',
  ].sort());
  // Each route has POST or GET layers.
  const methods = router.stack
    .filter((l) => l.route)
    .map((l) => Object.keys(l.route.methods).join(','));
  assert.ok(methods.includes('post'));
  assert.equal(methods.filter((m) => m === 'get').length, 3);
});

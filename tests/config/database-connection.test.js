'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const config = require('../../src/config');
const { connectDatabase, mongoose } = require('../../src/database');

test('database connection accepts a standalone URI and keeps database selection configurable', async () => {
  const originalConnect = mongoose.connect;
  const originalUri = config.mongoUri;
  const originalDatabase = config.mongoDatabase;
  const originalState = mongoose.connection.readyState;
  let connection;
  config.mongoUri = 'mongodb://127.0.0.1:27017/polling_standalone_test';
  config.mongoDatabase = 'configured_polling_database';
  mongoose.connection.readyState = 0;
  mongoose.connect = async (uri, options) => {
    connection = { uri, options };
    return mongoose.connection;
  };

  try {
    assert.equal(await connectDatabase(), mongoose.connection);
    assert.equal(connection.uri, config.mongoUri);
    assert.equal(connection.options.dbName, 'configured_polling_database');
    assert.equal(connection.options.serverSelectionTimeoutMS, 10000);
  } finally {
    mongoose.connect = originalConnect;
    config.mongoUri = originalUri;
    config.mongoDatabase = originalDatabase;
    mongoose.connection.readyState = originalState;
  }
});

test('concurrent startup callers share one MongoDB connection attempt', async () => {
  const originalConnect = mongoose.connect;
  const originalUri = config.mongoUri;
  const originalState = mongoose.connection.readyState;
  let connectCount = 0;
  let releaseConnect;
  config.mongoUri = 'mongodb://127.0.0.1:27017/polling_concurrent_test';
  mongoose.connection.readyState = 0;
  mongoose.connect = () => {
    connectCount += 1;
    return new Promise((resolve) => { releaseConnect = resolve; });
  };

  try {
    const first = connectDatabase();
    const second = connectDatabase();
    assert.equal(connectCount, 1);
    releaseConnect();
    const [firstConnection, secondConnection] = await Promise.all([first, second]);
    assert.equal(firstConnection, mongoose.connection);
    assert.equal(secondConnection, mongoose.connection);
  } finally {
    mongoose.connect = originalConnect;
    config.mongoUri = originalUri;
    mongoose.connection.readyState = originalState;
  }
});

test('MongoDB connection failures expose a safe actionable error', async () => {
  const originalConnect = mongoose.connect;
  const originalUri = config.mongoUri;
  const originalState = mongoose.connection.readyState;
  config.mongoUri = 'mongodb://127.0.0.1:27017/polling_connection_failure_test';
  mongoose.connection.readyState = 0;
  mongoose.connect = async () => { throw new Error('simulated unavailable database'); };
  try {
    await assert.rejects(
      () => connectDatabase(),
      (error) => error.name === 'MongoConnectionError' &&
        error.statusCode === 503 &&
        /Check MONGODB_URI/.test(error.message) &&
        !/simulated unavailable database/.test(error.message)
    );
  } finally {
    mongoose.connect = originalConnect;
    config.mongoUri = originalUri;
    mongoose.connection.readyState = originalState;
  }
});

test('non-MongoDB database URIs fail with a safe configuration error', () => {
  const configPath = path.resolve(__dirname, '../../src/config');
  const env = {
    ...process.env,
    MONGODB_URI: 'postgres://user:do-not-print@example.test/polling',
    SESSION_SECRET: 'test-session-secret',
  };
  let stderr = '';
  try {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(configPath)})`], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    stderr = String(error.stderr || '');
  }
  assert.match(stderr, /MONGODB_URI must use mongodb:\/\/ or mongodb\+srv:\/\//);
  assert.doesNotMatch(stderr, /do-not-print/);
});

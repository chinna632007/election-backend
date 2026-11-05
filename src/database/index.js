const mongoose = require('mongoose');
const config = require('../config');

let connectionPromise = null;

function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose.connect(config.mongoUri, {
    ...(config.mongoDatabase ? { dbName: config.mongoDatabase } : {}),
    serverSelectionTimeoutMS: 10000,
  }).then(() => mongoose.connection).catch((cause) => {
    const error = new Error(
      'MongoDB connection failed. Check MONGODB_URI, credentials, network access, and server availability.',
      { cause }
    );
    error.name = 'MongoConnectionError';
    error.statusCode = 503;
    throw error;
  }).finally(() => {
    connectionPromise = null;
  });

  return connectionPromise;
}

function getCollection(name) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new TypeError(`Invalid MongoDB collection name: ${name}`);
  }
  return mongoose.connection.collection(name);
}

module.exports = {
  connectDatabase,
  getCollection,
  mongoose,
};

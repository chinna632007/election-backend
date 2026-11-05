'use strict';

function matches(document, filter = {}) {
  if (filter.$or && !filter.$or.some((branch) => matches(document, branch))) return false;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return true;
    const actual = document[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$in' in expected && !expected.$in.includes(actual)) return false;
      if ('$ne' in expected && actual === expected.$ne) return false;
      if ('$exists' in expected && (key in document) !== expected.$exists) return false;
      return true;
    }
    return actual === expected;
  });
}

function compareValues(left, right) {
  if (left == null && right != null) return -1;
  if (left != null && right == null) return 1;
  if (left == null && right == null) return 0;
  return left < right ? -1 : left > right ? 1 : 0;
}

function createMongoStub({ seed = {}, onOperation = () => {} } = {}) {
  const data = Object.fromEntries(
    Object.entries(seed).map(([name, documents]) => [name, documents.map((doc) => ({ ...doc }))])
  );
  const sequences = new Map();
  const collections = new Map();

  function getCollection(name) {
    if (!data[name]) data[name] = [];
    if (collections.has(name)) return collections.get(name);
    const documents = data[name];
    const collection = {
      async createIndex() {
        onOperation({ collection: name, method: 'createIndex' });
        return 'stub_index';
      },
      find(filter = {}, options = {}) {
        onOperation({ collection: name, method: 'find', filter, options });
        let rows = documents.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc }));
        const cursor = {
          sort(spec) {
            const fields = Object.entries(spec);
            rows.sort((a, b) => {
              for (const [field, direction] of fields) {
                const compared = compareValues(a[field], b[field]) * direction;
                if (compared) return compared;
              }
              return 0;
            });
            return cursor;
          },
          limit(count) {
            rows = rows.slice(0, count);
            return cursor;
          },
          async toArray() {
            return rows.map((row) => project(row, options.projection));
          },
        };
        return cursor;
      },
      async findOne(filter = {}, options = {}) {
        onOperation({ collection: name, method: 'findOne', filter, options });
        const row = documents.find((doc) => matches(doc, filter));
        return row ? project(row, options.projection) : null;
      },
      async insertOne(document) {
        onOperation({ collection: name, method: 'insertOne', document });
        documents.push({ ...document });
        return { acknowledged: true, insertedId: document._id };
      },
      async insertMany(items) {
        onOperation({ collection: name, method: 'insertMany', documents: items });
        documents.push(...items.map((doc) => ({ ...doc })));
        return { acknowledged: true, insertedCount: items.length };
      },
      async updateOne(filter, update, options = {}) {
        onOperation({ collection: name, method: 'updateOne', filter, update, options });
        let row = documents.find((doc) => matches(doc, filter));
        if (!row && options.upsert) {
          row = Object.fromEntries(Object.entries(filter).filter(([, value]) => typeof value !== 'object'));
          documents.push(row);
        }
        if (!row) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        Object.assign(row, update.$set || {});
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      },
      async updateMany(filter, update) {
        onOperation({ collection: name, method: 'updateMany', filter, update });
        const rows = documents.filter((doc) => matches(doc, filter));
        rows.forEach((row) => Object.assign(row, update.$set || {}));
        return { matchedCount: rows.length, modifiedCount: rows.length };
      },
      async deleteOne(filter) {
        onOperation({ collection: name, method: 'deleteOne', filter });
        const index = documents.findIndex((doc) => matches(doc, filter));
        if (index < 0) return { deletedCount: 0 };
        documents.splice(index, 1);
        return { deletedCount: 1 };
      },
      async deleteMany(filter = {}) {
        onOperation({ collection: name, method: 'deleteMany', filter });
        const before = documents.length;
        const remaining = documents.filter((doc) => !matches(doc, filter));
        documents.splice(0, documents.length, ...remaining);
        return { deletedCount: before - documents.length };
      },
      async countDocuments(filter = {}) {
        onOperation({ collection: name, method: 'countDocuments', filter });
        return documents.filter((doc) => matches(doc, filter)).length;
      },
      async findOneAndUpdate(filter, update, options = {}) {
        onOperation({ collection: name, method: 'findOneAndUpdate', filter, update, options });
        const key = filter._id;
        let value = documents.find((doc) => matches(doc, filter));
        if (!value) {
          if (!options.upsert) return null;
          value = { ...filter, sequence: 0 };
          documents.push(value);
        }
        value.sequence += update.$inc.sequence;
        sequences.set(key, value.sequence);
        return { ...value };
      },
    };
    collections.set(name, collection);
    return collection;
  }

  function project(document, projection) {
    if (!projection) return { ...document };
    const includes = Object.entries(projection).filter(([field, include]) => field !== '_id' && include === 1);
    if (includes.length) {
      return Object.fromEntries(includes.filter(([field]) => field in document).map(([field]) => [field, document[field]]));
    }
    const result = { ...document };
    for (const [field, include] of Object.entries(projection)) if (include === 0) delete result[field];
    return result;
  }

  const mongoose = {
    async startSession() {
      return {
        async withTransaction(callback) { return callback(); },
        async endSession() {},
      };
    },
  };
  return { getCollection, mongoose, data, onOperation };
}

function installMongoStub(stub) {
  const database = require('../../src/database');
  const originals = {
    getCollection: database.getCollection,
    startSession: database.mongoose.startSession,
  };
  database.getCollection = stub.getCollection;
  database.mongoose.startSession = stub.mongoose.startSession;
  return () => {
    database.getCollection = originals.getCollection;
    database.mongoose.startSession = originals.startSession;
  };
}

module.exports = { createMongoStub, installMongoStub };

'use strict';

const database = require('../../src/database');
const mongoose = database.mongoose;

function equal(left, right) {
  if (left instanceof mongoose.Types.ObjectId || right instanceof mongoose.Types.ObjectId) {
    return String(left) === String(right);
  }
  if (left instanceof Date || right instanceof Date) return new Date(left).getTime() === new Date(right).getTime();
  return left === right;
}

function valueAt(document, path) {
  return path.split('.').reduce((value, key) => value == null ? undefined : value[key], document);
}

function copy(document) {
  return document && typeof document === 'object' && !Buffer.isBuffer(document)
    ? { ...document }
    : document;
}

function matches(document, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$expr') return true;
    if (key === '$or') return expected.some((part) => matches(document, part));
    const actual = valueAt(document, key);
    if (expected && typeof expected === 'object' && !(expected instanceof Date) &&
      !(expected instanceof mongoose.Types.ObjectId) && !Array.isArray(expected)) {
      return Object.entries(expected).every(([operator, operand]) => {
        if (operator === '$exists') return (actual !== undefined) === operand;
        if (operator === '$in') return operand.some((candidate) => Array.isArray(actual)
          ? actual.some((item) => equal(item, candidate))
          : equal(actual, candidate));
        if (operator === '$ne') return !equal(actual, operand);
        if (operator === '$regex') {
          const flags = expected.$options || '';
          return new RegExp(operand, flags).test(String(actual || ''));
        }
        if (operator === '$options') return true;
        return false;
      });
    }
    return equal(actual, expected);
  });
}

function project(document, projection) {
  if (!projection) return copy(document);
  const include = Object.entries(projection).filter(([key, enabled]) => key !== '_id' && enabled);
  if (include.length) {
    const output = {};
    for (const [key] of include) {
      const value = valueAt(document, key);
      if (value !== undefined) output[key] = value;
    }
    if (projection._id !== 0 && document._id !== undefined) output._id = document._id;
    return output;
  }
  const output = copy(document);
  for (const [key, enabled] of Object.entries(projection)) {
    if (enabled === 0) delete output[key];
  }
  return output;
}

function installMongoStub() {
  const collections = new Map();
  let closed = false;
  function getCollection(name) {
    if (closed) throw new Error('Mongo stub has been restored');
    if (!collections.has(name)) collections.set(name, []);
    const docs = collections.get(name);
    return {
      async createIndex() { return 'stub_index'; },
      find(filter = {}, options = {}) {
        let rows = docs.filter((doc) => matches(doc, filter)).map((doc) => project(doc, options.projection));
        const cursor = {
          sort(spec) {
            rows.sort((a, b) => {
              for (const [field, direction] of Object.entries(spec)) {
                const left = valueAt(a, field);
                const right = valueAt(b, field);
                const compare = left instanceof Date || right instanceof Date
                  ? new Date(left).getTime() - new Date(right).getTime()
                  : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true });
                if (compare) return compare * direction;
              }
              return 0;
            });
            return cursor;
          },
          limit(count) { rows = rows.slice(0, count); return cursor; },
          project(nextProjection) { rows = rows.map((row) => project(row, nextProjection)); return cursor; },
          async toArray() { return rows.map(copy); },
        };
        if (options.sort) cursor.sort(options.sort);
        return cursor;
      },
      async findOne(filter = {}, options = {}) {
        let rows = docs.filter((doc) => matches(doc, filter));
        if (options.sort) {
          rows = rows.slice().sort((a, b) => {
            const [[key, direction]] = Object.entries(options.sort);
            return String(valueAt(a, key) ?? '').localeCompare(String(valueAt(b, key) ?? ''), undefined, { numeric: true }) * direction;
          });
        }
        return rows.length ? project(rows[0], options.projection) : null;
      },
      async insertOne(document) {
        const stored = { ...document, _id: document._id || new mongoose.Types.ObjectId() };
        docs.push(stored);
        return { acknowledged: true, insertedId: stored._id };
      },
      async insertMany(documents) {
        const insertedIds = {};
        documents.forEach((doc, index) => {
          const stored = { ...doc, _id: doc._id || new mongoose.Types.ObjectId() };
          docs.push(stored);
          insertedIds[index] = stored._id;
        });
        return { acknowledged: true, insertedCount: documents.length, insertedIds };
      },
      async updateOne(filter, update, options = {}) {
        let document = docs.find((doc) => matches(doc, filter));
        let upsertedId;
        if (!document && options.upsert) {
          document = {};
          for (const [key, value] of Object.entries(filter)) {
            if (!key.startsWith('$') && (!value || typeof value !== 'object' || value instanceof mongoose.Types.ObjectId)) {
              document[key] = value;
            }
          }
          document._id = update.$setOnInsert?._id || new mongoose.Types.ObjectId();
          docs.push(document);
          upsertedId = document._id;
        }
        if (!document) return { matchedCount: 0, modifiedCount: 0, upsertedId: null };
        if (update.$setOnInsert && upsertedId) Object.assign(document, update.$setOnInsert);
        if (update.$set) Object.assign(document, update.$set);
        if (update.$inc) {
          for (const [key, increment] of Object.entries(update.$inc)) document[key] = (document[key] || 0) + increment;
        }
        return { matchedCount: upsertedId ? 0 : 1, modifiedCount: 1, upsertedId: upsertedId || null };
      },
      async updateMany(filter = {}, update = {}) {
        let modifiedCount = 0;
        for (const doc of docs) {
          if (matches(doc, filter)) {
            if (update.$set) Object.assign(doc, update.$set);
            modifiedCount += 1;
          }
        }
        return { matchedCount: modifiedCount, modifiedCount };
      },
      async findOneAndUpdate(filter, update, options = {}) {
        const result = await this.updateOne(filter, update, { ...options, upsert: options.upsert });
        const doc = docs.find((item) => matches(item, filter));
        return options.includeResultMetadata === false ? doc || null : { value: doc || null, lastErrorObject: result };
      },
      async deleteOne(filter) {
        const index = docs.findIndex((doc) => matches(doc, filter));
        if (index >= 0) docs.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
      async deleteMany(filter = {}) {
        const retained = docs.filter((doc) => !matches(doc, filter));
        const deletedCount = docs.length - retained.length;
        docs.splice(0, docs.length, ...retained);
        return { deletedCount };
      },
      async countDocuments(filter = {}) { return docs.filter((doc) => matches(doc, filter)).length; },
      aggregate(pipeline = []) {
        let rows = docs.slice();
        for (const step of pipeline) {
          if (step.$match) rows = rows.filter((doc) => matches(doc, step.$match));
          if (step.$group) {
            const grouped = new Map();
            for (const doc of rows) {
              const key = valueAt(doc, step.$group._id.replace(/^\$/, ''));
              grouped.set(key, (grouped.get(key) || 0) + (doc.present ? 1 : 0));
            }
            rows = [...grouped].map(([_id, attended]) => ({ _id, attended }));
          }
        }
        return {         async toArray() { return rows.map(copy); } };
      },
    };
  }

  const originalGetCollection = database.getCollection;
  const originalStartSession = mongoose.connection.startSession;
  const originalStartSessionRoot = mongoose.startSession;
  database.getCollection = getCollection;
  const sessionFactory = async () => ({
    async withTransaction(callback) { return callback(); },
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    async endSession() {},
  });
  mongoose.connection.startSession = sessionFactory;
  mongoose.startSession = sessionFactory;

  return {
    getCollection,
    collection(name) {
      getCollection(name);
      return collections.get(name);
    },
    close() {
      if (closed) return;
      closed = true;
      database.getCollection = originalGetCollection;
      mongoose.connection.startSession = originalStartSession;
      mongoose.startSession = originalStartSessionRoot;
    },
  };
}

module.exports = { installMongoStub };

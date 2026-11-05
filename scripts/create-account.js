'use strict';

const readline = require('readline');
const bcrypt = require('bcrypt');
const { connectDatabase, getCollection, mongoose } = require('../src/database');

const DEFAULT_ROLES = [
  { id: 1, name: 'admin' },
  { id: 2, name: 'authority' },
  { id: 3, name: 'staff' },
];

function resolveRole(roles, input) {
  const value = String(input).trim();
  const roleId = Number(value);
  return roles.find((role) => role.id === roleId)
    || roles.find((role) => role.name.toLowerCase() === value.toLowerCase());
}

async function main() {
  await connectDatabase();

  const rolesCollection = getCollection('roles');
  for (const role of DEFAULT_ROLES) {
    await rolesCollection.updateOne({ id: role.id }, { $setOnInsert: role }, { upsert: true });
  }
  const roles = await rolesCollection.find({}, { projection: { _id: 0, id: 1, name: 1 } })
    .sort({ id: 1 }).toArray();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question) => {
    process.stdout.write(question);
    const { value } = await lines.next();
    return String(value ?? '').trim();
  };

  try {
    console.log('Available roles:');
    for (const role of roles) console.log(`  ${role.id} - ${role.name}`);

    const username = await ask('Username: ');
    if (!username) throw new Error('Username is required.');

    const password = await ask('Password: ');
    if (!password) throw new Error('Password is required.');

    const role = resolveRole(roles, await ask('Role id or name: '));
    if (!role) throw new Error('Invalid role id or name.');

    const users = getCollection('users');
    if (await users.findOne({ username }, { projection: { _id: 1 } })) {
      throw new Error(`User "${username}" already exists.`);
    }

    await users.createIndex({ username: 1 }, { unique: true });
    const counter = await getCollection('counters').findOneAndUpdate(
      { _id: 'users' },
      { $inc: { sequence: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
    const userId = (counter.value || counter).sequence;
    await users.insertOne({
      id: userId,
      username,
      password_hash: await bcrypt.hash(password, 10),
      role_id: role.id,
    });

    console.log(`Account "${username}" created with role "${role.name}".`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    await mongoose.disconnect();
  });
}

module.exports = { resolveRole };

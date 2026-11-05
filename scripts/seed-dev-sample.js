'use strict';

/**
 * Development-Only Seed Script
 *
 * SAFEGUARDS:
 * 1. Strictly forbidden in production (checks NODE_ENV === 'production').
 * 2. Requires explicit command-line argument: --confirm.
 * 3. Never runs automatically on application startup.
 *
 * Usage:
 *   node scripts/seed-dev-sample.js --confirm
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const bcrypt = require('bcrypt');
const { connectDatabase, getCollection, mongoose } = require('../src/database');

const DEFAULT_ROLES = [
  { id: 1, name: 'admin' },
  { id: 2, name: 'authority' },
  { id: 3, name: 'staff' },
];

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('ERROR: Development seed script cannot run in production environment.');
    process.exit(1);
  }

  if (!process.argv.includes('--confirm')) {
    console.error('ERROR: You must pass --confirm to run the development seed script:');
    console.error('  node scripts/seed-dev-sample.js --confirm');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await connectDatabase();

  try {
    // 1. Roles
    const roles = getCollection('roles');
    for (const r of DEFAULT_ROLES) {
      await roles.updateOne({ id: r.id }, { $setOnInsert: r }, { upsert: true });
    }
    console.log('✓ Roles verified');

    // 2. Default dev users (admin, authority, staff)
    const users = getCollection('users');
    const devUsers = [
      { id: 1, username: 'admin', role_id: 1, password: 'password123' },
      { id: 2, username: 'authority', role_id: 2, password: 'password123' },
      { id: 3, username: 'staff', role_id: 3, password: 'password123' },
    ];

    for (const u of devUsers) {
      const existing = await users.findOne({ username: u.username });
      if (!existing) {
        const hash = await bcrypt.hash(u.password, 10);
        await users.insertOne({
          id: u.id,
          username: u.username,
          password_hash: hash,
          role_id: u.role_id,
          created_at: new Date(),
        });
        console.log(`✓ Created dev user: ${u.username} (password: ${u.password})`);
      } else {
        console.log(`  User ${u.username} already exists`);
      }
    }

    console.log('\nDevelopment sample seeding completed successfully.');
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});


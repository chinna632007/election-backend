'use strict';

/**
 * Opt-In Collection Cleanup & Migration Script
 *
 * SAFEGUARDS:
 * - Read-only / dry-run by default.
 * - Requires explicit --apply flag to perform any destructive action.
 * - Protects all core retained collections (users, roles, personnel, batches, allocations, etc.).
 *
 * Usage:
 *   node scripts/migrate-cleanup-unneeded-collections.js          # Dry run report only
 *   node scripts/migrate-cleanup-unneeded-collections.js --apply  # Opt-in removal of deprecated collections
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { connectDatabase, mongoose } = require('../src/database');

const CORE_RETAINED_COLLECTIONS = new Set([
  'users',
  'roles',
  'counters',
  'import_batches',
  'personnel',
  'import_rejected_rows',
  'personnel_exemptions',
  'micro_observers',
  'polling_stations',
  'mandal_adjacency',
  'election_requirements',
  'team_rosters',
  'team_roster_members',
  'allocation_runs',
  'allocation_publications',
  'randomization_runs',
  'randomization_stage1_results',
  'training_locations',
  'training_sessions',
  'training_attendance',
  'training_batches',
  'training_batch_members',
  'order_templates',
  'order_assignments',
  'generated_documents',
  'workflow_state',
  'app_settings',
  'settings_audit',
  'audit_events',
  'field_registry',
]);

const DEPRECATED_COLLECTIONS = new Set([
  'id_card_design', // Legacy feature removed per user specification
]);

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log(`=== Collection Cleanup & Health Check (${isApply ? 'APPLY MODE' : 'DRY RUN'}) ===\n`);

  await connectDatabase();

  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const existingNames = collections.map((c) => c.name);

    console.log(`Found ${existingNames.length} existing collections in database.\n`);

    const deprecatedFound = [];
    for (const name of existingNames) {
      if (DEPRECATED_COLLECTIONS.has(name)) {
        const count = await mongoose.connection.db.collection(name).countDocuments();
        deprecatedFound.push({ name, count });
      }
    }

    if (deprecatedFound.length === 0) {
      console.log('✓ No deprecated collections found. All collections match the retained data model.');
      return;
    }

    console.log('Deprecated collections detected:');
    for (const item of deprecatedFound) {
      console.log(` - ${item.name} (${item.count} documents)`);
    }

    if (!isApply) {
      console.log('\n[DRY RUN] No changes made. To remove deprecated collections, run:');
      console.log('  node scripts/migrate-cleanup-unneeded-collections.js --apply');
      return;
    }

    console.log('\nProceeding with cleanup:');
    for (const item of deprecatedFound) {
      await mongoose.connection.db.collection(item.name).drop();
      console.log(`✓ Dropped deprecated collection: ${item.name}`);
    }

    console.log('\nMigration cleanup completed successfully.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});


'use strict';

const { connectDatabase, getCollection, mongoose } = require('../src/database');

async function main() {
  await connectDatabase();

  for (const name of [
    'allocation_runs',
    'stage2_teams',
    'stage2_team_members',
    'stage3_assignments',
    'po_training_batches',
    'po_training_batch_members',
    'po_training_orders',
    'apo_training_batches',
    'apo_training_batch_members',
    'apo_training_orders',
    'personnel',
    'polling_stations',
    'users',
  ]) {
    console.log(`${name}: ${await getCollection(name).countDocuments({})}`);
  }

  const recentRuns = await getCollection('allocation_runs')
    .find({}, { projection: { _id: 1, run_by_username: 1, created_at: 1 } })
    .sort({ _id: -1 }).limit(3).toArray();
  console.log('Recent allocation runs:', JSON.stringify(recentRuns));
}

main()
  .catch((error) => {
    console.error('Failed to inspect MongoDB training state:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

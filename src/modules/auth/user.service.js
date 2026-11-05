'use strict';

const { getCollection, mongoose } = require('../../database');

function collection(name) {
  const result = getCollection(name);
  return result.collection || result;
}

/**
 * Lists all active users, their role, and counts of associated records.
 * Excludes sensitive fields like password_hash.
 */
async function listUsers() {
  const usersCollection = collection('users');
  const rolesCollection = collection('roles');
  const batchesCollection = collection('import_batches');
  const stationsCollection = collection('polling_stations');
  const sessionsCollection = collection('training_sessions');

  const [rawUsers, rawRoles] = await Promise.all([
    usersCollection.find({}, { projection: { password_hash: 0 } }).sort({ id: 1 }).toArray(),
    rolesCollection.find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
  ]);

  const roleMap = new Map(rawRoles.map((r) => [r.id, r.name]));

  const enriched = await Promise.all(
    rawUsers.map(async (u) => {
      const userId = u.id;
      const strId = String(userId);
      const [batchCount, stationCount, sessionCount] = await Promise.all([
        batchesCollection.countDocuments({ imported_by: { $in: [userId, strId] } }).catch(() => 0),
        stationsCollection.countDocuments({ imported_by: { $in: [userId, strId] } }).catch(() => 0),
        sessionsCollection.countDocuments({ created_by_user_id: { $in: [userId, strId] } }).catch(() => 0),
      ]);

      return {
        id: u.id,
        username: u.username,
        role: roleMap.get(u.role_id) || 'unknown',
        roleId: u.role_id,
        batchCount,
        stationCount,
        sessionCount,
      };
    })
  );

  return enriched;
}

/**
 * Deletes a user and removes or anonymizes all associated records.
 *
 * Rules:
 *  - User must exist.
 *  - Actor cannot delete themselves.
 *  - Cannot delete the last remaining admin user.
 *  - If user uploaded import batches: deletes personnel & rejected rows for those batches, and the batches themselves.
 *  - Deletes user's imported polling stations, training sessions, training batches, and generated documents.
 *  - Anonymizes audit events, settings audit, personnel exemptions, and field registry references.
 *  - Clears workflow state owned by this user.
 *  - Deletes the user record from `users`.
 */
async function deleteUserAndRelatedData(targetUserId, actorUserId) {
  const users = collection('users');
  const roles = collection('roles');

  const numTargetId = Number(targetUserId);
  const target = await users.findOne({ $or: [{ id: targetUserId }, { id: numTargetId }] });
  if (!target) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  if (String(target.id) === String(actorUserId) || String(targetUserId) === String(actorUserId)) {
    const err = new Error('You cannot delete your own user account');
    err.statusCode = 400;
    throw err;
  }

  // Check if target is admin and if it's the last admin
  const adminRole = await roles.findOne({ name: 'admin' });
  if (adminRole && target.role_id === adminRole.id) {
    const adminCount = await users.countDocuments({ role_id: adminRole.id });
    if (adminCount <= 1) {
      const err = new Error('Cannot delete the last remaining administrator account');
      err.statusCode = 400;
      throw err;
    }
  }

  const resolvedId = target.id;
  const strId = String(resolvedId);
  const numId = typeof resolvedId === 'number' ? resolvedId : Number(resolvedId);
  const userIds = [resolvedId, strId, numId].filter((v, i, a) => a.indexOf(v) === i && v !== undefined && !Number.isNaN(v));

  // Perform cleanup
  async function performCleanup() {
    // 1. Find batches imported by this user
    const importBatches = collection('import_batches');
    const userBatches = await importBatches.find({ imported_by: { $in: userIds } }, { projection: { id: 1 } }).toArray();
    const batchIds = userBatches.map((b) => b.id).filter(Boolean);

    // 2. Remove personnel and rejected rows for those batches
    let deletedPersonnel = 0;
    let deletedRejected = 0;
    if (batchIds.length > 0) {
      const pRes = await collection('personnel').deleteMany({ import_batch_id: { $in: batchIds } });
      deletedPersonnel = pRes?.deletedCount || 0;
      const rRes = await collection('import_rejected_rows').deleteMany({ import_batch_id: { $in: batchIds } });
      deletedRejected = rRes?.deletedCount || 0;
      await importBatches.deleteMany({ id: { $in: batchIds } });
    }

    // 3. Remove stations imported by this user
    const sRes = await collection('polling_stations').deleteMany({ imported_by: { $in: userIds } });
    const deletedStations = sRes?.deletedCount || 0;

    // 4. Remove training sessions and batches created by this user
    const sessRes = await collection('training_sessions').deleteMany({ created_by_user_id: { $in: userIds } });
    const deletedSessions = sessRes?.deletedCount || 0;
    await collection('training_batches').deleteMany({ created_by: { $in: userIds } });

    // 5. Remove generated documents created by this user
    await collection('generated_documents').deleteMany({ created_by: { $in: userIds } });

    // 6. Anonymize audit & references (preserving history without broken links)
    const anonymizedUserLabel = `[deleted-user#${resolvedId}]`;
    await collection('audit_events').updateMany(
      { actor_id: { $in: userIds } },
      { $set: { actor_id: null, actor_username: anonymizedUserLabel } }
    ).catch(() => {});

    await collection('settings_audit').updateMany(
      { updated_by: { $in: userIds } },
      { $set: { updated_by: null } }
    ).catch(() => {});

    await collection('personnel_exemptions').updateMany(
      { requested_by_user_id: { $in: userIds } },
      { $set: { requested_by_user_id: null } }
    ).catch(() => {});

    await collection('field_registry').updateMany(
      { created_by: { $in: userIds } },
      { $set: { created_by: null } }
    ).catch(() => {});

    await collection('field_registry').updateMany(
      { updated_by: { $in: userIds } },
      { $set: { updated_by: null } }
    ).catch(() => {});

    // 7. Clear workflow state snapshots updated by this user
    await collection('workflow_state').deleteMany({ updated_by: { $in: userIds } }).catch(() => {});

    // 8. Delete the user
    await users.deleteOne({ id: resolvedId });

    return {
      ok: true,
      deletedUserId: resolvedId,
      username: target.username,
      cleaned: {
        batches: batchIds.length,
        personnel: deletedPersonnel,
        rejectedRows: deletedRejected,
        pollingStations: deletedStations,
        trainingSessions: deletedSessions,
      },
    };
  }

  // Attempt transaction if supported; otherwise run sequential cleanup
  try {
    if (mongoose.connection && typeof mongoose.connection.startSession === 'function') {
      const session = await mongoose.connection.startSession();
      try {
        let result;
        await session.withTransaction(async () => {
          result = await performCleanup();
        });
        return result;
      } finally {
        await session.endSession().catch(() => {});
      }
    }
  } catch (txErr) {
    // If transactions are not supported on this MongoDB topology (e.g. standalone), fallback safely
  }

  return await performCleanup();
}

module.exports = {
  listUsers,
  deleteUserAndRelatedData,
};


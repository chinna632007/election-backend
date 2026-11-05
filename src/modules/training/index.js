'use strict';

/**
 * Protected training routes backed by MongoDB.
 */

const express = require('express');
const { requireAuth, authorize } = require('../../middleware/auth');
const { getCollection, mongoose } = require('../../database');

const WRITE = { writeConcern: { w: 'majority', j: true } };
const router = express.Router();
router.use(requireAuth);

function objectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)
    ? new mongoose.Types.ObjectId(id)
    : null;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

router.get('/sessions', async (_req, res) => {
  try {
    const sessions = await getCollection('training_sessions').find({}).sort({ _id: 1 }).toArray();
    const counts = await getCollection('training_attendance').aggregate([
      { $match: { present: true } },
      { $group: { _id: '$session_id', attended: { $sum: 1 } } },
    ]).toArray();
    const attendedBySession = new Map(counts.map((row) => [row._id, row.attended]));
    res.json({
      ok: true,
      sessions: sessions.map((session) => ({
        id: String(session._id),
        district: session.district,
        title: session.title,
        sessionType: session.session_type,
        mandal: session.mandal,
        venue: session.venue,
        scheduledAt: session.scheduled_at,
        durationMinutes: session.duration_minutes,
        conductedBy: session.conducted_by,
        status: session.status,
        createdByUserId: session.created_by_user_id,
        createdAt: session.created_at,
        attended: attendedBySession.get(String(session._id)) || 0,
      })),
    });
  } catch (err) {
    console.error('training sessions read failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load training sessions' });
  }
});

router.get('/batches', async (_req, res) => {
  try {
    const batches = await getCollection('training_batches').find({}).toArray();
    const locations = await getCollection('training_locations').find({}).toArray();
    const members = await getCollection('training_batch_members').find({}).toArray();
    const locationsById = new Map(locations.map((location) => [String(location._id), location]));
    const memberCounts = new Map();
    for (const member of members) {
      memberCounts.set(String(member.batch_id), (memberCounts.get(String(member.batch_id)) || 0) + 1);
    }
    batches.sort((a, b) => String(a.mandal).localeCompare(String(b.mandal)) || a.batch_no - b.batch_no);
    res.json({
      ok: true,
      batches: batches.map((batch) => ({
        id: String(batch._id),
        batch_no: batch.batch_no,
        mandal: batch.mandal,
        location_id: batch.location_id == null ? null : String(batch.location_id),
        created_at: batch.created_at,
        location_name: (locationsById.get(String(batch.location_id)) || {}).location_name || null,
        member_count: memberCounts.get(String(batch._id)) || 0,
      })),
    });
  } catch (err) {
    console.error('list training batches failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load training batches' });
  }
});

router.get('/batches/:id/members', async (req, res) => {
  const id = objectId(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid batch id' });
  }
  try {
    const batch = await getCollection('training_batches').findOne(
      { _id: id },
      { projection: { batch_no: 1, mandal: 1, location_id: 1, created_at: 1 } }
    );
    if (!batch) return res.status(404).json({ ok: false, error: 'Batch not found' });
    batch.id = String(batch._id);
    batch.location_id = batch.location_id == null ? null : String(batch.location_id);
    delete batch._id;
    const memberDocs = await getCollection('training_batch_members')
      .find({ batch_id: String(id) })
      .toArray();
    const personnelIds = [...new Set(memberDocs.map((member) => member.personnel_id).filter((x) => x != null))];
    const personObjectIds = personnelIds.map(objectId).filter(Boolean);
    const personnel = personObjectIds.length
      ? await getCollection('personnel').find({ _id: { $in: personObjectIds } }).toArray()
      : [];
    const personnelById = new Map(personnel.map((row) => [String(row._id), row]));
    const members = memberDocs.map((member) => {
      const person = personnelById.get(String(member.personnel_id)) || {};
      return {
        personnel_id: member.personnel_id == null ? null : String(member.personnel_id),
        employee_id: member.employee_id || person.employee_id || null,
        employee_name: person.employee_name || member.roster_name || null,
        designation: person.designation || member.roster_designation || null,
        native_mandal: person.native_mandal || null,
        work_mandal: person.work_mandal || member.roster_work_mandal || null,
      };
    }).sort((a, b) => String(a.employee_name || '').localeCompare(String(b.employee_name || '')));
    res.json({ ok: true, batch, members });
  } catch (err) {
    console.error('load batch members failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load batch members' });
  }
});

router.get('/batches/:id/locations', async (req, res) => {
  const id = objectId(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid batch id' });
  }
  try {
    const batch = await getCollection('training_batches').findOne({ _id: id }, { projection: { mandal: 1 } });
    if (!batch) return res.status(404).json({ ok: false, error: 'Batch not found' });
    const mandal = batch.mandal;
    const locationRows = await getCollection('training_locations')
      .find({ mandal })
      .project({ _id: 1, location_name: 1, panchayat: 1, mandal: 1, category: 1 })
      .sort({ location_name: 1 })
      .toArray();
    const locations = locationRows.map(({ _id, ...location }) => ({ id: String(_id), ...location }));
    res.json({ ok: true, mandal, locations });
  } catch (err) {
    console.error('list batch locations failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load locations' });
  }
});

router.patch('/batches/:id/location', authorize('authority', 'admin'), async (req, res) => {
  const id = objectId(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid batch id' });
  }
  const raw = req.body ? req.body.locationId : undefined;
  const locationId = raw === null || raw === undefined || raw === '' ? null : objectId(String(raw));
  if (raw !== null && raw !== undefined && raw !== '' && !locationId) {
    return res.status(400).json({ ok: false, error: 'Invalid location id' });
  }
  try {
    const batch = await getCollection('training_batches').findOne({ _id: id });
    if (!batch) return res.status(404).json({ ok: false, error: 'Batch not found' });
    if (locationId !== null) {
      const location = await getCollection('training_locations').findOne({ _id: locationId });
      if (!location) return res.status(404).json({ ok: false, error: 'Location not found' });
      if (location.mandal !== batch.mandal) {
        return res.status(400).json({
          ok: false,
          error: `Location must be in the batch mandal (${batch.mandal})`,
        });
      }
    }
    await getCollection('training_batches').updateOne({ _id: id }, { $set: { location_id: locationId ? String(locationId) : null } }, WRITE);
    res.json({ ok: true, id: String(id), locationId: locationId ? String(locationId) : null });
  } catch (err) {
    console.error('assign batch location failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to assign location' });
  }
});

router.post('/sessions', authorize('authority', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
      throw badRequest('title is required');
    }
    if (!['theory', 'practical'].includes(body.sessionType)) {
      throw badRequest('sessionType must be one of: theory, practical');
    }
    const session = {
      _id: new mongoose.Types.ObjectId(),
      district: body.district || 'Kakinada',
      title: body.title.trim(),
      session_type: body.sessionType,
      mandal: body.mandal || null,
      venue: body.venue || null,
      scheduled_at: body.scheduledAt || null,
      duration_minutes: body.durationMinutes !== undefined ? body.durationMinutes : null,
      conducted_by: body.conductedBy || null,
      status: 'planned',
      created_by_user_id: req.session.user.id == null ? null : String(req.session.user.id),
      created_at: new Date().toISOString(),
    };
    await getCollection('training_sessions').insertOne(session, WRITE);
    res.status(201).json({
      ok: true,
      session: {
        id: String(session._id),
        district: session.district,
        title: session.title,
        sessionType: session.session_type,
        mandal: session.mandal,
        venue: session.venue,
        scheduledAt: session.scheduled_at,
        durationMinutes: session.duration_minutes,
        conductedBy: session.conducted_by,
        status: session.status,
        createdByUserId: session.created_by_user_id,
        createdAt: session.created_at,
      },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('training create failed:', err);
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.get('/sessions/:id/attendance', async (req, res) => {
  const id = objectId(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid session id' });
  }
  try {
    const session = await getCollection('training_sessions').findOne({ _id: id }, { projection: { _id: 1 } });
    if (!session) throw notFound('Training session not found');
    const attendance = await getCollection('training_attendance')
      .find({ session_id: String(id) })
      .sort({ _id: 1 })
      .toArray();
    res.json({
      ok: true,
      attendance: attendance.map(({ session_id, personnel_id, present, role, is_reserve }) => ({
        sessionId: session_id,
        personnelId: personnel_id,
        present,
        role,
        isReserve: is_reserve,
      })),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('training attendance read failed:', err);
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.post('/sessions/:id/attendance', authorize('authority', 'admin'), async (req, res) => {
  const id = objectId(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid session id' });
  }
  try {
    if (!await getCollection('training_sessions').findOne({ _id: id }, { projection: { _id: 1 } })) {
      throw notFound('Training session not found');
    }
    const records = (req.body || {}).records;
    if (!Array.isArray(records) || records.length === 0) {
      throw badRequest('attendance records (array) are required');
    }
    const attendance = getCollection('training_attendance');
    await attendance.createIndex({ session_id: 1, personnel_id: 1 }, { unique: true, name: 'training_attendance_person_unique' });
    const written = [];
    for (const record of records) {
      if (!record || record.personnelId === undefined || record.personnelId === null) {
        throw badRequest('each record needs personnelId');
      }
      const row = {
        session_id: String(id),
        personnel_id: String(record.personnelId),
        present: record.present === true,
        role: record.role || null,
        is_reserve: record.isReserve === true,
      };
      await attendance.updateOne(
        { session_id: String(id), personnel_id: row.personnel_id },
        { $set: row },
        { upsert: true, ...WRITE }
      );
      written.push({
        sessionId: String(id),
        personnelId: row.personnel_id,
        present: row.present,
        role: row.role,
        isReserve: row.is_reserve,
      });
    }
    res.json({ ok: true, attendance: written });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('training attendance write failed:', err);
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.delete('/batches/:id/members/:personnelId', async (req, res) => {
  const id = objectId(req.params.id);
  const personnelId = objectId(req.params.personnelId);
  if (!id || !personnelId) {
    return res.status(400).json({ ok: false, error: 'Invalid batch or personnel id' });
  }
  try {
    await getCollection('training_batch_members').deleteOne(
      { batch_id: String(id), personnel_id: String(personnelId) },
      WRITE
    );
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('remove batch member failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to remove member from batch' });
  }
});

router.get('/batches/:id/orders', (_req, res) => {
  res.status(410).json({
    ok: false,
    error: 'Gone: replaced by GET /api/imports/training-orders?group=PO|APO (migration 013 tables).',
  });
});

router.post('/batches/:id/orders', (_req, res) => {
  res.status(410).json({
    ok: false,
    error: 'Gone: replaced by POST /api/imports/training-orders/generate { group }.',
  });
});

module.exports = router;

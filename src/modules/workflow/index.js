'use strict';

const express = require('express');
const { getCollection } = require('../../database');
const { requireAuth, authorize } = require('../../middleware/auth');

const CONTEXTS = new Set(['municipal', 'panchayat']);
const PHASES = new Set(['phase1', 'phase2', 'phase3', 'training']);
const router = express.Router();

router.use(requireAuth);
router.use(express.json({ limit: '20mb' }));

function collection(name) {
  const result = getCollection(name);
  return result.collection || result;
}

function validKey(context, phase) {
  return CONTEXTS.has(context) && PHASES.has(phase);
}

router.get('/:context/:phase', authorize('staff', 'authority', 'admin'), async (req, res) => {
  const { context, phase } = req.params;
  if (!validKey(context, phase)) {
    return res.status(400).json({ ok: false, error: 'Invalid election context or phase' });
  }

  try {
    const record = await collection('workflow_state').findOne(
      { context, phase },
      { projection: { _id: 0, value: 1, updated_at: 1 } }
    );
    return res.json({ ok: true, value: record?.value ?? null, updatedAt: record?.updated_at ?? null });
  } catch (error) {
    console.error('workflow state read failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to load workflow data' });
  }
});

router.put('/:context/:phase', authorize('authority', 'admin'), async (req, res) => {
  const { context, phase } = req.params;
  const value = req.body?.value;
  if (!validKey(context, phase)) {
    return res.status(400).json({ ok: false, error: 'Invalid election context or phase' });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
    return res.status(400).json({ ok: false, error: 'value must be a non-empty object' });
  }

  try {
    const updatedAt = new Date();
    await collection('workflow_state').updateOne(
      { _id: `${context}:${phase}` },
      {
        $setOnInsert: { _id: `${context}:${phase}` },
        $set: {
          context,
          phase,
          value,
          updated_at: updatedAt,
          updated_by: String(req.session.user.id),
        },
      },
      { upsert: true }
    );

    if (phase === 'phase1') {
      await collection('workflow_state').deleteOne({ context, phase: 'phase2' });
      await collection('workflow_state').deleteOne({ context, phase: 'phase3' });
      await collection('workflow_state').deleteOne({ context, phase: 'training' });
    } else if (phase === 'phase2') {
      await collection('workflow_state').deleteOne({ context, phase: 'phase3' });
      await collection('workflow_state').deleteOne({ context, phase: 'training' });
    } else if (phase === 'phase3') {
      await collection('workflow_state').deleteOne({ context, phase: 'training' });
    }

    return res.json({ ok: true, updatedAt });
  } catch (error) {
    console.error('workflow state write failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to save workflow data' });
  }
});

router.delete('/:context/:phase', authorize('authority', 'admin'), async (req, res) => {
  const { context, phase } = req.params;
  if (!validKey(context, phase)) {
    return res.status(400).json({ ok: false, error: 'Invalid election context or phase' });
  }

  try {
    await collection('workflow_state').deleteOne({ context, phase });
    if (phase === 'phase1') {
      await collection('workflow_state').deleteOne({ context, phase: 'phase2' });
      await collection('workflow_state').deleteOne({ context, phase: 'phase3' });
      await collection('workflow_state').deleteOne({ context, phase: 'training' });
    } else if (phase === 'phase2') {
      await collection('workflow_state').deleteOne({ context, phase: 'phase3' });
      await collection('workflow_state').deleteOne({ context, phase: 'training' });
    } else if (phase === 'phase3') {
      await collection('workflow_state').deleteOne({ context, phase: 'training' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('workflow state delete failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to clear workflow data' });
  }
});

module.exports = router;

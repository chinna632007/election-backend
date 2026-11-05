'use strict';

/**
 * Field-registry router — "SQL-level" data-schema customization, done safely
 * (docs/CUSTOMIZATION_ROADMAP.md §8). Admins define FIELDS, never SQL.
 *
 *   GET    /api/fields/:entity   list definitions (personnel|station)
 *   POST   /api/fields           create custom field (authority, admin)
 *   PATCH  /api/fields/:id       edit (core: label/export only)
 *   DELETE /api/fields/:id       deactivate custom field (soft)
 *
 * Session first (401), then role gate (403). Fail closed.
 */

const express = require('express');
const { requireAuth, authorize } = require('../../middleware/auth');
const { ENTITIES } = require('./field-registry.validator');
const service = require('./field-registry.service');

const router = express.Router();
router.use(requireAuth);

router.get('/:entity', authorize('staff', 'authority', 'admin'), async (req, res) => {
  const entity = req.params.entity;
  if (ENTITIES.indexOf(entity) === -1) {
    return res.status(400).json({ ok: false, error: 'entity must be one of: ' + ENTITIES.join(', ') });
  }
  try {
    const fields = await service.listFields(entity);
    res.json({ ok: true, fields: fields });
  } catch (err) {
    console.error('list fields failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load fields' });
  }
});

router.post('/', authorize('authority', 'admin'), async (req, res) => {
  try {
    const field = await service.createField(req.body, req.session.user.id);
    res.json({ ok: true, field: field });
  } catch (err) {
    if (err && err.statusCode === 400) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('create field failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to create field' });
  }
});

router.patch('/:id', authorize('authority', 'admin'), async (req, res) => {
  try {
    const field = await service.updateField(req.params.id, req.body, req.session.user.id);
    res.json({ ok: true, field: field });
  } catch (err) {
    if (err && (err.statusCode === 400 || err.statusCode === 404 || err.statusCode === 409)) {
      return res.status(err.statusCode).json({ ok: false, error: err.message });
    }
    console.error('update field failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to update field' });
  }
});

router.delete('/:id', authorize('authority', 'admin'), async (req, res) => {
  try {
    const field = await service.deactivateField(req.params.id, req.session.user.id);
    res.json({ ok: true, field: field });
  } catch (err) {
    if (err && (err.statusCode === 400 || err.statusCode === 404)) {
      return res.status(err.statusCode).json({ ok: false, error: err.message });
    }
    console.error('deactivate field failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to deactivate field' });
  }
});

module.exports = router;

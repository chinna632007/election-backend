'use strict';

/**
 * Settings router — admin customization center API.
 *
 *   GET  /api/settings          list knobs (staff sees public subset)
 *   PATCH /api/settings/:key    update one knob (authority, admin)
 *   GET  /api/settings/changes  recent audit trail (authority, admin)
 *
 * Session first (401), then role gate (403). Fail closed.
 */

const express = require('express');
const { requireAuth, authorize } = require('../../middleware/auth');
const service = require('./settings.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', authorize('staff', 'authority', 'admin'), async (req, res) => {
  try {
    const settings = await service.listSettings({ role: req.session.user.role });
    res.json({ ok: true, settings: settings });
  } catch (err) {
    console.error('list settings failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load settings' });
  }
});

router.get('/changes', authorize('authority', 'admin'), async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const changes = await service.recentChanges({ limit: limit });
    res.json({ ok: true, changes: changes });
  } catch (err) {
    console.error('list setting changes failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load setting changes' });
  }
});

router.patch('/:key', authorize('authority', 'admin'), async (req, res) => {
  try {
    const updated = await service.updateSetting({
      key: req.params.key,
      value: req.body && req.body.value,
      userId: req.session.user.id,
    });
    res.json({ ok: true, setting: updated });
  } catch (err) {
    if (err && err.statusCode === 400) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('update setting failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to update setting' });
  }
});

module.exports = router;

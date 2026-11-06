const express = require('express');
const bcrypt = require('bcrypt');
const svgCaptcha = require('svg-captcha');
const Limiter = require('express-rate-limiter');
const MemoryStore = require('express-rate-limiter/lib/memoryStore');
const { getCollection } = require('../../database');
const { requireAuth, authorize } = require('../../middleware/auth');
const { listUsers, deleteUserAndRelatedData } = require('./user.service');

const router = express.Router();

const loginLimiter = new Limiter({ db: new MemoryStore() });

router.get('/captcha', (req, res) => {
  const captcha = svgCaptcha.create({ size: 4, noise: 2, ignoreChars: '0o1lI' });
  req.session.captcha = captcha.text.toLowerCase();
  res.set('Content-Type', 'image/svg+xml');
  res.send(captcha.data);
});

router.post('/login', loginLimiter.middleware(), async (req, res) => {
  const { username, password, captcha } = req.body || {};

  if (!username || !password || !captcha) {
    return res.status(400).json({ ok: false, error: 'Username, password and captcha are required' });
  }

  const expectedCaptcha = req.session.captcha;
  delete req.session.captcha; // one attempt per captcha

  if (!expectedCaptcha || String(captcha).trim().toLowerCase() !== expectedCaptcha) {
    return res.status(400).json({ ok: false, error: 'Invalid captcha' });
  }

  const storedUser = await getCollection('users').findOne(
    { username },
    { projection: { _id: 0, id: 1, username: 1, password_hash: 1, role_id: 1 } }
  );
  const role = storedUser
    ? await getCollection('roles').findOne(
      { id: storedUser.role_id },
      { projection: { _id: 0, name: 1 } }
    )
    : null;
  const user = storedUser && role
    ? { id: storedUser.id, username: storedUser.username, password_hash: storedUser.password_hash, role: role.name }
    : null;
  const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!user || !passwordOk) {
    return res.status(401).json({ ok: false, error: 'Invalid username or password' });
  }

  req.session.regenerate(async (err) => {
    if (err) {
      return res.status(500).json({ ok: false, error: 'Failed to create session' });
    }
    req.session.user = { id: String(user.id), username: user.username, role: user.role };
    try {
      const col = getCollection('workflow_state');
      const target = col.collection || col;
      if (target && typeof target.deleteMany === 'function') {
        await target.deleteMany({});
      }
    } catch {
      // non-blocking
    }
    res.json({ ok: true, user: req.session.user });
  });
});

router.post('/logout', async (req, res) => {
  try {
    const col = getCollection('workflow_state');
    const target = col.collection || col;
    if (target && typeof target.deleteMany === 'function') {
      await target.deleteMany({});
    }
  } catch {
    // non-blocking
  }
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.session.user });
});

router.get('/users', requireAuth, authorize('admin'), async (req, res) => {
  try {
    const users = await listUsers();
    res.json({ ok: true, users });
  } catch (error) {
    console.error('list users failed:', error);
    res.status(500).json({ ok: false, error: 'Failed to list users' });
  }
});

router.delete('/users/:id', requireAuth, authorize('admin'), async (req, res) => {
  const targetId = Number(req.params.id) || req.params.id;
  const actorId = req.session.user?.id;

  try {
    const result = await deleteUserAndRelatedData(targetId, actorId);
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ ok: false, error: error.message });
    }
    console.error('delete user failed:', error);
    res.status(500).json({ ok: false, error: 'Failed to delete user' });
  }
});

module.exports = router;

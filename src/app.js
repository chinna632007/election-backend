const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const session = require('express-session');
const morgan = require('morgan');
const config = require('./config');
const authRoutes = require('./modules/auth');
const importRoutes = require('./modules/imports');
const masterDataRoutes = require('./modules/master-data');
const randomizationRoutes = require('./modules/randomization/routes');
const { createAppStage1Router } = require('./modules/randomization-stage-1/wiring');
const notificationRoutes = require('./modules/notifications');
const reportsRoutes = require('./modules/reports');
const trainingRoutes = require('./modules/training');
const settingsRoutes = require('./modules/settings');
const fieldRegistryRoutes = require('./modules/field-registry');
const workflowRoutes = require('./modules/workflow');


// Increased body limit to support large Excel uploads (10k+ personnel rows can be several MB)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// HTTP request logger (dev: combined-style output; production: same)
// Shows method, URL, status, response time, content-length for every request.
app.use(morgan('dev'));

// Debug: log every incoming request body and headers at the route entry point.
app.use((req, res, next) => {
  if (process.env.DEBUG_REQUESTS === 'true') {
    console.debug('[REQ]', req.method, req.originalUrl, {
      body: req.body,
      query: req.query,
      params: req.params,
      sessionUser: req.session && req.session.user ? req.session.user.id : null,
    });
  }
  next();
});

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/master-data', masterDataRoutes);
app.use('/api/randomization/stage-1', createAppStage1Router());
app.use('/api/randomization', randomizationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/fields', fieldRegistryRoutes);
app.use('/api/workflow', workflowRoutes);

// Serve frontend static assets (built dist) for all frontend routes
// SPA fallback: serve index.html for all non-API routes so client-side
// routing (React) works for /elections/* paths
const frontendDist = path.resolve(__dirname, '..', '..', 'polling-frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

const MONGO_CONNECTION_ERROR_NAMES = new Set([
  'MongoNetworkError',
  'MongoServerSelectionError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
  'MongoTimeoutError',
  'MongooseServerSelectionError',
]);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (MONGO_CONNECTION_ERROR_NAMES.has(error.name)) {
    console.error(
      `MongoDB request failed: ${req.method} ${req.path} (${error.name}): ${error.message}`
    );
    return res.status(503).json({
      ok: false,
      error: 'MongoDB is temporarily unavailable. The request was not completed; retry after the database connection is restored.',
    });
  }

  console.error(`Unhandled request error: ${req.method} ${req.path}`, error);
  return res.status(500).json({ ok: false, error: 'The request could not be completed.' });
});

module.exports = app;

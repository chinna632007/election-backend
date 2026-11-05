'use strict';

/** HTTP adapters for training-orders (PO/APO/OPO allocate, generate, ZIP). */

const {
  allocateTraining,
  wipeAllData: wipeAllDataLogic,
  listBatches,
  listBatchMembers,
  listBatchLocations,
  assignBatchLocation,
  generateOrders,
  listTrainingOrders,
  downloadTrainingOrder,
  buildOrdersZip,
} = require('./index');

function sendErr(res, err, fallback) {
  const status = err.statusCode || 500;
  if (status >= 500) console.error(fallback + ':', err);
  res.status(status).json({
    ok: false,
    error: status >= 500 ? fallback : err.message,
  });
}

/** POST /training-orders/allocate */
async function allocate(req, res) {
  try {
    const result = await allocateTraining({ createdBy: req.session.user.id });
    res.json({ ok: true, ...result });
  } catch (err) {
    sendErr(res, err, 'Allocation failed');
  }
}

/** POST /training-orders/wipe-all-data  (wipes all public tables except users/roles) */
async function wipeAllData(req, res) {
  try {
    const result = await wipeAllDataLogic();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[WIPE-ALL-DATA] failed:', err);
    sendErr(res, err, 'Wipe all data failed');
  }
}

/** POST /training-orders/generate  body: { group: 'PO'|'APO'|'OPO', trainingDate, trainingTime } */
async function generate(req, res) {
  try {
    const group = req.body && req.body.group;
    if (!group || !['PO', 'APO', 'OPO'].includes(String(group).toUpperCase())) {
      return res.status(400).json({ ok: false, error: 'group (PO|APO|OPO) is required' });
    }
    const result = await generateOrders({
      group: String(group).toUpperCase(),
      createdBy: req.session.user.id,
      trainingDate: req.body.trainingDate,
      trainingTime: req.body.trainingTime,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    sendErr(res, err, 'Generate failed');
  }
}

/** GET /training-orders?group=&page=&perPage= */
async function list(req, res) {
  try {
    const result = await listTrainingOrders({
      group: req.query.group,
      page: req.query.page,
      perPage: req.query.perPage,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    sendErr(res, err, 'Failed to list training orders');
  }
}

/** GET /training-orders/batches?group=PO|APO */
async function batches(req, res) {
  try {
    const group = req.query.group;
    if (!group) return res.status(400).json({ ok: false, error: 'group (PO|APO|OPO) is required' });
    const result = await listBatches(group);
    res.json({ ok: true, ...result });
  } catch (err) {
    sendErr(res, err, 'Failed to list batches');
  }
}

/** GET /training-orders/batches/:id/members?group= */
async function members(req, res) {
  try {
    const result = await listBatchMembers(req.query.group, req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    sendErr(res, err, 'Failed to list members');
  }
}

/** GET /training-orders/batches/:id/locations?group= */
async function locations(req, res) {
  try {
    const result = await listBatchLocations(req.query.group, req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    sendErr(res, err, 'Failed to list locations');
  }
}

/** PATCH /training-orders/batches/:id/location  body: { group, locationId } */
async function setLocation(req, res) {
  try {
    const group = req.body && req.body.group;
    const locationId = req.body ? req.body.locationId : undefined;
    const result = await assignBatchLocation(group, req.params.id, locationId);
    res.json({ ok: true, ...result });
  } catch (err) {
    sendErr(res, err, 'Failed to assign location');
  }
}

/** GET /training-orders/:group/:id/download  (single docx) */
async function downloadOne(req, res) {
  try {
    const { order, buffer, mime, filename } = await downloadTrainingOrder(
      req.params.group,
      req.params.id
    );
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
    void order;
  } catch (err) {
    sendErr(res, err, 'Failed to download');
  }
}

/** GET /training-orders/download-zip?group=PO|APO|OPO|ALL */
async function downloadZip(req, res) {
  try {
    const group = req.query.group || 'ALL';
    const { buffer, filename, count } = await buildOrdersZip(group);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Order-Count', String(count));
    res.send(buffer);
  } catch (err) {
    sendErr(res, err, 'Failed to build ZIP');
  }
}

module.exports = {
  allocate,
  wipeAllData,
  generate,
  list,
  batches,
  members,
  locations,
  setLocation,
  downloadOne,
  downloadZip,
  // legacy alias used by older route wiring
  printOrder: generate,
  download: downloadOne,
};

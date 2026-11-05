'use strict';

/**
 * Master data persistence for polling-station imports. Each import batch and
 * its accepted station records are committed together.
 */

const { getCollection, mongoose } = require('../../database');
const { validateStations } = require('./stations.validation');

const WRITE = { writeConcern: { w: 'majority', j: true } };

function objectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)
    ? new mongoose.Types.ObjectId(id)
    : null;
}

async function persistStationImport({ fileName, stations, importedBy }) {
  if (!Array.isArray(stations)) {
    const err = new Error('stations must be an array');
    err.statusCode = 400;
    throw err;
  }
  const { accepted, rejected } = validateStations(stations);
  const batchObjectId = new mongoose.Types.ObjectId();
  const batchId = String(batchObjectId);
  const timestamp = new Date();
  const batch = {
    _id: batchObjectId,
    file_name: fileName,
    imported_by: importedBy == null ? null : String(importedBy),
    total_rows: accepted.length + rejected.length,
    accepted_rows: accepted.length,
    rejected_rows: rejected.length,
    status: 'completed',
    kind: 'stations',
    imported_at: timestamp,
  };
  try {
    await getCollection('import_batches').insertOne(batch, WRITE);
    if (accepted.length > 0) {
      const stationDocs = accepted.map((record) => ({
        _id: new mongoose.Types.ObjectId(),
        import_batch_id: batchId,
        district: record.district,
        station_id: record.stationId,
        station_number: record.stationNumber,
        station_name: record.stationName,
        building_name: record.buildingName,
        street: record.street,
        locality: record.locality,
        ward: record.ward,
        mandal: record.mandal,
        pin_code: record.pinCode,
        required_officers: record.requiredOfficers,
      }));
      await getCollection('polling_stations').insertMany(stationDocs, { ...WRITE, ordered: true });
    }
  } catch (error) {
    try {
      await getCollection('polling_stations').deleteMany({ import_batch_id: batchId }, WRITE);
      await getCollection('import_batches').deleteOne({ _id: batchObjectId }, WRITE);
    } catch (cleanupError) {
      throw new Error(
        `Polling-station import failed (${error.message}); compensating cleanup also failed (${cleanupError.message}). Batch ${batchId} may require manual cleanup.`,
        { cause: error }
      );
    }
    throw error;
  }
  return {
    batchId,
    totalRows: accepted.length + rejected.length,
    acceptedRows: accepted.length,
    rejectedRows: rejected.length,
    rejected,
  };
}

async function listStations({ batchId, district, limit } = {}) {
  const cap = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 5000) : 1000;
  const filter = {};
  if (batchId !== undefined && batchId !== null) {
    filter.import_batch_id = String(objectId(String(batchId)) || batchId);
  }
  if (district) filter.district = district;
  const rows = await getCollection('polling_stations')
    .find(filter, {
      projection: {
        _id: 1,
        import_batch_id: 1,
        district: 1,
        station_id: 1,
        station_number: 1,
        station_name: 1,
        building_name: 1,
        street: 1,
        locality: 1,
        ward: 1,
        mandal: 1,
        pin_code: 1,
        required_officers: 1,
      },
    })
    .sort({ _id: 1 })
    .limit(cap)
    .toArray();
  return {
    count: rows.length,
    stations: rows.map(({ _id, ...row }) => ({ id: String(_id), ...row })),
  };
}

module.exports = { persistStationImport, listStations, objectId };

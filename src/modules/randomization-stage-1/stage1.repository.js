'use strict';

/**
 * Stage 1 persistence ports. The application repository stores runs and
 * results in MongoDB; the in-memory implementation is retained only for
 * isolated service tests and is never wired into the runtime.
 */

const crypto = require('crypto');
const { getCollection, mongoose } = require('../../database');
const { Stage1PersistenceError, Stage1ConflictError } = require('./stage1.errors');
const { RUN_STATUS, STAGE_NUMBER } = require('./stage1.constants');

function createInMemoryStage1Repository({ electionConfigurations = [], personnel = [] } = {}) {
  const runs = [];
  const results = [];
  return {
    async beginTransaction() { return { id: crypto.randomUUID(), open: true }; },
    async commitTransaction(tx) {
      if (!tx || tx.open !== true) throw new Stage1PersistenceError('Transaction is not open.');
      tx.open = false;
    },
    async rollbackTransaction(tx) {
      if (!tx) return;
      if (tx.__runId) {
        const runIndex = runs.findIndex((run) => run.runId === tx.__runId);
        if (runIndex >= 0) runs.splice(runIndex, 1);
        for (let index = results.length - 1; index >= 0; index -= 1) {
          if (results[index].runId === tx.__runId) results.splice(index, 1);
        }
      }
      tx.open = false;
    },
    async getElectionConfiguration(_tx, id, districtId) {
      const cfg = electionConfigurations.find((c) => String(c.id) === String(id)) || null;
      if (cfg && districtId !== undefined && String(cfg.districtId) !== String(districtId)) return null;
      return cfg;
    },
    async hasActiveRun(_tx, electionConfigurationId) {
      return runs.some((r) => String(r.electionConfigurationId) === String(electionConfigurationId) &&
        r.stage === STAGE_NUMBER && r.status === RUN_STATUS.COMPLETED);
    },
    async getEligibleCandidates(_tx, { districtId, mandalId } = {}) {
      return personnel.filter((p) => String(p.districtId) === String(districtId) &&
        (mandalId == null || String(p.mandalId) === String(mandalId)));
    },
    async insertRun(tx, record) {
      if (tx && tx.open === false) throw new Stage1PersistenceError('Cannot write inside a closed transaction.');
      if (record.__failNextPersist) throw new Stage1PersistenceError('Simulated write failure.');
      if (runs.some((r) => String(r.electionConfigurationId) === String(record.electionConfigurationId) &&
        r.stage === STAGE_NUMBER && r.status === RUN_STATUS.COMPLETED)) {
        throw new Stage1ConflictError('A completed Stage 1 run already exists for this election configuration.');
      }
      const runId = `s1run-${crypto.randomUUID()}`;
      runs.push({ runId, ...record });
      if (tx) tx.__runId = runId;
      return { runId };
    },
    async insertResults(tx, runId, entries) {
      if (!runs.some((r) => r.runId === runId)) throw new Stage1PersistenceError('Run does not exist; cannot attach results.');
      results.push(...entries.map((entry) => ({ ...entry, runId })));
      if (tx) tx.__resultCount = entries.length;
    },
    async getRun(_tx, runId, districtId) {
      const run = runs.find((r) => r.runId === String(runId)) || null;
      return run && (districtId === undefined || String(run.districtId) === String(districtId)) ? run : null;
    },
    async listRuns(_tx, { electionConfigurationId, districtId, limit = 50, offset = 0 } = {}) {
      return runs.filter((r) => !electionConfigurationId || String(r.electionConfigurationId) === String(electionConfigurationId))
        .filter((r) => districtId == null || String(r.districtId) === String(districtId))
        .slice(offset, offset + limit);
    },
    async getResults(_tx, runId, districtId) {
      const run = runs.find((r) => r.runId === String(runId));
      if (!run || (districtId !== undefined && String(run.districtId) !== String(districtId))) return [];
      return results.filter((r) => r.runId === String(runId));
    },
    __state: { runs, results },
  };
}

function createMongoStage1Repository({ getRegisteredConfiguration = () => null } = {}) {
  function stage1Filter(extra = {}) { return { stage: STAGE_NUMBER, ...extra }; }
  function runDocument(doc) {
    if (!doc) return null;
    return {
      runId: String(doc.run_id || doc._id),
      electionConfigurationId: String(doc.election_configuration_id),
      districtId: doc.district_id,
      stage: doc.stage,
      executedAt: doc.executed_at,
      status: doc.status,
      targetPoolCount: doc.target_pool_count,
      selectedCount: doc.selected_count,
      requiredCount: doc.required_count,
      reserveCount: doc.reserve_count,
      executedBy: doc.executed_by == null ? null : String(doc.executed_by),
    };
  }

  return {
    async beginTransaction() {
      await getCollection('randomization_runs').createIndex(
        { election_configuration_id: 1 },
        {
          unique: true,
          name: 'one_completed_stage1_run_per_election',
          partialFilterExpression: { stage: STAGE_NUMBER, status: RUN_STATUS.COMPLETED },
        }
      );
      return { open: true, runId: null };
    },
    async commitTransaction(tx) {
      if (!tx || !tx.open) throw new Stage1PersistenceError('Transaction is not open.');
      tx.open = false;
    },
    async rollbackTransaction(tx) {
      if (!tx || !tx.open) return;
      try {
        if (tx.runId) {
          await getCollection('randomization_stage1_results').deleteMany({ run_id: String(tx.runId) });
          await getCollection('randomization_runs').deleteOne({ run_id: String(tx.runId) });
        }
      } finally {
        tx.open = false;
      }
    },
    async getElectionConfiguration(tx, id, districtId) {
      let cfg = await getCollection('election_configurations').findOne(
        { $or: [
          { id: String(id) },
          { election_configuration_id: String(id) },
          ...(mongoose.isValidObjectId(id) ? [{ _id: new mongoose.Types.ObjectId(id) }] : []),
        ] }
      );
      if (!cfg) {
        const registered = getRegisteredConfiguration(String(id));
        if (registered) {
          cfg = { ...registered, district_id: registered.districtId || districtId };
          await getCollection('election_configurations').updateOne(
            { id: String(id) },
            { $set: { ...cfg, id: String(id), district_id: String(cfg.district_id) } },
            { upsert: true }
          );
        }
      }
      const configDistrict = cfg && (cfg.district_id || cfg.districtId);
      if (!cfg || (districtId !== undefined && configDistrict != null &&
        String(configDistrict) !== String(districtId))) return null;
      return {
        ...cfg,
        id: String(cfg.id || cfg.election_configuration_id || cfg._id),
        districtId: cfg.districtId || cfg.district_id || districtId,
        requiredStrength: cfg.requiredStrength || cfg.required_strength,
      };
    },
    async hasActiveRun(tx, electionConfigurationId) {
      return Boolean(await getCollection('randomization_runs').findOne(stage1Filter({
        election_configuration_id: String(electionConfigurationId),
        status: RUN_STATUS.COMPLETED,
      })));
    },
    async getEligibleCandidates(tx, { districtId, mandalId } = {}) {
      const batch = await getCollection('import_batches').findOne(
        { kind: 'personnel', status: 'completed' },
        { sort: { id: -1 }, projection: { id: 1 } }
      );
      if (!batch) return [];
      const query = {
        district: String(districtId),
        import_batch_id: batch.id,
        $or: [{ is_active: true }, { is_active: { $exists: false } }],
      };
      if (mandalId != null) query.work_mandal = String(mandalId);
      const cursor = await getCollection('personnel').find(query, {
        projection: {
          _id: 0, employee_id: 1, employee_name: 1, designation: 1, is_active: 1,
          district: 1, work_mandal: 1, native_mandal: 1, gazetted_status: 1, exempt_category: 1,
        },
        limit: 5000,

      });
      const docs = await cursor.toArray();
      return docs.map((p) => ({
        id: String(p.employee_id),
        name: p.employee_name,
        designation: p.designation,
        isActive: p.is_active !== false,
        districtId: p.district,
        mandalId: p.work_mandal,
        workMandal: p.work_mandal,
        nativeMandal: p.native_mandal,
        gazettedStatus: p.gazetted_status || null,
        exemptCategory: p.exempt_category || null,
      }));
    },
    async insertRun(tx, runRecord) {
      const existing = await getCollection('randomization_runs').findOne(stage1Filter({
        election_configuration_id: String(runRecord.electionConfigurationId),
        status: RUN_STATUS.COMPLETED,
      }));
      if (existing) throw new Stage1ConflictError('A completed Stage 1 run already exists for this election configuration.');
      const runId = `s1run-${crypto.randomUUID()}`;
      try {
        await getCollection('randomization_runs').insertOne({
          run_id: runId,
          election_configuration_id: String(runRecord.electionConfigurationId),
          district_id: String(runRecord.districtId),
          stage: STAGE_NUMBER,
          executed_by: runRecord.executedBy,
          executed_at: new Date(runRecord.executedAt),
          status: runRecord.status,
          target_pool_count: runRecord.targetPoolCount,
          selected_count: runRecord.selectedCount,
          required_count: runRecord.requiredCount,
          reserve_count: runRecord.reserveCount,
        });
      if (tx) tx.runId = runId;
      } catch (err) {
        if (err && err.code === 11000) {
          throw new Stage1ConflictError('A completed Stage 1 run already exists for this election configuration.');
        }
        throw err;
      }
      return { runId };
    },
    async insertResults(tx, runId, entries) {
      const run = await getCollection('randomization_runs').findOne({ run_id: String(runId) });
      if (!run) throw new Stage1PersistenceError('Run does not exist; cannot attach results.');
      if (entries.length) {
        await getCollection('randomization_stage1_results').insertMany(entries.map((entry) => ({
          run_id: String(runId),
          district_id: String(run.district_id),
          personnel_id: String(entry.personnelId),
          mandal_id: String(entry.mandalId),
          classification: entry.classification,
        })), { ordered: true });
      }
    },
    async getRun(tx, runId, districtId) {
      const query = { $or: [{ run_id: String(runId) }, ...(mongoose.isValidObjectId(runId) ? [{ _id: new mongoose.Types.ObjectId(runId) }] : [])] };
      if (districtId !== undefined) query.district_id = String(districtId);
      return runDocument(await getCollection('randomization_runs').findOne(query));
    },
    async listRuns(tx, { electionConfigurationId, districtId, limit = 50, offset = 0 } = {}) {
      const query = stage1Filter();
      if (electionConfigurationId) query.election_configuration_id = String(electionConfigurationId);
      if (districtId != null) query.district_id = String(districtId);
      const cursor = await getCollection('randomization_runs').find(query, {
        sort: { executed_at: -1, _id: -1 },
        skip: offset,
        limit,
      });
      const docs = await cursor.toArray();
      return docs.map(runDocument);
    },
    async getResults(tx, runId, districtId) {
      const run = await this.getRun(tx, runId, districtId);
      if (!run) return [];
      const cursor = await getCollection('randomization_stage1_results').find(
        { run_id: String(run.runId), district_id: String(run.districtId) },
        { projection: { _id: 0, run_id: 0, district_id: 0 } }
      );
      const docs = await cursor.toArray();
      return docs.map((doc) => ({
        personnelId: doc.personnel_id,
        mandalId: doc.mandal_id,
        classification: doc.classification,
      }));
    },
  };
}

module.exports = {
  createInMemoryStage1Repository,
  createMongoStage1Repository,
};

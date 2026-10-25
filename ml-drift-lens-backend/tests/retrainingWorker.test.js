const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  processNextRetrainingJob,
  sanitizeFailureMessage,
} = require("../services/retrainingWorker");
const {
  SOURCE,
  SOURCE_VERSION,
} = require("../services/verifiedTrainingDataSource");

function fakePool({ job, records, candidateError, candidate = {} }) {
  const updates = [];
  const connection = {
    async query(query) {
      if (/^BEGIN$|^COMMIT$/i.test(query)) return { rows: [] };
      if (/SELECT job\.\*/i.test(query)) return { rows: job ? [job] : [] };
      if (/SET status = 'collecting_data'/i.test(query)) {
        return { rows: [{ ...job, status: "collecting_data", attempt_count: job.attempt_count + 1 }] };
      }
      throw new Error(`Unexpected transaction query: ${query}`);
    },
    release() {},
  };
  return {
    updates,
    async connect() { return connection; },
    async query(query, values) {
      if (/SET status = CASE WHEN attempt_count/i.test(query)) return { rows: [] };
      if (/FROM predictions/i.test(query)) {
        assert.match(query, /actual_label_source/);
        assert.match(query, /actual_label_verified_at/);
        return { rows: records };
      }
      if (/UPDATE retraining_jobs/i.test(query)) {
        updates.push({ query, values });
        return { rows: [{ id: values[0], status: values[1] }] };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };
}

const queuedJob = {
  id: 10,
  model_id: "nsl-kdd-baseline",
  old_model_version: "0.1.0",
  min_samples: 2,
  attempt_count: 0,
};

function trustedData(records) {
  return {
    records,
    source: SOURCE,
    sourceVersion: SOURCE_VERSION,
    labelSources: [...new Set(records.map((record) => record.actual_label_source))],
    trustConfigured: true,
    excludedRecordCount: 0,
  };
}

test("waits for source-attributed verified labels instead of training on predictions", async () => {
  const database = fakePool({
    job: queuedJob,
    records: [{ id: 1, actual_label: "attack", actual_label_source: null, actual_label_verified_at: null }],
  });
  let trainCalls = 0;
  const result = await processNextRetrainingJob({
    pool: database,
    runCandidateRetraining: async () => { trainCalls += 1; },
  });

  assert.equal(result.status, "waiting_for_labelled_data");
  assert.equal(trainCalls, 0);
  assert.match(database.updates.at(-1).query, /UPDATE retraining_jobs/i);
  assert.equal(database.updates.at(-1).values[1], "waiting_for_labelled_data");
  assert.match(database.updates.at(-1).values[6], /No trusted verified-label source/);
});

test("waits when trusted, well-formed labels are below the job minimum", async () => {
  const records = [
    { id: 1, actual_label: "normal", actual_label_source: "trusted", actual_label_verified_at: "2026-10-01" },
  ];
  const database = fakePool({ job: queuedJob, records });
  let trainCalls = 0;
  const result = await processNextRetrainingJob({
    pool: database,
    loadVerifiedTrainingData: async () => trustedData(records),
    runCandidateRetraining: async () => { trainCalls += 1; },
  });

  assert.equal(result.status, "waiting_for_labelled_data");
  assert.equal(trainCalls, 0);
  assert.match(database.updates.at(-1).values[6], /Insufficient trusted/);
});

test("persists candidate-ready state after background training succeeds", async () => {
  const records = [
    { id: 1, actual_label: "normal", actual_label_source: "analyst", actual_label_verified_at: "2026-10-01" },
    { id: 2, actual_label: "attack", actual_label_source: "analyst", actual_label_verified_at: "2026-10-01" },
  ];
  const database = fakePool({ job: queuedJob, records });
  const result = await processNextRetrainingJob({
    pool: database,
    loadVerifiedTrainingData: async () => trustedData(records),
    runCandidateRetraining: async (input, options) => {
      assert.deepEqual(input, records);
      assert.equal(options.modelId, queuedJob.model_id);
      return {
        status: "completed",
        candidate_version: "candidate-worker-test",
        sample_count: 2,
        metrics: { f1: 0.75, precision: 0.8, recall: 0.7 },
        evaluation: {
          incumbent_metrics: { f1: 0.5 },
          sample_count: 2,
        },
      };
    },
  });

  assert.equal(result.status, "candidate_ready");
  assert.equal(database.updates.at(-1).values[1], "candidate_ready");
  assert.equal(database.updates.at(-1).values[5], "candidate-worker-test");
});

test("raises the data threshold when the held-out evaluation set is too small", async () => {
  const records = [
    { id: 1, actual_label: "normal", actual_label_source: "analyst", actual_label_verified_at: "2026-10-01" },
    { id: 2, actual_label: "attack", actual_label_source: "analyst", actual_label_verified_at: "2026-10-01" },
  ];
  const database = fakePool({ job: queuedJob, records });
  const result = await processNextRetrainingJob({
    pool: database,
    loadVerifiedTrainingData: async () => trustedData(records),
    runCandidateRetraining: async () => ({
      status: "insufficient_data",
      sample_count: 2,
      evaluation_sample_count: 1,
      required_samples: 10,
    }),
  });

  assert.equal(result.status, "waiting_for_labelled_data");
  assert.equal(database.updates.at(-1).values[9], 10);
});

test("uses bounded retries and records worker failures", async () => {
  const records = [
    { id: 1, actual_label: "normal", actual_label_source: "analyst", actual_label_verified_at: "2026-10-01" },
    { id: 2, actual_label: "attack", actual_label_source: "analyst", actual_label_verified_at: "2026-10-01" },
  ];
  const database = fakePool({ job: { ...queuedJob, attempt_count: 1 }, records });
  const result = await processNextRetrainingJob({
    pool: database,
    loadVerifiedTrainingData: async () => trustedData(records),
    runCandidateRetraining: async () => { throw new Error("temporary training failure"); },
  });

  assert.equal(result.status, "queued");
  assert.equal(database.updates.at(-1).values[1], "queued");
  assert.equal(database.updates.at(-1).values[6], "temporary training failure");
});

test("redacts common credential forms before persisting worker errors", () => {
  const safe = sanitizeFailureMessage(new Error(
    "Bearer token123 password=hunter2 https://user:pass@example.test/failure",
  ));

  assert.equal(safe.includes("token123"), false);
  assert.equal(safe.includes("hunter2"), false);
  assert.equal(safe.includes("user:pass"), false);
  assert.match(safe, /Bearer \[REDACTED\]/);
});

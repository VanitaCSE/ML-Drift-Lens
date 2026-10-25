const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildAlertMessage,
  consumeDriftEventsOnce,
  createAlertFromDriftEvent,
  parseDriftEvent,
} = require("../services/alertingConsumer");

function validEvent(overrides = {}) {
  return [
    "1712345678901-0",
    {
      event_type: "drift_detected",
      drift_score_id: "42",
      model_id: "intrusion-detector-v1",
      model_version: "0.1.0",
      score: "0.28",
      status: "significant_drift",
      ...overrides,
    },
  ];
}

test("creates an alert for a valid drift event with the correct association", async () => {
  let query;
  const pool = {
    query: async (text, values) => {
      query = { text, values };
      return { rows: [{ id: 7, drift_score_id: 42, model_id: values[1], message: values[2] }] };
    },
  };

  const result = await createAlertFromDriftEvent(validEvent(), pool);

  assert.equal(result.created, true);
  assert.match(query.text, /INSERT INTO alerts/i);
  assert.deepEqual(query.values, [
    42,
    "intrusion-detector-v1",
    "Significant PSI drift detected for model intrusion-detector-v1",
    "open",
  ]);
  assert.equal(buildAlertMessage({ model_id: query.values[1] }), query.values[2]);
});

test("rejects malformed and unsupported events without database writes", async () => {
  let writes = 0;
  const pool = { query: async () => { writes += 1; return { rows: [] }; } };

  const malformed = await createAlertFromDriftEvent(
    validEvent({ drift_score_id: "not-an-id" }),
    pool,
  );
  const unsupported = await createAlertFromDriftEvent(
    validEvent({ event_type: "other_event" }),
    pool,
  );

  assert.equal(malformed.created, false);
  assert.equal(malformed.ignored, false);
  assert.equal(unsupported.ignored, true);
  assert.equal(writes, 0);
  assert.equal(parseDriftEvent(["id", ["event_type", "other_event"]]).ignored, true);
});

test("does not create a duplicate alert when PostgreSQL reports a conflict", async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const result = await createAlertFromDriftEvent(validEvent(), pool);

  assert.equal(result.created, false);
  assert.equal(result.duplicate, true);
});

test("consumes valid events and handles Redis failures safely", async () => {
  let retrainingCalls = 0;
  const pool = {
    query: async (text) => /retraining_jobs/i.test(text) ? { rows: [] } : { rows: [{ id: 7 }] },
  };
  const client = {
    xGroupCreate: async () => {},
    xReadGroup: async () => [{ messages: [{ id: "1-0", message: validEvent()[1] }] }],
    xAck: async () => 1,
  };

  const consumed = await consumeDriftEventsOnce(client, pool, {
    enqueueRetraining: async () => { retrainingCalls += 1; },
  });
  const unavailable = await consumeDriftEventsOnce({
    xGroupCreate: async () => {},
    xReadGroup: async () => { throw new Error("Redis unavailable"); },
  }, pool);

  assert.deepEqual(consumed, { consumed: 1, created: 1, failed: 0, recoveryError: null });
  assert.equal(retrainingCalls, 1);
  assert.equal(unavailable.reason, "Redis unavailable");
});

test("does not retrain for insufficient data or normal drift events", async () => {
  let writes = 0;
  let retrainingCalls = 0;
  const pool = { query: async () => { writes += 1; return { rows: [] }; } };
  const client = {
    xGroupCreate: async () => {},
    xReadGroup: async () => [{ messages: [
      { id: "1-0", message: { ...validEvent()[1], status: "insufficient_data" } },
      { id: "2-0", message: { ...validEvent()[1], status: "no_drift" } },
    ] }],
  };

  const result = await consumeDriftEventsOnce(client, pool, {
    enqueueRetraining: async () => { retrainingCalls += 1; },
  });

  assert.equal(result.consumed, 2);
  assert.equal(retrainingCalls, 0);
  assert.equal(writes, 0);
});

test("does not create a duplicate retraining job for a duplicate drift event", async () => {
  let retrainingCalls = 0;
  const pool = {
    query: async (text) => {
      if (/INSERT INTO alerts/i.test(text)) return { rows: [] };
      if (/retraining_jobs/i.test(text)) return { rows: [{ id: 99 }] };
      return { rows: [] };
    },
  };
  const client = {
    xGroupCreate: async () => {},
    xReadGroup: async () => [{ messages: [{ id: "3-0", message: validEvent()[1] }] }],
  };

  await consumeDriftEventsOnce(client, pool, {
    enqueueRetraining: async () => { retrainingCalls += 1; },
  });

  assert.equal(retrainingCalls, 0);
});

test("reports retraining failures without acknowledging the Redis event", async () => {
  let acknowledgements = 0;
  const pool = {
    query: async (text) => /retraining_jobs/i.test(text) ? { rows: [] } : { rows: [{ id: 7 }] },
  };
  const client = {
    xGroupCreate: async () => {},
    xReadGroup: async () => [{ messages: [{ id: "4-0", message: validEvent()[1] }] }],
    xAck: async () => { acknowledgements += 1; },
  };

  const result = await consumeDriftEventsOnce(client, pool, {
    enqueueRetraining: async () => { throw new Error("retraining failed"); },
  });

  assert.equal(result.failed, 1);
  assert.equal(acknowledgements, 0);
});

test("keeps malformed drift messages pending instead of acknowledging them", async () => {
  let acknowledgements = 0;
  const client = {
    xGroupCreate: async () => {},
    xReadGroup: async () => [{ messages: [{
      id: "5-0",
      message: { ...validEvent()[1], drift_score_id: "invalid" },
    }] }],
    xAck: async () => { acknowledgements += 1; },
  };

  const result = await consumeDriftEventsOnce(client, { query: async () => ({ rows: [] }) });

  assert.equal(result.failed, 1);
  assert.equal(acknowledgements, 0);
});

test("reports pending-message recovery failures while still processing new events", async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const client = {
      xGroupCreate: async () => {},
      xReadGroup: async () => [{ messages: [] }],
      xAutoClaim: async () => {
        throw Object.assign(new Error("private details must not be logged"), {
          code: "REDIS_DOWN",
        });
      },
    };

    const result = await consumeDriftEventsOnce(client, { query: async () => ({ rows: [] }) });

    assert.equal(result.consumed, 0);
    assert.deepEqual(result.recoveryError, { code: "REDIS_DOWN", name: "Error" });
    assert.equal(JSON.stringify(warnings).includes("private details"), false);
  } finally {
    console.warn = originalWarn;
  }
});
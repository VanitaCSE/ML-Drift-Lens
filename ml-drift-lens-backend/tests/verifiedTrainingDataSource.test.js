const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  SOURCE,
  SOURCE_VERSION,
  loadVerifiedTrainingData,
} = require("../services/verifiedTrainingDataSource");

test("loads only allowlisted, well-formed verified labels for the requested model", async () => {
  let query;
  const records = [
    {
      id: 1,
      model_id: "detector",
      actual_label: "attack",
      actual_label_source: "analyst-b",
      actual_label_verified_at: "2026-10-01",
    },
    {
      id: 2,
      model_id: "detector",
      actual_label: "normal",
      actual_label_source: "analyst-a",
      actual_label_verified_at: "2026-10-02",
    },
  ];
  const result = await loadVerifiedTrainingData("detector", {
    query: async (text, values) => {
      query = { text, values };
      return { rows: records };
    },
  }, ["analyst-a", "analyst-b"]);

  assert.deepEqual(query.values, ["detector", ["analyst-a", "analyst-b"]]);
  assert.match(query.text, /actual_label IS NOT NULL/);
  assert.match(query.text, /BTRIM\(actual_label_source\) = ANY/);
  assert.match(query.text, /actual_label_verified_at IS NOT NULL/);
  assert.match(query.text, /LOWER\(BTRIM\(actual_label\)\)/);
  assert.match(query.text, /ORDER BY timestamp ASC, id ASC/);
  assert.equal(result.source, SOURCE);
  assert.equal(result.sourceVersion, SOURCE_VERSION);
  assert.deepEqual(result.records, records);
  assert.deepEqual(result.labelSources, ["analyst-a", "analyst-b"]);
  assert.equal(result.trustConfigured, true);
  assert.equal(result.excludedRecordCount, 0);
  assert.ok(Number.isFinite(Date.parse(result.retrievedAt)));
});

test("does not query labels when no trusted source is configured", async () => {
  let queried = false;
  const result = await loadVerifiedTrainingData("detector", {
    query: async () => { queried = true; return { rows: [] }; },
  }, []);

  assert.equal(queried, false);
  assert.deepEqual(result.records, []);
  assert.equal(result.trustConfigured, false);
  assert.match(result.blockedReason, /No trusted verified-label sources/);
});

test("excludes labels from untrusted, malformed, or timestamp-invalid records", async () => {
  const result = await loadVerifiedTrainingData("detector", {
    query: async () => ({
      rows: [
        { actual_label: "attack", actual_label_source: "analyst", actual_label_verified_at: "2026-10-01" },
        { actual_label: "unknown", actual_label_source: "trusted", actual_label_verified_at: "2026-10-01" },
        { actual_label: "normal", actual_label_source: "trusted", actual_label_verified_at: "not-a-date" },
        { actual_label: "normal", actual_label_source: "untrusted", actual_label_verified_at: "2026-10-01" },
      ],
    }),
  }, ["trusted"]);

  assert.equal(result.records.length, 0);
  assert.equal(result.excludedRecordCount, 4);
});

test("rejects an empty model identity before querying", async () => {
  let queried = false;
  await assert.rejects(
    loadVerifiedTrainingData("  ", { query: async () => { queried = true; } }, ["trusted"]),
    /model id is required/i,
  );
  assert.equal(queried, false);
});

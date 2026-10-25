const defaultPool = require("../db");

const SOURCE = "verified_prediction_records";
const SOURCE_VERSION = "verified_prediction_records-v1";

function parseTrustedSources(value = process.env.VERIFIED_LABEL_SOURCE_ALLOWLIST) {
  return [...new Set(
    (value || "")
      .split(",")
      .map((source) => source.trim())
      .filter(Boolean),
  )].sort();
}

function isValidGroundTruth(record) {
  if (typeof record.actual_label !== "string") return false;
  const normalizedLabel = record.actual_label.trim().toLowerCase().replace(/\.$/, "");
  if (!["normal", "attack"].includes(normalizedLabel)) return false;
  if (
    typeof record.actual_label_source !== "string"
    || !record.actual_label_source.trim()
    || !parseableVerificationTime(record.actual_label_verified_at)
  ) return false;
  return true;
}

function parseableVerificationTime(value) {
  if (!(value instanceof Date) && typeof value !== "string") return false;
  return Number.isFinite(Date.parse(value instanceof Date ? value.toISOString() : value));
}

async function loadVerifiedTrainingData(
  modelId,
  pool = defaultPool,
  trustedSources = parseTrustedSources(),
) {
  if (typeof modelId !== "string" || !modelId.trim()) {
    throw new Error("A model id is required to load verified training data");
  }

  if (!Array.isArray(trustedSources) || trustedSources.length === 0) {
    return {
      records: [],
      source: SOURCE,
      sourceVersion: SOURCE_VERSION,
      labelSources: [],
      retrievedAt: new Date().toISOString(),
      trustConfigured: false,
      excludedRecordCount: 0,
      blockedReason: "No trusted verified-label sources are configured",
    };
  }

  const result = await pool.query(
    `SELECT id, request_id, model_id, model_version, input_features, actual_label,
            actual_label_source, actual_label_verified_at
     FROM predictions
     WHERE model_id = $1
       AND actual_label IS NOT NULL
       AND BTRIM(actual_label_source) = ANY($2::text[])
       AND actual_label_verified_at IS NOT NULL
       AND LOWER(BTRIM(actual_label)) IN ('normal', 'normal.', 'attack', 'attack.')
     ORDER BY timestamp ASC, id ASC`,
    [modelId, trustedSources],
  );
  const records = result.rows.filter((record) => (
    record.actual_label !== null
    && record.actual_label !== undefined
    && typeof record.actual_label_source === "string"
    && record.actual_label_source.trim().length > 0
    && record.actual_label_verified_at !== null
    && record.actual_label_verified_at !== undefined
    && trustedSources.includes(record.actual_label_source.trim())
    && isValidGroundTruth(record)
  ));
  const labelSources = [...new Set(
    records.map((record) => record.actual_label_source.trim()),
  )].sort();

  return {
    records,
    source: SOURCE,
    sourceVersion: SOURCE_VERSION,
    labelSources,
    retrievedAt: new Date().toISOString(),
    trustConfigured: true,
    excludedRecordCount: result.rows.length - records.length,
    blockedReason: null,
  };
}

module.exports = {
  SOURCE,
  SOURCE_VERSION,
  parseTrustedSources,
  isValidGroundTruth,
  loadVerifiedTrainingData,
};

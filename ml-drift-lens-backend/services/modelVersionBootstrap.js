const fs = require("node:fs");
const path = require("node:path");
const pool = require("../db");

function readProductionMetadata() {
  const projectRoot = path.resolve(__dirname, "../..");
  const metadataPath = process.env.MODEL_METADATA_PATH
    ? (path.isAbsolute(process.env.MODEL_METADATA_PATH)
        ? process.env.MODEL_METADATA_PATH
        : path.resolve(projectRoot, process.env.MODEL_METADATA_PATH))
    : path.join(projectRoot, "ml", "artifacts", "metadata.json");
  return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
}

async function ensureActiveModelVersion({ poolOverride = pool, metadata: suppliedMetadata } = {}) {
  const metadata = suppliedMetadata || readProductionMetadata();
  const modelId = metadata.model_id || metadata.model_name;
  const modelVersion = metadata.model_version || metadata.candidate_version;
  if (!modelId || !modelVersion) {
    throw new Error("Production model metadata must include model_id and model_version");
  }

  const metrics = metadata.metrics || metadata.validation_metrics || {};
  const connection = await poolOverride.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("LOCK TABLE public.model_versions IN EXCLUSIVE MODE");
    const registered = await connection.query(
      "SELECT model_version, is_active FROM model_versions WHERE model_id = $1 FOR UPDATE",
      [modelId],
    );
    if (registered.rows.length > 0) {
      const active = registered.rows.find((row) => row.is_active);
      if (!active || active.model_version !== modelVersion) {
        throw new Error("Model registry does not match the active production artifact");
      }
      await connection.query("COMMIT");
      return { status: "already_registered", model_id: modelId, model_version: modelVersion };
    }

    await connection.query(
      `INSERT INTO model_versions (
         model_id, model_version, mlflow_run_id, accuracy, precision_score,
         recall, f1_score, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [
        modelId,
        modelVersion,
        metadata.mlflow_run_id || null,
        metrics.accuracy ?? null,
        metrics.precision ?? metrics.precision_score ?? null,
        metrics.recall ?? null,
        metrics.f1 ?? metrics.f1_score ?? null,
      ],
    );
    await connection.query("COMMIT");
    return { status: "registered", model_id: modelId, model_version: modelVersion };
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { ensureActiveModelVersion, readProductionMetadata };

const pool = require("../db");
const { body, param, validationResult } = require("express-validator");
const fs = require("fs");
const path = require("path");
const candidateRetrainingService = require("../services/candidateRetrainingService");
const artifactPromotionService = require("../services/artifactPromotionService");
const mlServiceClient = require("../services/mlServiceClient");
function positiveIntegerSetting(name, fallback) {
  const value = process.env[name];
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

const DEFAULT_MIN_RETRAINING_SAMPLES = positiveIntegerSetting(
  "RETRAINING_MIN_LABELLED_SAMPLES",
  150,
);
const MINIMUM_EVALUATION_SAMPLES = positiveIntegerSetting(
  "RETRAINING_MIN_EVALUATION_SAMPLES",
  30,
);

function toMetricNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") return Number.NaN;
  if (typeof value === "string" && !value.trim()) return Number.NaN;
  return Number(value);
}

function normalizeCandidateMetrics(rawMetrics = {}) {
  return {
    accuracy: toMetricNumber(rawMetrics.accuracy ?? rawMetrics.accuracy_score),
    precision: toMetricNumber(rawMetrics.precision ?? rawMetrics.precision_score),
    recall: toMetricNumber(rawMetrics.recall),
    f1: toMetricNumber(rawMetrics.f1 ?? rawMetrics.f1_score),
  };
}

function validateMetrics(metrics, label) {
  for (const [name, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw Object.assign(new Error(`${label} ${name} metric is invalid`), { statusCode: 400 });
    }
  }
}

function candidateArtifactPaths(candidateVersion) {
  if (
    !candidateVersion ||
    path.basename(candidateVersion) !== candidateVersion ||
    candidateVersion.includes("..")
  ) {
    throw new Error("Candidate model version is invalid");
  }
  const candidateDir = path.join(candidateRetrainingService.projectRoot, "ml", "artifacts", "candidates");
  return {
    artifactPath: path.resolve(candidateDir, `${candidateVersion}.joblib`),
    metadataPath: path.resolve(candidateDir, `${candidateVersion}.json`),
  };
}

function resolveCandidateMetadata(job) {
  if (!job?.new_model_version) return null;
  const paths = candidateArtifactPaths(job.new_model_version);
  if (!fs.existsSync(paths.artifactPath) || !fs.existsSync(paths.metadataPath)) return null;
  const metadata = JSON.parse(fs.readFileSync(paths.metadataPath, "utf8"));
  if (metadata.model_id !== job.model_id || metadata.candidate_version !== job.new_model_version) return null;
  return {
    model_id: metadata.model_id,
    candidate_version: metadata.candidate_version,
    old_model_version: metadata.old_model_version || null,
    feature_schema_version: metadata.feature_schema_version || null,
    preprocessing_version: metadata.preprocessing_version || null,
    mlflow_run_id: metadata.mlflow_run_id || null,
    promoted: metadata.promoted === true,
    metrics: normalizeCandidateMetrics(metadata.metrics || metadata),
    evaluation: metadata.evaluation || null,
    ...paths,
  };
}

function readProductionMetadata() {
  const metadataPath = path.join(candidateRetrainingService.projectRoot, "ml", "artifacts", "metadata.json");
  return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
}

async function restoreActiveDatabaseVersion(modelId, candidateVersion, previousVersion) {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const active = await connection.query(
      "SELECT model_version FROM model_versions WHERE model_id = $1 AND is_active = true FOR UPDATE",
      [modelId],
    );
    if (active.rows.length === 1 && active.rows[0].model_version === candidateVersion) {
      await connection.query(
        "UPDATE model_versions SET is_active = false WHERE model_id = $1 AND model_version = $2 AND is_active = true",
        [modelId, candidateVersion],
      );
      const previous = await connection.query(
        "UPDATE model_versions SET is_active = true WHERE model_id = $1 AND model_version = $2 RETURNING id",
        [modelId, previousVersion],
      );
      if (previous.rows.length !== 1) throw new Error("Previously active model version is missing");
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

exports.validateRetrainingJob = [
  body("model_id")
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 255 })
    .withMessage("model_id must be a non-empty string of at most 255 characters"),
  body("triggered_by")
    .isIn(["auto", "manual"])
    .withMessage('triggered_by must be "auto" or "manual"'),
  body("min_samples")
    .optional()
    .isInt({ min: DEFAULT_MIN_RETRAINING_SAMPLES })
    .withMessage(`min_samples must be at least ${DEFAULT_MIN_RETRAINING_SAMPLES}`),
];

exports.validateJobId = [
  param("id").isInt({ min: 1 }).withMessage("id must be a positive integer"),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
  },
];

exports.getAllRetrainingJobs = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, model_id, triggered_by, trigger_reason, status,
              start_time, end_time, updated_at, attempt_count, min_samples,
              sample_count, evaluation_sample_count, error_message,
              old_model_version, new_model_version, promoted, promotion_reason,
              NULLIF(candidate_metrics->>'f1', '')::double precision AS candidate_f1,
              NULLIF(candidate_metrics->>'precision', '')::double precision AS candidate_precision,
              NULLIF(candidate_metrics->>'recall', '')::double precision AS candidate_recall,
              NULLIF(candidate_metrics->'incumbent_metrics'->>'f1', '')::double precision AS incumbent_f1,
              NULL::varchar AS reload_status
       FROM retraining_jobs ORDER BY start_time DESC`,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to retrieve retraining jobs" });
  }
};

exports.getRetrainingJob = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Retraining job id must be a positive integer" });
  }

  try {
    const result = await pool.query(
      `SELECT id, model_id, triggered_by, trigger_reason, status,
              start_time, end_time, updated_at, attempt_count, min_samples,
              sample_count, evaluation_sample_count, error_message,
              old_model_version, new_model_version,
              promoted, promotion_reason, candidate_metrics,
              NULLIF(candidate_metrics->>'f1', '')::double precision AS candidate_f1,
              NULLIF(candidate_metrics->'incumbent_metrics'->>'f1', '')::double precision AS incumbent_f1,
              NULL::varchar AS reload_status
       FROM retraining_jobs WHERE id = $1`,
      [id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Retraining job not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to retrieve retraining job" });
  }
};

exports.createRetrainingJob = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { model_id, triggered_by, min_samples } = req.body;
  try {
    const result = await exports.enqueueRetrainingJob({
      modelId: model_id,
      triggeredBy: triggered_by,
      minSamples: min_samples,
      triggerReason: triggered_by === "auto" ? "significant_drift" : "manual_request",
    });
    res.status(result.created ? 202 : 200).json({
      status: result.job.status,
      duplicate: !result.created,
      job: result.job,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Unable to queue retraining job" });
  }
};

exports.enqueueRetrainingJob = async ({
  modelId,
  modelVersion,
  driftScoreId,
  triggeredBy = "auto",
  triggerReason = "significant_drift",
  minSamples = DEFAULT_MIN_RETRAINING_SAMPLES,
}) => {
  if (
    !Number.isSafeInteger(Number(minSamples))
    || Number(minSamples) < DEFAULT_MIN_RETRAINING_SAMPLES
  ) {
    throw new Error(`min_samples must be at least ${DEFAULT_MIN_RETRAINING_SAMPLES}`);
  }

  const activeResult = await pool.query(
    "SELECT model_version FROM model_versions WHERE model_id = $1 AND is_active = true",
    [modelId],
  );
  const oldModelVersion = activeResult.rows[0]?.model_version || null;
  const result = await pool.query(
    `INSERT INTO retraining_jobs (
       model_id, triggered_by, start_time, old_model_version, drift_score_id,
       status, trigger_reason, min_samples, updated_at
     )
     VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, 'queued', $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      modelId,
      triggeredBy,
      oldModelVersion,
      driftScoreId || null,
      triggerReason,
      Number(minSamples),
    ],
  );
  if (result.rows.length) {
    return { created: true, job: result.rows[0], modelVersion };
  }

  const existing = await pool.query(
    `SELECT *
     FROM retraining_jobs
     WHERE ($1::integer IS NOT NULL AND drift_score_id = $1)
        OR (
          model_id = $2
          AND status IN (
            'queued', 'collecting_data', 'waiting_for_labelled_data',
            'validating_data', 'training', 'evaluating', 'deploying'
          )
        )
     ORDER BY CASE WHEN drift_score_id = $1 THEN 0 ELSE 1 END, start_time DESC
     LIMIT 1`,
    [driftScoreId || null, modelId],
  );
  if (!existing.rows.length) {
    throw new Error("Retraining job conflict could not be resolved");
  }
  return { created: false, job: existing.rows[0], modelVersion };
};

exports.promoteRetrainingJob = async (req, res) => {
  let connection;
  let transactionOpen = false;
  let backupToken = null;
  let job;
  let candidate;
  let modelId;
  let previousVersion;
  let recoveringExistingPromotion = false;

  try {
    connection = await pool.connect();
    await connection.query("BEGIN");
    transactionOpen = true;
    const jobResult = await connection.query(
      "SELECT * FROM retraining_jobs WHERE id = $1 FOR UPDATE",
      [req.params.id],
    );
    if (!jobResult.rows.length) {
      await connection.query("ROLLBACK");
      transactionOpen = false;
      return res.status(404).json({ success: false, error: "Retraining job not found" });
    }
    job = jobResult.rows[0];
    modelId = job.model_id;
    candidate = resolveCandidateMetadata(job);
    if (!candidate) {
      throw Object.assign(new Error("Candidate metadata or metrics are not available"), { statusCode: 400 });
    }
    if (job.status && !["candidate_ready", "deployed"].includes(job.status)) {
      throw Object.assign(new Error("Retraining job is not eligible for promotion"), { statusCode: 409 });
    }
    validateMetrics(candidate.metrics, "Candidate");
    const evaluation = candidate.evaluation;
    if (
      !evaluation
      || evaluation.dataset !== "verified_labelled_prediction_records"
      || !Number.isSafeInteger(evaluation.sample_count)
      || evaluation.sample_count < MINIMUM_EVALUATION_SAMPLES
      || !Array.isArray(evaluation.label_sources)
      || evaluation.label_sources.length === 0
      || evaluation.source !== "verified_prediction_records"
      || evaluation.source_version !== "verified_prediction_records-v1"
      || evaluation.feature_schema_version !== candidate.feature_schema_version
      || evaluation.preprocessing_version !== candidate.preprocessing_version
      || !evaluation.config
      || !Number.isFinite(evaluation.config.validation_fraction)
      || evaluation.config.validation_fraction <= 0
      || evaluation.config.validation_fraction >= 1
      || !Number.isSafeInteger(evaluation.config.random_seed)
      || !Number.isSafeInteger(evaluation.config.minimum_evaluation_samples)
      || evaluation.config.minimum_evaluation_samples < MINIMUM_EVALUATION_SAMPLES
      || evaluation.sample_count < evaluation.config.minimum_evaluation_samples
      || evaluation.label_sources.some(
        (source) => typeof source !== "string" || source.trim().length === 0,
      )
      || evaluation.incumbent_model_id !== modelId
      || evaluation.incumbent_model_version !== job.old_model_version
      || candidate.old_model_version !== job.old_model_version
    ) {
      throw Object.assign(new Error("Candidate evaluation is incomplete or stale"), { statusCode: 409 });
    }
    const evaluatedIncumbentMetrics = normalizeCandidateMetrics(evaluation.incumbent_metrics);
    validateMetrics(evaluatedIncumbentMetrics, "Incumbent");

    const activeResult = await connection.query(
      "SELECT * FROM model_versions WHERE model_id = $1 AND is_active = true FOR UPDATE",
      [modelId],
    );
    if (activeResult.rows.length !== 1) {
      throw Object.assign(new Error("Exactly one active incumbent is required"), { statusCode: 409 });
    }
    const activeModel = activeResult.rows[0];
    recoveringExistingPromotion = activeModel.model_version === candidate.candidate_version;
    if (!recoveringExistingPromotion && activeModel.model_version !== job.old_model_version) {
      throw Object.assign(new Error("Candidate is stale because the active incumbent changed"), { statusCode: 409 });
    }

    let comparisonModel = activeModel;
    if (recoveringExistingPromotion) {
      const previousResult = await connection.query(
        "SELECT * FROM model_versions WHERE model_id = $1 AND model_version = $2 LIMIT 1",
        [modelId, job.old_model_version],
      );
      comparisonModel = previousResult.rows[0];
      if (!comparisonModel) {
        throw Object.assign(new Error("Previously approved incumbent record is missing"), { statusCode: 409 });
      }
      previousVersion = comparisonModel.model_version;
    } else {
      if (job.promoted === true) {
        throw Object.assign(new Error("Retraining job is already promoted to a different version"), { statusCode: 409 });
      }
      previousVersion = activeModel.model_version;
    }

    const incumbentF1 = evaluatedIncumbentMetrics.f1;
    const comparison = {
      incumbent: {
        ...evaluatedIncumbentMetrics,
        model_id: comparisonModel.model_id,
        model_version: comparisonModel.model_version,
        evaluation_sample_count: evaluation.sample_count,
      },
      candidate: { ...candidate.metrics, model_id: modelId, model_version: candidate.candidate_version },
    };
    if (!(candidate.metrics.f1 > incumbentF1)) {
      if (recoveringExistingPromotion) {
        throw Object.assign(new Error("Recorded promotion does not satisfy the strict F1 rule"), { statusCode: 409 });
      }
      await connection.query(
        `UPDATE retraining_jobs
         SET status = 'rejected', promoted = false,
             promotion_reason = 'candidate_f1_not_better',
             end_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [job.id],
      );
      await connection.query("COMMIT");
      transactionOpen = false;
      return res.status(200).json({
        status: "not_promoted",
        primary_metric: "f1",
        reason: "candidate_f1_not_better",
        ...comparison,
        candidate_promoted: false,
      });
    }

    const expectedServingVersion = recoveringExistingPromotion ? previousVersion : activeModel.model_version;
    const servingInfo = await mlServiceClient.getModelInfo();
    const productionMetadata = readProductionMetadata();
    const productionVersion = productionMetadata.model_version || productionMetadata.candidate_version;
    if (
      servingInfo.model_name !== modelId ||
      productionMetadata.model_id !== modelId ||
      servingInfo.model_version !== expectedServingVersion ||
      productionVersion !== expectedServingVersion
    ) {
      throw Object.assign(new Error("Serving model, production artifact, and incumbent DB version do not agree"), { statusCode: 409 });
    }

    const staged = await artifactPromotionService.promoteCandidate(modelId, candidate.candidate_version);
    backupToken = staged.backup_token;
    await mlServiceClient.reloadModel({ model_id: modelId, model_version: candidate.candidate_version });

    let promotedModel = activeModel;
    if (!recoveringExistingPromotion) {
      await connection.query(
        "UPDATE model_versions SET is_active = false WHERE model_id = $1 AND is_active = true",
        [modelId],
      );
      const existingVersion = await connection.query(
        "SELECT id FROM model_versions WHERE model_id = $1 AND model_version = $2 FOR UPDATE",
        [modelId, candidate.candidate_version],
      );
      if (existingVersion.rows.length) {
        const updated = await connection.query(
          `UPDATE model_versions
           SET mlflow_run_id = $1, accuracy = $2, precision_score = $3,
               recall = $4, f1_score = $5, is_active = true
           WHERE id = $6 RETURNING *`,
          [candidate.mlflow_run_id, candidate.metrics.accuracy, candidate.metrics.precision, candidate.metrics.recall, candidate.metrics.f1, existingVersion.rows[0].id],
        );
        promotedModel = updated.rows[0];
      } else {
        const inserted = await connection.query(
          `INSERT INTO model_versions (model_id, model_version, mlflow_run_id, accuracy, precision_score, recall, f1_score, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
          [modelId, candidate.candidate_version, candidate.mlflow_run_id, candidate.metrics.accuracy, candidate.metrics.precision, candidate.metrics.recall, candidate.metrics.f1],
        );
        promotedModel = inserted.rows[0];
      }
    }

    await connection.query(
      `UPDATE retraining_jobs
       SET status = 'deployed', promoted = true,
           promotion_reason = 'candidate_f1_better',
           end_time = CURRENT_TIMESTAMP, lease_expires_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [job.id],
    );
    await connection.query("COMMIT");
    transactionOpen = false;
    await artifactPromotionService.finalize(backupToken).catch(() => {});
    return res.status(200).json({
      status: recoveringExistingPromotion ? "reconciled" : "promoted",
      primary_metric: "f1",
      reason: recoveringExistingPromotion ? "recorded_promotion_reconciled" : "candidate_f1_better",
      ...comparison,
      candidate_promoted: true,
      model_version: promotedModel,
      reload_status: "success",
      active_model_version: candidate.candidate_version,
    });
  } catch (err) {
    if (transactionOpen && connection) {
      await connection.query("ROLLBACK").catch(() => {});
      transactionOpen = false;
    }

    let restoredPrevious = false;
    try {
      if (backupToken) await artifactPromotionService.rollback(backupToken);
      if (modelId && previousVersion) {
        const productionMetadata = readProductionMetadata();
        const servingInfo = await mlServiceClient.getModelInfo();
        const productionVersion = productionMetadata.model_version || productionMetadata.candidate_version;
        if (productionVersion === previousVersion && servingInfo.model_version !== previousVersion) {
          await mlServiceClient.reloadModel({ model_id: modelId, model_version: previousVersion });
        }
        const verifiedServingInfo = await mlServiceClient.getModelInfo();
        restoredPrevious = productionVersion === previousVersion && verifiedServingInfo.model_version === previousVersion;
      }
    } catch (rollbackError) {
      restoredPrevious = false;
    }

    if (recoveringExistingPromotion && modelId && previousVersion && restoredPrevious) {
      await restoreActiveDatabaseVersion(modelId, candidate.candidate_version, previousVersion).catch(() => {});
    }
    return res.status(err.statusCode || 502).json({
      status: "promotion_failed",
      success: false,
      error: err.message || "Model promotion failed",
      candidate_promoted: false,
      reload_status: restoredPrevious ? "rolled_back" : "unchanged",
    });
  } finally {
    connection?.release();
  }
};

exports.updateRetrainingJob = async (req, res) => {
  res.status(409).json({
    success: false,
    error: "Retraining lifecycle state is managed by the worker and promotion workflow",
  });
};

exports.deleteRetrainingJob = async (req, res) => {
  res.status(409).json({
    success: false,
    error: "Retraining job history is retained and cannot be deleted",
  });
};
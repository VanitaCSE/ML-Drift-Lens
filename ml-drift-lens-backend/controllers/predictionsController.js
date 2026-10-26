const pool = require("../db");
const { body, validationResult } = require("express-validator");
const mlServiceClient = require("../services/mlServiceClient");
const driftMonitoringService = require("../services/driftMonitoringService");
const { parsePagination } = require("../utils/pagination");

// Validation middleware for prediction requests
// Expects: model_id, model_version, preprocessing_version, input_features
exports.validatePrediction = [
  body("model_id").notEmpty().withMessage("model_id is required"),
  body("model_version").notEmpty().withMessage("model_version is required"),
  body("preprocessing_version")
    .notEmpty()
    .withMessage("preprocessing_version is required"),
  body("input_features")
    .isObject()
    .withMessage("input_features must be an object"),
];

exports.getAllPredictions = async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query || {});
    const result = await pool.query(
            `SELECT id, model_id, model_version, prediction, prediction_class,
              confidence, inference_latency_ms, actual_label, timestamp, request_id
       FROM predictions ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    res.json(result.rows);
  } catch (err) {
    if (err.message.includes("limit must") || err.message.includes("offset must")) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error("Failed to retrieve predictions", { code: err.code, name: err.name });
    res.status(500).json({ success: false, error: "Failed to retrieve predictions" });
  }
};

/**
 * Create a prediction by calling the ML service and storing the result
 * Flow:
 * 1. Validate request
 * 2. Call FastAPI /predict endpoint
 * 3. Store result in PostgreSQL
 * 4. Return result to client
 */
exports.createPrediction = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const {
    model_id,
    model_version,
    preprocessing_version,
    input_features,
    request_id,
  } = req.body;

  try {
    // Generate request_id if not provided
    const correlationId = request_id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(
      `[${correlationId}] Prediction request received: model_id=${model_id}`
    );

    // Call FastAPI /predict endpoint
    console.log(`[${correlationId}] Calling ML service...`);
    const inferenceStartedAt = process.hrtime.bigint();
    const mlResponse = await mlServiceClient.predict({
      model_id,
      model_version,
      preprocessing_version,
      input_features,
      request_id: correlationId,
    });
    const inferenceLatencyMs = Number(process.hrtime.bigint() - inferenceStartedAt) / 1_000_000;

    console.log(
      `[${correlationId}] ML service response: prediction=${mlResponse.prediction}, confidence=${mlResponse.confidence}`
    );

    const timestamp = new Date();
    let storedPrediction;
    try {
      const result = await pool.query(
        `INSERT INTO predictions (
           model_id,
           model_version,
           preprocessing_version,
           input_features,
           prediction,
           prediction_class,
           confidence,
           inference_latency_ms,
           request_id,
           timestamp
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          model_id,
          model_version,
          preprocessing_version,
          input_features,
          mlResponse.prediction,
          mlResponse.prediction_class,
          mlResponse.confidence,
          inferenceLatencyMs,
          correlationId,
          timestamp,
        ],
      );
      storedPrediction = result.rows[0];
    } catch (err) {
      console.error(`[${correlationId}] Failed to store prediction`, {
        code: err.code,
        name: err.name,
      });
      return res.status(500).json({
        success: false,
        error: "Failed to store prediction",
      });
    }

    console.log(`[${correlationId}] Prediction stored`);

    // Monitoring is deliberately non-blocking: prediction success must not depend
    // on detector, alert, or retraining availability.
    res.status(201).json({
      success: true,
      prediction: mlResponse.prediction,
      prediction_class: mlResponse.prediction_class,
      confidence: mlResponse.confidence,
      model_id,
      model_version,
      preprocessing_version,
      request_id: correlationId,
      stored_id: storedPrediction.id,
      inference_latency_ms: inferenceLatencyMs,
    });
    setImmediate(() => {
      void driftMonitoringService.processPrediction({ modelId: model_id, modelVersion: model_version })
        .catch((monitoringError) => {
          console.error("Prediction monitoring failed", {
            model_id,
            model_version,
            error: monitoringError.message,
          });
        });
    });
  } catch (err) {
    console.error(`[${request_id || "unknown"}] Prediction failed:`, err);

    // Determine appropriate HTTP status code
    let statusCode = 500;
    let errorMessage = "Internal server error";

    if (err.statusCode === 503) {
      statusCode = 503;
      errorMessage = "ML Service unavailable";
    } else if (err.statusCode === 400) {
      statusCode = 400;
      errorMessage = "Invalid prediction request";
    } else if (err.statusCode === 422) {
      statusCode = 422;
      errorMessage = "Validation error";
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: err.message,
    });
  }
};

exports.updatePrediction = async (req, res) => {
  const { id } = req.params;
  const { actual_label } = req.body;

  const parsedId = parseInt(id, 10);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return res.status(400).json({ success: false, error: "Invalid prediction ID" });
  }

  const normalizedLabel = typeof actual_label === "string" ? actual_label.trim().toLowerCase() : "";
  if (normalizedLabel !== "normal" && normalizedLabel !== "attack") {
    return res.status(400).json({
      success: false,
      error: "Invalid actual_label. Must be 'normal' or 'attack'",
    });
  }

  const verifierSource = req.authUser?.email || (req.session?.user && req.session.user.email) || "analyst-review";

  try {
    const result = await pool.query(
      `UPDATE predictions
       SET actual_label = $1,
           actual_label_source = COALESCE(actual_label_source, $3),
           actual_label_verified_at = COALESCE(actual_label_verified_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [normalizedLabel, id, verifierSource],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Prediction not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(`Failed to update prediction ${id}`, {
      code: err.code,
      name: err.name,
    });
    res.status(500).json({
      success: false,
      error: "Failed to update prediction",
    });
  }
};

exports.deletePrediction = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM predictions WHERE id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Prediction not found" });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error(`Failed to delete prediction ${id}`, {
      code: err.code,
      name: err.name,
    });
    res.status(500).json({
      success: false,
      error: "Failed to delete prediction",
    });
  }
};

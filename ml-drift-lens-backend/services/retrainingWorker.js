const pool = require("../db");
const candidateRetrainingService = require("./candidateRetrainingService");
const verifiedTrainingDataSource = require("./verifiedTrainingDataSource");
const { parseTrustedSources } = verifiedTrainingDataSource;

const MAX_ATTEMPTS = Number(process.env.RETRAINING_MAX_ATTEMPTS || "3");
const JOB_LEASE_MS = Number(process.env.RETRAINING_JOB_LEASE_MS || "1800000");
if (!Number.isSafeInteger(MAX_ATTEMPTS) || MAX_ATTEMPTS < 1) {
  throw new Error("RETRAINING_MAX_ATTEMPTS must be a positive integer");
}
if (!Number.isSafeInteger(JOB_LEASE_MS) || JOB_LEASE_MS < 1) {
  throw new Error("RETRAINING_JOB_LEASE_MS must be a positive integer");
}

function sanitizeFailureMessage(error) {
  const message = error instanceof Error ? error.message : "Candidate training failed";
  return message
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
    .slice(0, 4000);
}

async function recoverExpiredJobs(poolOverride = pool) {
  const result = await poolOverride.query(
    `UPDATE retraining_jobs
     SET status = CASE WHEN attempt_count >= $1 THEN 'failed' ELSE 'queued' END,
         error_message = COALESCE(error_message, 'Worker lease expired before completion'),
         lease_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP,
         end_time = CASE WHEN attempt_count >= $1 THEN CURRENT_TIMESTAMP ELSE end_time END
     WHERE status IN ('collecting_data', 'validating_data', 'training', 'evaluating')
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < CURRENT_TIMESTAMP
     RETURNING id, status`,
    [MAX_ATTEMPTS],
  );
  return result.rows;
}

async function claimNextJob(poolOverride = pool, trustedSources = parseTrustedSources()) {
  const connection = await poolOverride.connect();
  try {
    await connection.query("BEGIN");
    const result = await connection.query(
      `SELECT job.*
       FROM retraining_jobs AS job
       WHERE job.status = 'queued'
          OR (
            job.status = 'waiting_for_labelled_data'
            AND (
              SELECT COUNT(*)
              FROM predictions AS prediction
              WHERE prediction.model_id = job.model_id
                AND prediction.actual_label IS NOT NULL
                AND BTRIM(prediction.actual_label_source) = ANY($1::text[])
                AND prediction.actual_label_verified_at IS NOT NULL
                AND LOWER(BTRIM(prediction.actual_label)) IN ('normal', 'normal.', 'attack', 'attack.')
            ) >= job.min_samples
          )
       ORDER BY job.start_time ASC, job.id ASC
       LIMIT 1
       FOR UPDATE OF job SKIP LOCKED`,
      [trustedSources],
    );
    if (!result.rows.length) {
      await connection.query("COMMIT");
      return null;
    }

    const job = result.rows[0];
    const claimed = await connection.query(
      `UPDATE retraining_jobs
       SET status = 'collecting_data',
           attempt_count = attempt_count + 1,
           lease_expires_at = CURRENT_TIMESTAMP + ($2 * INTERVAL '1 millisecond'),
           updated_at = CURRENT_TIMESTAMP,
           error_message = NULL
       WHERE id = $1
       RETURNING *`,
      [job.id, JOB_LEASE_MS],
    );
    await connection.query("COMMIT");
    return claimed.rows[0];
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function updateJob(jobId, fields, poolOverride = pool) {
  const result = await poolOverride.query(
    `UPDATE retraining_jobs
     SET status = $2,
         sample_count = COALESCE($3, sample_count),
         candidate_metrics = COALESCE($4::jsonb, candidate_metrics),
         evaluation_sample_count = COALESCE($5, evaluation_sample_count),
         new_model_version = COALESCE($6, new_model_version),
         error_message = $7,
         promotion_reason = $8,
         end_time = CASE WHEN $9 THEN CURRENT_TIMESTAMP ELSE end_time END,
         min_samples = GREATEST(min_samples, COALESCE($10, min_samples)),
         lease_expires_at = CASE
           WHEN $9 OR $2 = 'waiting_for_labelled_data' THEN NULL
           ELSE lease_expires_at
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [
      jobId,
      fields.status,
      fields.sampleCount ?? null,
      fields.metrics ? JSON.stringify(fields.metrics) : null,
      fields.evaluationSampleCount ?? null,
      fields.candidateVersion ?? null,
      fields.errorMessage ?? null,
      fields.promotionReason ?? null,
      fields.complete === true,
      fields.requiredSamples ?? null,
    ],
  );
  return result.rows[0];
}

async function processNextRetrainingJob(dependencies = {}) {
  const database = dependencies.pool || pool;
  const runCandidate = dependencies.runCandidateRetraining
    || candidateRetrainingService.runCandidateRetraining;
  const loadTrainingData = dependencies.loadVerifiedTrainingData
    || ((modelId) => verifiedTrainingDataSource.loadVerifiedTrainingData(modelId, database));
  const recoveredJobs = await recoverExpiredJobs(database);
  const job = await claimNextJob(database);
  if (!job) return { processed: false, recovered: recoveredJobs.length };

  try {
    const trainingData = await loadTrainingData(job.model_id);
    if (
      !trainingData
      || trainingData.source !== verifiedTrainingDataSource.SOURCE
      || trainingData.sourceVersion !== verifiedTrainingDataSource.SOURCE_VERSION
      || !Array.isArray(trainingData.records)
      || trainingData.trustConfigured !== true
    ) {
      if (trainingData?.trustConfigured === false) {
        await updateJob(job.id, {
          status: "waiting_for_labelled_data",
          sampleCount: 0,
          errorMessage: trainingData.blockedReason || "No trusted verified-label source is configured",
        }, database);
        return { processed: true, jobId: job.id, status: "waiting_for_labelled_data" };
      }
      throw new Error("Verified training-data source returned invalid provenance");
    }
    const records = trainingData.records;
    if (records.length < job.min_samples) {
      await updateJob(job.id, {
        status: "waiting_for_labelled_data",
        sampleCount: records.length,
        errorMessage: `Insufficient trusted, well-formed verified labels: ${records.length} eligible, ${trainingData.excludedRecordCount || 0} excluded`,
      }, database);
      return { processed: true, jobId: job.id, status: "waiting_for_labelled_data" };
    }

    await updateJob(job.id, { status: "validating_data", sampleCount: records.length }, database);
    await updateJob(job.id, { status: "training", sampleCount: records.length }, database);
    const candidate = await runCandidate(records, {
      modelId: job.model_id,
      minSamples: job.min_samples,
      oldModelVersion: job.old_model_version,
      dataSource: trainingData.source,
      dataSourceVersion: trainingData.sourceVersion,
      labelSources: trainingData.labelSources,
    });

    if (candidate.status === "insufficient_data") {
      await updateJob(job.id, {
        status: "waiting_for_labelled_data",
        sampleCount: candidate.sample_count,
        evaluationSampleCount: candidate.evaluation_sample_count,
        requiredSamples: candidate.required_samples,
      }, database);
      return { processed: true, jobId: job.id, status: "waiting_for_labelled_data" };
    }

    if (candidate.status !== "completed" || !candidate.candidate_version) {
      throw new Error("Candidate training did not produce a valid candidate");
    }
    if (
      !candidate.metrics
      || !Number.isFinite(candidate.metrics.f1)
      || !candidate.evaluation?.incumbent_metrics
      || !Number.isFinite(candidate.evaluation.incumbent_metrics.f1)
    ) {
      throw new Error("Candidate evaluation did not produce finite comparison metrics");
    }

    const betterThanIncumbent = candidate.metrics?.f1 > candidate.evaluation?.incumbent_metrics?.f1;
    const finalStatus = betterThanIncumbent ? "candidate_ready" : "rejected";
    const promotionReason = betterThanIncumbent
      ? "candidate_f1_better"
      : "candidate_f1_not_better";
    await updateJob(job.id, {
      status: finalStatus,
      sampleCount: candidate.sample_count,
      evaluationSampleCount: candidate.evaluation.sample_count,
      metrics: {
        ...candidate.metrics,
        evaluation: candidate.evaluation,
        incumbent_metrics: candidate.evaluation?.incumbent_metrics,
      },
      candidateVersion: candidate.candidate_version,
      promotionReason,
      complete: true,
    }, database);
    return { processed: true, jobId: job.id, status: finalStatus };
  } catch (error) {
    const terminal = Number(job.attempt_count) >= MAX_ATTEMPTS;
    const failure = sanitizeFailureMessage(error);
    await updateJob(job.id, {
      status: terminal ? "failed" : "queued",
      errorMessage: failure.slice(0, 4000),
      complete: terminal,
    }, database);
    return {
      processed: true,
      jobId: job.id,
      status: terminal ? "failed" : "queued",
      error: failure,
    };
  }
}

module.exports = {
  MAX_ATTEMPTS,
  JOB_LEASE_MS,
  sanitizeFailureMessage,
  recoverExpiredJobs,
  claimNextJob,
  processNextRetrainingJob,
};

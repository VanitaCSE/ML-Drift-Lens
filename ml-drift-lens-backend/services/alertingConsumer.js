const pool = require("../db");
const {
  STREAM_NAME,
  getRedisClient,
} = require("./redisStreamPublisher");
const retrainingController = require("../controllers/retrainingController");

const CONSUMER_GROUP = "modelwatch-alerting";
const CONSUMER_NAME = "alerting-service";
const PENDING_IDLE_THRESHOLD_MS = 30 * 60 * 1000;

function normalizeStreamFields(fields) {
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    return fields;
  }

  const payload = {};
  if (Array.isArray(fields)) {
    for (let index = 0; index < fields.length; index += 2) {
      payload[fields[index]] = fields[index + 1];
    }
  }
  return payload;
}

function parseDriftEvent(entry) {
  const [id, fields] = entry || [];
  const payload = normalizeStreamFields(fields);

  if (!id || payload.event_type !== "drift_detected") {
    return { valid: false, ignored: payload.event_type !== "drift_detected" };
  }

  const driftScoreId = Number(payload.drift_score_id);
  if (
    !Number.isInteger(driftScoreId) ||
    driftScoreId <= 0 ||
    !payload.model_id ||
    payload.status !== "significant_drift"
  ) {
    return { valid: false, ignored: false, reason: "missing required drift event fields" };
  }

  return {
    valid: true,
    event: {
      id,
      drift_score_id: driftScoreId,
      model_id: String(payload.model_id),
      model_version: payload.model_version ? String(payload.model_version) : null,
      score: payload.score,
    },
  };
}

function buildAlertMessage(event) {
  return `Significant PSI drift detected for model ${event.model_id}`;
}

async function ensureConsumerGroup(client) {
  if (typeof client.xGroupCreate !== "function") {
    return;
  }

  try {
    await client.xGroupCreate(STREAM_NAME, CONSUMER_GROUP, "0", { MKSTREAM: true });
  } catch (error) {
    if (!String(error.message || "").includes("BUSYGROUP")) {
      throw error;
    }
  }
}

async function createAlertFromDriftEvent(event, poolOverride = pool) {
  const parsed = parseDriftEvent(event);
  if (!parsed.valid) {
    return {
      created: false,
      ignored: parsed.ignored,
      reason: parsed.reason || "unsupported event type",
    };
  }

  const { drift_score_id, model_id } = parsed.event;
  const result = await poolOverride.query(
    `INSERT INTO alerts (drift_score_id, model_id, message, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (drift_score_id) DO NOTHING
     RETURNING *`,
    [drift_score_id, model_id, buildAlertMessage(parsed.event), "open"],
  );

  return {
    created: result.rows.length > 0,
    duplicate: result.rows.length === 0,
    alert: result.rows[0],
  };
}

async function consumeDriftEventsOnce(clientOverride = null, poolOverride = pool, dependencies = {}) {
  const client = clientOverride || (await getRedisClient()).client;
  const enqueueRetraining = dependencies.enqueueRetraining || retrainingController.enqueueRetrainingJob;
  const ownsClient = !clientOverride;
  if (!client) {
    return { consumed: 0, created: 0, failed: 0, reason: "Redis unavailable" };
  }

  try {
    await ensureConsumerGroup(client);
    const entries = await client.xReadGroup(
      CONSUMER_GROUP,
      CONSUMER_NAME,
      [{ key: STREAM_NAME, id: ">" }],
      { COUNT: 10, BLOCK: 1 },
    );
    const messages = entries?.[0]?.messages || [];

    let claimedMessages = [];
    let recoveryError = null;
    if (typeof client.xAutoClaim === "function") {
      try {
        const claimed = await client.xAutoClaim(
          STREAM_NAME,
          CONSUMER_GROUP,
          CONSUMER_NAME,
          PENDING_IDLE_THRESHOLD_MS,
          "0",
          { COUNT: 10 },
        );
        claimedMessages = claimed?.messages || [];
      } catch (error) {
        recoveryError = {
          code: error.code || null,
          name: error.name || "Error",
        };
        console.warn("Redis pending drift-message recovery failed", recoveryError);
      }
    }

    const allMessages = [...messages, ...claimedMessages];
    let created = 0;
    let failed = 0;

    for (const message of allMessages) {
      try {
        const parsed = parseDriftEvent([message.id, message.message]);
        if (!parsed.valid && !parsed.ignored) {
          throw new Error(parsed.reason || "Malformed drift event");
        }
        const result = await createAlertFromDriftEvent(
          [message.id, message.message],
          poolOverride,
        );
        if (result.created || result.duplicate) {
          const existingJob = await poolOverride.query(
            "SELECT id FROM retraining_jobs WHERE drift_score_id = $1 LIMIT 1",
            [parsed.event.drift_score_id],
          );
          if (existingJob.rows.length === 0) {
            await enqueueRetraining({
              modelId: parsed.event.model_id,
              modelVersion: parsed.event.model_version,
              driftScoreId: parsed.event.drift_score_id,
            });
          }
        }
        if (result.created) {
          created += 1;
        }
        if (typeof client.xAck === "function") {
          await client.xAck(STREAM_NAME, CONSUMER_GROUP, message.id);
        }
      } catch (error) {
        failed += 1;
        console.error("Drift stream message processing failed", {
          message_id: message.id,
          code: error.code || null,
          name: error.name || "Error",
        });
      }
    }

    return { consumed: allMessages.length, created, failed, recoveryError };
  } catch (error) {
    return { consumed: 0, created: 0, failed: 0, reason: error.message };
  } finally {
    if (ownsClient && client?.isOpen && typeof client.quit === "function") {
      await client.quit().catch(() => {});
    }
  }
}

module.exports = {
  CONSUMER_GROUP,
  CONSUMER_NAME,
  PENDING_IDLE_THRESHOLD_MS,
  normalizeStreamFields,
  parseDriftEvent,
  buildAlertMessage,
  ensureConsumerGroup,
  createAlertFromDriftEvent,
  consumeDriftEventsOnce,
};
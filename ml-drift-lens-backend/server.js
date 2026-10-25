const express = require("express");
const cors = require("cors");
const pool = require("./db");
const { createCorsOptions, parseCorsOrigins } = require("./utils/cors");
const { defaultEmailService } = require("./services/emailService");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

function createApp({ databasePool = pool, env = process.env, emailService = defaultEmailService } = {}) {
  const app = express();

  app.set("trust proxy", env.NODE_ENV === "production" ? 1 : false);
  app.use(cors(createCorsOptions(parseCorsOrigins(env.CORS_ORIGINS))));
  app.use(express.json({ limit: "16kb" }));

  app.get("/", (req, res) => {
    res.send("ModelWatch backend is alive 🚀");
  });

  const diagnosticsRoutes = require("./routes/diagnosticsRoutes");
  app.use(diagnosticsRoutes.createDiagnosticsRouter({ databasePool, env, emailService }));

  const { createAuthRouter } = require("./routes/authRoutes");
  app.use("/api/auth", createAuthRouter({ databasePool, env, emailService }));

  const metricsRoutes = require("./routes/metricsRoutes");
  app.use("/api/metrics", metricsRoutes);

  // Health and ML Service integration routes
  const healthRoutes = require("./routes/healthRoutes");
  app.use("/api", healthRoutes);

  const predictionsRoutes = require("./routes/predictionsRoutes");
  app.use("/api/predictions", predictionsRoutes);

  const driftRoutes = require("./routes/driftRoutes");
  app.use("/api/drift", driftRoutes);

  const alertsRoutes = require("./routes/alertsRoutes");
  app.use("/api/alerts", alertsRoutes);

  const modelsRoutes = require("./routes/modelsRoutes");
  app.use("/api/models", modelsRoutes);

  const retrainingRoutes = require("./routes/retrainingRoutes");
  app.use("/api/retraining", retrainingRoutes);

  return app;
}

const app = createApp({ databasePool: pool });

const { consumeDriftEventsOnce } = require("./services/alertingConsumer");
const { ensureActiveModelVersion } = require("./services/modelVersionBootstrap");
const { processNextRetrainingJob } = require("./services/retrainingWorker");

function startBackgroundWorkers() {
  const consumerInterval = setInterval(() => {
    consumeDriftEventsOnce().catch((error) => {
      console.error("Drift event consumer failed", { error: error.message });
    });
  }, 1000);
  consumerInterval.unref();

  let retrainingWorkerRunning = false;
  const retrainingWorkerInterval = setInterval(async () => {
    if (retrainingWorkerRunning) return;
    retrainingWorkerRunning = true;
    try {
      const result = await processNextRetrainingJob();
      if (result.processed && result.status === "failed") {
        console.error("Retraining job failed", { job_id: result.jobId, error: result.error });
      }
    } catch (error) {
      console.error("Retraining worker failed", { error: error.message });
    } finally {
      retrainingWorkerRunning = false;
    }
  }, 5000);
  retrainingWorkerInterval.unref();
}

async function startServer({ port = PORT, host = HOST, skipModelBootstrap = false } = {}) {
  if (!skipModelBootstrap) {
    await ensureActiveModelVersion();
  }
  startBackgroundWorkers();
  return app.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Backend startup failed", { error: error.message });
    process.exitCode = 1;
  });
}

module.exports = { app, createApp, startServer };

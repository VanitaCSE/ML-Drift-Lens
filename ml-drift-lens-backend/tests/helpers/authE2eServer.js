const path = require("node:path");

// Ensure environment uses isolated test database
process.env.DB_NAME = "ml_drift_lens_auth_phase4_test_20261025";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "root";
process.env.DB_PORT = process.env.DB_PORT || "5432";
process.env.DB_USER = process.env.DB_USER || "postgres";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "isolated-e2e-playwright-test-secret-at-least-32-chars";
process.env.SESSION_COOKIE_SECURE = "false";
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || "http://localhost:5180,http://127.0.0.1:5180,http://localhost:5173,http://127.0.0.1:5173";

const pool = require("../../db");
const { createApp } = require("../../server");

async function start() {
  // Positively verify target database contains 'test' and is neither ml_drift_lens nor production
  const dbRes = await pool.query("SELECT current_database()");
  const dbName = dbRes.rows[0].current_database;
  if (!dbName.includes("test") || dbName === "ml_drift_lens" || dbName === "production") {
    console.error(`Refusing to start E2E test server against non-test database: ${dbName}`);
    process.exit(1);
  }

  const app = createApp({ databasePool: pool, env: process.env });
  const port = parseInt(process.env.PORT || "3008", 10);
  const host = "127.0.0.1";

  const server = app.listen(port, host, () => {
    console.log(`[authE2eServer] Listening on http://${host}:${port} against database: ${dbName}`);
  });

  function shutdown() {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  console.error("[authE2eServer] Startup error:", err);
  process.exit(1);
});

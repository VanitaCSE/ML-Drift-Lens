const assert = require("node:assert/strict");
const express = require("express");
const { test } = require("node:test");
const { createDiagnosticsRouter } = require("../routes/diagnosticsRoutes");

async function requestDiagnostic(env, databasePool, path = "/test-db", emailService) {
  const app = express();
  app.use(createDiagnosticsRouter({
    env,
    databasePool,
    logger: { error() {} },
    emailService,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    return await fetch(`http://127.0.0.1:${address.port}${path}`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

test("database diagnostic is disabled in production without querying PostgreSQL", async () => {
  let queryCount = 0;
  const response = await requestDiagnostic(
    { NODE_ENV: "production" },
    { query: async () => { queryCount += 1; return { rows: [] }; } },
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: "Not found" });
  assert.equal(queryCount, 0);
});

test("database diagnostic remains available outside production", async () => {
  const response = await requestDiagnostic(
    { NODE_ENV: "development" },
    { query: async () => ({ rows: [{ now: "test-time" }] }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    time: { now: "test-time" },
  });
});

test("email preview endpoints (/test-email-preview and /api/dev/email-preview) are disabled in production", async () => {
  const res1 = await requestDiagnostic({ NODE_ENV: "production" }, {}, "/test-email-preview");
  assert.equal(res1.status, 404);
  assert.deepEqual(await res1.json(), { success: false, error: "Not found" });

  const res2 = await requestDiagnostic({ NODE_ENV: "production" }, {}, "/api/dev/email-preview");
  assert.equal(res2.status, 404);
  assert.deepEqual(await res2.json(), { success: false, error: "Not found" });
});

test("email preview endpoints are reachable outside production", async () => {
  const mockEmailService = {
    getLastSentMessage: () => ({
      to: "preview-user@example.test",
      from: "no-reply@ml-drift-lens.local",
      subject: "Test Subject",
      text: "Reset at: http://127.0.0.1:5180/reset-password?token=mock-token",
      sentAt: new Date(),
      auditTokenHash: "123456789abc",
    }),
  };

  const res1 = await requestDiagnostic({ NODE_ENV: "development" }, {}, "/test-email-preview", mockEmailService);
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.success, true);
  assert.equal(data1.simulated, true);
  assert.equal(data1.preview.to, "preview-user@example.test");
  assert.equal(data1.preview.resetUrl, "http://127.0.0.1:5180/reset-password?token=mock-token");

  const res2 = await requestDiagnostic({ NODE_ENV: "development" }, {}, "/api/dev/email-preview", mockEmailService);
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.success, true);
  assert.equal(data2.preview.to, "preview-user@example.test");
});

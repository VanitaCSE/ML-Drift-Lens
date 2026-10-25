const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createDatabaseDiagnosticHandler,
  createEmailPreviewHandler,
  isLoopbackIp,
} = require("../controllers/diagnosticsController");

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("returns database diagnostic results when the query succeeds", async () => {
  const response = responseRecorder();
  let queryText;
  const handler = createDatabaseDiagnosticHandler(
    { query: async (text) => { queryText = text; return { rows: [{ now: "database-time" }] }; } },
    { error: assert.fail },
  );

  await handler({}, response);

  assert.equal(queryText, "SELECT NOW()");
  assert.deepEqual(response.body, { success: true, time: { now: "database-time" } });
});

test("does not return database error details to the diagnostic caller", async () => {
  const response = responseRecorder();
  const logged = [];
  const handler = createDatabaseDiagnosticHandler(
    { query: async () => { throw Object.assign(new Error("sensitive connection details"), { code: "08006" }); } },
    { error: (...args) => logged.push(args) },
  );

  await handler({}, response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { success: false, error: "Database diagnostic failed" });
  assert.equal(JSON.stringify(response.body).includes("sensitive connection details"), false);
  assert.deepEqual(logged, [["Database diagnostic failed", { name: "Error", code: "08006" }]]);
});

test("isLoopbackIp correctly identifies loopback addresses", () => {
  assert.equal(isLoopbackIp("127.0.0.1"), true);
  assert.equal(isLoopbackIp("::1"), true);
  assert.equal(isLoopbackIp("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackIp("192.168.1.5"), false);
  assert.equal(isLoopbackIp("10.0.0.1"), false);
  assert.equal(isLoopbackIp(undefined), false);
});

test("email preview rejects requests from non-loopback addresses with 403", async () => {
  const response = responseRecorder();
  const handler = createEmailPreviewHandler({});
  await handler({ socket: { remoteAddress: "192.168.1.100" } }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.success, false);
  assert.match(response.body.error, /restricted to local loopback/);
});

test("email preview returns empty state when message queue has no messages", async () => {
  const response = responseRecorder();
  const emailService = {
    getLastSentMessage: () => null,
  };
  const handler = createEmailPreviewHandler(emailService);
  await handler({ socket: { remoteAddress: "127.0.0.1" }, query: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.simulated, true);
  assert.equal(response.body.preview, null);
});

test("email preview retrieves simulated email with extracted resetUrl and audit hash", async () => {
  const response = responseRecorder();
  const sentMsg = {
    to: "test@example.com",
    from: "no-reply@ml-drift-lens.local",
    subject: "ML-Drift-Lens Password Reset Instructions",
    text: "Visit http://127.0.0.1:5180/reset-password?token=secret-token-123 to reset.",
    html: "<p>Visit link</p>",
    sentAt: new Date("2026-10-25T12:00:00Z"),
    auditTokenHash: "abc123def456",
  };
  const emailService = {
    getLastSentMessage: (email) => {
      assert.equal(email, "test@example.com");
      return sentMsg;
    },
  };
  const handler = createEmailPreviewHandler(emailService);
  await handler({
    socket: { remoteAddress: "127.0.0.1" },
    query: { email: "test@example.com" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.simulated, true);
  assert.match(response.body.notice, /Simulated email captured from local memory transport/);
  assert.equal(response.body.preview.to, "test@example.com");
  assert.equal(response.body.preview.resetUrl, "http://127.0.0.1:5180/reset-password?token=secret-token-123");
  assert.equal(response.body.preview.auditTokenHash, "abc123def456");
});

test("email preview supports ?all=true listing all captured messages", async () => {
  const response = responseRecorder();
  const messages = [
    {
      to: "user1@example.com",
      from: "no-reply@ml-drift-lens.local",
      subject: "Test 1",
      text: "Link: http://127.0.0.1:5180/reset-password?token=token-1",
      sentAt: new Date("2026-10-25T12:00:00Z"),
      auditTokenHash: "hash1",
    },
    {
      to: "user2@example.com",
      from: "no-reply@ml-drift-lens.local",
      subject: "Test 2",
      text: "Link: http://127.0.0.1:5180/reset-password?token=token-2",
      sentAt: new Date("2026-10-25T12:01:00Z"),
      auditTokenHash: "hash2",
    },
  ];
  const emailService = {
    getSentMessages: () => messages,
  };
  const handler = createEmailPreviewHandler(emailService);
  await handler({
    socket: { remoteAddress: "127.0.0.1" },
    query: { all: "true" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.count, 2);
  assert.equal(response.body.messages[0].to, "user1@example.com");
  assert.equal(response.body.messages[0].resetUrl, "http://127.0.0.1:5180/reset-password?token=token-1");
  assert.equal(response.body.messages[1].to, "user2@example.com");
});

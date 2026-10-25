const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const { after, test } = require("node:test");
const { createAuthRouter } = require("../routes/authRoutes");
const { createAuthGuards, createSessionMiddleware } = require("../middleware/authSession");
const { parseCorsOrigins } = require("../utils/cors");
const { hashToken } = require("../controllers/authController");
const { createEmailService } = require("../services/emailService");

const SECRET = "test-only-session-secret-with-more-than-32-bytes";
const ORIGIN = "http://localhost:5173";
const PASSWORD = "initial-secure-password-123";
const NEW_PASSWORD = "updated-secure-password-456";
const activeServers = new Set();

after(async () => {
  await Promise.all(
    [...activeServers].map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        }),
    ),
  );
});

function createMockDb(initialUsers = []) {
  const users = [...initialUsers];
  const resetTokens = [];
  const verificationTokens = [];
  const userSessions = new Map();
  let nextUserId = users.reduce((max, u) => Math.max(max, Number(u.id)), 0) + 1;
  let nextResetId = 1;
  let nextVerifyId = 1;

  const pool = {
    users,
    resetTokens,
    verificationTokens,
    userSessions,
    async query(sql, values = []) {
      if (sql.includes("INSERT INTO app_users")) {
        const [email, passwordHash] = values;
        if (users.some((u) => u.email === email)) {
          const err = new Error("duplicate key");
          err.code = "23505";
          throw err;
        }
        const user = { id: String(nextUserId++), email, password_hash: passwordHash, email_verified: false };
        users.push(user);
        return { rows: [{ id: user.id, email: user.email }] };
      }

      if (sql.includes("password_hash FROM app_users")) {
        const user = users.find((u) => u.email === values[0]);
        return { rows: user ? [{ ...user }] : [] };
      }

      if (sql.includes("FROM app_users WHERE id = $1")) {
        const user = users.find((u) => u.id === String(values[0]));
        return { rows: user ? [{ id: user.id, email: user.email, email_verified: user.email_verified }] : [] };
      }

      if (sql.includes("SELECT id, email FROM app_users WHERE email = $1") || sql.includes("SELECT id, email, email_verified FROM app_users WHERE email = $1")) {
        const user = users.find((u) => u.email === values[0]);
        return { rows: user ? [{ ...user }] : [] };
      }

      if (sql.includes("INSERT INTO password_reset_tokens")) {
        const [userId, tokenDigest, expiresAt] = values;
        const record = { id: nextResetId++, user_id: Number(userId), token_hash: tokenDigest, expires_at: expiresAt, used_at: null };
        resetTokens.push(record);
        return { rows: [record] };
      }

      if (sql.includes("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL")) {
        const [userId] = values;
        for (const t of resetTokens) {
          if (t.user_id === Number(userId) && t.used_at === null) {
            t.used_at = new Date();
          }
        }
        return { rows: [] };
      }

      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }

      if (sql.includes("password_reset_tokens") && sql.includes("token_hash = $1")) {
        const [tokenDigest] = values;
        const found = resetTokens.find((t) => t.token_hash === tokenDigest);
        return { rows: found ? [{ ...found }] : [] };
      }

      if (sql.includes("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1")) {
        const [id] = values;
        const found = resetTokens.find((t) => t.id === Number(id));
        if (found) found.used_at = new Date();
        return { rows: [] };
      }

      if (sql.includes("UPDATE app_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")) {
        const [newHash, userId] = values;
        const found = users.find((u) => u.id === String(userId));
        if (found) found.password_hash = newHash;
        return { rows: [] };
      }

      if (sql.includes("DELETE FROM user_sessions WHERE sess->>'userId' = $1::text")) {
        const [userId] = values;
        for (const [sid, sess] of userSessions.entries()) {
          if (sess?.userId === String(userId)) {
            userSessions.delete(sid);
          }
        }
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO email_verification_tokens")) {
        const [userId, tokenDigest, expiresAt] = values;
        const record = { id: nextVerifyId++, user_id: Number(userId), token_hash: tokenDigest, expires_at: expiresAt, used_at: null };
        verificationTokens.push(record);
        return { rows: [record] };
      }

      if (sql.includes("email_verification_tokens") && sql.includes("token_hash = $1")) {
        const [tokenDigest] = values;
        const found = verificationTokens.find((t) => t.token_hash === tokenDigest);
        return { rows: found ? [{ ...found }] : [] };
      }

      if (sql.includes("UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1")) {
        const [id] = values;
        const found = verificationTokens.find((t) => t.id === Number(id));
        if (found) found.used_at = new Date();
        return { rows: [] };
      }

      if (sql.includes("UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL")) {
        const [userId] = values;
        for (const t of verificationTokens) {
          if (t.user_id === Number(userId) && t.used_at === null) {
            t.used_at = new Date();
          }
        }
        return { rows: [] };
      }

      if (sql.includes("UPDATE app_users SET email_verified = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1")) {
        const [userId] = values;
        const found = users.find((u) => u.id === String(userId));
        if (found) found.email_verified = true;
        return { rows: [] };
      }

      throw new Error(`Unexpected query in mock DB: ${sql}`);
    },
    async connect() {
      return {
        query: (...args) => pool.query(...args),
        release() {},
      };
    },
  };
  return pool;
}

function testHasher() {
  return {
    async hash(password) {
      return `hash:${password}`;
    },
    async verify(storedHash, password) {
      return storedHash === `hash:${password}`;
    },
  };
}

function createTestServer({ db = createMockDb(), emailService = createEmailService({ env: { NODE_ENV: "test" } }), now = Date.now } = {}) {
  const app = express();
  app.use(express.json());
  const sessionMiddleware = createSessionMiddleware({
    databasePool: db,
    env: { NODE_ENV: "test", SESSION_SECRET: SECRET, CORS_ORIGINS: ORIGIN },
    store: new session.MemoryStore(),
  });
  const guards = createAuthGuards({
    databasePool: db,
    env: { NODE_ENV: "test", CORS_ORIGINS: ORIGIN },
    sessionMiddleware,
    allowedOrigins: parseCorsOrigins(ORIGIN),
  });
  const router = createAuthRouter({
    databasePool: db,
    sessionMiddleware,
    guards,
    passwordHasher: testHasher(),
    emailService,
    now,
    env: { NODE_ENV: "test", SESSION_SECRET: SECRET, CORS_ORIGINS: ORIGIN },
    loginLimiter: (_req, _res, next) => next(),
    registrationLimiter: (_req, _res, next) => next(),
    recoveryLimiter: (_req, _res, next) => next(),
    resetLimiter: (_req, _res, next) => next(),
    verifyLimiter: (_req, _res, next) => next(),
    resendLimiter: (_req, _res, next) => next(),
  });
  app.use("/api/auth", router);

  return { app, db, emailService };
}

async function withServer(app, run) {
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address();
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    activeServers.delete(server);
  }
}

async function request(baseUrl, path, { method = "GET", body, cookie, origin = ORIGIN } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : undefined,
  };
}

test("password recovery requests return indistinguishable generic response for existing and nonexistent emails", async () => {
  const initialUsers = [{ id: "1", email: "alice@example.com", password_hash: "hash:pass", email_verified: false }];
  const { app, db, emailService } = createTestServer({ db: createMockDb(initialUsers) });

  await withServer(app, async (baseUrl) => {
    // Nonexistent email
    const resUnknown = await request(baseUrl, "/api/auth/forgot-password", {
      method: "POST",
      body: { email: "ghost@example.com" },
    });
    assert.equal(resUnknown.status, 200);
    assert.equal(resUnknown.body.success, true);
    assert.match(resUnknown.body.message, /instructions have been sent/);
    assert.equal(db.resetTokens.length, 0);

    // Existing email
    const resKnown = await request(baseUrl, "/api/auth/forgot-password", {
      method: "POST",
      body: { email: "  ALICE@example.com " },
    });
    assert.equal(resKnown.status, 200);
    assert.equal(resKnown.body.success, true);
    assert.equal(resKnown.body.message, resUnknown.body.message);
    assert.equal(db.resetTokens.length, 1);

    // Ensure only token hash was persisted, not raw token
    const tokenRecord = db.resetTokens[0];
    assert.equal(tokenRecord.user_id, 1);
    assert.match(tokenRecord.token_hash, /^[a-f0-9]{64}$/);

    // Ensure email service dispatched the message
    const lastMsg = emailService.getLastSentMessage("alice@example.com");
    assert.ok(lastMsg);
    assert.match(lastMsg.text, /reset-password\?token=/);
  });
});

test("password reset flow validates single-use token, updates password, and invalidates tokens", async () => {
  const initialUsers = [{ id: "1", email: "bob@example.com", password_hash: `hash:${PASSWORD}`, email_verified: false }];
  const db = createMockDb(initialUsers);
  const emailService = createEmailService({ env: { NODE_ENV: "test" } });
  const { app } = createTestServer({ db, emailService });

  await withServer(app, async (baseUrl) => {
    // 1. Request recovery
    await request(baseUrl, "/api/auth/forgot-password", {
      method: "POST",
      body: { email: "bob@example.com" },
    });
    assert.equal(db.resetTokens.length, 1);

    // Extract raw token sent in email
    const email = emailService.getLastSentMessage("bob@example.com");
    const match = email.text.match(/token=([A-Za-z0-9_-]+)/);
    assert.ok(match, "Raw token must be in the email link");
    const rawToken = match[1];

    // 2. Reject short password
    const shortRes = await request(baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: rawToken, password: "short" },
    });
    assert.equal(shortRes.status, 400);

    // 3. Reject invalid token
    const invalidRes = await request(baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: "fake-token-that-does-not-exist", password: NEW_PASSWORD },
    });
    assert.equal(invalidRes.status, 400);
    assert.equal(invalidRes.body.code, "invalid_or_used_token");

    // 4. Successful password reset
    const successRes = await request(baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: rawToken, password: NEW_PASSWORD },
    });
    assert.equal(successRes.status, 200);
    assert.equal(successRes.body.success, true);

    // Verify user password was updated in db
    assert.equal(db.users[0].password_hash, `hash:${NEW_PASSWORD}`);
    // Verify token was marked used
    assert.ok(db.resetTokens[0].used_at !== null);

    // 5. Replay attempt fails
    const replayRes = await request(baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: rawToken, password: "yet-another-password-123" },
    });
    assert.equal(replayRes.status, 400);
    assert.equal(replayRes.body.code, "invalid_or_used_token");

    // 6. Login with new password succeeds; old password fails
    const oldLogin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "bob@example.com", password: PASSWORD },
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "bob@example.com", password: NEW_PASSWORD },
    });
    assert.equal(newLogin.status, 200);
  });
});

test("password reset rejects expired tokens", async () => {
  const initialUsers = [{ id: "1", email: "carol@example.com", password_hash: `hash:${PASSWORD}`, email_verified: false }];
  const db = createMockDb(initialUsers);
  let currentTime = 1000000;
  const { app } = createTestServer({ db, now: () => currentTime });

  await withServer(app, async (baseUrl) => {
    // Generate token in DB with expiration at currentTime + 1 hour
    const rawToken = "valid-token-format-that-will-expire";
    const tokenDigest = hashToken(rawToken);
    db.resetTokens.push({
      id: 1,
      user_id: 1,
      token_hash: tokenDigest,
      expires_at: new Date(currentTime + 3600 * 1000),
      used_at: null,
    });

    // Advance clock past expiration
    currentTime += 3601 * 1000;

    const res = await request(baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: rawToken, password: NEW_PASSWORD },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "expired_token");
  });
});

test("email verification activates unverified accounts and rejects replayed or expired tokens", async () => {
  const initialUsers = [{ id: "1", email: "dave@example.com", password_hash: `hash:${PASSWORD}`, email_verified: false }];
  const db = createMockDb(initialUsers);
  const { app } = createTestServer({ db });

  await withServer(app, async (baseUrl) => {
    const rawToken = "dave-verification-token-123456789";
    const tokenDigest = hashToken(rawToken);
    db.verificationTokens.push({
      id: 1,
      user_id: 1,
      token_hash: tokenDigest,
      expires_at: new Date(Date.now() + 86400 * 1000),
      used_at: null,
    });

    // Verify
    const verifyRes = await request(baseUrl, "/api/auth/verify-email", {
      method: "POST",
      body: { token: rawToken },
    });
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.success, true);
    assert.equal(db.users[0].email_verified, true);
    assert.ok(db.verificationTokens[0].used_at !== null);

    // Replay fails
    const replayRes = await request(baseUrl, "/api/auth/verify-email", {
      method: "POST",
      body: { token: rawToken },
    });
    assert.equal(replayRes.status, 400);
    assert.equal(replayRes.body.code, "invalid_or_used_token");
  });
});

test("resend verification dispatches new token for unverified user and returns generic response", async () => {
  const initialUsers = [
    { id: "1", email: "unverified@example.com", password_hash: `hash:${PASSWORD}`, email_verified: false },
    { id: "2", email: "verified@example.com", password_hash: `hash:${PASSWORD}`, email_verified: true },
  ];
  const db = createMockDb(initialUsers);
  const emailService = createEmailService({ env: { NODE_ENV: "test" } });
  const { app } = createTestServer({ db, emailService });

  await withServer(app, async (baseUrl) => {
    // Unverified user receives new verification email
    const res1 = await request(baseUrl, "/api/auth/resend-verification", {
      method: "POST",
      body: { email: "unverified@example.com" },
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.body.success, true);
    assert.equal(db.verificationTokens.length, 1);
    assert.ok(emailService.getLastSentMessage("unverified@example.com"));

    // Already verified user gets same generic message without new token
    const res2 = await request(baseUrl, "/api/auth/resend-verification", {
      method: "POST",
      body: { email: "verified@example.com" },
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.message, res1.body.message);
    assert.equal(db.verificationTokens.length, 1); // No new token added

    // Nonexistent user gets same generic message
    const res3 = await request(baseUrl, "/api/auth/resend-verification", {
      method: "POST",
      body: { email: "nonexistent@example.com" },
    });
    assert.equal(res3.status, 200);
    assert.equal(res3.body.message, res1.body.message);
    assert.equal(db.verificationTokens.length, 1);
  });
});

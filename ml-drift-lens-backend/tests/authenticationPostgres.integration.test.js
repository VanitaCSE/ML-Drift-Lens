const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { fork } = require("node:child_process");
const path = require("node:path");
const { after, test } = require("node:test");

const integrationEnabled = process.env.AUTH_TEST_DATABASE === "true";
const testOnlySecret = "isolated-postgresql-auth-test-secret-value";
const origin = "http://localhost:5173";
let pool;
let testEmail;
let registeredUserId;
let restartTestUserId;
let recoveryTestUserId;

if (integrationEnabled) {
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = testOnlySecret;
  process.env.SESSION_COOKIE_SECURE = "false";
  process.env.CORS_ORIGINS = origin;
  pool = require("../db");
  const { createApp } = require("../server");
  const env = process.env;

  async function assertSafeTestDatabase() {
    const res = await pool.query("SELECT current_database()");
    const dbName = res.rows[0].current_database;
    if (!dbName.includes("test") || dbName === "ml_drift_lens" || dbName === "production") {
      throw new Error(`Refusing to run integration tests against non-test database: ${dbName}`);
    }
    return dbName;
  }

  const { createEmailService } = require("../services/emailService");

  function createAuthApp(options = {}) {
    return createApp({ databasePool: pool, env, ...options });
  }

  async function withServer(app, run) {
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const address = server.address();
      return await run(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    }
  }

  async function request(baseUrl, route, {
    method = "GET",
    body,
    cookie,
    csrfToken,
  } = {}) {
    const headers = { origin };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    if (csrfToken) headers["x-csrf-token"] = csrfToken;
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : undefined,
      setCookie: response.headers.get("set-cookie"),
    };
  }

  function spawnWorker() {
    return new Promise((resolve, reject) => {
      const workerPath = path.resolve(__dirname, "./helpers/authProcessWorker.js");
      const child = fork(workerPath, [], {
        env: {
          ...process.env,
          NODE_ENV: "test",
          SESSION_SECRET: testOnlySecret,
          SESSION_COOKIE_SECURE: "false",
          CORS_ORIGINS: origin,
        },
        stdio: ["pipe", "pipe", "pipe", "ipc"],
      });
      child.on("message", (msg) => {
        if (msg.type === "listening") resolve({ child, port: msg.port, pid: msg.pid });
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0 && code !== null) reject(new Error(`Worker exited with code ${code}`));
      });
    });
  }

  test("registration, PostgreSQL session persistence across app reinitialization, and logout", async () => {
    await assertSafeTestDatabase();
    testEmail = `auth-test-${crypto.randomUUID()}@example.test`;
    const password = "isolated integration test password";
    const firstApp = createAuthApp();

    const registration = await withServer(firstApp, async (baseUrl) => request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: testEmail, password },
    }));
    assert.equal(registration.status, 201);
    registeredUserId = registration.body.user.id;

    const duplicate = await withServer(createAuthApp(), async (baseUrl) => request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: testEmail.toUpperCase(), password },
    }));
    assert.equal(duplicate.status, 409);

    const databaseUser = await pool.query(
      "SELECT email, password_hash FROM app_users WHERE id = $1",
      [registeredUserId],
    );
    assert.equal(databaseUser.rows[0].email, testEmail);
    assert.match(databaseUser.rows[0].password_hash, /^\$argon2id\$/);
    assert.notEqual(databaseUser.rows[0].password_hash, password);

    const loginResult = await withServer(createAuthApp(), async (baseUrl) => {
      const login = await request(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { email: testEmail, password },
      });
      assert.equal(login.status, 200);
      assert.match(login.setCookie, /^ml_drift_lens=s%3A[^;]+;.*HttpOnly/i);
      assert.match(login.setCookie, /SameSite=Lax/i);
      assert.match(login.setCookie, /Path=\//i);
      assert.doesNotMatch(login.setCookie, new RegExp(testEmail, "i"));
      assert.doesNotMatch(login.setCookie, new RegExp(password, "i"));
      const cookie = login.setCookie.split(";", 1)[0];
      const signedSession = decodeURIComponent(cookie.slice("ml_drift_lens=".length));
      const sessionId = signedSession.match(/^s:([^.]+)\./)?.[1];
      assert.ok(sessionId, "cookie has a signed opaque session identifier");
      const expectedDigest = crypto.createHash("sha256").update(sessionId, "utf8").digest("hex");
      const databaseSession = await pool.query(
        "SELECT sid, sess FROM user_sessions WHERE sess->>'userId' = $1",
        [registeredUserId],
      );
      assert.equal(databaseSession.rows.length, 1);
      assert.equal(databaseSession.rows[0].sid, expectedDigest);
      assert.equal(databaseSession.rows[0].sess.userId, registeredUserId);
      assert.equal(databaseSession.rows[0].sess.password, undefined);
      return { cookie, expectedDigest };
    });

    const restartedApp = createAuthApp();
    const restored = await withServer(restartedApp, async (baseUrl) => request(baseUrl, "/api/auth/me", {
      cookie: loginResult.cookie,
    }));
    assert.equal(restored.status, 200);
    assert.equal(restored.body.authenticated, true);
    assert.deepEqual(restored.body.user, { id: registeredUserId, email: testEmail });
    assert.equal(typeof restored.body.csrfToken, "string");

    // Verify privileged mutation on the actual production application router:
    // Session, Origin, and CSRF must be verified before the unapproved mutation policy blocker stops the request.
    const protectedWrite = await withServer(createAuthApp(), async (baseUrl) => request(
      baseUrl,
      "/api/predictions/1",
      {
        method: "DELETE",
        cookie: loginResult.cookie,
        csrfToken: restored.body.csrfToken,
      },
    ));
    assert.equal(protectedWrite.status, 403);
    assert.equal(protectedWrite.body.code, "authorization_policy_unconfigured");

    const logout = await withServer(createAuthApp(), async (baseUrl) => request(baseUrl, "/api/auth/logout", {
      method: "POST",
      cookie: loginResult.cookie,
      csrfToken: restored.body.csrfToken,
    }));
    assert.equal(logout.status, 204);
    const sessionAfterLogout = await pool.query(
      "SELECT sid FROM user_sessions WHERE sid = $1",
      [loginResult.expectedDigest],
    );
    assert.equal(sessionAfterLogout.rows.length, 0);

    const reusedCookie = await withServer(createAuthApp(), async (baseUrl) => request(baseUrl, "/api/auth/me", {
      cookie: loginResult.cookie,
    }));
    assert.deepEqual(reusedCookie.body, { authenticated: false, user: null });
  });

  test("PostgreSQL session persistence across real backend process restart", async () => {
    await assertSafeTestDatabase();
    const restartEmail = `restart-${crypto.randomUUID()}@example.test`;
    const password = "restart integration test password 123";

    // 1. Spawn Process 1 running the actual production server initialization
    const worker1 = await spawnWorker();
    const baseUrl1 = `http://127.0.0.1:${worker1.port}`;

    const reg = await request(baseUrl1, "/api/auth/register", {
      method: "POST",
      body: { email: restartEmail, password },
    });
    assert.equal(reg.status, 201);
    restartTestUserId = reg.body.user.id;

    const login = await request(baseUrl1, "/api/auth/login", {
      method: "POST",
      body: { email: restartEmail, password },
    });
    assert.equal(login.status, 200);
    const setCookie = login.setCookie;
    assert.ok(setCookie, "must receive session cookie from process 1");
    const cookie = setCookie.split(";", 1)[0];
    const signedSession = decodeURIComponent(cookie.slice("ml_drift_lens=".length));
    const sessionId = signedSession.match(/^s:([^.]+)\./)?.[1];
    assert.ok(sessionId, "valid signed session identifier");
    const expectedDigest = crypto.createHash("sha256").update(sessionId, "utf8").digest("hex");

    const sessionInDb = await pool.query(
      "SELECT sid, sess FROM user_sessions WHERE sid = $1",
      [expectedDigest],
    );
    assert.equal(sessionInDb.rows.length, 1);
    assert.equal(sessionInDb.rows[0].sess.userId, restartTestUserId);

    // 2. Kill Process 1 and wait for it to exit completely
    const exit1 = new Promise((resolve) => worker1.child.once("exit", resolve));
    worker1.child.kill();
    await exit1;

    // 3. Spawn Process 2 (a brand new Node process running the actual production server initialization with distinct PID)
    const worker2 = await spawnWorker();
    assert.notEqual(worker2.pid, worker1.pid, "Worker 2 must have a different PID than Worker 1");
    const baseUrl2 = `http://127.0.0.1:${worker2.port}`;

    // 4. Request /me on Process 2 using the cookie issued by Process 1
    const restored = await request(baseUrl2, "/api/auth/me", { cookie });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.authenticated, true);
    assert.deepEqual(restored.body.user, { id: restartTestUserId, email: restartEmail });
    assert.equal(typeof restored.body.csrfToken, "string");

    // 5. Execute privileged mutation on Process 2 using Process 1's restored session and CSRF token:
    // Confirms session and CSRF were accepted across the real process restart, and policy block remains active.
    const protectedWrite = await request(baseUrl2, "/api/predictions/1", {
      method: "DELETE",
      cookie,
      csrfToken: restored.body.csrfToken,
    });
    assert.equal(protectedWrite.status, 403);
    assert.equal(protectedWrite.body.code, "authorization_policy_unconfigured");

    // 6. Logout on Process 2
    const logout = await request(baseUrl2, "/api/auth/logout", {
      method: "POST",
      cookie,
      csrfToken: restored.body.csrfToken,
    });
    assert.equal(logout.status, 204);

    const sessionAfterLogout = await pool.query(
      "SELECT sid FROM user_sessions WHERE sid = $1",
      [expectedDigest],
    );
    assert.equal(sessionAfterLogout.rows.length, 0);

    // 7. Verify cookie reuse fails on Process 2
    const reused = await request(baseUrl2, "/api/auth/me", { cookie });
    assert.deepEqual(reused.body, { authenticated: false, user: null });

    // Clean up Process 2
    const exit2 = new Promise((resolve) => worker2.child.once("exit", resolve));
    worker2.child.kill();
    await exit2;
  });

  test("persists password reset tokens, revokes sessions across PostgreSQL, and updates email verification state", async () => {
    await assertSafeTestDatabase();
    const emailService = createEmailService({ env: { NODE_ENV: "test" } });
    const app = createAuthApp({ emailService });
    const recoveryEmail = `recovery-test-${Date.now()}@example.test`;
    const initialPassword = "initial-safe-test-password-123";
    const updatedPassword = "updated-safe-test-password-456";

    await withServer(app, async (baseUrl) => {
      // 1. Register user
      const registerRes = await request(baseUrl, "/api/auth/register", {
        method: "POST",
        body: { email: recoveryEmail, password: initialPassword },
      });
      assert.equal(registerRes.status, 201);
      recoveryTestUserId = registerRes.body.user.id;

      // 2. Nonexistent email recovery request returns indistinguishable generic response without writing tokens
      const ghostEmail = `ghost-${Date.now()}@example.test`;
      const ghostRes = await request(baseUrl, "/api/auth/forgot-password", {
        method: "POST",
        body: { email: ghostEmail },
      });
      assert.equal(ghostRes.status, 200);
      assert.equal(ghostRes.body.success, true);
      assert.match(ghostRes.body.message, /instructions have been sent/i);

      // Verify no token written for nonexistent email
      const ghostTokens = await pool.query(
        "SELECT id FROM password_reset_tokens WHERE user_id = $1",
        [9999999],
      );
      assert.equal(ghostTokens.rows.length, 0);

      // 3. Request recovery for registered user
      const forgotRes = await request(baseUrl, "/api/auth/forgot-password", {
        method: "POST",
        body: { email: recoveryEmail },
      });
      assert.equal(forgotRes.status, 200);
      assert.equal(forgotRes.body.success, true);
      assert.equal(forgotRes.body.message, ghostRes.body.message);

      // 4. Inspect PostgreSQL: reset token hash is stored, used_at is null, expires_at is future (~1hr)
      const tokenRows = await pool.query(
        "SELECT id, token_hash, expires_at, used_at FROM password_reset_tokens WHERE user_id = $1",
        [recoveryTestUserId],
      );
      assert.equal(tokenRows.rows.length, 1);
      assert.equal(tokenRows.rows[0].used_at, null);
      assert.match(tokenRows.rows[0].token_hash, /^[a-f0-9]{64}$/);
      const expiresAtMs = new Date(tokenRows.rows[0].expires_at).getTime();
      assert.ok(expiresAtMs > Date.now() + 50 * 60 * 1000);

      // 5. Obtain the raw reset token strictly via safe test email transport / local preview
      const previewRes = await fetch(`${baseUrl}/api/dev/email-preview?email=${encodeURIComponent(recoveryEmail)}`);
      assert.equal(previewRes.status, 200);
      const previewData = await previewRes.json();
      assert.equal(previewData.success, true);
      assert.equal(previewData.simulated, true);
      assert.ok(previewData.preview.resetUrl);

      const urlMatch = previewData.preview.resetUrl.match(/token=([A-Za-z0-9_-]+)/);
      assert.ok(urlMatch, "Raw reset token must be present in the simulated preview resetUrl");
      const rawToken = urlMatch[1];

      // Confirm SHA-256 hash of this raw token strictly matches the persisted database hash
      const computedHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
      assert.equal(computedHash, tokenRows.rows[0].token_hash);

      // 6. Verify malformed and unknown tokens are rejected safely
      const malformedRes = await request(baseUrl, "/api/auth/reset-password", {
        method: "POST",
        body: { token: "bad token with spaces!", password: updatedPassword },
      });
      assert.equal(malformedRes.status, 400);

      const unknownRes = await request(baseUrl, "/api/auth/reset-password", {
        method: "POST",
        body: { token: "unknown-token-that-does-not-exist-in-database", password: updatedPassword },
      });
      assert.equal(unknownRes.status, 400);
      assert.equal(unknownRes.body.code, "invalid_or_used_token");

      // 7. Verify expired token is rejected
      const expiredRawToken = "expired-test-token-123456789";
      const expiredDigest = crypto.createHash("sha256").update(expiredRawToken).digest("hex");
      await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP - interval '1 hour')",
        [recoveryTestUserId, expiredDigest],
      );
      const expiredRes = await request(baseUrl, "/api/auth/reset-password", {
        method: "POST",
        body: { token: expiredRawToken, password: updatedPassword },
      });
      assert.equal(expiredRes.status, 400);
      assert.equal(expiredRes.body.code, "expired_token");

      // 8. Log in to establish an active session before password reset
      const loginRes = await request(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { email: recoveryEmail, password: initialPassword },
      });
      assert.equal(loginRes.status, 200);
      const cookie = loginRes.setCookie.split(";", 1)[0];

      // Verify active session exists in PostgreSQL
      const activeSessionsBefore = await pool.query(
        "SELECT sid FROM user_sessions WHERE sess->>'userId' = $1",
        [recoveryTestUserId],
      );
      assert.equal(activeSessionsBefore.rows.length, 1);

      // 9. Reset password using the genuine rawToken obtained from test email transport
      const resetRes = await request(baseUrl, "/api/auth/reset-password", {
        method: "POST",
        body: { token: rawToken, password: updatedPassword },
      });
      assert.equal(resetRes.status, 200);
      assert.equal(resetRes.body.success, true);

      // 10. Verify token cannot be reused (single-use)
      const replayRes = await request(baseUrl, "/api/auth/reset-password", {
        method: "POST",
        body: { token: rawToken, password: "yet-another-password-123" },
      });
      assert.equal(replayRes.status, 400);
      assert.equal(replayRes.body.code, "invalid_or_used_token");

      // Verify token is now marked used in PostgreSQL
      const tokenAfter = await pool.query(
        "SELECT used_at FROM password_reset_tokens WHERE id = $1",
        [tokenRows.rows[0].id],
      );
      assert.ok(tokenAfter.rows[0].used_at !== null);

      // 11. Verify all existing sessions for the user were revoked in PostgreSQL
      const activeSessionsAfter = await pool.query(
        "SELECT sid FROM user_sessions WHERE sess->>'userId' = $1",
        [recoveryTestUserId],
      );
      assert.equal(activeSessionsAfter.rows.length, 0);

      // 12. Verify previous session cookie is no longer authenticated
      const meRes = await request(baseUrl, "/api/auth/me", { cookie });
      assert.deepEqual(meRes.body, { authenticated: false, user: null });

      // 13. Verify old password fails; new password succeeds
      const oldLogin = await request(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { email: recoveryEmail, password: initialPassword },
      });
      assert.equal(oldLogin.status, 401);

      const newLogin = await request(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { email: recoveryEmail, password: updatedPassword },
      });
      assert.equal(newLogin.status, 200);

      // 14. Email verification test against PostgreSQL
      const verifyRawToken = crypto.randomBytes(32).toString("base64url");
      const verifyDigest = crypto.createHash("sha256").update(verifyRawToken).digest("hex");
      await pool.query(
        "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + interval '24 hours')",
        [recoveryTestUserId, verifyDigest],
      );

      const verifyRes = await request(baseUrl, "/api/auth/verify-email", {
        method: "POST",
        body: { token: verifyRawToken },
      });
      assert.equal(verifyRes.status, 200);

      const userRow = await pool.query(
        "SELECT email_verified FROM app_users WHERE id = $1",
        [recoveryTestUserId],
      );
      assert.equal(userRow.rows[0].email_verified, true);
    });
  });
} else {
  test("PostgreSQL auth integration requires AUTH_TEST_DATABASE=true for a dedicated isolated database", {
    skip: true,
  }, () => {});
}

after(async () => {
  if (!integrationEnabled || !pool) return;
  try {
    if (registeredUserId) {
      await pool.query("DELETE FROM user_sessions WHERE sess->>'userId' = $1", [registeredUserId]);
      await pool.query("DELETE FROM app_users WHERE id = $1", [registeredUserId]);
    }
    if (restartTestUserId) {
      await pool.query("DELETE FROM user_sessions WHERE sess->>'userId' = $1", [restartTestUserId]);
      await pool.query("DELETE FROM app_users WHERE id = $1", [restartTestUserId]);
    }
    if (recoveryTestUserId) {
      await pool.query("DELETE FROM user_sessions WHERE sess->>'userId' = $1", [recoveryTestUserId]);
      await pool.query("DELETE FROM app_users WHERE id = $1", [recoveryTestUserId]);
    }
  } finally {
    await pool.end();
  }
});

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const session = require("express-session");
const express = require("express");
const argon2 = require("argon2");
const { after, test } = require("node:test");
const { createAuthRouter } = require("../routes/authRoutes");
const {
  createAuthGuards,
  createSessionMiddleware,
  HashedSessionStore,
} = require("../middleware/authSession");
const { parseCorsOrigins } = require("../utils/cors");
const {
  SESSION_ABSOLUTE_TIMEOUT_MS,
  readSessionConfig,
} = require("../utils/authConfig");
const { ARGON2_OPTIONS } = require("../controllers/authController");

const SECRET = "test-only-session-secret-with-more-than-32-bytes";
const ORIGIN = "http://localhost:5173";
const PASSWORD = "a-secure-test-password";
const activeServers = new Set();

after(async () => {
  await Promise.all([...activeServers].map((server) => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  })));
});

function createUserPool(seed = []) {
  const users = [...seed];
  let nextId = users.reduce((maxId, user) => Math.max(maxId, Number(user.id)), 0) + 1;

  return {
    users,
    async query(sql, values = []) {
      if (sql.includes("INSERT INTO app_users")) {
        const [email, passwordHash] = values;
        if (users.some((user) => user.email === email)) {
          const error = new Error("private duplicate constraint detail");
          error.code = "23505";
          throw error;
        }
        const user = { id: String(nextId++), email, password_hash: passwordHash };
        users.push(user);
        return { rows: [{ id: user.id, email: user.email }] };
      }
      if (sql.includes("password_hash FROM app_users")) {
        const user = users.find((item) => item.email === values[0]);
        return { rows: user ? [{ ...user }] : [] };
      }
      if (sql.includes("FROM app_users WHERE id = $1")) {
        const user = users.find((item) => item.id === String(values[0]));
        return { rows: user ? [{ id: user.id, email: user.email, email_verified: false }] : [] };
      }
      if (sql.includes("tokens")) {
        return { rows: [] };
      }
      throw new Error("Unexpected query in auth test");
    },
  };
}

function testPasswordHasher() {
  return {
    async hash(password) {
      return `test-hash:${password}`;
    },
    async verify(hash, password) {
      return hash === `test-hash:${password}`;
    },
  };
}

function createAuthApp({
  databasePool = createUserPool(),
  env = {
    NODE_ENV: "test",
    SESSION_SECRET: SECRET,
    CORS_ORIGINS: ORIGIN,
  },
  store = new session.MemoryStore(),
  passwordHasher = testPasswordHasher(),
  addProtectedProbe = false,
  loginLimiter,
  registrationLimiter,
} = {}) {
  const app = express();
  app.set("trust proxy", env.NODE_ENV === "production" ? 1 : false);
  app.use(express.json({ limit: "16kb" }));
  const sessionMiddleware = createSessionMiddleware({ databasePool, env, store });
  const guards = createAuthGuards({
    databasePool,
    env,
    sessionMiddleware,
    allowedOrigins: parseCorsOrigins(env.CORS_ORIGINS),
  });
  app.use(
    "/api/auth",
    createAuthRouter({
      databasePool,
      env,
      sessionMiddleware,
      guards,
      passwordHasher,
      loginLimiter,
      registrationLimiter,
    }),
  );
  if (addProtectedProbe) {
    app.post(
      "/api/protected-probe",
      guards.requireBrowserOrigin,
      guards.requireUserSession,
      guards.requireCsrfToken,
      guards.blockUnapprovedMutation,
      (_req, res) => res.status(204).end(),
    );
  }
  return { app, store, databasePool, guards };
}

async function withServer(app, run) {
  const server = http.createServer(app);
  activeServers.add(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    activeServers.delete(server);
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

async function request(baseUrl, path, {
  method = "GET",
  body,
  cookie,
  csrfToken,
  origin = ORIGIN,
  forwardedProto,
} = {}) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  if (forwardedProto) headers["x-forwarded-proto"] = forwardedProto;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
    cookie: response.headers.get("set-cookie"),
  };
}

function cookiePair(setCookie) {
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
}

test("validates session secret strength and requires secure cookies in production", () => {
  assert.equal(readSessionConfig({ SESSION_SECRET: "too-short", NODE_ENV: "development" }).status, "invalid");
  assert.equal(readSessionConfig({
    SESSION_SECRET: SECRET,
    NODE_ENV: "production",
    SESSION_COOKIE_SECURE: "false",
  }).status, "invalid");
  assert.equal(readSessionConfig({
    SESSION_SECRET: SECRET,
    NODE_ENV: "production",
  }).config.secureCookie, true);
});

test("hashes the session identifier before passing it to the backing store", async () => {
  let storedKey;
  const backingStore = new session.Store();
  backingStore.set = (key, value, callback) => {
    storedKey = key;
    callback();
  };
  const hashedStore = new HashedSessionStore(backingStore);
  await new Promise((resolve, reject) => {
    hashedStore.set("opaque-random-session-id", {}, (error) => (
      error ? reject(error) : resolve()
    ));
  });
  assert.match(storedKey, /^[a-f0-9]{64}$/);
  assert.notEqual(storedKey, "opaque-random-session-id");
});

test("registers a normalized account with a password hash and rejects invalid input", async () => {
  const fixture = createAuthApp();
  await withServer(fixture.app, async (baseUrl) => {
    const invalid = await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: "not-an-email", password: "short" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(fixture.databasePool.users.length, 0);

    const response = await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: "  USER@example.test ", password: PASSWORD },
    });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.user, { id: "1", email: "user@example.test" });
    assert.equal(fixture.databasePool.users[0].password_hash, `test-hash:${PASSWORD}`);
    assert.doesNotMatch(JSON.stringify(response.body), /password_hash|test-hash/);
  });
});

test("rejects duplicate normalized email without returning database details", async () => {
  const fixture = createAuthApp();
  await withServer(fixture.app, async (baseUrl) => {
    await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: "user@example.test", password: PASSWORD },
    });
    const duplicate = await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: " USER@EXAMPLE.TEST ", password: PASSWORD },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, "email_unavailable");
    assert.doesNotMatch(JSON.stringify(duplicate.body), /private|constraint/i);
  });
});

test("logs in, restores the minimal current session and invalidates it on logout", async () => {
  const fixture = createAuthApp();
  await withServer(fixture.app, async (baseUrl) => {
    await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: "user@example.test", password: PASSWORD },
    });
    const login = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: " USER@example.test ", password: PASSWORD },
    });
    assert.equal(login.status, 200);
    assert.deepEqual(login.body.user, { id: "1", email: "user@example.test" });
    assert.doesNotMatch(login.cookie, /password_hash|test-hash/);
    const cookie = cookiePair(login.cookie);

    const current = await request(baseUrl, "/api/auth/me", { cookie });
    assert.deepEqual(current.body.user, { id: "1", email: "user@example.test" });
    assert.equal(current.body.authenticated, true);
    assert.match(current.body.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(JSON.stringify(current.body), /password_hash|sessionId|sid/);

    const logout = await request(baseUrl, "/api/auth/logout", {
      method: "POST",
      cookie,
      csrfToken: current.body.csrfToken,
    });
    assert.equal(logout.status, 204, JSON.stringify(logout.body));
    assert.match(logout.cookie, /Expires=Thu, 01 Jan 1970/i);

    const afterLogout = await request(baseUrl, "/api/auth/me", { cookie });
    assert.deepEqual(afterLogout.body, { authenticated: false, user: null });
  });
});

test("returns indistinguishable login errors for unknown accounts and incorrect passwords", async () => {
  const fixture = createAuthApp();
  await withServer(fixture.app, async (baseUrl) => {
    await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: "user@example.test", password: PASSWORD },
    });
    const wrongPassword = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "user@example.test", password: "another-secure-password" },
    });
    const unknownUser = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "other@example.test", password: "another-secure-password" },
    });
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(unknownUser.body, wrongPassword.body);
    assert.equal(unknownUser.body.code, "invalid_credentials");
  });
});

test("enforces browser origin, authenticated-session and CSRF checks before protected mutations", async () => {
  const fixture = createAuthApp({ addProtectedProbe: true });
  await withServer(fixture.app, async (baseUrl) => {
    const badOrigin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      origin: "https://untrusted.example",
      body: { email: "user@example.test", password: PASSWORD },
    });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.body.code, "origin_not_allowed");

    const anonymous = await request(baseUrl, "/api/protected-probe", { method: "POST" });
    assert.equal(anonymous.status, 401);

    await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: "user@example.test", password: PASSWORD },
    });
    const login = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "user@example.test", password: PASSWORD },
    });
    const cookie = cookiePair(login.cookie);
    const invalidCsrf = await request(baseUrl, "/api/protected-probe", {
      method: "POST",
      cookie,
      csrfToken: "invalid-token",
    });
    assert.equal(invalidCsrf.status, 403);
    assert.equal(invalidCsrf.body.code, "csrf_validation_failed");

    const unapprovedPermission = await request(baseUrl, "/api/protected-probe", {
      method: "POST",
      cookie,
      csrfToken: (await request(baseUrl, "/api/auth/me", { cookie })).body.csrfToken,
    });
    assert.equal(unapprovedPermission.status, 403);
    assert.equal(unapprovedPermission.body.code, "authorization_policy_unconfigured");
  });
});

test("expires sessions at the absolute lifetime and rejects invalid cookies", async () => {
  const fixture = createAuthApp();
  await withServer(fixture.app, async (baseUrl) => {
    await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: { email: "user@example.test", password: PASSWORD },
    });
    const login = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "user@example.test", password: PASSWORD },
    });
    const cookie = cookiePair(login.cookie);
    const cookieValue = decodeURIComponent(cookie.split("=", 2)[1]);
    const sessionId = cookieValue.slice(2, cookieValue.lastIndexOf("."));
    const storedSessionKey = crypto.createHash("sha256").update(sessionId).digest("hex");
    const stored = JSON.parse(fixture.store.sessions[storedSessionKey]);
    stored.authenticatedAt = Date.now() - SESSION_ABSOLUTE_TIMEOUT_MS - 1000;
    fixture.store.sessions[storedSessionKey] = JSON.stringify(stored);

    const expired = await request(baseUrl, "/api/auth/me", { cookie });
    assert.deepEqual(expired.body, { authenticated: false, user: null });
    assert.match(expired.cookie, /Expires=Thu, 01 Jan 1970/i);

    const invalid = await request(baseUrl, "/api/auth/me", {
      cookie: "ml_drift_lens=invalid",
    });
    assert.deepEqual(invalid.body, { authenticated: false, user: null });
  });
});

test("fails closed when session configuration or the PostgreSQL session store is unavailable", async () => {
  const missingConfig = createAuthApp({
    env: { NODE_ENV: "test", CORS_ORIGINS: ORIGIN },
  });
  await withServer(missingConfig.app, async (baseUrl) => {
    const response = await request(baseUrl, "/api/auth/me");
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "authentication_unavailable");
  });

  const databasePool = createUserPool([{
    id: "1",
    email: "user@example.test",
    password_hash: "test-hash:" + PASSWORD,
  }]);
  const failingStore = new session.Store();
  failingStore.set = (_sid, _value, callback) => callback(new Error("private store failure"));
  const storeFailure = createAuthApp({ databasePool, store: failingStore });
  await withServer(storeFailure.app, async (baseUrl) => {
    const response = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "user@example.test", password: PASSWORD },
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "authentication_unavailable");
    assert.doesNotMatch(JSON.stringify(response.body), /private store failure/);
  });
});

test("sets host-only Secure HttpOnly SameSite cookies for production HTTPS", async () => {
  const fixture = createAuthApp({
    env: {
      NODE_ENV: "production",
      SESSION_SECRET: SECRET,
      SESSION_COOKIE_SECURE: "true",
      CORS_ORIGINS: "https://app.example.test",
    },
  });
  await withServer(fixture.app, async (baseUrl) => {
    fixture.databasePool.users.push({
      id: "1",
      email: "user@example.test",
      password_hash: "test-hash:" + PASSWORD,
    });
    const response = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      origin: "https://app.example.test",
      forwardedProto: "https",
      body: { email: "user@example.test", password: PASSWORD },
    });
    assert.equal(response.status, 200);
    assert.match(response.cookie, /^__Host-ml-drift-lens=/);
    assert.match(response.cookie, /HttpOnly/i);
    assert.match(response.cookie, /Secure/i);
    assert.match(response.cookie, /SameSite=Lax/i);
    assert.match(response.cookie, /Path=\//i);
    assert.doesNotMatch(response.cookie, /Domain=/i);
  });
});

test("hashes passwords with Argon2id rather than storing plaintext", async () => {
  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS);
  assert.match(hash, /^\$argon2id\$/);
  assert.notEqual(hash, PASSWORD);
  assert.equal(await argon2.verify(hash, PASSWORD), true);
  assert.equal(await argon2.verify(hash, "incorrect-password"), false);
});

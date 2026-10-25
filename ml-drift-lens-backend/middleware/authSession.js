const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const crypto = require("node:crypto");
const pool = require("../db");
const { parseCorsOrigins } = require("../utils/cors");
const {
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  readSessionConfig,
} = require("../utils/authConfig");

const PgSessionStore = connectPgSimple(session);

class HashedSessionStore extends session.Store {
  constructor(store) {
    super();
    this.store = store;
    store.on?.("error", (error) => this.emit("error", error));
  }

  digest(sessionId) {
    return crypto.createHash("sha256").update(sessionId, "utf8").digest("hex");
  }

  get(sessionId, callback) {
    this.store.get(this.digest(sessionId), callback);
  }

  set(sessionId, value, callback) {
    this.store.set(this.digest(sessionId), value, callback);
  }

  touch(sessionId, value, callback) {
    this.store.touch(this.digest(sessionId), value, callback);
  }

  destroy(sessionId, callback) {
    this.store.destroy(this.digest(sessionId), callback);
  }

  close() {
    return this.store.close?.();
  }
}

function unavailable(res) {
  return res.status(503).json({
    success: false,
    error: "Authentication is temporarily unavailable",
    code: "authentication_unavailable",
  });
}

function clearSessionCookie(res, config) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: "lax",
    path: "/",
  });
}

function createSessionMiddleware({
  databasePool = pool,
  env = process.env,
  store,
  now = Date.now,
} = {}) {
  let middleware;
  let config;
  let configInvalid = false;

  return function loadSession(req, res, next) {
    if (!middleware && !configInvalid) {
      const result = readSessionConfig(env);
      if (result.status !== "valid") {
        configInvalid = true;
      } else {
        config = result.config;
        const postgresStore = store || new PgSessionStore({
          pool: databasePool,
          tableName: "user_sessions",
          createTableIfMissing: false,
          pruneSessionInterval: 15,
        });
        const sessionStore = new HashedSessionStore(postgresStore);
        sessionStore.on("error", (error) => {
          console.error("PostgreSQL session store error", {
            name: error.name,
            code: error.code,
          });
        });
        middleware = session({
          name: config.cookieName,
          secret: config.secret,
          store: sessionStore,
          resave: false,
          saveUninitialized: false,
          rolling: true,
          cookie: {
            httpOnly: true,
            secure: config.secureCookie,
            sameSite: "lax",
            path: "/",
            maxAge: SESSION_IDLE_TIMEOUT_MS,
          },
        });
      }
    }

    if (configInvalid) return unavailable(res);

    middleware(req, res, (error) => {
      if (error) return unavailable(res);

      const authenticatedAt = req.session?.authenticatedAt;
      const hasAuthenticatedUser = Boolean(req.session?.userId);
      const invalidAuthenticationTime = hasAuthenticatedUser
        && (!Number.isSafeInteger(authenticatedAt) || authenticatedAt > now());
      const sessionHasExpired = Number.isSafeInteger(authenticatedAt)
        && now() - authenticatedAt >= SESSION_ABSOLUTE_TIMEOUT_MS;
      if (invalidAuthenticationTime || sessionHasExpired) {
        return req.session.destroy((destroyError) => {
          if (destroyError) return unavailable(res);
          clearSessionCookie(res, config);
          req.sessionExpired = true;
          next();
        });
      }

      return next();
    });
  };
}

function createAuthGuards({
  databasePool = pool,
  env = process.env,
  sessionMiddleware = createSessionMiddleware({ databasePool, env }),
  allowedOrigins = parseCorsOrigins(env.CORS_ORIGINS),
} = {}) {
  function requireBrowserOrigin(req, res, next) {
    const origin = req.get("origin");
    if (typeof origin !== "string" || !allowedOrigins.has(origin)) {
      return res.status(403).json({
        success: false,
        error: "Request origin is not allowed",
        code: "origin_not_allowed",
      });
    }
    return next();
  }

  function requireAuthenticatedSession(req, res, next) {
    if (!req.authUser) {
      return res.status(401).json({
        success: false,
        error: "Authentication is required",
        code: req.sessionExpired ? "session_expired" : "authentication_required",
      });
    }
    return next();
  }

  function requireCsrfToken(req, res, next) {
    const expected = req.session?.csrfToken;
    const supplied = req.get("x-csrf-token");
    if (
      typeof expected !== "string"
      || typeof supplied !== "string"
      || Buffer.byteLength(expected) !== Buffer.byteLength(supplied)
      || !crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(supplied),
      )
    ) {
      return res.status(403).json({
        success: false,
        error: "A valid CSRF token is required",
        code: "csrf_validation_failed",
      });
    }
    return next();
  }

  function blockUnapprovedMutation(req, res) {
    return res.status(403).json({
      success: false,
      error: "Authorization policy for this operation has not been approved",
      code: "authorization_policy_unconfigured",
    });
  }

  async function loadSessionUser(req, res, next) {
    if (!req.session?.userId || req.sessionExpired) {
      req.authUser = null;
      return next();
    }

    try {
      const result = await databasePool.query(
        "SELECT id, email, email_verified FROM app_users WHERE id = $1",
        [req.session.userId],
      );
      if (result.rows.length === 0) {
        return req.session.destroy((error) => {
          if (error) return unavailable(res);
          req.authUser = null;
          next();
        });
      }
      req.authUser = {
        id: String(result.rows[0].id),
        email: result.rows[0].email,
        email_verified: Boolean(result.rows[0].email_verified),
      };
      return next();
    } catch {
      return unavailable(res);
    }
  }

  function requireUserSession(req, res, next) {
    sessionMiddleware(req, res, (error) => {
      if (error) return unavailable(res);
      loadSessionUser(req, res, () => requireAuthenticatedSession(req, res, next));
    });
  }

  return {
    sessionMiddleware,
    requireBrowserOrigin,
    requireAuthenticatedSession,
    requireUserSession,
    requireCsrfToken,
    blockUnapprovedMutation,
    loadSessionUser,
  };
}

const defaultGuards = createAuthGuards();

module.exports = {
  HashedSessionStore,
  createSessionMiddleware,
  createAuthGuards,
  ...defaultGuards,
  clearSessionCookie,
};

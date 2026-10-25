const crypto = require("node:crypto");
const argon2 = require("argon2");
const { clearSessionCookie } = require("../middleware/authSession");
const { readSessionConfig } = require("../utils/authConfig");
const { defaultEmailService } = require("../services/emailService");

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

const RESET_TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours

function publicUser(row) {
  return {
    id: String(row.id),
    email: row.email,
  };
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function sendUnavailable(res) {
  return res.status(503).json({
    success: false,
    error: "Authentication is temporarily unavailable",
    code: "authentication_unavailable",
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function createAuthController({
  databasePool,
  passwordHasher = argon2,
  emailService = defaultEmailService,
  now = Date.now,
  env = process.env,
}) {
  async function register(req, res) {
    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;

    try {
      const passwordHash = await passwordHasher.hash(password, ARGON2_OPTIONS);
      const result = await databasePool.query(
        `INSERT INTO app_users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email`,
        [email, passwordHash],
      );
      const user = result.rows[0];

      // Generate initial verification token and dispatch email in background
      try {
        const rawToken = crypto.randomBytes(32).toString("base64url");
        const tokenDigest = hashToken(rawToken);
        const expiresAt = new Date(now() + VERIFICATION_TOKEN_LIFETIME_MS);
        await databasePool.query(
          `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [user.id, tokenDigest, expiresAt],
        );
        await emailService.sendVerificationEmail({ email: user.email, token: rawToken });
      } catch (emailErr) {
        // Log safely without breaking account creation
        if (env.NODE_ENV !== "test") {
          console.error("Initial verification email dispatch failed:", emailErr.message);
        }
      }

      return res.status(201).json({
        success: true,
        user: publicUser(user),
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          error: "An account with this email cannot be created",
          code: "email_unavailable",
        });
      }
      return sendUnavailable(res);
    }
  }

  async function login(req, res) {
    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;
    let result;

    try {
      result = await databasePool.query(
        "SELECT id, email, password_hash FROM app_users WHERE email = $1",
        [email],
      );
    } catch {
      return sendUnavailable(res);
    }

    const user = result.rows[0];
    let passwordMatches = false;
    try {
      if (user) {
        passwordMatches = await passwordHasher.verify(user.password_hash, password);
      } else {
        await passwordHasher.hash(password, ARGON2_OPTIONS);
      }
    } catch {
      passwordMatches = false;
    }

    if (!user || !passwordMatches) {
      return res.status(401).json({
        success: false,
        error: "Email or password is incorrect",
        code: "invalid_credentials",
      });
    }

    try {
      await regenerateSession(req);
      req.session.userId = String(user.id);
      req.session.authenticatedAt = now();
      req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
      await saveSession(req);
    } catch {
      return sendUnavailable(res);
    }

    return res.status(200).json({
      success: true,
      user: publicUser(user),
    });
  }

  async function currentSession(req, res) {
    if (!req.authUser) {
      return res.status(200).json({
        authenticated: false,
        user: null,
      });
    }

    if (typeof req.session.csrfToken !== "string") {
      req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
      try {
        await saveSession(req);
      } catch {
        return sendUnavailable(res);
      }
    }

    return res.status(200).json({
      authenticated: true,
      user: publicUser(req.authUser),
      email_verified: Boolean(req.authUser.email_verified),
      csrfToken: req.session.csrfToken,
    });
  }

  async function logout(req, res) {
    const result = readSessionConfig(env);
    try {
      await destroySession(req);
    } catch {
      delete req.session;
      if (result.status === "valid") clearSessionCookie(res, result.config);
      return sendUnavailable(res);
    }

    delete req.session;
    if (result.status === "valid") clearSessionCookie(res, result.config);
    return res.status(204).end();
  }

  async function requestPasswordReset(req, res) {
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : "";
    const genericResponse = {
      success: true,
      message: "If an account exists with this email address, password reset instructions have been sent.",
    };

    if (!email) {
      return res.status(200).json(genericResponse);
    }

    try {
      const userResult = await databasePool.query(
        "SELECT id, email FROM app_users WHERE email = $1",
        [email],
      );

      if (userResult.rows.length === 0) {
        // Dummy verification to mitigate timing attacks
        await passwordHasher.hash(email, ARGON2_OPTIONS).catch(() => {});
        return res.status(200).json(genericResponse);
      }

      const user = userResult.rows[0];

      // Invalidate existing unused tokens for this user
      await databasePool.query(
        "UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL",
        [user.id],
      );

      // Generate cryptographically secure token and persist only its SHA-256 hash
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenDigest = hashToken(rawToken);
      const expiresAt = new Date(now() + RESET_TOKEN_LIFETIME_MS);

      await databasePool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, tokenDigest, expiresAt],
      );

      await emailService.sendPasswordResetEmail({
        email: user.email,
        token: rawToken,
      });

      return res.status(200).json(genericResponse);
    } catch (err) {
      if (env.NODE_ENV !== "test") {
        console.error("Password reset request error:", err.message);
      }
      return sendUnavailable(res);
    }
  }

  async function resetPassword(req, res) {
    const token = req.body.token ? String(req.body.token).trim() : "";
    const newPassword = req.body.password;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Password reset token is required",
        code: "missing_token",
      });
    }

    try {
      const tokenDigest = hashToken(token);
      const tokenResult = await databasePool.query(
        `SELECT id, user_id, expires_at, used_at
         FROM password_reset_tokens
         WHERE token_hash = $1`,
        [tokenDigest],
      );

      if (tokenResult.rows.length === 0 || tokenResult.rows[0].used_at !== null) {
        return res.status(400).json({
          success: false,
          error: "Password reset link is invalid or has already been used.",
          code: "invalid_or_used_token",
        });
      }

      const tokenRecord = tokenResult.rows[0];
      const expiresAtMs = new Date(tokenRecord.expires_at).getTime();

      if (expiresAtMs < now()) {
        return res.status(400).json({
          success: false,
          error: "Password reset link has expired. Please request a new one.",
          code: "expired_token",
        });
      }

      // Hash new password using Argon2id
      const newHash = await passwordHasher.hash(newPassword, ARGON2_OPTIONS);

      // Atomically update password, consume token, and invalidate any other tokens
      const client = await databasePool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE app_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
          [newHash, tokenRecord.user_id],
        );
        await client.query(
          "UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1",
          [tokenRecord.id],
        );
        await client.query(
          "UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL",
          [tokenRecord.user_id],
        );
        // Revoke active sessions for this user in user_sessions
        await client.query(
          "DELETE FROM user_sessions WHERE sess->>'userId' = $1::text",
          [String(tokenRecord.user_id)],
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }

      return res.status(200).json({
        success: true,
        message: "Password has been successfully reset. Please sign in with your new password.",
      });
    } catch (err) {
      if (env.NODE_ENV !== "test") {
        console.error("Password reset error:", err.message);
      }
      return sendUnavailable(res);
    }
  }

  async function verifyEmail(req, res) {
    const token = req.body.token ? String(req.body.token).trim() : "";

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Verification token is required",
        code: "missing_token",
      });
    }

    try {
      const tokenDigest = hashToken(token);
      const tokenResult = await databasePool.query(
        `SELECT id, user_id, expires_at, used_at
         FROM email_verification_tokens
         WHERE token_hash = $1`,
        [tokenDigest],
      );

      if (tokenResult.rows.length === 0 || tokenResult.rows[0].used_at !== null) {
        return res.status(400).json({
          success: false,
          error: "Verification link is invalid or has already been used.",
          code: "invalid_or_used_token",
        });
      }

      const tokenRecord = tokenResult.rows[0];
      const expiresAtMs = new Date(tokenRecord.expires_at).getTime();

      if (expiresAtMs < now()) {
        return res.status(400).json({
          success: false,
          error: "Verification link has expired. Please request a new verification email.",
          code: "expired_token",
        });
      }

      const client = await databasePool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE app_users SET email_verified = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
          [tokenRecord.user_id],
        );
        await client.query(
          "UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1",
          [tokenRecord.id],
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }

      return res.status(200).json({
        success: true,
        message: "Email has been successfully verified.",
      });
    } catch (err) {
      if (env.NODE_ENV !== "test") {
        console.error("Email verification error:", err.message);
      }
      return sendUnavailable(res);
    }
  }

  async function resendVerification(req, res) {
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : "";
    const genericResponse = {
      success: true,
      message: "If an unverified account exists with that email address, a verification link has been sent.",
    };

    if (!email) {
      return res.status(200).json(genericResponse);
    }

    try {
      const userResult = await databasePool.query(
        "SELECT id, email, email_verified FROM app_users WHERE email = $1",
        [email],
      );

      if (userResult.rows.length === 0 || userResult.rows[0].email_verified === true) {
        return res.status(200).json(genericResponse);
      }

      const user = userResult.rows[0];

      // Invalidate existing unused verification tokens
      await databasePool.query(
        "UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL",
        [user.id],
      );

      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenDigest = hashToken(rawToken);
      const expiresAt = new Date(now() + VERIFICATION_TOKEN_LIFETIME_MS);

      await databasePool.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, tokenDigest, expiresAt],
      );

      await emailService.sendVerificationEmail({
        email: user.email,
        token: rawToken,
      });

      return res.status(200).json(genericResponse);
    } catch (err) {
      if (env.NODE_ENV !== "test") {
        console.error("Resend verification error:", err.message);
      }
      return sendUnavailable(res);
    }
  }

  return {
    register,
    login,
    currentSession,
    logout,
    requestPasswordReset,
    resetPassword,
    verifyEmail,
    resendVerification,
  };
}

module.exports = {
  ARGON2_OPTIONS,
  createAuthController,
  hashToken,
};

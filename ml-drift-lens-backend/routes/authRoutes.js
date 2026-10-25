const express = require("express");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const pool = require("../db");
const { createAuthController } = require("../controllers/authController");
const authSession = require("../middleware/authSession");
const { readSessionConfig } = require("../utils/authConfig");

function createAuthRouter({
  databasePool = pool,
  sessionMiddleware = authSession.sessionMiddleware,
  guards = authSession,
  passwordHasher,
  emailService,
  now = Date.now,
  env = process.env,
  loginLimiter,
  registrationLimiter,
  recoveryLimiter,
  resetLimiter,
  verifyLimiter,
  resendLimiter,
} = {}) {
  const router = express.Router();
  const controller = createAuthController({ databasePool, passwordHasher, emailService, now, env });

  const emailInput = body("email")
    .isString()
    .bail()
    .trim()
    .isEmail({ allow_utf8_local_part: false })
    .isLength({ max: 254 })
    .customSanitizer((email) => email.toLowerCase());

  const passwordInput = body("password")
    .isString()
    .bail()
    .custom((password) => (
      [...password].length >= 12
      && [...password].length <= 128
      && Buffer.byteLength(password, "utf8") <= 1024
      && !password.includes("\0")
    ));

  const tokenInput = body("token")
    .isString()
    .bail()
    .trim()
    .isLength({ min: 16, max: 256 })
    .matches(/^[A-Za-z0-9_-]+$/);

  const checkCredentials = async (req, res, next) => {
    if (!validationResult(req).isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Email or password format is invalid",
        code: "invalid_auth_input",
      });
    }
    return next();
  };

  const checkEmailOnly = async (req, res, next) => {
    if (!validationResult(req).isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Email format is invalid",
        code: "invalid_email_input",
      });
    }
    return next();
  };

  const checkTokenAndPass = async (req, res, next) => {
    if (!validationResult(req).isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Password reset token or password format is invalid",
        code: "invalid_reset_input",
      });
    }
    return next();
  };

  const checkTokenOnly = async (req, res, next) => {
    if (!validationResult(req).isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Verification token format is invalid",
        code: "invalid_token_input",
      });
    }
    return next();
  };

  const validateCredentials = [emailInput, passwordInput, checkCredentials];
  const validateEmailOnly = [emailInput, checkEmailOnly];
  const validateTokenAndPass = [tokenInput, passwordInput, checkTokenAndPass];
  const validateTokenOnly = [tokenInput, checkTokenOnly];

  const limitResponse = (_req, res) => res.status(429).json({
    success: false,
    error: "Too many authentication attempts. Try again later.",
    code: "rate_limit_exceeded",
  });

  const commonLimiterOptions = {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: limitResponse,
  };

  const loginRateLimit = loginLimiter || rateLimit(commonLimiterOptions);
  const registrationRateLimit = registrationLimiter || rateLimit({
    ...commonLimiterOptions,
    limit: 5,
  });
  const recoveryRateLimit = recoveryLimiter || rateLimit({
    ...commonLimiterOptions,
    limit: 5,
  });
  const resetRateLimit = resetLimiter || rateLimit({
    ...commonLimiterOptions,
    limit: 5,
  });
  const verifyRateLimit = verifyLimiter || rateLimit({
    ...commonLimiterOptions,
    limit: 10,
  });
  const resendRateLimit = resendLimiter || rateLimit({
    ...commonLimiterOptions,
    limit: 3,
  });

  const sessionConfig = readSessionConfig(env);
  const secureCookie = sessionConfig.status === "valid"
    ? sessionConfig.config.secureCookie
    : env.NODE_ENV === "production";

  router.use(sessionMiddleware, guards.loadSessionUser);

  router.post(
    "/register",
    guards.requireBrowserOrigin,
    registrationRateLimit,
    ...validateCredentials,
    controller.register,
  );

  router.post(
    "/login",
    guards.requireBrowserOrigin,
    loginRateLimit,
    ...validateCredentials,
    controller.login,
  );

  router.get("/me", controller.currentSession);

  router.post(
    "/logout",
    guards.requireBrowserOrigin,
    guards.requireAuthenticatedSession,
    guards.requireCsrfToken,
    controller.logout,
  );

  router.post(
    "/forgot-password",
    guards.requireBrowserOrigin,
    recoveryRateLimit,
    ...validateEmailOnly,
    controller.requestPasswordReset,
  );

  router.post(
    "/reset-password",
    guards.requireBrowserOrigin,
    resetRateLimit,
    ...validateTokenAndPass,
    controller.resetPassword,
  );

  router.post(
    "/verify-email",
    guards.requireBrowserOrigin,
    verifyRateLimit,
    ...validateTokenOnly,
    controller.verifyEmail,
  );

  router.post(
    "/resend-verification",
    guards.requireBrowserOrigin,
    resendRateLimit,
    ...validateEmailOnly,
    controller.resendVerification,
  );

  router.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error) {
      res.clearCookie(
        secureCookie ? "__Host-ml-drift-lens" : "ml_drift_lens",
        { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/" },
      );
      return res.status(503).json({
        success: false,
        error: "Authentication is temporarily unavailable",
        code: "authentication_unavailable",
      });
    }
  });

  return router;
}

module.exports = { createAuthRouter };

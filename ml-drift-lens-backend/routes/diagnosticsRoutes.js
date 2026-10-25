const express = require("express");
const pool = require("../db");
const { defaultEmailService } = require("../services/emailService");
const {
  createDatabaseDiagnosticHandler,
  createEmailPreviewHandler,
} = require("../controllers/diagnosticsController");

function createDiagnosticsRouter({
  databasePool = pool,
  env = process.env,
  logger = console,
  emailService = defaultEmailService,
} = {}) {
  const router = express.Router();
  const databaseDiagnostic = createDatabaseDiagnosticHandler(databasePool, logger);
  const emailPreview = createEmailPreviewHandler(emailService);

  router.get("/test-db", (req, res, next) => {
    if (env.NODE_ENV === "production") {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    return databaseDiagnostic(req, res, next);
  });

  const previewGuard = (req, res, next) => {
    if (env.NODE_ENV === "production") {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    return emailPreview(req, res, next);
  };

  router.get("/test-email-preview", previewGuard);
  router.get("/api/dev/email-preview", previewGuard);

  return router;
}

module.exports = { createDiagnosticsRouter };

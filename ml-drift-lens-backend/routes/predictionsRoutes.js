const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const predictionsController = require("../controllers/predictionsController");
const {
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
} = require("../middleware/authSession");

const predictionCreationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    success: false,
    error: "Too many prediction requests. Try again later.",
    code: "rate_limit_exceeded",
  }),
});

router.get("/", requireUserSession, predictionsController.getAllPredictions);
router.post(
  "/",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  predictionCreationLimiter,
  predictionsController.validatePrediction,
  predictionsController.createPrediction,
);
router.put(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  predictionsController.updatePrediction,
);
router.delete(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  predictionsController.deletePrediction,
);

module.exports = router;

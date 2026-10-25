const express = require("express");
const router = express.Router();
const retrainingController = require("../controllers/retrainingController");
const { requireTrustedOrigin } = require("../utils/cors");
const {
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
} = require("../middleware/authSession");

router.get("/", requireUserSession, retrainingController.getAllRetrainingJobs);
router.get(
  "/:id",
  requireUserSession,
  retrainingController.validateJobId,
  retrainingController.getRetrainingJob,
);
router.post(
  "/",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  retrainingController.validateRetrainingJob,
  retrainingController.createRetrainingJob,
);
router.post(
  "/:id/promote",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  retrainingController.validateJobId,
  requireTrustedOrigin,
  retrainingController.promoteRetrainingJob,
);
router.put(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  retrainingController.validateJobId,
  retrainingController.updateRetrainingJob,
);
router.delete(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  retrainingController.validateJobId,
  retrainingController.deleteRetrainingJob,
);

module.exports = router;

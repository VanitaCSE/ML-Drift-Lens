const express = require("express");
const router = express.Router();
const driftController = require("../controllers/driftController");
const {
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
} = require("../middleware/authSession");

router.get("/", requireUserSession, driftController.getAllDriftScores);
router.get("/history", requireUserSession, driftController.getDriftHistory);
router.post(
  "/",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  driftController.validateDriftScore,
  driftController.createDriftScore,
);
router.put(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  driftController.updateDriftScore,
);
router.delete(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  driftController.deleteDriftScore,
);

module.exports = router;

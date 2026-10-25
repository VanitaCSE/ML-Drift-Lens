const express = require("express");
const router = express.Router();
const alertsController = require("../controllers/alertsController");
const {
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
} = require("../middleware/authSession");

router.get("/", requireUserSession, alertsController.getAllAlerts);
router.post(
  "/",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  alertsController.validateAlert,
  alertsController.createAlert,
);
router.put(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  alertsController.updateAlert,
);
router.delete(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  alertsController.deleteAlert,
);

module.exports = router;

const express = require("express");
const router = express.Router();
const healthController = require("../controllers/healthController");
const { requireUserSession } = require("../middleware/authSession");

router.get("/health", healthController.health);
router.get("/ready", healthController.ready);
router.get("/model-info", requireUserSession, healthController.getModelInfo);
router.get("/deployments/status", requireUserSession, healthController.getDeploymentStatus);

module.exports = router;

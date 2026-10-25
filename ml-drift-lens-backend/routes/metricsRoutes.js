const express = require("express");
const router = express.Router();
const metricsController = require("../controllers/metricsController");
const { requireUserSession } = require("../middleware/authSession");

router.get("/", requireUserSession, metricsController.getMetrics);

module.exports = router;

const express = require("express");
const router = express.Router();
const benchmarkController = require("../controllers/benchmarkController");

router.get("/", benchmarkController.getBenchmarkData);
router.get("/demo", benchmarkController.getDemoScenario);

module.exports = router;

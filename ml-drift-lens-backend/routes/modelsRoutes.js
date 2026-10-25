const express = require("express");
const router = express.Router();
const modelsController = require("../controllers/modelsController");
const {
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
} = require("../middleware/authSession");

router.get("/", requireUserSession, modelsController.getAllModels);
router.post(
  "/",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  modelsController.validateModel,
  modelsController.createModel,
);
router.put(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  modelsController.updateModel,
);
router.delete(
  "/:id",
  requireBrowserOrigin,
  requireUserSession,
  requireCsrfToken,
  blockUnapprovedMutation,
  modelsController.deleteModel,
);

module.exports = router;

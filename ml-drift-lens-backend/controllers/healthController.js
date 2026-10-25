/**
 * Health Check Controller
 * Exposes ML service health, readiness status, and deployment prerequisites
 */

const mlServiceClient = require("../services/mlServiceClient");
const pool = require("../db");
const { evaluatePrerequisites } = require("../services/deploymentPrerequisitesService");

function createHealthController({
  databasePool = pool,
  serviceClient = mlServiceClient,
  env = process.env,
} = {}) {
  async function health(req, res) {
    const [databaseResult, mlServiceResult] = await Promise.allSettled([
      databasePool.query("SELECT 1"),
      serviceClient.checkHealth(),
    ]);
    const databaseConnected = databaseResult.status === "fulfilled";
    const mlServiceHealthy = mlServiceResult.status === "fulfilled" && mlServiceResult.value.healthy;
    const healthy = databaseConnected && mlServiceHealthy;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "unhealthy",
      service: "modelwatch-backend",
      database_connected: databaseConnected,
      ml_service_healthy: mlServiceHealthy,
      message: healthy ? "Backend dependencies are healthy" : "One or more backend dependencies are unavailable",
    });
  }

  async function ready(req, res) {
    try {
      const readiness = await serviceClient.checkReady();
      const statusCode = readiness.ready ? 200 : 503;
      res.status(statusCode).json({
        ready: readiness.ready,
        model_loaded: readiness.modelLoaded,
        message: readiness.message,
      });
    } catch (error) {
      res.status(503).json({
        ready: false,
        model_loaded: false,
        message: "Failed to check ML service readiness",
      });
    }
  }

  async function getModelInfo(req, res) {
    try {
      const modelInfo = await serviceClient.getModelInfo();
      res.json({
        success: true,
        model: modelInfo,
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: "Failed to retrieve model information",
        details: error.message,
      });
    }
  }

  async function getDeploymentStatus(req, res) {
    try {
      const status = evaluatePrerequisites({ env });
      res.json({
        success: true,
        ...status,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to evaluate deployment prerequisites",
      });
    }
  }

  return { health, ready, getModelInfo, getDeploymentStatus };
}

module.exports = {
  createHealthController,
  ...createHealthController(),
};

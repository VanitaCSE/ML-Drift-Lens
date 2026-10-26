/**
 * ML Service Client
 * Communicates with the Python FastAPI inference service
 * Handles model predictions, health checks, and model information
 */

const http = require("http");
const https = require("https");

const DEFAULT_ML_SERVICE_URL = process.env.NODE_ENV === "production"
  ? "https://ml-drift-lens.onrender.com"
  : "http://localhost:8000";

function getMLServiceURL() {
  let url = (process.env.ML_SERVICE_URL || DEFAULT_ML_SERVICE_URL).trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, "");
}

function getMLServiceTimeout() {
  return Number.parseInt(process.env.ML_SERVICE_TIMEOUT || "15000", 10);
}

function buildServiceURLCandidates() {
  const configuredUrl = getMLServiceURL();
  const target = new URL(configuredUrl);
  const candidates = [configuredUrl];

  if (target.hostname === "127.0.0.1") {
    candidates.push(`http://localhost:${target.port || 8000}`);
  } else if (target.hostname === "localhost") {
    candidates.push(`http://127.0.0.1:${target.port || 8000}`);
  }

  return [...new Set(candidates)];
}

/**
 * Parse ML service URL into host and port
 */
function parseMLServiceURL(urlString = getMLServiceURL()) {
  const url = new URL(urlString);
  return {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    protocol: url.protocol,
  };
}

/**
 * Make HTTP request to ML service
 * Free-tier inference services on Render spin down after 15m of inactivity.
 * When waking up, Render's edge gateway returns transient HTTP 502/504 while the
 * container provisions (typically 25-45s). Retrying up to 5 times with backoff
 * spans the cold-start window gracefully without failing prematurely.
 *
 * @param {string} method - HTTP method (GET, POST)
 * @param {string} path - URL path (e.g., /predict, /health)
 * @param {object} data - Request body (for POST)
 * @param {number} retryAttempt - Internal retry counter for transient gateway errors
 * @returns {Promise<object>} Parsed response body
 */
function makeMLServiceRequest(method, path, data = null, retryAttempt = 0) {
  const maxGatewayRetries = 5;
  const gatewayDelays = [1500, 2500, 4000, 6000, 8000];

  return new Promise((resolve, reject) => {
    const candidateUrls = buildServiceURLCandidates();
    let lastError = null;

    const attempt = (candidateUrlIndex) => {
      const urlString = candidateUrls[candidateUrlIndex];
      const options = parseMLServiceURL(urlString);
      options.method = method;
      options.path = path;
      const payload = data ? JSON.stringify(data) : null;
      options.headers = {
        "Content-Type": "application/json",
      };
      if (payload) {
        options.headers["Content-Length"] = Buffer.byteLength(payload);
      }

      const transport = options.protocol === "https:" ? https : http;
      const req = transport.request(options, (res) => {
        let responseBody = "";

        res.on("data", (chunk) => {
          responseBody += chunk;
        });

        res.on("end", () => {
          // If the gateway reports 502/503/504 while the ML service wakes up, retry with backoff
          if ((res.statusCode === 502 || res.statusCode === 503 || res.statusCode === 504) && retryAttempt < maxGatewayRetries) {
            const delayMs = gatewayDelays[retryAttempt] || 5000;
            setTimeout(() => {
              makeMLServiceRequest(method, path, data, retryAttempt + 1)
                .then(resolve)
                .catch(reject);
            }, delayMs);
            return;
          }

          try {
            const parsedBody = JSON.parse(responseBody);

            if (res.statusCode >= 400) {
              reject({
                statusCode: res.statusCode,
                message: parsedBody?.detail || "ML Service Error",
                error: parsedBody,
              });
            } else {
              resolve(parsedBody);
            }
          } catch (parseError) {
            const isGatewayError = res.statusCode === 502 || res.statusCode === 503 || res.statusCode === 504;
            reject({
              statusCode: res.statusCode >= 400 ? res.statusCode : 502,
              message: isGatewayError
                ? `ML Service returned HTTP ${res.statusCode} (Inference service waking from sleep or temporarily unavailable)`
                : (res.statusCode >= 400
                    ? `ML Service returned HTTP ${res.statusCode}`
                    : "Failed to parse ML service response"),
              error: parseError.message,
            });
          }
        });
      });

      req.setTimeout(getMLServiceTimeout(), () => {
        req.destroy();
        const timeoutError = {
          statusCode: 503,
          message: `ML Service request timeout for ${urlString}`,
          error: "Service request exceeded timeout",
        };

        if (candidateUrlIndex < candidateUrls.length - 1) {
          lastError = timeoutError;
          attempt(candidateUrlIndex + 1);
          return;
        }

        if (retryAttempt < maxGatewayRetries) {
          const delayMs = gatewayDelays[retryAttempt] || 5000;
          setTimeout(() => {
            makeMLServiceRequest(method, path, data, retryAttempt + 1)
              .then(resolve)
              .catch(reject);
          }, delayMs);
          return;
        }

        reject(timeoutError);
      });

      req.on("error", (error) => {
        const connectionError = {
          statusCode: 503,
          message: `ML Service connection failed for ${urlString}`,
          error: error.message,
        };

        if (candidateUrlIndex < candidateUrls.length - 1) {
          lastError = connectionError;
          attempt(candidateUrlIndex + 1);
          return;
        }

        if (retryAttempt < maxGatewayRetries) {
          const delayMs = gatewayDelays[retryAttempt] || 5000;
          setTimeout(() => {
            makeMLServiceRequest(method, path, data, retryAttempt + 1)
              .then(resolve)
              .catch(reject);
          }, delayMs);
          return;
        }

        reject(connectionError);
      });

      if (payload) {
        req.write(payload);
      }

      req.end();
    };

    attempt(0);
  });
}

/**
 * Health check - Is the ML service process running?
 */
async function checkHealth() {
  try {
    const response = await makeMLServiceRequest("GET", "/health");
    return {
      healthy: response.status === "healthy",
      message: response.message,
    };
  } catch (error) {
    return {
      healthy: false,
      message: error.message,
    };
  }
}

/**
 * Readiness check - Is the model loaded and ready?
 */
async function checkReady() {
  try {
    const response = await makeMLServiceRequest("GET", "/ready");
    return {
      ready: response.ready,
      modelLoaded: response.model_loaded,
      message: response.message,
    };
  } catch (error) {
    return {
      ready: false,
      modelLoaded: false,
      message: error.message,
    };
  }
}

/**
 * Get model information
 */
async function getModelInfo() {
  try {
    const response = await makeMLServiceRequest("GET", "/model/info");
    return response;
  } catch (error) {
    throw error;
  }
}

/**
 * Trigger a safe reload of the in-memory model in the FastAPI service.
 * The reload endpoint accepts a trusted candidate reference and resolves it
 * internally, instead of accepting arbitrary filesystem paths from the client.
 * @param {{ model_id: string, model_version: string }} reloadRequest
 * @returns {Promise<object>} Reload response payload
 */
async function reloadModel(reloadRequest) {
  const payload = {
    model_id: reloadRequest.model_id,
    model_version: reloadRequest.model_version,
  };
  const response = await makeMLServiceRequest("POST", "/reload", payload);

  if (
    !response ||
    response.status !== "success" ||
    response.active_model_version !== reloadRequest.model_version ||
    (response.model_id && response.model_id !== reloadRequest.model_id)
  ) {
    throw {
      statusCode: 502,
      message: "ML Service returned an invalid reload response",
      error: "Reload response did not confirm the requested active model",
    };
  }

  return response;
}

/**
 * Execute prediction
 * @param {object} predictionRequest - Request matching prediction_request.schema.json
 * @returns {Promise<object>} Response matching prediction_response.schema.json
 */
async function predict(predictionRequest) {
  try {
    const response = await makeMLServiceRequest("POST", "/predict", predictionRequest);
    return response;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  checkHealth,
  checkReady,
  getModelInfo,
  reloadModel,
  predict,
};

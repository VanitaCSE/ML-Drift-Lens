const RENDER_API_BASE_URL = "https://api.render.com/v1";

function readRenderStagingConfig(env = process.env) {
  if (
    env.RENDER_TARGET_ENVIRONMENT !== "staging"
    || !env.RENDER_STAGING_SERVICE_ID?.trim()
    || !env.RENDER_API_KEY?.trim()
  ) {
    return null;
  }

  return {
    serviceId: env.RENDER_STAGING_SERVICE_ID.trim(),
    apiKey: env.RENDER_API_KEY.trim(),
  };
}

function createRenderStagingClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = readRenderStagingConfig(env);
  if (typeof fetchImpl !== "function") {
    throw new Error("A Fetch-compatible implementation is required");
  }

  async function request(url, options) {
    const response = await fetchImpl(url, options);
    if (!response.ok) {
      throw new Error(`Render staging API request failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  function requireConfig() {
    if (!config) {
      throw new Error("Render staging deployment is not configured");
    }
  }

  return {
    enabled: config !== null,
    async createDeploy() {
      requireConfig();
      const result = await request(
        `${RENDER_API_BASE_URL}/services/${encodeURIComponent(config.serviceId)}/deploys`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ clearCache: "do_not_clear" }),
        },
      );
      if (typeof result?.id !== "string" || !result.id.trim()) {
        throw new Error("Render staging API response did not include a deployment id");
      }
      return {
        id: result.id,
        status: typeof result.status === "string" ? result.status : "unknown",
        createdAt: result.createdAt || null,
      };
    },
    async getDeploy(deployId) {
      requireConfig();
      if (typeof deployId !== "string" || !deployId.trim()) {
        throw new Error("A Render deployment id is required");
      }
      const result = await request(
        `${RENDER_API_BASE_URL}/services/${encodeURIComponent(config.serviceId)}/deploys/${encodeURIComponent(deployId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${config.apiKey}` },
        },
      );
      if (typeof result?.id !== "string" || result.id !== deployId) {
        throw new Error("Render staging API returned a different deployment id");
      }
      return {
        id: result.id,
        status: typeof result.status === "string" ? result.status : "unknown",
        createdAt: result.createdAt || null,
        updatedAt: result.updatedAt || null,
      };
    },
  };
}

module.exports = {
  createRenderStagingClient,
  readRenderStagingConfig,
};

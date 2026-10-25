const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createRenderStagingClient,
  readRenderStagingConfig,
} = require("../services/renderStagingClient");

const configuredEnv = {
  RENDER_TARGET_ENVIRONMENT: "staging",
  RENDER_STAGING_SERVICE_ID: "srv-staging-test",
  RENDER_API_KEY: "unit-test-only",
};

test("does not enable the client without an explicitly configured staging target", async () => {
  assert.equal(readRenderStagingConfig({}), null);
  assert.equal(readRenderStagingConfig({
    ...configuredEnv,
    RENDER_TARGET_ENVIRONMENT: "production",
  }), null);
  assert.equal(readRenderStagingConfig({
    ...configuredEnv,
    RENDER_STAGING_SERVICE_ID: "",
  }), null);
  assert.equal(readRenderStagingConfig({
    ...configuredEnv,
    RENDER_API_KEY: "",
  }), null);

  const client = createRenderStagingClient({ env: {} });
  assert.equal(client.enabled, false);
  await assert.rejects(client.createDeploy(), /not configured/);
});

test("creates a staging deployment and returns initiation state, not activation success", async () => {
  const requests = [];
  const client = createRenderStagingClient({
    env: configuredEnv,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { id: "dep-staging-1", status: "build_in_progress", createdAt: "now" };
        },
      };
    },
  });

  const deployment = await client.createDeploy();

  assert.deepEqual(deployment, {
    id: "dep-staging-1",
    status: "build_in_progress",
    createdAt: "now",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer unit-test-only");
  assert.equal(JSON.parse(requests[0].options.body).clearCache, "do_not_clear");
});

test("retrieves only the requested deployment state", async () => {
  const client = createRenderStagingClient({
    env: configuredEnv,
    fetchImpl: async (url, options) => {
      assert.match(url, /dep-staging-2$/);
      assert.equal(options.method, "GET");
      return {
        ok: true,
        async json() {
          return { id: "dep-staging-2", status: "live", createdAt: "then", updatedAt: "now" };
        },
      };
    },
  });

  assert.deepEqual(await client.getDeploy("dep-staging-2"), {
    id: "dep-staging-2",
    status: "live",
    createdAt: "then",
    updatedAt: "now",
  });
  await assert.rejects(client.getDeploy(""), /deployment id is required/);
});

test("sanitizes API failures and rejects mismatched deployment identities", async () => {
  const failedClient = createRenderStagingClient({
    env: configuredEnv,
    fetchImpl: async () => ({ ok: false, status: 401, async json() { return {}; } }),
  });
  await assert.rejects(failedClient.createDeploy(), /HTTP 401/);

  const mismatchedClient = createRenderStagingClient({
    env: configuredEnv,
    fetchImpl: async () => ({ ok: true, async json() { return { id: "different" }; } }),
  });
  await assert.rejects(mismatchedClient.getDeploy("expected"), /different deployment id/);
});

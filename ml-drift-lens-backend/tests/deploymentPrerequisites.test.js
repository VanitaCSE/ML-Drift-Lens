const assert = require("node:assert/strict");
const { test } = require("node:test");
const { evaluatePrerequisites } = require("../services/deploymentPrerequisitesService");
const { createHealthController } = require("../controllers/healthController");

test("evaluates unconfigured state under default local environment", () => {
  const result = evaluatePrerequisites({ env: {} });

  assert.equal(result.all_passed, false);
  assert.equal(result.can_redeploy, false);
  assert.equal(result.environment, "Local Development (127.0.0.1)");
  assert.match(result.redeployment_block_reason, /permanently disabled/i);

  const { prerequisites } = result;
  assert.equal(prerequisites.render_staging_client.status, "unconfigured");
  assert.equal(prerequisites.render_staging_client.badge, "Unconfigured (Disabled)");
  assert.match(prerequisites.render_staging_client.reason, /RENDER_API_KEY/i);

  assert.equal(prerequisites.remote_durable_store.status, "unconfigured");
  assert.equal(prerequisites.remote_durable_store.badge, "Unconfigured (Local Filesystem Only)");
  assert.match(prerequisites.remote_durable_store.reason, /durable object storage/i);

  assert.equal(prerequisites.independent_live_verifier.status, "unconfigured");
  assert.equal(prerequisites.independent_live_verifier.badge, "Unconfigured (Local Probes Only)");
  assert.match(prerequisites.independent_live_verifier.reason, /post-deployment/i);

  assert.equal(prerequisites.operator_authorization.status, "blocked");
  assert.equal(prerequisites.operator_authorization.badge, "Policy Blocked (403)");
  assert.match(prerequisites.operator_authorization.reason, /403/i);
});

test("marks Render staging client as configured_unverified when env vars are present but unverified", () => {
  const result = evaluatePrerequisites({
    env: {
      RENDER_TARGET_ENVIRONMENT: "staging",
      RENDER_STAGING_SERVICE_ID: "srv-staging-12345",
      RENDER_API_KEY: "secret-render-api-key-value",
    },
  });

  const { render_staging_client } = result.prerequisites;
  assert.equal(render_staging_client.status, "configured_unverified");
  assert.equal(render_staging_client.badge, "Configured (Unverified)");
  assert.match(render_staging_client.reason, /not been verified/i);

  // Redaction check: ensure the secret API key is NEVER included in the result
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret-render-api-key-value"), false);
});

test("marks prerequisites verified only when verified flags are explicitly established", () => {
  const result = evaluatePrerequisites({
    env: {
      RENDER_TARGET_ENVIRONMENT: "staging",
      RENDER_STAGING_SERVICE_ID: "srv-staging-12345",
      RENDER_API_KEY: "secret-render-api-key-value",
      RENDER_STAGING_VERIFIED: "true",
      ARTIFACT_STORE_URL: "s3://ml-drift-lens-artifacts-staging",
      DURABLE_STORE_VERIFIED: "true",
      LIVE_VERIFIER_URL: "https://verifier.staging.internal/verify",
      LIVE_VERIFIER_VERIFIED: "true",
      OPERATOR_AUTHORIZATION_POLICY: "approved",
    },
  });

  assert.equal(result.prerequisites.render_staging_client.status, "verified");
  assert.equal(result.prerequisites.remote_durable_store.status, "verified");
  assert.equal(result.prerequisites.independent_live_verifier.status, "verified");
  assert.equal(result.prerequisites.operator_authorization.status, "verified");
  assert.equal(result.all_passed, true);
  // can_redeploy remains false without interactive confirmation
  assert.equal(result.can_redeploy, false);
});

test("healthController getDeploymentStatus returns json with prerequisites", async () => {
  const controller = createHealthController({
    env: {
      NODE_ENV: "production",
    },
  });

  let responseData = null;
  const mockRes = {
    json(data) {
      responseData = data;
      return this;
    },
    status() {
      return this;
    },
  };

  await controller.getDeploymentStatus({}, mockRes);

  assert.ok(responseData);
  assert.equal(responseData.success, true);
  assert.equal(responseData.environment, "Production (Render)");
  assert.ok(responseData.prerequisites.render_staging_client);
  assert.ok(responseData.prerequisites.remote_durable_store);
  assert.ok(responseData.prerequisites.independent_live_verifier);
  assert.ok(responseData.prerequisites.operator_authorization);
});

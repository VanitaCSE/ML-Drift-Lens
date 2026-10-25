const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHealthController } = require("../controllers/healthController");
const router = require("../routes/healthRoutes");

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("health and readiness routes stay public for deployment probes", () => {
  for (const path of ["/health", "/ready"]) {
    const route = router.stack.find((layer) => layer.route?.path === path);
    assert.ok(route, `GET ${path} is registered`);
    assert.equal(route.route.stack.length, 1);
    assert.notEqual(route.route.stack[0].handle.name, "requireUserSession");
  }
});

test("health reports healthy only when PostgreSQL and the ML service respond", async () => {
  const healthyController = createHealthController({
    databasePool: { query: async () => ({ rows: [{ ok: 1 }] }) },
    serviceClient: {
      checkHealth: async () => ({ healthy: true }),
      checkReady: async () => ({ ready: true, modelLoaded: true, message: "Ready" }),
    },
  });
  const healthyResponse = responseRecorder();
  await healthyController.health({}, healthyResponse);
  assert.equal(healthyResponse.statusCode, 200);
  assert.equal(healthyResponse.body.status, "healthy");

  const unhealthyController = createHealthController({
    databasePool: { query: async () => { throw new Error("database unavailable"); } },
    serviceClient: {
      checkHealth: async () => ({ healthy: false }),
      checkReady: async () => ({ ready: false, modelLoaded: false, message: "Not ready" }),
    },
  });
  const unhealthyResponse = responseRecorder();
  await unhealthyController.health({}, unhealthyResponse);
  assert.equal(unhealthyResponse.statusCode, 503);
  assert.equal(unhealthyResponse.body.database_connected, false);
  assert.equal(unhealthyResponse.body.ml_service_healthy, false);
  assert.doesNotMatch(JSON.stringify(unhealthyResponse.body), /database unavailable/);
});

test("readiness reports unavailable state without leaking dependency errors", async () => {
  const controller = createHealthController({
    serviceClient: {
      checkReady: async () => { throw new Error("internal service detail"); },
    },
  });
  const response = responseRecorder();
  await controller.ready({}, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    ready: false,
    model_loaded: false,
    message: "Failed to check ML service readiness",
  });
});

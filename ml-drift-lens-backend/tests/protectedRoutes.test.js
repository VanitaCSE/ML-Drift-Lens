const assert = require("node:assert/strict");
const { test } = require("node:test");

const routeModules = [
  ["../routes/retrainingRoutes", [
    ["POST", "/"],
    ["POST", "/:id/promote"],
    ["PUT", "/:id"],
    ["DELETE", "/:id"],
  ]],
  ["../routes/predictionsRoutes", [
    ["DELETE", "/:id"],
  ]],
  ["../routes/modelsRoutes", [
    ["POST", "/"],
    ["PUT", "/:id"],
    ["DELETE", "/:id"],
  ]],
  ["../routes/alertsRoutes", [
    ["POST", "/"],
    ["PUT", "/:id"],
    ["DELETE", "/:id"],
  ]],
  ["../routes/driftRoutes", [
    ["POST", "/"],
    ["PUT", "/:id"],
    ["DELETE", "/:id"],
  ]],
];

const protectedReadRoutes = [
  ["../routes/metricsRoutes", [["GET", "/"]]],
  ["../routes/predictionsRoutes", [["GET", "/"]]],
  ["../routes/driftRoutes", [["GET", "/"], ["GET", "/history"]]],
  ["../routes/alertsRoutes", [["GET", "/"]]],
  ["../routes/modelsRoutes", [["GET", "/"]]],
  ["../routes/retrainingRoutes", [["GET", "/"], ["GET", "/:id"]]],
];

test("sensitive mutations require same-origin session and CSRF guards and remain policy-blocked", () => {
  for (const [modulePath, expectedRoutes] of routeModules) {
    const router = require(modulePath);
    for (const [method, routePath] of expectedRoutes) {
      const layer = router.stack.find((entry) => (
        entry.route
        && entry.route.path === routePath
        && entry.route.methods[method.toLowerCase()]
      ));
      assert.ok(layer, `${method} ${routePath} is registered`);
      const middlewareNames = layer.route.stack.map(({ handle }) => handle.name);

      assert.deepEqual(
        middlewareNames.slice(0, 4),
        [
          "requireBrowserOrigin",
          "requireUserSession",
          "requireCsrfToken",
          "blockUnapprovedMutation",
        ],
        `${method} ${routePath} must fail closed before its controller`,
      );
      assert.equal(middlewareNames.includes("requireOidcScope"), false);
    }
  }
});

test("operational read routes require an authenticated session", () => {
  for (const [modulePath, expectedRoutes] of protectedReadRoutes) {
    const router = require(modulePath);
    for (const [method, routePath] of expectedRoutes) {
      const layer = router.stack.find((entry) => (
        entry.route
        && entry.route.path === routePath
        && entry.route.methods[method.toLowerCase()]
      ));
      assert.ok(layer, `${method} ${routePath} is registered`);
      assert.equal(
        layer.route.stack[0].handle.name,
        "requireUserSession",
        `${method} ${routePath} must require a valid account session`,
      );
    }
  }
});

test("health and readiness stay public while model metadata requires a session", () => {
  const router = require("../routes/healthRoutes");
  for (const path of ["/health", "/ready"]) {
    const layer = router.stack.find((entry) => entry.route?.path === path);
    assert.ok(layer, `GET ${path} is registered`);
    assert.notEqual(layer.route.stack[0].handle.name, "requireUserSession");
  }
  const modelInfoRoute = router.stack.find((entry) => entry.route?.path === "/model-info");
  assert.equal(modelInfoRoute.route.stack[0].handle.name, "requireUserSession");
});

test("prediction creation requires session, origin, and CSRF checks before rate limiting and inference", () => {
  const router = require("../routes/predictionsRoutes");
  const layer = router.stack.find((entry) => entry.route?.path === "/" && entry.route.methods.post);
  assert.ok(layer, "POST / is registered");
  assert.deepEqual(layer.route.stack.slice(0, 3).map(({ handle }) => handle.name), [
    "requireBrowserOrigin",
    "requireUserSession",
    "requireCsrfToken",
  ]);
  assert.equal(layer.route.stack.some(({ handle }) => handle.name === "blockUnapprovedMutation"), false);
});

test("prediction labeling requires session, origin, and CSRF checks without blockUnapprovedMutation", () => {
  const router = require("../routes/predictionsRoutes");
  const layer = router.stack.find((entry) => entry.route?.path === "/:id" && entry.route.methods.put);
  assert.ok(layer, "PUT /:id is registered");
  assert.deepEqual(layer.route.stack.slice(0, 3).map(({ handle }) => handle.name), [
    "requireBrowserOrigin",
    "requireUserSession",
    "requireCsrfToken",
  ]);
  assert.equal(layer.route.stack.some(({ handle }) => handle.name === "blockUnapprovedMutation"), false);
});

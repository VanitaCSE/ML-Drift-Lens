const assert = require("node:assert/strict");
const { test } = require("node:test");
const { inspectOidcConfig } = require("../utils/oidcConfig");

const configuredEnv = {
  OIDC_ISSUER_URL: "https://identity.example.test/tenant/",
  OIDC_AUDIENCE: "ml-drift-lens-api",
  OIDC_REQUIRED_SCOPE: "model:manage",
};

test("distinguishes entirely missing OIDC configuration without exposing values", () => {
  assert.deepEqual(inspectOidcConfig({}), {
    status: "missing",
    missingKeys: ["OIDC_ISSUER_URL", "OIDC_AUDIENCE", "OIDC_REQUIRED_SCOPE"],
  });
});

test("classifies partial configuration as invalid and reports only variable names", () => {
  assert.deepEqual(inspectOidcConfig({
    OIDC_ISSUER_URL: configuredEnv.OIDC_ISSUER_URL,
    OIDC_AUDIENCE: "",
    OIDC_REQUIRED_SCOPE: configuredEnv.OIDC_REQUIRED_SCOPE,
  }), {
    status: "invalid",
    missingKeys: ["OIDC_AUDIENCE"],
    invalidKeys: [],
  });
});

test("rejects malformed issuer, audience, and scope values", () => {
  const cases = [
    { OIDC_ISSUER_URL: "http://identity.example.test/" },
    { OIDC_ISSUER_URL: "https://user:password@identity.example.test/" },
    { OIDC_ISSUER_URL: "https://identity.example.test/?tenant=1" },
    { OIDC_AUDIENCE: "api audience" },
    { OIDC_REQUIRED_SCOPE: "model:read model:manage" },
    { OIDC_REQUIRED_SCOPE: "model:read\nadmin" },
  ];

  for (const override of cases) {
    const result = inspectOidcConfig({ ...configuredEnv, ...override });
    assert.equal(result.status, "invalid");
    assert.ok(result.invalidKeys.length > 0);
    assert.equal(JSON.stringify(result).includes("password"), false);
  }
});

test("accepts complete HTTPS OIDC verifier configuration without claiming authentication", () => {
  assert.deepEqual(inspectOidcConfig(configuredEnv), {
    status: "valid",
    config: {
      issuer: configuredEnv.OIDC_ISSUER_URL,
      audience: configuredEnv.OIDC_AUDIENCE,
      requiredScope: configuredEnv.OIDC_REQUIRED_SCOPE,
    },
  });
});

test("preserves the configured issuer string for exact OIDC issuer matching", () => {
  const issuer = "https://identity.example.test";

  assert.deepEqual(inspectOidcConfig({ ...configuredEnv, OIDC_ISSUER_URL: issuer }), {
    status: "valid",
    config: {
      issuer,
      audience: configuredEnv.OIDC_AUDIENCE,
      requiredScope: configuredEnv.OIDC_REQUIRED_SCOPE,
    },
  });
});

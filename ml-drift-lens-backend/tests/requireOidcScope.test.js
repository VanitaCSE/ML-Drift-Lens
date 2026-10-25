const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createRequireOidcScope,
  readOidcConfig,
} = require("../middleware/requireOidcScope");

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function request(authorization) {
  return {
    auth: undefined,
    get(name) {
      return name.toLowerCase() === "authorization" ? authorization : undefined;
    },
  };
}

const configuredEnv = {
  OIDC_ISSUER_URL: "https://identity.example.test/tenant/",
  OIDC_AUDIENCE: "ml-drift-lens-api",
  OIDC_REQUIRED_SCOPE: "model:manage",
};

test("requires exact HTTPS issuer, audience, and deployment scope configuration", () => {
  assert.deepEqual(readOidcConfig(configuredEnv), {
    issuer: "https://identity.example.test/tenant/",
    audience: "ml-drift-lens-api",
    requiredScope: "model:manage",
  });
  assert.equal(readOidcConfig({ ...configuredEnv, OIDC_ISSUER_URL: "http://identity.test" }), null);
  assert.equal(readOidcConfig({ ...configuredEnv, OIDC_AUDIENCE: "" }), null);
});

test("fails closed when OIDC is not configured", async () => {
  const middleware = createRequireOidcScope({ env: {} });
  const res = responseRecorder();

  await middleware(request("Bearer token"), res, () => assert.fail("must not continue"));

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "oidc_not_configured");
});

test("fails closed with a distinct response when partial OIDC configuration is invalid", async () => {
  const middleware = createRequireOidcScope({
    env: {
      OIDC_ISSUER_URL: configuredEnv.OIDC_ISSUER_URL,
      OIDC_AUDIENCE: "",
      OIDC_REQUIRED_SCOPE: configuredEnv.OIDC_REQUIRED_SCOPE,
    },
  });
  const res = responseRecorder();

  await middleware(request(undefined), res, () => assert.fail("must not continue"));

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "oidc_invalid_configuration");
  assert.equal(JSON.stringify(res.body).includes(configuredEnv.OIDC_ISSUER_URL), false);
});

test("rejects missing or invalid bearer tokens without disclosing token data", async () => {
  const middleware = createRequireOidcScope({
    env: configuredEnv,
    getVerifier: async () => async () => { throw new Error("token details"); },
  });

  const missingResponse = responseRecorder();
  await middleware(request(undefined), missingResponse, () => assert.fail("must not continue"));
  assert.equal(missingResponse.statusCode, 401);

  const invalidResponse = responseRecorder();
  await middleware(request("Bearer secret-token"), invalidResponse, () => assert.fail("must not continue"));
  assert.equal(invalidResponse.statusCode, 401);
  assert.equal(JSON.stringify(invalidResponse.body).includes("secret-token"), false);
  assert.equal(JSON.stringify(invalidResponse.body).includes("token details"), false);
});

test("returns unavailable when issuer discovery cannot be reached", async () => {
  const middleware = createRequireOidcScope({
    env: configuredEnv,
    getVerifier: async () => { throw new Error("discovery details"); },
  });
  const res = responseRecorder();

  await middleware(request("Bearer valid-shaped-token"), res, () => assert.fail("must not continue"));

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "oidc_unavailable");
  assert.equal(JSON.stringify(res.body).includes("discovery details"), false);
});

test("requires the configured scope and attaches only the verified subject", async () => {
  const middleware = createRequireOidcScope({
    env: configuredEnv,
    getVerifier: async () => async () => ({
      sub: "operator-123",
      scope: "model:read model:manage",
      aud: "ml-drift-lens-api",
    }),
  });
  const req = request("Bearer verified-token");
  const res = responseRecorder();
  let continued = false;

  await middleware(req, res, () => { continued = true; });

  assert.equal(continued, true);
  assert.deepEqual(req.auth, { subject: "operator-123", scope: "model:manage" });
});

test("rejects a verified token without the required scope", async () => {
  const middleware = createRequireOidcScope({
    env: configuredEnv,
    getVerifier: async () => async () => ({ sub: "reader-1", scope: "model:read" }),
  });
  const res = responseRecorder();

  await middleware(request("Bearer verified-token"), res, () => assert.fail("must not continue"));

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "insufficient_scope");
});

test("real JOSE validation rejects wrong issuer, audience, and expired signed tokens", async () => {
  const { generateKeyPair, jwtVerify, SignJWT } = await import("jose");
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const verifier = async (token) => {
    const result = await jwtVerify(token, publicKey, {
      issuer: configuredEnv.OIDC_ISSUER_URL,
      audience: configuredEnv.OIDC_AUDIENCE,
      algorithms: ["RS256"],
    });
    return result.payload;
  };
  const middleware = createRequireOidcScope({
    env: configuredEnv,
    getVerifier: async () => verifier,
  });

  async function signedToken({ issuer, audience, expiration, scope = "model:manage" }) {
    return new SignJWT({ scope })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("operator-test")
      .setExpirationTime(expiration)
      .sign(privateKey);
  }

  const cases = [
    {
      token: await signedToken({
        issuer: "https://wrong-issuer.example.test/",
        audience: configuredEnv.OIDC_AUDIENCE,
        expiration: "2m",
      }),
      status: 401,
    },
    {
      token: await signedToken({
        issuer: configuredEnv.OIDC_ISSUER_URL,
        audience: "wrong-audience",
        expiration: "2m",
      }),
      status: 401,
    },
    {
      token: await signedToken({
        issuer: configuredEnv.OIDC_ISSUER_URL,
        audience: configuredEnv.OIDC_AUDIENCE,
        expiration: "1s",
      }),
      status: 401,
      waitForExpiration: true,
    },
  ];

  for (const testCase of cases) {
    if (testCase.waitForExpiration) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    const response = responseRecorder();
    await middleware(request(`Bearer ${testCase.token}`), response, () => {
      assert.fail("invalid token must not reach the protected operation");
    });
    assert.equal(response.statusCode, testCase.status);
    assert.equal(response.body.code, "invalid_token");
  }
});

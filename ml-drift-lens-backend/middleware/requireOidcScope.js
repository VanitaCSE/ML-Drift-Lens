const OIDC_DISCOVERY_TIMEOUT_MS = 5000;
const issuerVerifierCache = new Map();
let joseModulePromise;
const { inspectOidcConfig } = require("../utils/oidcConfig");

function readOidcConfig(env = process.env) {
  const result = inspectOidcConfig(env);
  return result.status === "valid" ? result.config : null;
}

async function getIssuerVerifier(config) {
  const cacheKey = `${config.issuer}\n${config.audience}`;
  if (issuerVerifierCache.has(cacheKey)) return issuerVerifierCache.get(cacheKey);

  const verifierPromise = (async () => {
    const response = await fetch(
      `${config.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(OIDC_DISCOVERY_TIMEOUT_MS) },
    );
    if (!response.ok) throw new Error("OIDC discovery is unavailable");
    const metadata = await response.json();
    let jwksUrl;
    try {
      jwksUrl = new URL(metadata.jwks_uri);
    } catch {
      throw new Error("OIDC discovery metadata is invalid");
    }
    if (
      metadata.issuer !== config.issuer
      || jwksUrl.protocol !== "https:"
      || jwksUrl.username
      || jwksUrl.password
    ) {
      throw new Error("OIDC discovery metadata is invalid");
    }

    joseModulePromise ||= import("jose");
    const { createRemoteJWKSet, jwtVerify } = await joseModulePromise;
    const jwks = createRemoteJWKSet(jwksUrl, {
      timeoutDuration: OIDC_DISCOVERY_TIMEOUT_MS,
    });
    return async (token) => {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ["RS256", "ES256", "PS256"],
      });
      return payload;
    };
  })();

  issuerVerifierCache.set(cacheKey, verifierPromise);
  try {
    return await verifierPromise;
  } catch (error) {
    issuerVerifierCache.delete(cacheKey);
    throw error;
  }
}

function bearerToken(req) {
  const header = req.get("authorization");
  const match = typeof header === "string" && header.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] || null;
}

function createRequireOidcScope({
  env = process.env,
  getVerifier = getIssuerVerifier,
} = {}) {
  return async function requireOidcScope(req, res, next) {
    const configResult = inspectOidcConfig(env);
    if (configResult.status === "missing") {
      return res.status(503).json({
        success: false,
        error: "Protected operation unavailable: OIDC is not configured",
        code: "oidc_not_configured",
      });
    }
    if (configResult.status === "invalid") {
      return res.status(503).json({
        success: false,
        error: "Protected operation unavailable: OIDC configuration is invalid",
        code: "oidc_invalid_configuration",
      });
    }
    const { config } = configResult;

    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "A valid bearer token is required",
        code: "authentication_required",
      });
    }

    let verifier;
    try {
      verifier = await getVerifier(config);
    } catch {
      return res.status(503).json({
        success: false,
        error: "Protected operation unavailable: OIDC issuer could not be verified",
        code: "oidc_unavailable",
      });
    }

    let claims;
    try {
      claims = await verifier(token);
    } catch {
      return res.status(401).json({
        success: false,
        error: "Bearer token is invalid or expired",
        code: "invalid_token",
      });
    }

    const scopes = typeof claims.scope === "string"
      ? claims.scope.split(/\s+/)
      : Array.isArray(claims.scp) ? claims.scp : [];
    if (
      typeof claims.sub !== "string"
      || claims.sub.length === 0
      || !scopes.includes(config.requiredScope)
    ) {
      return res.status(403).json({
        success: false,
        error: "The authenticated identity is not authorized for this operation",
        code: "insufficient_scope",
      });
    }

    req.auth = { subject: claims.sub, scope: config.requiredScope };
    return next();
  };
}

module.exports = {
  OIDC_DISCOVERY_TIMEOUT_MS,
  readOidcConfig,
  createRequireOidcScope,
};

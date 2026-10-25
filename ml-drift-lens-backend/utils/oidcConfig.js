const OIDC_ENV_KEYS = ["OIDC_ISSUER_URL", "OIDC_AUDIENCE", "OIDC_REQUIRED_SCOPE"];

function inspectOidcConfig(env = process.env) {
  const values = {
    OIDC_ISSUER_URL: typeof env.OIDC_ISSUER_URL === "string" ? env.OIDC_ISSUER_URL.trim() : "",
    OIDC_AUDIENCE: typeof env.OIDC_AUDIENCE === "string" ? env.OIDC_AUDIENCE.trim() : "",
    OIDC_REQUIRED_SCOPE: typeof env.OIDC_REQUIRED_SCOPE === "string" ? env.OIDC_REQUIRED_SCOPE.trim() : "",
  };
  const missingKeys = OIDC_ENV_KEYS.filter((key) => !values[key]);

  if (missingKeys.length === OIDC_ENV_KEYS.length) {
    return { status: "missing", missingKeys: OIDC_ENV_KEYS };
  }

  const invalidKeys = [];
  const issuer = values.OIDC_ISSUER_URL;
  let issuerUrl;

  if (issuer.length > 2048) {
    invalidKeys.push("OIDC_ISSUER_URL");
  } else {
    try {
      issuerUrl = new URL(issuer);
    } catch {
      invalidKeys.push("OIDC_ISSUER_URL");
    }
  }

  if (
    issuerUrl
    && (
      issuerUrl.protocol !== "https:"
      || issuerUrl.username
      || issuerUrl.password
      || issuerUrl.search
      || issuerUrl.hash
    )
  ) {
    invalidKeys.push("OIDC_ISSUER_URL");
  }

  const audience = values.OIDC_AUDIENCE;
  if (audience.length > 2048 || /[\s\x00-\x1f\x7f]/.test(audience)) {
    invalidKeys.push("OIDC_AUDIENCE");
  }

  const scope = values.OIDC_REQUIRED_SCOPE;
  if (scope.length > 255 || !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope)) {
    invalidKeys.push("OIDC_REQUIRED_SCOPE");
  }

  if (missingKeys.length > 0 || invalidKeys.length > 0) {
    return {
      status: "invalid",
      missingKeys,
      invalidKeys: [...new Set(invalidKeys)],
    };
  }

  return {
    status: "valid",
    config: {
      issuer,
      audience,
      requiredScope: scope,
    },
  };
}

module.exports = { OIDC_ENV_KEYS, inspectOidcConfig };

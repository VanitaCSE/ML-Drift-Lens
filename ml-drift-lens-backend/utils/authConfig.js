const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const SESSION_SECRET_MIN_BYTES = 32;

function readSessionConfig(env = process.env) {
  const secret = typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET : "";
  const secureValue = env.SESSION_COOKIE_SECURE;
  let secureCookie = env.NODE_ENV === "production";
  const invalidKeys = [];

  if (Buffer.byteLength(secret, "utf8") < SESSION_SECRET_MIN_BYTES) {
    invalidKeys.push("SESSION_SECRET");
  }

  if (secureValue !== undefined && secureValue !== "") {
    if (secureValue === "true") {
      secureCookie = true;
    } else if (secureValue === "false") {
      secureCookie = false;
    } else {
      invalidKeys.push("SESSION_COOKIE_SECURE");
    }
  }

  if (env.NODE_ENV === "production" && !secureCookie) {
    invalidKeys.push("SESSION_COOKIE_SECURE");
  }

  if (invalidKeys.length > 0) {
    return { status: "invalid", invalidKeys: [...new Set(invalidKeys)] };
  }

  return {
    status: "valid",
    config: {
      secret,
      secureCookie,
      cookieName: secureCookie ? "__Host-ml-drift-lens" : "ml_drift_lens",
    },
  };
}

module.exports = {
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_SECRET_MIN_BYTES,
  readSessionConfig,
};

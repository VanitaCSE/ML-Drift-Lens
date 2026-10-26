const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function parseCorsOrigins(value = process.env.CORS_ORIGINS) {
  const origins = (value || DEFAULT_CORS_ORIGINS.join(","))
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set(origins);
}

function createCorsOptions(allowedOrigins = parseCorsOrigins()) {
  return {
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
  };
}

function requireTrustedOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin && !parseCorsOrigins().has(origin)) {
    return res.status(403).json({ success: false, error: "Origin not allowed" });
  }
  next();
}

module.exports = {
  DEFAULT_CORS_ORIGINS,
  parseCorsOrigins,
  createCorsOptions,
  requireTrustedOrigin,
};
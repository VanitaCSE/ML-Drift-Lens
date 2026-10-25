const path = require("path");

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({
    path: path.resolve(__dirname, "../.env"),
  });
}

const { Pool } = require("pg");

const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      user: process.env.DB_USER || process.env.POSTGRES_USER || "postgres",
      password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || process.env.POSTGRES_PORT || 5432),
      database: process.env.DB_NAME || process.env.POSTGRES_DB || "ml_drift_lens",
    };

if (process.env.DATABASE_SSL === "true" && !databaseConfig.ssl) {
  databaseConfig.ssl = { rejectUnauthorized: true };
}

const pool = new Pool(databaseConfig);

pool.on("error", (error) => {
  console.error("Unexpected idle PostgreSQL client error", {
    code: error.code,
    name: error.name,
  });
});

module.exports = pool;

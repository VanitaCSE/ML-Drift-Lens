const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../db");

async function applyAuthMigration() {
  const migrationPath = path.resolve(__dirname, "../migrations/011_native_authentication.sql");
  const migration = await fs.readFile(migrationPath, "utf8");
  await pool.query(migration);
  console.log("Applied additive native-authentication migration 011.");
}

applyAuthMigration()
  .catch((error) => {
    console.error("Native-authentication migration failed", {
      name: error.name,
      code: error.code,
    });
    process.exitCode = 1;
  })
  .finally(() => pool.end());

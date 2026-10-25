/**
 * Apply All Migrations
 * Sequentially executes all idempotent database migrations from ml-drift-lens-backend/migrations.
 * Designed for pre-deploy execution on fresh Render PostgreSQL instances or local setups.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../db");

async function applyAllMigrations({ poolOverride = pool } = {}) {
  const migrationsDir = path.resolve(__dirname, "../migrations");
  const files = await fs.readdir(migrationsDir);
  const sqlFiles = files
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  console.log(`Found ${sqlFiles.length} migration files in ${migrationsDir}`);

  const client = await poolOverride.connect();
  try {
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, "utf8");
      console.log(`Applying migration: ${file}...`);
      await client.query(sql);
      console.log(`Successfully applied: ${file}`);
    }
    console.log("All migrations applied successfully.");
  } finally {
    client.release();
  }
}

if (require.main === module) {
  applyAllMigrations()
    .then(() => pool.end())
    .catch((error) => {
      console.error("Migration failed:", {
        message: error.message,
        code: error.code,
        detail: error.detail,
      });
      pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { applyAllMigrations };

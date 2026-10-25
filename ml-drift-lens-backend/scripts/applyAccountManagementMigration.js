const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../db");

async function applyAccountManagementMigration() {
  const migrationPath = path.resolve(__dirname, "../migrations/012_account_recovery_and_verification.sql");
  const migration = await fs.readFile(migrationPath, "utf8");
  await pool.query(migration);
  console.log("Applied additive account-recovery and verification migration 012.");
}

applyAccountManagementMigration()
  .catch((error) => {
    console.error("Account-recovery and verification migration failed", {
      name: error.name,
      code: error.code,
      message: error.message,
    });
    process.exitCode = 1;
  })
  .finally(() => pool.end());

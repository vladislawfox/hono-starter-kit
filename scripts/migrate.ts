#!/usr/bin/env bun
/**
 * Applies pending migrations from ./drizzle to the database at DATABASE_URL.
 * Uses Bun's native SQL driver via drizzle-orm/bun-sql.
 *
 * Idempotent: if no migrations exist yet (no ./drizzle/meta/_journal.json),
 * exits 0 with a log — so CI and pre-commit hooks pass on a fresh template.
 *
 * Closes the SQL client explicitly in finally so the connection doesn't leak
 * between invocations (important when scripts run inside long-lived runners).
 */

import { existsSync } from "node:fs";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";

const dbUrl = process.env["DATABASE_URL"];
if (!dbUrl) {
  console.error("✗ DATABASE_URL is not set");
  process.exit(1);
}

const migrationsFolder = "./drizzle";
if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  console.log("ℹ no migrations found — skipping (run `bun run db:generate` after adding schemas)");
  process.exit(0);
}

const client = new SQL(dbUrl);
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log("✓ migrations applied");
} finally {
  await client.close();
}

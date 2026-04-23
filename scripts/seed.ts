#!/usr/bin/env bun
/**
 * Idempotent dev seed. Safe to run repeatedly — uses ON CONFLICT DO NOTHING
 * on the unique index so re-runs don't error out and don't duplicate rows.
 *
 * Shape of a good seed (copy when writing one for a new feature):
 *   1. Refuse to run in production.
 *   2. Open an explicit SQL client, close it in `finally`.
 *   3. Per table: use `onConflictDoNothing()` keyed on the natural unique
 *      index — not `DELETE` then `INSERT`, which races with running servers.
 *   4. Log a concrete count of what happened, not a generic "done".
 *
 * Invoke: `bun run db:seed`
 */

import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { waitlistEntries } from "@/features/waitlist/schema";

if (process.env["NODE_ENV"] === "production") {
  console.error("✗ Refusing to seed in production (NODE_ENV=production)");
  process.exit(1);
}

const dbUrl = process.env["DATABASE_URL"];
if (!dbUrl) {
  console.error("✗ DATABASE_URL is not set");
  process.exit(1);
}

const client = new SQL(dbUrl);
const db = drizzle(client);
try {
  const inserted = await db
    .insert(waitlistEntries)
    .values([
      { email: "alice@example.com" },
      { email: "bob@example.com" },
      { email: "carol@example.com" },
    ])
    .onConflictDoNothing({ target: waitlistEntries.email })
    .returning();

  console.log(`✓ seeded ${inserted.length} waitlist entries (skipped existing)`);
} finally {
  await client.close();
}

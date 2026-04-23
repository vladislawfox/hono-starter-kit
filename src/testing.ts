import { sql } from "drizzle-orm";
import app from "@/app";
import { db } from "@/infrastructure/db";

/**
 * Truncates the given tables (CASCADE). Use in `beforeEach` of feature tests
 * to ensure isolation between test cases.
 *
 * Uses `sql.identifier()` so table names are safely quoted by the driver —
 * no hand-rolled interpolation, even though callers today pass only string
 * literals from test files.
 */
export async function truncate(...tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  const idents = tables.map((t) => sql.identifier(t));
  await db.execute(sql`TRUNCATE TABLE ${sql.join(idents, sql`, `)} RESTART IDENTITY CASCADE`);
}

/**
 * Shorthand for JSON POST against the compiled app. Body is typed as `unknown`
 * so tests can deliberately send malformed payloads (empty objects, wrong
 * types) to exercise validation branches.
 */
export async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

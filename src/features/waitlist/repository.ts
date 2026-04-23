import { type WaitlistEntry, waitlistEntries } from "@/features/waitlist/schema";
import { db } from "@/infrastructure/db";

const UNIQUE_VIOLATION = "23505";

/**
 * Detects a Postgres unique-index violation across drivers and wrappers.
 *
 * - Bun.SQL (current driver): SQLSTATE in `.errno`, `.code` holds a Bun
 *   constant like `"ERR_POSTGRES_SERVER_ERROR"`.
 * - node-postgres: SQLSTATE in `.code`.
 * - Drizzle wraps driver errors in `DrizzleQueryError` and puts the original
 *   under `.cause` — so we walk the chain.
 */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur != null; i++) {
    if (typeof cur === "object") {
      const e = cur as { code?: unknown; errno?: unknown; cause?: unknown };
      if (e.errno === UNIQUE_VIOLATION || e.code === UNIQUE_VIOLATION) return true;
      cur = e.cause;
    } else {
      return false;
    }
  }
  return false;
}

/**
 * Inserts a new waitlist entry. Returns `null` if a row with the same email
 * already exists (detected via Postgres unique-index violation 23505).
 *
 * Avoids a pre-check + insert TOCTOU race: two concurrent requests with the
 * same email both pass a naive `SELECT` check, then one fails on the insert.
 * Relying on the DB constraint is the only atomic option.
 */
export async function createIfNew(email: string): Promise<WaitlistEntry | null> {
  try {
    const [entry] = await db.insert(waitlistEntries).values({ email }).returning();
    return entry ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

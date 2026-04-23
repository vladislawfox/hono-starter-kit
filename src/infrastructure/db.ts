import { SQL } from "bun";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { env } from "@/config/env";
import { rootLogger } from "@/core/logger";

const sqlClient = new SQL(env.DATABASE_URL, {
  max: env.NODE_ENV === "production" ? 20 : 10,
  idleTimeout: 30,
  connectionTimeout: 10,
});

// Route Drizzle's query log through pino at `debug` level so dev output is
// structured (and filterable) instead of bypassing the logger via console.log.
// In prod, LOG_LEVEL=info drops these automatically; in tests, silent.
const queryLogger =
  env.NODE_ENV === "development"
    ? {
        logQuery: (query: string, params: unknown[]): void => {
          rootLogger.debug({ query, params }, "drizzle query");
        },
      }
    : false;

export const db = drizzle(sqlClient, { logger: queryLogger });

export async function pingDb(): Promise<void> {
  await db.execute(sql`select 1`);
}

export async function closeDb(): Promise<void> {
  await sqlClient.close();
}

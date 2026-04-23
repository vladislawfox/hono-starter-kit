import app from "@/app";
import { env } from "@/config/env";
import { rootLogger } from "@/core/logger";
import { closeDb, pingDb } from "@/infrastructure/db";

// Fail-fast on startup in production: refuse to serve traffic if the DB
// isn't reachable. In dev/test we skip this so the server still starts when
// Postgres is booting up in parallel (e.g. `docker compose up -d && bun dev`).
if (env.NODE_ENV === "production") {
  try {
    await pingDb();
    rootLogger.info("db connectivity verified");
  } catch (err) {
    rootLogger.fatal({ err }, "startup db check failed — refusing to start");
    process.exit(1);
  }
}

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
  development: env.NODE_ENV !== "production",
});

rootLogger.info({ port: server.port, env: env.NODE_ENV }, "API listening");

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  rootLogger.info({ signal }, "shutdown requested, draining in-flight requests");
  await server.stop();

  const dbResult = await Promise.allSettled([closeDb()]);
  if (dbResult[0].status === "rejected") {
    rootLogger.error({ err: dbResult[0].reason }, "db close failed");
  }

  rootLogger.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

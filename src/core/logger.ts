import { tryGetContext } from "hono/context-storage";
import pino, { type Logger } from "pino";
import { env } from "@/config/env";
import type { AppEnv } from "@/http/context";

const isDev = env.NODE_ENV === "development";

export const rootLogger: Logger = pino({
  level: env.LOG_LEVEL,
  serializers: {
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      "password",
      "passwordHash",
      "accessToken",
      "refreshToken",
      "body",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.passwordHash",
      "*.accessToken",
      "*.refreshToken",
      'req.headers["x-api-key"]',
    ],
    censor: "[REDACTED]",
  },
  ...(isDev && {
    transport: {
      target: "hono-pino/debug-log",
      options: { colorEnabled: true },
    },
  }),
});

export type AppLogger = Pick<Logger, "trace" | "debug" | "info" | "warn" | "error" | "fatal">;

export function getLogger(): AppLogger {
  return tryGetContext<AppEnv>()?.var.logger ?? rootLogger;
}

import { z } from "zod";

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

const DEFAULT_LOG_LEVEL_BY_ENV = {
  development: "debug",
  production: "info",
  test: "silent",
} as const;

const envSchema = z
  .object({
    NODE_ENV: z.enum(["test", "development", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
    DATABASE_URL: z.url(),
    FRONTEND_URL: z.url().default("http://localhost:3000"),
  })
  .transform(({ LOG_LEVEL, ...rest }) => ({
    ...rest,
    LOG_LEVEL: LOG_LEVEL ?? DEFAULT_LOG_LEVEL_BY_ENV[rest.NODE_ENV],
  }));

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${z.prettifyError(parsed.error)}`);
}

export type Env = z.infer<typeof envSchema>;
export const env: Env = parsed.data;

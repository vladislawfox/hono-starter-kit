import type { RequestIdVariables } from "hono/request-id";
import type { PinoLogger } from "hono-pino";

export type AppVariables = RequestIdVariables & {
  logger: PinoLogger;
};

export type AppEnv = {
  Variables: AppVariables;
};

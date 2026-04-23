import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { bodyLimit } from "hono/body-limit";
import { contextStorage } from "hono/context-storage";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { pinoLogger } from "hono-pino";
import { env } from "@/config/env";
import { ValidationError } from "@/core/errors";
import { rootLogger } from "@/core/logger";
import { healthRoute } from "@/features/health/route";
import { waitlistRoute } from "@/features/waitlist/route";
import type { AppEnv } from "@/http/context";
import { errorHandler, notFoundHandler } from "@/http/error-handler";
import { requestTimeout } from "@/http/middleware/request-timeout";

const BODY_LIMIT_BYTES = 100 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

const app = new OpenAPIHono<AppEnv>();

app.use(requestId());
app.use(contextStorage());
app.use(pinoLogger({ pino: rootLogger }));
app.use(async (c, next) => {
  c.var.logger.assign({ reqId: c.get("requestId") });
  await next();
});
app.use(secureHeaders());
app.use(requestTimeout(REQUEST_TIMEOUT_MS));
app.use(
  bodyLimit({
    maxSize: BODY_LIMIT_BYTES,
    onError: () => {
      throw new ValidationError(`Request body exceeds ${BODY_LIMIT_BYTES} bytes`);
    },
  }),
);
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));

app.route("/health", healthRoute);
app.route("/waitlist", waitlistRoute);

app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Hono Starter Kit API",
    version: "0.0.1",
    description: "Production-ready Hono template.",
  },
  servers: [{ url: `http://localhost:${env.PORT}`, description: "local" }],
});

app.get("/reference", Scalar({ url: "/openapi.json", theme: "purple" }));

app.onError(errorHandler);
app.notFound(notFoundHandler);

export default app;

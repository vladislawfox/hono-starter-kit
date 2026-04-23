import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { pinoLogger } from "hono-pino";
import type { ErrorResponse } from "@/core/errors";
import { rootLogger } from "@/core/logger";
import type { AppEnv } from "@/http/context";
import { errorHandler } from "@/http/error-handler";
import { requestTimeout } from "./request-timeout";

function makeApp(timeoutMs: number): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(pinoLogger({ pino: rootLogger }));
  app.use(requestTimeout(timeoutMs));

  app.get("/fast", () => new Response("ok"));
  app.get("/slow", async () => {
    await new Promise((r) => setTimeout(r, 200));
    return new Response("late");
  });
  app.onError(errorHandler);
  return app;
}

describe("requestTimeout middleware", () => {
  test("passes through when handler finishes under the limit", async () => {
    const res = await makeApp(100).request("/fast");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("504 TIMEOUT when handler exceeds the limit", async () => {
    const res = await makeApp(50).request("/slow");
    expect(res.status).toBe(504);
    const body = (await res.json()) as ErrorResponse;
    expect(body.type).toBe("TIMEOUT");
    // 5xx messages are scrubbed in non-dev (tests run under NODE_ENV=test)
    expect(body.message).toBe("Internal server error");
  });
});

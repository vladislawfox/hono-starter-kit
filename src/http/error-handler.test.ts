import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { pinoLogger } from "hono-pino";
import {
  ConflictError,
  type ErrorResponse,
  ErrorType,
  InternalError,
  UpstreamError,
  ValidationError,
} from "@/core/errors";
import { rootLogger } from "@/core/logger";
import type { AppEnv } from "@/http/context";
import { errorHandler, notFoundHandler } from "./error-handler";

function makeApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(pinoLogger({ pino: rootLogger }));

  app.get("/app-error", () => {
    throw new ValidationError("bad input");
  });
  app.get("/conflict", () => {
    throw new ConflictError("already exists");
  });
  app.get("/http-exception", () => {
    throw new HTTPException(403, { message: "forbidden" });
  });
  app.get("/unknown", () => {
    throw new Error("internal secret");
  });
  app.get("/internal-app", () => {
    throw new InternalError("db password leak: 10.0.0.5");
  });
  app.get("/upstream-app", () => {
    throw new UpstreamError("stripe secret key in error message");
  });
  app.get("/http-500", () => {
    throw new HTTPException(500, { message: "leaked connection string" });
  });

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
}

describe("errorHandler — AppError branch", () => {
  test("ValidationError produces 400 with type + message", async () => {
    const res = await makeApp().request("/app-error");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body).toMatchObject({
      code: 400,
      type: "VALIDATION_ERROR",
      message: "bad input",
      path: "/app-error",
    });
    expect(body.requestId).toBeTruthy();
    expect(body.timestamp).toBeTruthy();
  });

  test("ConflictError produces 409 with type", async () => {
    const res = await makeApp().request("/conflict");
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorResponse;
    expect(body.type).toBe("CONFLICT");
    expect(body.message).toBe("already exists");
  });
});

describe("errorHandler — HTTPException branch", () => {
  test("403 HTTPException maps to FORBIDDEN type", async () => {
    const res = await makeApp().request("/http-exception");
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorResponse;
    expect(body.type).toBe("FORBIDDEN");
    expect(body.message).toBe("forbidden");
  });
});

describe("errorHandler — unknown error branch", () => {
  test("generic Error in non-dev returns 500 with safe message (no leaks)", async () => {
    const res = await makeApp().request("/unknown");
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponse;
    expect(body.type).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("Internal server error");
    expect(body.message).not.toContain("internal secret");
  });
});

describe("errorHandler — 5xx message scrubbing", () => {
  test("AppError 500: custom message is replaced with safe text in non-dev", async () => {
    const res = await makeApp().request("/internal-app");
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponse;
    expect(body.type).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("Internal server error");
    expect(body.message).not.toContain("10.0.0.5");
  });

  test("AppError 502 (UpstreamError): custom message scrubbed in non-dev", async () => {
    const res = await makeApp().request("/upstream-app");
    expect(res.status).toBe(502);
    const body = (await res.json()) as ErrorResponse;
    expect(body.type).toBe("UPSTREAM_ERROR");
    expect(body.message).toBe("Internal server error");
    expect(body.message).not.toContain("stripe");
  });

  test("HTTPException 500: message scrubbed in non-dev", async () => {
    const res = await makeApp().request("/http-500");
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponse;
    expect(body.message).toBe("Internal server error");
    expect(body.message).not.toContain("connection string");
  });
});

describe("errorHandler — HTTPException status-to-type mapping", () => {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(pinoLogger({ pino: rootLogger }));
  app.get("/throw/:code", (c) => {
    const code = Number(c.req.param("code")) as ContentfulStatusCode;
    throw new HTTPException(code, { message: `test-${code}` });
  });
  app.onError(errorHandler);

  const cases: Array<[ContentfulStatusCode, ErrorType]> = [
    [400, ErrorType.VALIDATION_ERROR],
    [401, ErrorType.UNAUTHORIZED],
    [403, ErrorType.FORBIDDEN],
    [404, ErrorType.NOT_FOUND],
    [409, ErrorType.CONFLICT],
    [429, ErrorType.RATE_LIMITED],
    [500, ErrorType.INTERNAL_ERROR],
    [502, ErrorType.UPSTREAM_ERROR],
    [503, ErrorType.UPSTREAM_ERROR],
    [504, ErrorType.UPSTREAM_ERROR],
    // default branch, < 500 — any unmapped 4xx falls back to VALIDATION_ERROR
    [422, ErrorType.VALIDATION_ERROR],
  ];

  for (const [status, type] of cases) {
    test(`HTTPException ${status} → ${type}`, async () => {
      const res = await app.request(`/throw/${status}`);
      expect(res.status).toBe(status);
      const body = (await res.json()) as ErrorResponse;
      expect(body.type).toBe(type);
    });
  }
});

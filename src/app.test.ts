import { describe, expect, test } from "bun:test";
import app from "@/app";
import type { ErrorResponse } from "@/core/errors";

describe("404 handler", () => {
  test("returns typed ErrorResponse for unknown route", async () => {
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);

    const body = (await res.json()) as ErrorResponse;
    expect(body).toMatchObject({
      code: 404,
      type: "NOT_FOUND",
      path: "/does-not-exist",
    });
    expect(body.message).toContain("Route not found");
    expect(body.requestId).toBeTruthy();
    expect(body.timestamp).toBeTruthy();
  });
});

describe("bodyLimit middleware", () => {
  // Content-Length must be set explicitly: the Request constructor doesn't add it
  // for string bodies, so Hono's bodyLimit would otherwise fall through to its
  // streaming check — which only fires when a handler actually reads the body.
  test("400 VALIDATION_ERROR when Content-Length exceeds 100KB limit", async () => {
    const oversized = "x".repeat(200_000);
    const res = await app.request("/__body-limit-probe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(oversized.length),
      },
      body: oversized,
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorResponse;
    expect(body.type).toBe("VALIDATION_ERROR");
    expect(body.message).toMatch(/exceeds/i);
  });
});

describe("OpenAPI docs", () => {
  test("GET /openapi.json returns OpenAPI 3.1 spec with health path", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);

    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.info.title).toBe("Hono Starter Kit API");
    expect(spec.paths["/health"]).toBeDefined();
  });

  test("GET /reference serves Scalar HTML UI", async () => {
    const res = await app.request("/reference");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/html/);
  });
});

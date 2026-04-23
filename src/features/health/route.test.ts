import { describe, expect, test } from "bun:test";
import app from "@/app";

describe("GET /health", () => {
  test("liveness returns 200 with status + timestamp", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeTruthy();
    expect(new Date(body.timestamp).toString()).not.toBe("Invalid Date");
  });
});

describe("GET /health/ready", () => {
  test("returns 200 with db.ok=true when Postgres is reachable", async () => {
    const res = await app.request("/health/ready");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      timestamp: string;
      checks: { db: { ok: boolean; error?: string } };
    };
    expect(body.status).toBe("ready");
    expect(body.checks.db.ok).toBe(true);
    expect(body.timestamp).toBeTruthy();
  });
});

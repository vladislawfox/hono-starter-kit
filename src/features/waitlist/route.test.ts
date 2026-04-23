import { beforeEach, describe, expect, test } from "bun:test";
import type { ErrorResponse } from "@/core/errors";
import { waitlistEntries } from "@/features/waitlist/schema";
import { clearRateLimits } from "@/http/middleware/rate-limit";
import { db } from "@/infrastructure/db";
import { post, truncate } from "@/testing";

describe("POST /waitlist", () => {
  beforeEach(async () => {
    await truncate("waitlist_entries");
    clearRateLimits();
  });

  test("201 on valid email — persists row with lowercase normalization", async () => {
    const res = await post("/waitlist", { email: "User@Example.com" });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { email: string; createdAt: string };
    expect(body.email).toBe("user@example.com");
    expect(body.createdAt).toBeTruthy();

    const rows = await db.select().from(waitlistEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("user@example.com");
    expect(rows[0]?.isNotified).toBe(false);
  });

  test("400 VALIDATION_ERROR on malformed email", async () => {
    const res = await post("/waitlist", { email: "not-an-email" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body).toMatchObject({
      code: 400,
      type: "VALIDATION_ERROR",
      path: "/waitlist",
    });
    expect(body.requestId).toBeTruthy();
  });

  test("400 VALIDATION_ERROR on missing email field", async () => {
    const res = await post("/waitlist", {});

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.type).toBe("VALIDATION_ERROR");
  });

  test("409 CONFLICT on duplicate email (case-insensitive)", async () => {
    const first = await post("/waitlist", { email: "dup@example.com" });
    expect(first.status).toBe(201);

    const second = await post("/waitlist", { email: "DUP@Example.com" });

    expect(second.status).toBe(409);
    const body = (await second.json()) as ErrorResponse;
    expect(body).toMatchObject({
      code: 409,
      type: "CONFLICT",
      message: "This email is already on the waitlist",
    });

    const rows = await db.select().from(waitlistEntries);
    expect(rows).toHaveLength(1);
  });

  test("429 RATE_LIMITED after exceeding 5 requests per minute", async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await post("/waitlist", { email: `u${i}@example.com` });
      expect(ok.status).toBe(201);
    }

    const blocked = await post("/waitlist", { email: "u5@example.com" });

    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as ErrorResponse;
    expect(body.type).toBe("RATE_LIMITED");
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe("5");
  });
});

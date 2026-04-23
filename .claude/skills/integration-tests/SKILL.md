---
name: integration-tests
description: Rules for writing integration tests with app.request() against real Postgres. Invoke when writing or editing any *.test.ts file in this project.
paths: "**/*.test.ts"
---

# Integration tests

Feature tests are **integration-level** by default: `app.request()` exercises the full middleware chain against a real Postgres database. Do not mock Drizzle or `db` in tests — mocks hide SQL bugs and drift from reality.

## File layout

Tests co-locate with source as `*.test.ts` inside the same feature folder. Import `app` from `@/app` (not from `@/index`, which has Bun.serve side-effects), import feature schema/repository/types as needed.

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import app from "@/app";
import type { ErrorResponse } from "@/core/errors";
import { truncate } from "@/testing";
```

## Isolation — truncate in beforeEach

Every `describe` block that touches a table MUST truncate in `beforeEach`:

```ts
beforeEach(async () => {
  await truncate("my_table");
});
```

Bun test runs tests serially in a file, but data from one test bleeds into the next without explicit cleanup. No transaction rollback tricks — just `TRUNCATE ... RESTART IDENTITY CASCADE` via our helper.

For multiple tables, pass all of them: `await truncate("users", "sessions")`.

## Rate-limited routes

If the route under test has `rateLimit()` middleware, call `clearRateLimits()` **in the same `beforeEach`**:

```ts
import { clearRateLimits } from "@/http/middleware/rate-limit";

beforeEach(async () => {
  await truncate("waitlist_entries");
  clearRateLimits();
});
```

Rate-limit buckets are module-level `Map` state — they persist across tests and will cause later tests to spuriously 429 without this.

## Error-response typing

Parse error bodies as `ErrorResponse` so the shape is typed:

```ts
const res = await app.request("/waitlist", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "not-an-email" }),
});

expect(res.status).toBe(400);
const body = (await res.json()) as ErrorResponse;
expect(body).toMatchObject({
  code: 400,
  type: "VALIDATION_ERROR",
  path: "/waitlist",
});
expect(body.requestId).toBeTruthy();
```

## Test body shape assertions

For success responses, cast to the expected shape inline (we don't import Hono RPC types):

```ts
const body = (await res.json()) as { email: string; createdAt: string };
expect(body.email).toBe("user@example.com");
```

If you need to assert DB state after the request (common for mutations), query via Drizzle in the test:

```ts
const rows = await db.select().from(waitlistEntries);
expect(rows).toHaveLength(1);
expect(rows[0]?.email).toBe("user@example.com");
```

Use the `?.` — `noUncheckedIndexedAccess` types `rows[0]` as possibly undefined.

## Test DB lifecycle

- **Interactive / fast iteration**: `bun run docker:up` once, then `bun test` repeatedly. Tests hit the same DB but each truncates its tables.
- **CI**: `.github/workflows/ci.yml` spins up a Postgres service container, runs migrations, then tests. No docker-compose in CI.
- **First-time setup**: `bun install && cp .env.example .env && bun run docker:up && bun run db:migrate && bun test`.

Tests run with `NODE_ENV=test` (set by `package.json`'s `test` script), which resolves to `LOG_LEVEL=silent` via the env schema — stdout stays clean. Don't override this.

## Unit tests (mocked repository)

Add unit tests only when a service has branching logic dense enough that integration tests can't cover cheaply. For the typical CRUD flow, integration tests suffice — and they exercise Zod + Hono + Drizzle in one shot.

## What NOT to do

- **Don't mock the DB or Drizzle.** Use the real one via docker-compose. Mocks pass when the real SQL wouldn't.
- **Don't test through `@/index`** (has Bun.serve side-effects). Always `@/app`.
- **Don't share state across tests** without truncating. Even "read-only" tests that seed data in `beforeAll` break when order changes.
- **Don't assert on logger output.** Logs are informational, not contract — if tests depend on a log line, that line is doing too much.

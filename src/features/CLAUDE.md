# features/ — conventions

Each subdirectory is one feature (= one domain concept). A feature is a vertical slice: DB schema, repository, service, HTTP route, tests — all in one place.

## Directory layout

```
src/features/<name>/
├── schema.ts         Drizzle table + inferred types
├── repository.ts     Pure DB queries — no business logic, no HTTP
├── service.ts        Business logic — calls repo, throws typed errors, logs via getLogger()
├── route.ts          OpenAPI route(s) + handlers — thin: validate → call service → return
├── route.test.ts     Integration tests via app.request()
├── errors.ts         Feature-specific AppError subclasses (optional)
└── dto.ts            Request/response Zod schemas (optional — only when 3+ schemas make route.ts cluttered)
```

`health/` is minimal (route only, no DB) — follow `waitlist/` for the full pattern.

## Cross-feature imports are banned

```ts
// ❌ forbidden — creates hidden coupling + cycle risk
import { joinWaitlist } from "@/features/waitlist/service";
// in src/features/users/service.ts
```

If two features need shared logic, it goes **up**, never sideways:

- Shared type or util that's truly cross-cutting → `src/core/`
- Shared HTTP helper (middleware, schema helper) → `src/http/`
- Shared adapter to an external system → `src/infrastructure/`
- Shared domain concept used by multiple features → extract a new feature module that both depend on

Madge will flag cycles; knip will not flag sideways imports — discipline here is on you.

## Mounting a new feature

In `src/app.ts`:

```ts
import { myFeatureRoute } from "@/features/my-feature/route";
// ...
app.route("/my-feature", myFeatureRoute);
```

The `path` in each `createRoute({ path: "/" })` is relative to the mount point.

## Feature-specific errors

When you need a finer `type` than the built-in categories (e.g. `USER_NOT_FOUND` distinct from generic `NOT_FOUND`), extend `AppError` directly — not a category subclass:

```ts
// src/features/user/errors.ts
import { AppError, ErrorType } from "@/core/errors";

export class UserNotFoundError extends AppError {
  constructor(userId: string) {
    super({ status: 404, type: ErrorType.USER_NOT_FOUND, message: `User ${userId} not found` });
    this.name = "UserNotFoundError";
  }
}
```

Add the new enum value to `ErrorType` in `@/core/errors` first. `type` is public API — **never rename** existing values, only add new ones.

## Transactions

When a service performs 2+ writes that must succeed or fail together, wrap them in `db.transaction()`. Drizzle rolls back automatically if the callback throws — no explicit `ROLLBACK` needed.

```ts
// src/features/order/service.ts
import { db } from "@/infrastructure/db";

export async function placeOrder(input: OrderInput): Promise<Order> {
  return db.transaction(async (tx) => {
    const [order] = await tx.insert(orders).values(...).returning();
    await tx.insert(orderItems).values(input.items.map(...));
    await tx.update(inventory).set(...).where(...);
    if (!order) throw new InternalError("order insert returned no rows");
    return order;
  });
}
```

- **Repositories should accept `db` or `tx`.** Type the executor param as `typeof db` so the same repository function works standalone and inside a transaction. Default to `db` when called without one:
  ```ts
  export async function findByEmail(
    email: string,
    executor: typeof db = db,
  ): Promise<User | null> { /* ... */ }
  ```
- **Throw to abort.** Any thrown error inside the callback rolls back. Don't swallow errors in the callback unless you genuinely want a partial commit.
- **Don't do network I/O inside a transaction.** Holding a DB connection open while awaiting an external API keeps the connection pinned in the pool. Pattern: fetch upstream → open tx → write → close tx → (if needed) notify upstream.
- **Nested calls use SAVEPOINTs.** Calling `db.transaction()` from inside another is fine — Drizzle translates inner ones to savepoints. Rarely needed.
- **No test helper needed.** Tests truncate tables in `beforeEach` rather than wrapping each test in a rollbackable transaction — simpler, and matches how the app actually exercises the DB.

## Testing

Integration-first. Tests hit a real compiled app via `app.request()` (use the `post()` helper from `@/testing` for JSON POSTs) and a live Postgres (from `docker-compose.yml`). No mocking the DB.

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { post, truncate } from "@/testing";
// import { clearRateLimits } from "@/http/middleware/rate-limit"; // if route has rate limit

describe("POST /my-feature", () => {
  beforeEach(async () => {
    await truncate("my_feature_entries");
    // clearRateLimits();
  });

  test("201 on valid input", async () => {
    const res = await post("/my-feature", { /* body */ });
    expect(res.status).toBe(201);
  });
});
```

- `post(path, body)` serializes JSON and sets `content-type` for you. Body type is `unknown` so you can send deliberately malformed payloads (`{}`, wrong types) to exercise validation branches.
- For GET or other methods, call `app.request(path, ...)` directly.
- Each `*.test.ts` file MUST truncate its tables in `beforeEach` — Bun test runs tests serially by default, but data from one test bleeds into the next otherwise.
- For routes with `rateLimit()` middleware, also call `clearRateLimits()` — buckets are module-level and leak across tests.

## When a feature grows

- **More than ~3 routes** in `route.ts` → still one file is fine. Split only when it hurts readability.
- **Complex validation schemas** (3+ schemas, 50+ lines of Zod) → extract `dto.ts`.
- **Multiple repositories/tables** → keep one `repository.ts` with multiple exports; split into `repositories/` subfolder only when functions clearly separate by table.
- **Sub-features emerge** (e.g. `auth/` needs `sessions`, `tokens`, `passwords`) → **flat files** inside the feature (`auth/sessions.ts`, `auth/tokens.ts`), not nested directories — unless each sub-feature needs its own `route.ts`, in which case split into top-level features.

The goal: someone reading `src/features/<name>/` should understand the entire feature in 15 minutes without chasing imports.

## When a feature needs its own CLAUDE.md

Most features don't — this file (plus the root `CLAUDE.md`) covers standard CRUD patterns. Create `src/features/<name>/CLAUDE.md` **only when the feature has non-obvious rules that can't be inferred from the code**:

- Complex state machines (e.g. auth session rotation, payment lifecycle with retries)
- Unusual invariants a reader wouldn't guess (e.g. "all prices are stored in minor units, never convert on write")
- Security-critical flows where the *wrong* pattern is dangerous (e.g. token hashing, signature verification)
- Non-standard testing conventions (e.g. needs a test fixture or running external process)

Plain CRUD features with straightforward validation → **no** feature-level CLAUDE.md. The layer-level one (this file) is enough.

Rule of thumb: if you can't name three rules that aren't obvious from reading the code, you don't need a file.

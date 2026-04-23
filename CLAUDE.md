# CLAUDE.md

Conventions and gates for Claude (or any LLM assistant) working in this repo. If you're not Claude, this also doubles as a concise engineering guide.

## Runtime: Bun-first

Default to Bun for everything. Do not reach for Node-era tools where Bun has a built-in.

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun test` instead of `jest` or `vitest`
- `bun install` / `bun run <script>` / `bunx <package>` — no npm/yarn/pnpm/npx
- `Bun.serve()` for HTTP, `Bun.sql` for Postgres (already used via `drizzle-orm/bun-sql`)
- `Bun.password` for bcrypt, `Bun.CryptoHasher` for SHA — don't add `bcrypt` or `node:crypto` wrappers when Bun covers it
- `WebSocket` is built-in — don't pull `ws`
- Bun auto-loads `.env` — **never add `dotenv`**

## Gates: run before claiming a task done

The pre-commit hook runs Biome + `tsc --noEmit` + madge. CI adds knip and integration tests. Your first move on a non-trivial change is to keep these green:

```sh
bun run check           # biome autofix
bun run typecheck       # tsc --noEmit
bun run check:cycles    # madge circular deps
bun run check:deadcode  # knip — unused files / exports / deps
bun test                # integration tests against live Postgres
```

If a gate fails, **fix the underlying issue** — do not pass `--no-verify` or add broad Biome ignores. Hooks exist to catch regressions TypeScript alone cannot (dead code, circular deps via type-only imports, missing `await`s).

## Architecture and imports

Directory responsibilities (import direction is strict — top-to-bottom):

| Layer | Responsibility | May import from |
|---|---|---|
| `config/` | Load + validate env | — (leaf) |
| `core/` | Cross-cutting types/utils (errors, logger) | `config/` |
| `http/` | HTTP-layer primitives (context, error-handler, openapi factory, middleware) | `config/`, `core/` |
| `infrastructure/` | Adapters for external systems (DB, Redis, queues, …) | `config/`, `core/` |
| `features/<name>/` | Domain modules (schema + repository + service + route) | anything above |
| `testing.ts` | Shared test helpers (truncate, …) | `infrastructure/` |

**Never**: `features/A` imports from `features/B`. If shared behavior emerges across features, move it up (to `core/` or a new semantic folder), **don't cross-import**. Madge enforces the absence of cycles; importing across features at best risks a cycle, at worst smears domain boundaries.

**Never**: `core/` imports from `features/` or `infrastructure/`. Core is the foundation — it cannot know about adapters or domain logic.

## Code quality (Biome)

Biome enforces the following — run `bun run check` to see/fix failures:

- **Explicit return types on exported functions.** `export async function foo(): Promise<Bar>` — yes. Bare `export async function foo()` fails. For inferred complex generics (e.g. Hono's `OpenAPIHono<AppEnv>` chain), use `// biome-ignore lint/nursery/useExplicitType: <specific reason>`. No blanket ignores.
- **No `console.*`** in `src/` — use `c.var.logger` or `getLogger()`. Allowed only in `scripts/` via override.
- **No `any` / no implicit any.** Use `unknown` + narrow. `any` fails the build.
- **No `==` / `!=`** — always strict equality.
- **No `foo!`** (non-null assertion) — prefer explicit null-checks or optional chaining.
- **No parameter reassignment.** Rebind: `const normalized = email.toLowerCase()`.
- **`node:*` imports for Node stdlib.** `import { readFile } from "node:fs/promises"`, not `"fs/promises"`.

## TypeScript strictness

On top of `strict: true`, we run with six extra flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noUncheckedSideEffectImports`, `allowUnreachableCode: false`.

Consequences worth remembering:

- `arr[i]` is `T | undefined` — handle missing elements.
- `obj.key` on an index-signature type (like `process.env`) is **forbidden**; use `obj["key"]`. Biome's `useLiteralKeys` is off for `scripts/` and `drizzle.config.ts` because those read raw `process.env`; everywhere else import validated `env` from `@/config/env`.
- `{ foo?: T }` means "omit the key", not "`foo: T | undefined`". If a caller can pass an explicit `undefined`, type it as `{ foo: T | undefined }`.

## Logging

`pino` via `hono-pino`. Never `console.log`/`console.error` in application code — output must be structured and carry `reqId`.

**Inside HTTP handlers** (you have `c`):

```ts
c.var.logger.info({ userId }, "User fetched");
c.var.logger.error({ err }, "Failed to save user");
```

**Everywhere else** (repositories, services, startup, scripts that touch app code):

```ts
import { getLogger } from "@/core/logger";

const log = getLogger();                                // request-scoped if called inside a request, root otherwise
log.info({ id }, "Processing job");
```

`getLogger()` returns `c.var.logger` when invoked within a Hono request (via `hono/context-storage` AsyncLocalStorage) and falls back to `rootLogger` otherwise. Services therefore stay agnostic of HTTP — same code works in tests and (future) cron jobs.

**Pino conventions:**

- First arg is the *bindings object*, second is the *message string*: `log.info({ userId }, "User created")`.
- For errors, pass under the `err` key so pino's serializer unpacks name/stack: `log.error({ err }, "Unhandled")`.
- **Never** string-interpolate values into the message — keep them as bindings so they're queryable in a log aggregator.

Redact paths cover passwords, tokens, auth headers — see `src/core/logger.ts`. Add new secret paths there when a new token type is introduced.

## Graceful shutdown

`src/index.ts` owns the only `process.exit()` call in the codebase. It handles `SIGTERM` / `SIGINT`, stops the HTTP server (draining in-flight requests), closes the DB pool, then exits.

**Never** add `process.exit()` elsewhere. If a module needs to participate in shutdown (close a connection, flush a queue), export a `close*()` function from it and call it from the `shutdown()` block in `index.ts` alongside `closeDb()`.

## Errors

All HTTP errors serialize through `errorHandler` into the canonical shape:

```json
{
  "requestId": "uuid",
  "code": 404,
  "message": "Route not found: GET /missing",
  "type": "NOT_FOUND",
  "path": "/missing",
  "timestamp": "2026-04-23T10:00:00.000Z"
}
```

- `code` — HTTP status.
- `type` — domain identifier from the `ErrorType` enum in `@/core/errors`. Multiple `type` values can share one `code` (e.g. two 404s with different `type`s). **`type` is part of the public API contract** — never rename existing values, only add new ones.

**Throw the built-in subclasses, not raw `Error` or `HTTPException`:**

```ts
import { ConflictError, NotFoundError, UnauthorizedError } from "@/core/errors";

if (!user) throw new NotFoundError("User not found");
if (emailTaken) throw new ConflictError("Email already registered");
if (!session) throw new UnauthorizedError("Session expired");
```

Built-in categories: `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409), `RateLimitError` (429), `UpstreamError` (502), `InternalError` (500).

**Feature-specific errors** — when you need a more precise `type`, add a value to `ErrorType` and extend `AppError` directly (not one of the categories — `type` is readonly there):

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

The error handler only checks `instanceof AppError`, so any subclass serializes identically — no handler changes needed when adding new error classes.

**Wrapping underlying errors** — use the native `Error.cause` second argument. The cause goes to logs, not to the response body:

```ts
try {
  await db.insert(users).values(input);
} catch (dbErr) {
  throw new InternalError("Failed to create user", { cause: dbErr });
}
```

In non-development environments, 5xx responses replace `message` with `"Internal server error"` to avoid leaking internals. The original error still reaches the structured logs.

## Database

Postgres via `Bun.sql` with Drizzle ORM. `Bun.sql` is the driver (connection pool), Drizzle provides typed queries and migrations.

- **Connection**: `import { db } from "@/infrastructure/db"`. A single pool instance, configured from `DATABASE_URL`.
- **Schema files** live next to each feature: `src/features/<name>/schema.ts`. `drizzle.config.ts` globs them — no central import needed.
- **Generate a migration**: change `schema.ts`, then `bun run db:generate`. Review the generated SQL in `./drizzle/` and commit it.
- **Apply migrations**: `bun run db:migrate` (also runs in CI before tests).
- **Never edit an applied migration file.** Create a new migration instead.
- **Inspect DB visually**: `bun run db:studio`.

### Schema conventions

- **UUID v7** for primary keys — time-sortable, lexicographic = chronological, keeps B-tree indexes local:
  ```ts
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  ```
- **Timestamps**: always `timestamp("col", { withTimezone: true })` with `.defaultNow()`. Never store naive timestamps.
- **`updatedAt`** uses `.$onUpdate(() => new Date())` — runs only on Drizzle-issued UPDATEs. If raw SQL will update the table, add a Postgres trigger.
- **Unique indexes** with `.unique()` on columns are fine for simple cases. For conditional uniqueness (`WHERE is_deleted = false`), use `uniqueIndex()` with `.where()`.

## HTTP middleware

The order in `src/app.ts` matters:

1. `requestId()` — first, sets `c.var.requestId` for all downstream logs.
2. `contextStorage()` — enables `tryGetContext()` → `getLogger()` outside handlers.
3. `pinoLogger({ pino: rootLogger })` — attaches `c.var.logger`.
4. Inline `c.var.logger.assign({ reqId })` — enriches every log line with the request ID.
5. `secureHeaders()` — HSTS, X-Frame-Options, etc. Must run before routes so all responses carry the headers.
6. `bodyLimit({ maxSize: 100 * 1024 })` — rejects oversized bodies before handlers parse them; throws `ValidationError` on overflow (NOT `HTTPException`, so our typed error shape is preserved).
7. `cors({ origin: env.FRONTEND_URL, credentials: true })` — explicit origin; `"*"` is forbidden with `credentials: true`.

Per-route middleware (e.g. rate limit) goes in `createRoute({ middleware: [...] as const })`. The `as const` is required for Hono's type inference.

## Rate limiting

`src/http/middleware/rate-limit.ts` is an **in-memory fixed-window** limiter. It works for single-instance deployments and development; for horizontally scaled production, replace the backing `Map` with Redis `INCR + EXPIRE` so all instances share the same bucket.

Applying on a route:

```ts
const joinRoute = createRoute({
  method: "post",
  path: "/",
  middleware: [rateLimit({ windowMs: 60_000, max: 5 })] as const,
  // ...
});
```

Test isolation: integration tests that hit rate-limited endpoints **must** call `clearRateLimits()` in `beforeEach`, otherwise buckets leak across tests. See `src/features/waitlist/route.test.ts`.

When auth lands, the typical custom key-generator pattern is:

```ts
// Once available — `clientIp` will be exported from rate-limit.ts:
middleware: [rateLimit({ windowMs: 60_000, max: 5, keyGenerator: (c) => c.var.user?.id ?? clientIp(c) })] as const
```

## OpenAPI + validation

Routes use `@hono/zod-openapi`'s `createRoute` + `.openapi(route, handler)`. Schema is the single source of truth: it drives request validation, response shape, and the OpenAPI doc.

**Always use `createFeatureRouter()`** from `@/http/openapi` instead of `new OpenAPIHono<AppEnv>()` directly. The factory registers a `defaultHook` that converts Zod validation failures into our `ValidationError` — so invalid request bodies produce the same `ErrorResponse` shape as hand-thrown domain errors.

Response helpers in `@/http/openapi`:

- `jsonBody(schema)` — wraps a Zod schema as `{ "application/json": { schema } }`
- `errorResponse(description)` — prebuilt `ErrorResponse` content for 4xx/5xx declarations

Example:

```ts
const joinRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["waitlist"],
  request: { body: { required: true, content: jsonBody(joinSchema) } },
  responses: {
    201: { description: "Joined", content: jsonBody(entrySchema) },
    400: errorResponse("Invalid email"),
    409: errorResponse("Email already registered"),
  },
});
```

## Feature module layout

A feature owns these files — flat inside `src/features/<name>/`:

| File | Responsibility |
|---|---|
| `schema.ts` | Drizzle table + inferred types (`$inferSelect` / `$inferInsert`) |
| `repository.ts` | Pure DB queries. No business logic, no HTTP. |
| `service.ts` | Business logic. Calls repositories, throws typed errors, logs via `getLogger()`. |
| `route.ts` | OpenAPI route definitions + handlers. Thin: validate → call service → return. |
| `route.test.ts` | Integration tests via `app.request()`, truncate in `beforeEach`. |

Optional: `dto.ts` for request/response Zod schemas if they get large enough that inlining in `route.ts` hurts readability (usually only around 3+ schemas).

Feature-specific errors (see Errors) live in `errors.ts` inside the feature.

## Testing

Integration-first: we test via `app.request()` against the real compiled Hono app, hitting a live Postgres. No mocks of the database.

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import app from "@/app";
import { truncate } from "@/testing";

describe("POST /feature", () => {
  beforeEach(async () => {
    await truncate("feature_entries");
    // clearRateLimits();  ← add if the route has rateLimit middleware
  });

  test("201 on valid input", async () => {
    const res = await app.request("/feature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ /* ... */ }),
    });
    expect(res.status).toBe(201);
  });
});
```

Tests run with `NODE_ENV=test`, which resolves to `LOG_LEVEL=silent` via the env schema — stdout stays clean. If a test really needs to see logs, export a one-off logger override; do not relax the default.

Coverage threshold is 70% lines, enforced by `bunfig.toml`. Adding a feature without tests drops coverage below threshold, failing CI — there is no opt-out.

## Managing `knip` flags

Knip runs in CI and fails on unused files, exports, and dependencies. Two patterns we follow:

- **Type-only public API without consumers yet** — allowed by `ignoreExportsUsedInFile: { type: true, interface: true }` in `knip.json`. Types you export but don't import anywhere are OK *if they're used elsewhere in the same file*. This lets `config/env.ts` expose `type Env` even before another module imports it.
- **Runtime exports without consumers** — **not** allowed. If you add `export const thing` and nothing imports it, knip fails. Either:
  1. Drop the `export` (keep it internal until the first consumer lands), or
  2. Add the consumer in the same slice.

This prevents "speculative API" pollution that LLMs tend to produce.

## Adding dependencies

- Add to `package.json` — runtime deps under `dependencies`, dev/build tools under `devDependencies`.
- Run `bun install` — this updates `bun.lock`.
- If the dep is used only in `scripts/` or `drizzle.config.ts`, knip's built-in plugins usually auto-detect it via the consumer file. If knip flags it as unused, you've wired it wrong — don't add to `knip.json`'s ignore list, fix the wiring.

## Available skills, commands, and agents

Configured under `.claude/`:

| Type | Name | When |
|---|---|---|
| Skill | `drizzle-schema` | Auto-loads when editing `src/features/**/schema.ts` — UUID v7, timezone-aware timestamps, index rules |
| Skill | `integration-tests` | Auto-loads when editing `*.test.ts` — `app.request()`, `truncate`, `clearRateLimits`, `ErrorResponse` shape |
| Command | `/add-feature <name>` | Scaffold a new feature module (schema + repository + service + route, register in `app.ts`) |
| Command | `/pr-ready` | Run the full pre-PR gate: lint → types → cycles → dead-code → tests → docker build |
| Command | `/commit` | Run the full pre-PR gate, then create a conventional-commit (`type(scope): description`). Aborts on any gate failure |
| Agent | `code-reviewer` | Review uncommitted changes against project conventions. Reports high-signal issues only — does not fix |
| Agent | `test-writer` | Generate integration tests for a feature route covering all declared response codes |
| Agent | `plan-validator` | Validate a plan via Gemini 3.1 Pro Preview (adversarial framing, read-only repo access). Accepts a file path or inline plan text; optional `--deep` for codebase-investigator mode. Requires `gemini` CLI installed |

Skills auto-load via `paths:` glob — you don't invoke them, they appear when relevant. Commands run via `/<name>`. Agents run via the Agent tool with `subagent_type: "<name>"`.

## Where to find domain-specific rules

Directory-scoped rules live next to the code they govern. When you work inside one of these directories, read its `CLAUDE.md` — it complements (not duplicates) the main file with rules that matter only in that scope.

| Scope | File |
|---|---|
| Feature module layout, cross-feature import ban, testing conventions | [`src/features/CLAUDE.md`](./src/features/CLAUDE.md) |
| What qualifies as "core", extending `AppError`/`ErrorType`, redaction paths | [`src/core/CLAUDE.md`](./src/core/CLAUDE.md) |
| Middleware order, `createFeatureRouter` requirement, OpenAPI helpers, rate-limit nuances | [`src/http/CLAUDE.md`](./src/http/CLAUDE.md) |
| Adapter file shape (ping/close contract), pool sizing, wiring into readiness + shutdown | [`src/infrastructure/CLAUDE.md`](./src/infrastructure/CLAUDE.md) |

When adding a new directory with its own conventions (say, `src/features/auth/` with JWT token rotation rules that don't apply elsewhere), add a `CLAUDE.md` next to the code and link it here.

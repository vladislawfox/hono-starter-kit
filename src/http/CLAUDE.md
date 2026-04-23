# http/ — conventions

HTTP presentation layer — everything that's about *transport*, not business logic. Types (`context.ts`), global handlers (`error-handler.ts`), OpenAPI factory (`openapi.ts`), and middleware (`middleware/`).

Everything here is *cross-feature* — it gets used by every route. Feature-specific middleware or schema helpers live in the feature itself.

## Middleware order in `app.ts`

Order matters. The chain in `src/app.ts`:

1. `requestId()` — generates `c.var.requestId` (UUID) for every request. **Must run first** so all downstream logs carry it.
2. `contextStorage()` — enables `hono/context-storage` AsyncLocalStorage, which `getLogger()` reads from. **Must run before any middleware that might log from a service.**
3. `pinoLogger({ pino: rootLogger })` — attaches `c.var.logger` (request-scoped pino child).
4. Inline enrichment — `c.var.logger.assign({ reqId: c.get("requestId") })` so every log line carries `reqId`.
5. `secureHeaders()` — HSTS, X-Frame-Options, X-Content-Type-Options. Must run early so all responses (including error responses) carry them.
6. `requestTimeout(30_000)` — rejects handlers that run longer than 30s with 504 `TIMEOUT`. Runs after `secureHeaders` so timeout responses still get security headers; runs before `bodyLimit` so even streaming of oversized bodies is bounded.
7. `bodyLimit()` — rejects oversized bodies *before* parsing. **Important**: throws `ValidationError` on overflow (not `HTTPException`) so our typed error shape is preserved.
8. `cors()` — explicit origin; wildcard `"*"` is forbidden with `credentials: true`. Must run before routes so OPTIONS preflights work.

When adding new global middleware:
- Cheap, always-relevant (security, logging) → goes here, in `app.ts`.
- Route-specific (auth, rate-limit for one endpoint) → goes in `createRoute({ middleware: [...] as const })`.

## `createFeatureRouter()` is mandatory

**Never** `new OpenAPIHono<AppEnv>()` directly in feature code. Always:

```ts
import { createFeatureRouter } from "@/http/openapi";

export const myRoute = createFeatureRouter().openapi(someRoute, handler);
```

The factory registers a `defaultHook` that converts Zod validation failures into our `ValidationError` — so invalid request bodies produce the same `ErrorResponse` shape as hand-thrown domain errors. Without the factory, Zod errors come out as raw `HTTPException`s with a different JSON shape.

## OpenAPI response helpers

`src/http/openapi.ts` exports two helpers used by every feature route:

```ts
import { createRoute, z } from "@hono/zod-openapi";
import { createFeatureRouter, errorResponse, jsonBody } from "@/http/openapi";

const route = createRoute({
  method: "post",
  path: "/",
  request: { body: { required: true, content: jsonBody(requestSchema) } },
  responses: {
    201: { description: "Created", content: jsonBody(responseSchema) },
    400: errorResponse("Invalid input"),
    409: errorResponse("Already exists"),
  },
});
```

- `jsonBody(schema)` — wraps a Zod schema for `application/json` content.
- `errorResponse(description)` — prebuilt response using the shared `ErrorResponse` schema.

Don't open-code the `content: { "application/json": { schema } }` structure in feature files — use the helper. Consistency here lets you grep for `errorResponse(` to find every error-returning endpoint.

## Rate limiting

`middleware/rate-limit.ts` is an **in-memory fixed-window** limiter.

### Works for

- Single-instance deployments (one Bun process)
- Local development
- Tests (with `clearRateLimits()` in `beforeEach`)

### Does NOT work for

- Multiple instances behind a load balancer — each instance has its own buckets; user gets (instances × max) requests total before being limited.
- Sliding-window precision — we use fixed windows, so a burst right at window boundary can temporarily exceed `max`.

### Upgrade path to Redis

When scaling to multiple instances, swap the backing `Map<string, Bucket>` for `Bun.redis` with `INCR` + `EXPIRE`. API stays identical — only `rateLimit()` and `clearRateLimits()` bodies change. Do not add a Redis dependency preemptively.

### Test isolation

Routes with `rateLimit()` middleware **must** call `clearRateLimits()` in `beforeEach`:

```ts
import { clearRateLimits } from "@/http/middleware/rate-limit";
// ...
beforeEach(async () => {
  await truncate("my_table");
  clearRateLimits();
});
```

Without this, buckets leak across tests — later tests in the same file will hit the limit unpredictably.

## Pagination (pattern, not code)

No helper ships by default — we'd need a consumer and knip would flag unused exports. When the first list endpoint lands, copy this pattern into `src/http/pagination.ts` and extend it.

**Use cursor-based, not offset-based.** Our primary keys are UUID v7, which sort lexicographically by time — so "last id from previous page" is a valid cursor, queries stay O(log n), and offset's deep-page degradation doesn't apply.

```ts
// Request: GET /items?cursor=<uuid-v7>&limit=20
const listQuery = z.object({
  cursor: z.uuidv7().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Response
const paginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.uuidv7().nullable(), // null when no more pages
  });

// Repository query — fetch `limit + 1` to know if there's a next page
export async function list(limit: number, cursor?: string): Promise<{ items: Item[]; nextCursor: string | null }> {
  const rows = await db
    .select()
    .from(items)
    .where(cursor ? gt(items.id, cursor) : undefined)
    .orderBy(items.id)
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { items: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
}
```

**Why limit+1 and not a separate count query?** A count is a second round-trip against a table that may be huge. `limit+1` is one round-trip; we know there's a next page iff we got the extra row. We never need a total count for cursor-based paging.

**If you need offset-based anyway** (admin UIs that want page numbers): acceptable at small scale, but bound `page * limit ≤ 10_000` to protect the DB from deep-page scans.

## Adding new middleware

1. File in `src/http/middleware/<name>.ts`.
2. Export a *factory* that returns `MiddlewareHandler<AppEnv>` — never hard-code options:
   ```ts
   export function myMiddleware(opts: MyOptions): MiddlewareHandler<AppEnv> {
     return async (c, next) => { /* ... */ };
   }
   ```
3. If the middleware holds state (like rate limit's `Map`), export a `clear*()` helper for tests.
4. Never import from `@/features/*` — middleware is cross-feature by definition. If you need feature-specific logic in a middleware, that's a smell — move the logic to the feature's handler.

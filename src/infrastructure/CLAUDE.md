# infrastructure/ — conventions

Adapters for **external systems** — databases, caches, message queues, HTTP clients for third-party services, object storage, email. Anything that crosses the network (or disk) to talk to something this process doesn't own.

If it's pure code — it doesn't belong here. If it's an HTTP handler — it doesn't belong here. Those go to `core/` and `features/` respectively.

## Current inventory

- `db.ts` — Postgres via `Bun.sql` + Drizzle ORM.

## File shape for every adapter

Each adapter file exports (at minimum):

1. **The client instance** — a module-level constant, configured from validated env (`@/config/env`), with pool/timeout settings that scale by `NODE_ENV`.
2. **A `ping*()` function** — cheap health probe that readiness checks call (e.g. `pingDb` executes `SELECT 1`). Must throw on failure.
3. **A `close*()` function** — clean shutdown. Called from `src/index.ts`'s `shutdown()` handler so in-flight work drains before process exit.

Pattern, seen in `db.ts`:

```ts
import { env } from "@/config/env";

const client = new ExternalClient(env.SOMETHING_URL, {
  poolSize: env.NODE_ENV === "production" ? 20 : 10,
});

export const something = client;  // open export once a consumer imports it
export async function pingSomething(): Promise<void> {
  await client.health();
}
export async function closeSomething(): Promise<void> {
  await client.close();
}
```

## Wiring a new adapter into shutdown + readiness

Two places to update when adding a new external system:

### `src/index.ts` — graceful shutdown

Extend the `Promise.allSettled([...])` list in `shutdown()`:

```ts
const results = await Promise.allSettled([closeDb(), closeRedis(), closeQueue()]);
for (const [i, result] of results.entries()) {
  if (result.status === "rejected") {
    rootLogger.error({ err: result.reason, i }, "shutdown resource close failed");
  }
}
```

Order doesn't matter (`allSettled` runs in parallel) — but all must be awaited before `process.exit()`.

### `src/features/health/route.ts` — readiness probe

Add the new check to `readinessSchema` and the handler:

```ts
const readinessSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  timestamp: z.iso.datetime(),
  checks: z.object({
    db: checkSchema,
    redis: checkSchema,  // ← add here
  }),
});

// in the handler:
const [db, redis] = await Promise.all([probe(pingDb), probe(pingRedis)]);
const ok = db.ok && redis.ok;
const body = { /* ... */ checks: { db, redis } };
```

Readiness fails (503) if **any** check fails. This gates the load balancer — `readinessProbe` in K8s pulls the pod out of rotation when DB or Redis is down.

## Connection pool sizing

The `db.ts` default is the template:

```ts
max: env.NODE_ENV === "production" ? 20 : 10,
idleTimeout: 30,
connectionTimeout: 10,
```

- **`max` in production** — start at 20. Tune against your actual RDS/Postgres connection limit, reserving headroom for migrations and background jobs.
- **`max` in dev/test** — 10 is plenty. Higher risks exhausting local Postgres's default 100 connections when you run tests in parallel.
- **`idleTimeout`** — 30s. Shorter than most load balancers' TCP idle kill, longer than typical request cycles.

Scale these numbers, don't remove them — naked defaults hide production-time pool exhaustion.

## `export` discipline

An adapter's client (`db`, `redis`) is "public API" to the rest of the app. Following our [knip-flag convention](../../CLAUDE.md#managing-knip-flags):

- **Don't export the client** until the first consumer (usually a feature repository) imports it. Keep it `const` internal.
- **Do export** `ping*()` and `close*()` immediately — they're consumed by `features/health/route.ts` and `src/index.ts` from day 1.

This prevents "speculative" exports that knip flags as dead code.

## External HTTP clients

When wrapping a third-party API (Stripe, Resend, Twilio), create a dedicated subfolder: `src/infrastructure/stripe/`, `src/infrastructure/resend/`. Each subfolder gets the same shape (client + ping + close if applicable), plus its own typed facade:

```
src/infrastructure/stripe/
├── client.ts       Configured SDK instance
├── facade.ts       Typed functions app code calls (creatCharge, etc.)
├── types.ts        Shared types
└── client.test.ts  Contract tests against their sandbox or a replay
```

**Never** let features import the raw SDK — they import from the facade. That lets you swap implementations (mock in tests, fallback in outages) without changing feature code.

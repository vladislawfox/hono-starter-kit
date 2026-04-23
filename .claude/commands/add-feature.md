---
description: Scaffold a new feature under src/features/<name>/ with schema, repository, service, route, and register it in src/app.ts.
argument-hint: <feature-name>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

Scaffold a new feature at `src/features/$ARGUMENTS/`.

## Steps

1. **Read the canonical pattern** — look at `src/features/waitlist/` (schema, repository, service, route, route.test). That's the reference layout. Also skim `src/features/CLAUDE.md` for conventions.

2. **Refuse scaffold if the directory already exists** — don't overwrite. Ask the user to pick a different name or remove the existing one first.

3. **Create 4 files** mirroring waitlist:
   - `schema.ts` — Drizzle table with `uuid("id").$defaultFn(() => Bun.randomUUIDv7()).primaryKey()` and `createdAt` / `updatedAt` as `timestamp(..., { withTimezone: true })`. Leave domain columns as a TODO comment for the user. Export `<Name>Entry` as `typeof <table>.$inferSelect`.
   - `repository.ts` — minimal exported functions (`getById`, `create`) using `db` from `@/infrastructure/db`. No business logic.
   - `service.ts` — at least one exported function that calls the repository. Imports `getLogger` from `@/core/logger` and relevant `AppError` subclasses from `@/core/errors`. Never imports Hono.
   - `route.ts` — uses `createFeatureRouter()` from `@/http/openapi`, declares a route with `createRoute()`, calls the service, returns JSON. Include `errorResponse()` for expected error statuses (400 at minimum).

4. **Register the route** in `src/app.ts`:
   ```ts
   import { $ARGUMENTSRoute } from "@/features/$ARGUMENTS/route";
   // ...
   app.route("/$ARGUMENTS", $ARGUMENTSRoute);
   ```

5. **Run `bun run db:generate`** after schema.ts is finalized with real columns (if the user has filled them in at scaffold time). If not, remind them to run it after editing.

6. **Verify** — run `bun run check:cycles && bunx tsc --noEmit && bun run check:deadcode`. If any fails, report what broke; do not mutate the scaffold silently to hide errors.

7. **Report** what was created and remind the user to:
   - Fill in real columns in `schema.ts` then run `bun run db:generate` + `bun run db:migrate`
   - Add a Zod input schema in `route.ts` for request validation
   - Add domain methods to `service.ts` (beyond the stub)
   - Write an integration test in `route.test.ts` — invoke the `integration-tests` skill when ready

## Do not

- Generate a `.test.ts` file — integration tests are a deliberate follow-up, not scaffold boilerplate.
- Add `errors.ts` — only needed when a feature wants a more specific `ErrorType` than the eight categories. Premature otherwise.
- Register middleware (`rateLimit`, future `auth`) in the scaffold. Those are per-route deliberate decisions.
- Open `export` on anything not yet consumed — knip will fail. Keep `const` internal until something imports it.

---
name: drizzle-schema
description: Conventions for Drizzle schema.ts files — UUID v7 primary keys, timezone-aware timestamps, updatedAt auto-update, index choices. Invoke when editing any src/features/**/schema.ts.
paths: "src/features/**/schema.ts"
---

# Drizzle schema conventions

## Primary keys — always UUID v7

```ts
import { pgTable, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(() => Bun.randomUUIDv7()),
  // ...
});
```

Why v7 and not v4 / serial:
- **Time-sortable** — B-tree indexes stay local, pagination via `WHERE id > :cursor ORDER BY id` works without a separate `created_at` column.
- **Non-guessable** — unlike serial ints, IDs don't leak row count or creation order to public API consumers.
- **Generated in app code**, not via `gen_random_uuid()` server-side. Keeps the insert round-trip a single statement and works the same in tests.
- **`Bun.randomUUIDv7()`** is built into the runtime (Bun ≥ 1.1.25) — no npm dependency. Do NOT reintroduce the `uuid` package for this.

## Timestamps — always timezone-aware

```ts
import { timestamp } from "drizzle-orm/pg-core";

createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
updatedAt: timestamp("updated_at", { withTimezone: true })
  .defaultNow()
  .notNull()
  .$onUpdate(() => new Date()),
```

- **`withTimezone: true` always.** Naive timestamps cause silent correctness bugs when workers run in a different TZ than Postgres. No exceptions.
- **`.defaultNow()` not `sql\`now()\`` literal** — Drizzle handles it portably.
- **`$onUpdate` only runs on Drizzle-issued UPDATEs.** If any code path uses raw SQL (`db.execute(sql\`UPDATE ...\`)`), add a Postgres trigger to cover it — don't rely on `$onUpdate`.

## Indexes

- **Foreign-key columns**: add an index when the column is queried without the parent row already in hand. Postgres does NOT auto-index FKs.
- **Case-insensitive text** (emails, usernames): store lowercased on the application side (as `waitlist/service.ts` does) — avoids needing an expression index. If you *must* preserve case, add `CREATE INDEX ... ON lower(col)` via raw SQL migration.
- **Do not preemptively index every column.** Each index costs write throughput. Add an index when a query plan confirms a seq scan.
- **Unique with conditions**: use `uniqueIndex("name").on(cols).where(sql\`...\`)` for things like "unique email among non-deleted users".

## Inferred types

Export at least:

```ts
export type <Name>Entry = typeof <table>.$inferSelect;
```

Export `NewEntry = typeof <table>.$inferInsert` **only if** a repository function takes it — otherwise knip flags the unused type.

## Migrations — never edit an applied one

After editing schema.ts: `bun run db:generate` produces a new file in `./drizzle/`. Commit it. **Never edit a previously applied migration file** — Drizzle's migration journal has already hashed it; editing causes divergence that is hell to roll back in prod. If you need to change something already applied, create a new migration that alters it.

## After touching schema.ts

Always run (in this order):

1. `bun run db:generate` — produces the migration SQL in `./drizzle/`.
2. Review the generated SQL — does it do what you expect? Especially for `DROP` or `ALTER TYPE`.
3. `bun run db:migrate` — applies to local dev DB.
4. `bun run check:cycles` — schema is imported by repositories + types; a typo that creates a circular import surfaces here.

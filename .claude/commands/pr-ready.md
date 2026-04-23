---
description: Run the full pre-PR gate — lint, types, cycles, dead-code, tests, docker build. Stop at first failure.
allowed-tools: Bash
model: haiku
---

Run the full pre-PR validation suite in order. If any step fails, stop immediately and report which step failed with the relevant error output. Do not proceed to the next step on failure.

Steps (in order):

1. `bun run check:ci` — Biome lint (CI mode, no auto-fix).
2. `bun run typecheck` — TypeScript `--noEmit`.
3. `bun run check:cycles` — madge circular-import check.
4. `bun run check:deadcode` — knip (unused files, exports, dependencies).
5. `bun test` — integration tests against live Postgres (requires `docker compose up` first).
6. `docker build -t hono-starter-kit:pr-check .` — Dockerfile build, catches image-level regressions.

On full success, report **"PR-ready ✅"** with a one-line summary of what ran (e.g., "lint, types, cycles, dead-code, N tests, docker build — all green").

If step 5 fails because Postgres is unreachable, do NOT try to start Docker Desktop yourself — that's a user setup step. Just ask the user to run `bun run docker:up` and retry `/pr-ready`.

If any other step fails, include the failing command's last ~15 lines of output so the user can see the error without reading the full log.

# hono-starter-kit

Production-ready [Hono](https://hono.dev) template for Bun. Feature-based architecture, strict TypeScript, OpenAPI-first routing, typed errors, structured logging, Drizzle + Postgres — all wired up and tested.

## Features

- **Runtime**: Bun 1.3.12 (pinned), native `SQL` driver, built-in test runner
- **Framework**: Hono 4 with `@hono/zod-openapi` + Scalar UI at `/reference`
- **Validation**: Zod 4 schemas drive both request validation and OpenAPI docs
- **DB**: Drizzle ORM + Bun's native Postgres driver, UUID v7 primary keys
- **Errors**: typed `AppError` hierarchy, standardized `ErrorResponse` shape with `requestId`
- **Logging**: `pino` via `hono-pino`, structured, with `reqId` per request and broad redact paths
- **Security**: `secureHeaders`, CORS with explicit origin, body limit, in-memory rate limiter
- **Quality gates**: Biome (strict), TypeScript strict + 6 extra flags, madge (cycles), knip (dead code), Bun test with 70% coverage threshold
- **CI**: GitHub Actions with Postgres service, cached installs, Docker build validation
- **Ops**: multi-stage Alpine Dockerfile, docker-compose, graceful shutdown (SIGTERM/SIGINT)
- **Deps hygiene**: Dependabot (npm + actions + docker) + weekly `bun outdated` + `bun audit` workflow
- **Example feature**: `POST /waitlist` — full vertical slice (Drizzle schema → repository → service → route → integration tests)

## Quick start

Prerequisites: [Bun](https://bun.sh) ≥ 1.3.12, [Docker](https://www.docker.com) (for local Postgres).

```sh
bun install                   # install deps + set up Husky hook
cp .env.example .env          # local env (DATABASE_URL, FRONTEND_URL)
bun run docker:up             # start Postgres on port 25572
bun run db:migrate            # apply migrations
bun run dev                   # server on http://localhost:3000
```

Open:

- `http://localhost:3000/health` — liveness probe
- `http://localhost:3000/health/ready` — readiness (pings DB)
- `http://localhost:3000/reference` — Scalar OpenAPI UI
- `http://localhost:3000/openapi.json` — raw OpenAPI 3.1 spec

## Project structure

```
src/
├── index.ts                    Bun.serve + graceful shutdown (SIGTERM/SIGINT)
├── app.ts                      Hono bootstrap: middleware + routes + OpenAPI docs
├── config/
│   └── env.ts                  Zod env schema, fail-fast at startup
├── core/                       Cross-cutting utilities (used everywhere)
│   ├── errors.ts               AppError hierarchy + ErrorResponse type
│   └── logger.ts               Pino logger + getLogger() helper
├── http/                       HTTP presentation layer (cross-feature)
│   ├── context.ts              AppEnv type (c.var.logger, c.var.requestId)
│   ├── error-handler.ts        Global onError + notFound handlers
│   ├── openapi.ts              createFeatureRouter factory + jsonBody/errorResponse helpers
│   └── middleware/
│       └── rate-limit.ts       In-memory fixed-window rate limiter
├── infrastructure/             Adapters for external systems
│   └── db.ts                   Drizzle + Bun SQL, pingDb, closeDb
├── features/                   Feature modules (one folder per domain concept)
│   ├── health/
│   │   └── route.ts            /health + /health/ready
│   └── waitlist/
│       ├── schema.ts           Drizzle table definition
│       ├── repository.ts       DB queries
│       ├── service.ts          Business logic (normalize, ConflictError)
│       ├── route.ts            OpenAPI route with rate limit
│       └── route.test.ts       Integration tests
└── testing.ts                  Shared test helper: truncate()

drizzle/                        Generated SQL migrations (do not edit manually)
scripts/
└── migrate.ts                  Migration runner (idempotent)
```

Architectural conventions (who can import from whom) live in [CLAUDE.md](./CLAUDE.md#architecture-and-imports).

## Stack

| Concern | Choice |
|---|---|
| Runtime | Bun 1.3.12 |
| Framework | Hono 4 + `@hono/zod-openapi` |
| OpenAPI UI | Scalar |
| Validation | Zod 4 |
| ORM | Drizzle + Bun SQL |
| DB | Postgres 18 |
| Logger | pino + hono-pino |
| Lint + format | Biome 2 |
| Dead-code | knip 6 |
| Cycle detection | madge |
| Tests | `bun test` + `app.request()` |
| Git hooks | Husky |
| CI | GitHub Actions |

No ESLint, no Prettier, no dotenv — Biome and Bun cover those roles.

## Scripts

| Command | What it does |
|---|---|
| `bun dev` | hot-reload server |
| `bun start` | production-like run |
| `bun test` | `NODE_ENV=test bun test` with 70% line coverage threshold |
| `bun run check` | Biome with autofix |
| `bun run check:ci` | Biome read-only (CI and hooks) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check:cycles` | madge circular dependency check |
| `bun run check:deadcode` | knip — unused files/exports/deps |
| `bun run docker:up` / `down` | start/stop local Postgres |
| `bun run db:generate` | generate migration from schema changes |
| `bun run db:migrate` | apply pending migrations |
| `bun run db:studio` | open Drizzle Studio |

## Development workflow

1. **Edit code.** Biome auto-formats on save (see `.vscode/settings.json`).
2. **Before committing** — the pre-commit hook runs Biome + `tsc --noEmit` + madge. If it fails, fix the issue rather than skipping the hook.
3. **Adding a feature** — create `src/features/<name>/` with `schema.ts`, `repository.ts`, `service.ts`, `route.ts`, `route.test.ts`. Mount the route in `src/app.ts`. If the schema changes, run `bun run db:generate`, review the SQL, commit the migration.
4. **Running tests** — `bun test`. Integration tests hit a live Postgres (from `docker-compose.yml`) via `app.request()`. Each test truncates the relevant tables in `beforeEach`.

Detailed conventions (logging, errors, architectural boundaries, feature module layout) are in [CLAUDE.md](./CLAUDE.md).

## Configuration

Environment variables are validated by Zod at startup — an invalid or missing required variable fails the process with a readable message.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` / `test` / `production` |
| `PORT` | no | `3000` | |
| `LOG_LEVEL` | no | env-derived | `debug` (dev), `info` (prod), `silent` (test) |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `FRONTEND_URL` | no | `http://localhost:3000` | CORS origin (credentials enabled, wildcard not allowed) |

See [`.env.example`](./.env.example) for the canonical list.

## Deployment

`Dockerfile` is multi-stage on `oven/bun:1.3.12-alpine`, runs as the non-root `bun` user, and includes a `HEALTHCHECK` hitting `/health`. Typecheck runs in the builder stage as a pre-deploy sanity gate.

```sh
docker build -t hono-starter-kit .
docker run -e DATABASE_URL=... -e FRONTEND_URL=... -p 3000:3000 hono-starter-kit
```

For Kubernetes, wire `livenessProbe` to `/health` and `readinessProbe` to `/health/ready` — the latter pings the DB, so the load balancer removes the pod from rotation when the DB is unreachable.

## License

MIT — see [LICENSE](./LICENSE).

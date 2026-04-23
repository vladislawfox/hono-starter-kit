# syntax=docker/dockerfile:1.7
# hono-starter-kit — Bun 1.3 multi-stage image.
# Pin bun to exact patch for reproducibility (bump together with .bun-version).

FROM oven/bun:1.3.13-alpine AS builder

WORKDIR /app

# Dependency layer — cache-friendly: copy only manifests first so `bun install`
# is re-used across image rebuilds that only touch source.
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# Source + config needed for build and runtime.
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src ./src

# Build-time sanity guard. Catches TS errors before the image ships.
RUN bunx tsc --noEmit

# ------- runtime stage -------
FROM oven/bun:1.3.13-alpine AS runtime

WORKDIR /app

# oven/bun:*-alpine ships a non-root `bun` user (UID 1000). Own all files as
# that user so nothing in the image is root-writable at runtime.
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/bun.lock ./bun.lock
COPY --from=builder --chown=bun:bun /app/bunfig.toml ./bunfig.toml
COPY --from=builder --chown=bun:bun /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=bun:bun /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=bun:bun /app/drizzle ./drizzle
COPY --from=builder --chown=bun:bun /app/scripts ./scripts
COPY --from=builder --chown=bun:bun /app/src ./src

USER bun

ENV NODE_ENV=production
EXPOSE 3000

# wget is part of alpine busybox — no extra packages needed.
# Checks liveness only (cheap, never touches DB). For readiness gating at the
# orchestrator level, use GET /health/ready (e.g. Kubernetes readinessProbe).
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["bun", "src/index.ts"]

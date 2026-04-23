import { createRoute, z } from "@hono/zod-openapi";
import { createFeatureRouter, jsonBody } from "@/http/openapi";
import { pingDb } from "@/infrastructure/db";

const livenessSchema = z
  .object({
    status: z.literal("ok"),
    timestamp: z.iso.datetime(),
  })
  .openapi("Liveness");

const checkSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

const readinessSchema = z
  .object({
    status: z.enum(["ready", "not_ready"]),
    timestamp: z.iso.datetime(),
    checks: z.object({ db: checkSchema }),
  })
  .openapi("Readiness");

type CheckResult = z.infer<typeof checkSchema>;

const PROBE_TIMEOUT_MS = 2000;

/**
 * Runs a health probe with a hard timeout. Prevents a stuck dependency from
 * blocking readiness past the orchestrator's own probe timeout — we'd rather
 * report 503 deterministically than hang until the pod is killed.
 *
 * Timeout cancels the timer in `finally` so a successful probe doesn't leave
 * a pending rejection that could fire later as an unhandled rejection.
 */
async function probe(fn: () => Promise<void>): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`probe timeout after ${PROBE_TIMEOUT_MS}ms`)),
        PROBE_TIMEOUT_MS,
      );
    });
    await Promise.race([fn(), timeout]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const livenessRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["health"],
  summary: "Liveness probe",
  description: "Cheap check that the process is alive. Does not touch any dependencies.",
  responses: {
    200: { description: "Process is alive", content: jsonBody(livenessSchema) },
  },
});

const readinessRoute = createRoute({
  method: "get",
  path: "/ready",
  tags: ["health"],
  summary: "Readiness probe",
  description: "Verifies DB connectivity. Use for load-balancer readiness checks.",
  responses: {
    200: { description: "All dependencies reachable", content: jsonBody(readinessSchema) },
    503: {
      description: "One or more dependencies unreachable",
      content: jsonBody(readinessSchema),
    },
  },
});

export const healthRoute = createFeatureRouter()
  .openapi(livenessRoute, (c) =>
    c.json({ status: "ok" as const, timestamp: new Date().toISOString() }, 200),
  )
  .openapi(readinessRoute, async (c) => {
    const db = await probe(pingDb);
    const ok = db.ok;
    const body = {
      status: ok ? ("ready" as const) : ("not_ready" as const),
      timestamp: new Date().toISOString(),
      checks: { db },
    };
    if (!ok) c.var.logger.error({ checks: body.checks }, "readiness failed");
    return c.json(body, ok ? 200 : 503);
  });

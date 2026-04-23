import type { Context, MiddlewareHandler, Next } from "hono";
import { TimeoutError } from "@/core/errors";
import type { AppEnv } from "@/http/context";

/**
 * Rejects the request with 504 `TIMEOUT` if the handler chain does not
 * complete within `ms`. Implemented with `Promise.race` + `clearTimeout`
 * in `finally` so a successful handler does not leave a pending rejection
 * that could surface later as an unhandled rejection.
 *
 * **JS has no preemption:** if a handler ignores `AbortSignal` (e.g., a DB
 * query still in flight), it keeps running in the background after we
 * return 504 — only its *response* is discarded. To actually cancel
 * downstream work, forward `c.req.raw.signal` into your fetch/query calls.
 */
export function requestTimeout(ms: number): MiddlewareHandler<AppEnv> {
  return async (_c: Context<AppEnv>, next: Next): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(`Request exceeded ${ms}ms timeout`)), ms);
    });
    try {
      await Promise.race([next(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

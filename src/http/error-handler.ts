import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { env } from "@/config/env";
import { AppError, type ErrorResponse, ErrorType } from "@/core/errors";
import type { AppEnv } from "@/http/context";

const isDev = env.NODE_ENV === "development";

/**
 * Strips internal details from 5xx messages in non-dev. The original message
 * still reaches the structured logs — only the client-facing body is scrubbed.
 * Keeps 4xx messages intact (they are the intended user-facing signal).
 */
function clientMessage(status: number, message: string): string {
  if (status >= 500 && !isDev) return "Internal server error";
  return message;
}

function statusToType(status: number): ErrorType {
  switch (status) {
    case 400:
      return ErrorType.VALIDATION_ERROR;
    case 401:
      return ErrorType.UNAUTHORIZED;
    case 403:
      return ErrorType.FORBIDDEN;
    case 404:
      return ErrorType.NOT_FOUND;
    case 409:
      return ErrorType.CONFLICT;
    case 429:
      return ErrorType.RATE_LIMITED;
    case 502:
    case 503:
    case 504:
      return ErrorType.UPSTREAM_ERROR;
    default:
      return status >= 500 ? ErrorType.INTERNAL_ERROR : ErrorType.VALIDATION_ERROR;
  }
}

function buildResponse(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  type: ErrorType,
  message: string,
): ErrorResponse {
  return {
    requestId: c.get("requestId"),
    code: status,
    message,
    type,
    path: c.req.path,
    timestamp: new Date().toISOString(),
  };
}

export function errorHandler(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof AppError) {
    const body = buildResponse(c, err.status, err.type, clientMessage(err.status, err.message));
    const level = err.status >= 500 ? "error" : "warn";
    c.var.logger[level]({ err }, `Request failed: ${err.type}`);
    return c.json(body, err.status);
  }

  if (err instanceof HTTPException) {
    const type = statusToType(err.status);
    const body = buildResponse(c, err.status, type, clientMessage(err.status, err.message));
    const level = err.status >= 500 ? "error" : "warn";
    c.var.logger[level]({ err }, `HTTPException: ${type}`);
    return c.json(body, err.status);
  }

  const body = buildResponse(c, 500, ErrorType.INTERNAL_ERROR, clientMessage(500, err.message));
  c.var.logger.error({ err }, "Unhandled error");
  return c.json(body, 500);
}

export function notFoundHandler(c: Context<AppEnv>): Response {
  const body = buildResponse(
    c,
    404,
    ErrorType.NOT_FOUND,
    `Route not found: ${c.req.method} ${c.req.path}`,
  );
  return c.json(body, 404);
}

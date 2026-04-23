import type { ContentfulStatusCode } from "hono/utils/http-status";

export const ErrorType = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  TIMEOUT: "TIMEOUT",
} as const;

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

export type ErrorResponse = {
  requestId: string;
  code: ContentfulStatusCode;
  message: string;
  type: ErrorType;
  path: string;
  timestamp: string;
};

type AppErrorInit = {
  status: ContentfulStatusCode;
  type: ErrorType;
  message: string;
};

export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly type: ErrorType;

  constructor(init: AppErrorInit, options?: { cause?: unknown }) {
    super(init.message, options);
    this.name = "AppError";
    this.status = init.status;
    this.type = init.type;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", options?: { cause?: unknown }) {
    super({ status: 400, type: ErrorType.VALIDATION_ERROR, message }, options);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", options?: { cause?: unknown }) {
    super({ status: 401, type: ErrorType.UNAUTHORIZED, message }, options);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", options?: { cause?: unknown }) {
    super({ status: 403, type: ErrorType.FORBIDDEN, message }, options);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", options?: { cause?: unknown }) {
    super({ status: 404, type: ErrorType.NOT_FOUND, message }, options);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", options?: { cause?: unknown }) {
    super({ status: 409, type: ErrorType.CONFLICT, message }, options);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests", options?: { cause?: unknown }) {
    super({ status: 429, type: ErrorType.RATE_LIMITED, message }, options);
    this.name = "RateLimitError";
  }
}

export class UpstreamError extends AppError {
  constructor(message = "Upstream service error", options?: { cause?: unknown }) {
    super({ status: 502, type: ErrorType.UPSTREAM_ERROR, message }, options);
    this.name = "UpstreamError";
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error", options?: { cause?: unknown }) {
    super({ status: 500, type: ErrorType.INTERNAL_ERROR, message }, options);
    this.name = "InternalError";
  }
}

export class TimeoutError extends AppError {
  constructor(message = "Request handler timed out", options?: { cause?: unknown }) {
    super({ status: 504, type: ErrorType.TIMEOUT, message }, options);
    this.name = "TimeoutError";
  }
}

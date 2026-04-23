import { describe, expect, test } from "bun:test";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  AppError,
  ConflictError,
  ErrorType,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
} from "./errors";

describe("AppError", () => {
  test("carries status, type, message", () => {
    const err = new AppError({
      status: 418,
      type: ErrorType.VALIDATION_ERROR,
      message: "teapot",
    });
    expect(err.status).toBe(418);
    expect(err.type).toBe(ErrorType.VALIDATION_ERROR);
    expect(err.message).toBe("teapot");
    expect(err.name).toBe("AppError");
    expect(err).toBeInstanceOf(Error);
  });

  test("preserves options.cause", () => {
    const cause = new Error("original");
    const err = new AppError(
      { status: 500, type: ErrorType.INTERNAL_ERROR, message: "wrapped" },
      { cause },
    );
    expect(err.cause).toBe(cause);
  });
});

describe("AppError subclasses", () => {
  test("each subclass sets correct status, type, and inherits AppError", () => {
    const cases: Array<{ err: AppError; status: ContentfulStatusCode; type: ErrorType }> = [
      { err: new ValidationError(), status: 400, type: ErrorType.VALIDATION_ERROR },
      { err: new UnauthorizedError(), status: 401, type: ErrorType.UNAUTHORIZED },
      { err: new ForbiddenError(), status: 403, type: ErrorType.FORBIDDEN },
      { err: new NotFoundError(), status: 404, type: ErrorType.NOT_FOUND },
      { err: new ConflictError(), status: 409, type: ErrorType.CONFLICT },
      { err: new RateLimitError(), status: 429, type: ErrorType.RATE_LIMITED },
      { err: new UpstreamError(), status: 502, type: ErrorType.UPSTREAM_ERROR },
      { err: new InternalError(), status: 500, type: ErrorType.INTERNAL_ERROR },
      { err: new TimeoutError(), status: 504, type: ErrorType.TIMEOUT },
    ];

    for (const { err, status, type } of cases) {
      expect(err.status).toBe(status);
      expect(err.type).toBe(type);
      expect(err).toBeInstanceOf(AppError);
    }
  });

  test("custom message overrides default", () => {
    const err = new ValidationError("email is required");
    expect(err.message).toBe("email is required");
  });

  test("cause propagates through subclasses", () => {
    const cause = new Error("db down");
    const err = new UpstreamError("service unavailable", { cause });
    expect(err.cause).toBe(cause);
  });
});

import { OpenAPIHono, z } from "@hono/zod-openapi";
import { ErrorType, ValidationError } from "@/core/errors";
import type { AppEnv } from "@/http/context";

/**
 * Factory for feature routers that hooks zod validation failures into our
 * standard ValidationError shape. Use instead of `new OpenAPIHono<AppEnv>()`
 * so that invalid request bodies produce the same ErrorResponse as
 * hand-thrown ValidationErrors do.
 */
// biome-ignore lint/nursery/useExplicitType: OpenAPIHono<AppEnv> generic chain is the intended inferred type
export function createFeatureRouter() {
  return new OpenAPIHono<AppEnv>({
    // biome-ignore lint/nursery/useExplicitType: result type is an inferred generic from @hono/zod-openapi
    defaultHook: (result): void => {
      if (!result.success) {
        const issue = result.error.issues[0];
        const message = issue
          ? `${issue.path.join(".") || "validation"}: ${issue.message}`
          : "Validation failed";
        throw new ValidationError(message, { cause: result.error });
      }
    },
  });
}

const errorResponseSchema = z
  .object({
    requestId: z.uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    code: z.number().int().openapi({ example: 400 }),
    message: z.string().openapi({ example: "Validation failed" }),
    type: z.enum(ErrorType).openapi({ example: ErrorType.VALIDATION_ERROR }),
    path: z.string().openapi({ example: "/waitlist" }),
    timestamp: z.iso.datetime().openapi({ example: "2026-04-23T10:00:00.000Z" }),
  })
  .openapi("ErrorResponse");

type ContentJson<S> = { "application/json": { schema: S } };

export function jsonBody<S>(schema: S): ContentJson<S> {
  return { "application/json": { schema } };
}

export function errorResponse(description: string): {
  description: string;
  content: ContentJson<typeof errorResponseSchema>;
} {
  return { description, content: jsonBody(errorResponseSchema) };
}

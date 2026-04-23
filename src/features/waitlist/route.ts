import { createRoute, z } from "@hono/zod-openapi";
import { joinWaitlist } from "@/features/waitlist/service";
import { rateLimit } from "@/http/middleware/rate-limit";
import { createFeatureRouter, errorResponse, jsonBody } from "@/http/openapi";

const joinSchema = z
  .object({
    email: z.email().max(255).openapi({ example: "user@example.com" }),
  })
  .openapi("WaitlistJoinRequest");

const entrySchema = z
  .object({
    email: z.string().openapi({ example: "user@example.com" }),
    createdAt: z.iso.datetime().openapi({ example: "2026-04-23T10:00:00.000Z" }),
  })
  .openapi("WaitlistEntry");

const joinRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["waitlist"],
  summary: "Join waitlist",
  middleware: [rateLimit({ windowMs: 60_000, max: 5 })] as const,
  request: { body: { required: true, content: jsonBody(joinSchema) } },
  responses: {
    201: { description: "Joined waitlist", content: jsonBody(entrySchema) },
    400: errorResponse("Invalid email"),
    409: errorResponse("Email already on the waitlist"),
    429: errorResponse("Rate limit exceeded"),
  },
});

export const waitlistRoute = createFeatureRouter().openapi(joinRoute, async (c) => {
  const { email } = c.req.valid("json");
  const entry = await joinWaitlist(email);
  return c.json({ email: entry.email, createdAt: entry.createdAt.toISOString() }, 201);
});

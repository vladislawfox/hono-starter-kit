# core/ — conventions

`core/` holds **cross-cutting types and utilities** used by every layer above (`http/`, `infrastructure/`, `features/`). It is the foundation — it cannot know about adapters or domain logic.

## What belongs here

- Error types (`errors.ts`) — used by services, error handler, tests
- Logger setup (`logger.ts`) — used everywhere output needs to be structured
- Future: cross-cutting helpers like `assertNever`, `Brand<T>`, domain-less utilities

## What does NOT belong here

- DB access, Redis, HTTP clients → `src/infrastructure/`
- HTTP-layer primitives (context, middleware, route factories) → `src/http/`
- Domain models (users, waitlist entries) → `src/features/`
- Config loading → `src/config/`

Rule of thumb: if it needs to *import* from `@/config`, `@/http`, `@/infrastructure`, or `@/features` — it does **not** belong in `core/`. Core is a leaf that only imports from external packages and `@/config` (for env access like `LOG_LEVEL`).

## Extending the error hierarchy

Two ways to add a new error, picked by whether the `type` is shared:

### New category (rare)

A new HTTP status class that none of the eight built-ins cover. Add a subclass in `errors.ts`:

```ts
export class PaymentRequiredError extends AppError {
  constructor(message = "Payment required", options?: { cause?: unknown }) {
    super({ status: 402, type: ErrorType.PAYMENT_REQUIRED, message }, options);
    this.name = "PaymentRequiredError";
  }
}
```

Also add `PAYMENT_REQUIRED: "PAYMENT_REQUIRED"` to the `ErrorType` enum. Update `statusToType()` in `src/http/error-handler.ts` to map the status.

### New domain-specific type (common)

Lives in `src/features/<name>/errors.ts`, extends `AppError` directly (not a category). See `src/features/CLAUDE.md` for the pattern.

## `ErrorType` is public API

- **Never rename** an existing value — clients and logs key off these strings.
- **Never delete** a value — if a type becomes unused, leave it; removing breaks historical log queries.
- **Only add** new values, at the end of the `as const` block.

## Logger redaction paths

`src/core/logger.ts` has a `redact.paths` array for secrets. Every time you introduce a new kind of sensitive value, add its key(s) there **in the same commit**:

```ts
redact: {
  paths: [
    "password",
    "*.password",
    // your new secret:
    "stripeApiKey",
    "*.stripeApiKey",
  ],
},
```

Include the wildcard form (`*.foo`) to catch the key in nested objects (request/response bodies, payloads).

Do not log raw request headers as a blob — `req.headers.authorization` and `req.headers.cookie` are already redacted, but new auth schemes (`x-api-key`, `x-signature`) must be added explicitly.

## Keeping core/ small

When this folder starts growing beyond errors + logger + one or two leaf utilities, reconsider — likely something should have lived in `http/`, `infrastructure/`, or a feature. Core should change **rarely**; frequent edits here signal mis-categorization.

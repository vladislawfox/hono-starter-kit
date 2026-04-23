---
description: Run the full pre-PR gate, then create a conventional-commit (type(scope): description). Stop at first failure — never commit on red.
allowed-tools: Bash
model: haiku
---

Validate the working tree with the full pre-PR gate. Only if every step passes, stage the relevant files and create a single conventional-commit. If any step fails, report the failure and abort — do **not** commit.

## Step 1 — Confirm there is something to commit

Run `git status --porcelain=v1`. If it's empty, report **"Nothing to commit — working tree clean"** and exit. Do not create an empty commit.

## Step 2 — Validation suite (stop at first failure)

Run these in order. On any failure, print the last ~15 lines of the failing command's output, report which step failed, and **abort without committing**.

1. `bun run check:ci` — Biome lint (CI mode, no auto-fix).
2. `bun run typecheck` — TypeScript `--noEmit`.
3. `bun run check:cycles` — madge circular-import check.
4. `bun run check:deadcode` — knip (unused files, exports, dependencies).
5. `bun test` — integration tests against live Postgres.
6. `docker build -t hono-starter-kit:pr-check .` — Dockerfile build.

If step 5 fails because Postgres is unreachable, do NOT try to start Docker yourself — ask the user to run `bun run docker:up` and retry `/commit`.

## Step 3 — Analyze the diff

Run `git status` and `git diff HEAD` to understand what changed. Also run `git log --oneline -5` to match the repo's commit-message style.

Identify:

- **What changed** — added feature, bug fix, refactor, docs-only, CI/tooling, deps bump, etc.
- **Where it changed** — one feature folder, multiple layers, repo-wide config.
- **Whether the diff is cohesive** — if the diff spans clearly unrelated concerns (e.g. a feature change AND unrelated CI tweaks), **stop and ask the user whether to split into multiple commits**. Do not bundle unrelated concerns into one commit.

Reject (warn + exit) if the diff contains files that look like secrets: `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`, anything under `secrets/`.

## Step 4 — Draft the commit message

Format: `type(scope): description`

**`type`** (required) — pick one:

| Type | Use when |
|---|---|
| `feat` | new user-visible behavior (new route, new feature module, new flag) |
| `fix` | bug fix — restores intended behavior |
| `refactor` | internal restructure, no behavior change |
| `perf` | measurable performance improvement |
| `test` | tests only (or test infra) |
| `docs` | docs only (README, CLAUDE.md, code comments) |
| `build` | build system, Dockerfile, bundler config |
| `ci` | GitHub Actions, pre-commit hooks |
| `chore` | deps bumps, tool config, housekeeping that fits nothing above |
| `style` | formatting only (Biome usually catches this automatically — rare) |

**`scope`** (optional but preferred) — the smallest label that captures the area. Pick one:

- Feature name when the diff is inside `src/features/<name>/` — e.g. `waitlist`, `health`.
- Layer when the diff is inside `src/core/`, `src/http/`, `src/infrastructure/`, `src/config/` — use `core`, `http`, `infra`, `config`.
- Tooling area for non-`src/` changes — `ci`, `docker`, `deps`, `claude` (for `.claude/**`), `docs` (for `README.md` / top-level `CLAUDE.md`).
- Omit the scope (just `type: description`) only when the change is genuinely repo-wide and no single scope fits.

**`description`** — imperative, lowercase, no trailing period, under ~60 chars. Describe the *change*, not the implementation.

Good examples:
- `feat(waitlist): add email normalization on join`
- `fix(infra): handle pool exhaustion during readiness probe`
- `refactor(core): extract AppError serialization into helper`
- `ci: cache bun install between jobs`
- `chore(claude): rebrand agents away from template identity`
- `docs: document rate-limit custom key-generator pattern`

Bad examples (do not produce these):
- `feat: updated some files` — vague, no scope, tells nothing.
- `Fix bug.` — wrong case, trailing period, no scope.
- `feat(waitlist): Added email normalization on join` — not imperative, capitalized.

## Step 5 — Stage and commit

1. Stage files explicitly by name — `git add <file1> <file2> ...`. **Never** `git add -A` or `git add .` (can sweep in untracked secrets or unrelated noise).
2. Create the commit with a HEREDOC to preserve formatting:

   ```sh
   git commit -m "$(cat <<'EOF'
   type(scope): description
   EOF
   )"
   ```

3. Run `git status` after the commit to confirm it succeeded.

## Hard rules

- **Never pass `--no-verify`, `-n`, `--no-gpg-sign`.** The pre-commit hook is a second safety net. If it fails, fix the underlying issue and create a **new** commit — do not `--amend`.
- **Never push.** Stop after the local commit. The user decides when to push.
- **One commit per invocation.** If the diff should be multiple commits, stop and ask.
- **No Co-Authored-By trailer** unless the user asks for it — keep the commit message a clean single line.

## Output on success

Print:

```
✅ Committed: <type>(<scope>): <description>
Files: <N>
Pre-PR gate: lint, types, cycles, dead-code, <M> tests, docker build — all green
```

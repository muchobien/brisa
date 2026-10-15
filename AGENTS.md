# Brisa repository instructions

Read README.md, CONTRIBUTING.md, and the affected docs before changes. Use the
pinned pnpm version and the project-local Vite+ commands. Keep Cloudflare config
and generated types aligned. Do not print secrets or browser push subscriptions.

Use Conventional Commits and matching type/short-description working branches.
Do not commit local state, deployment-specific config, or generated secrets.

Run pnpm check, pnpm typecheck, pnpm test, pnpm test:e2e, pnpm build, and
git diff --check before finishing. Report any checks that could not run.

One deployment is one shared trusted workspace. Preserve the distinction between
management sessions and topic-scoped ingestion keys. New features must keep the
UI, API validation, persistent schema, and documentation consistent.

# Contributing

Use the pinned pnpm version and install dependencies from the lockfile. Run the
local setup in the README before developing. Use `pnpm exec vp` for Vite+ tools;
an older global `vp` installation is not required or used by package scripts.

Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, and
`git diff --check` before submitting changes. Check generated icons with
`pnpm icons` when the app mark changes. Regenerate Worker types with
`pnpm typegen` after editing bindings. They are generated from the config and
local secret names, and are not checked in.

Run `pnpm test:pwa` after service-worker, caching, manifest, or update-prompt
changes. It builds the app and tests its production PWA behavior. PWA configuration
lives in `vite.config.ts`; custom push handlers live in `src/pwa/sw.ts`.

Use typed request contracts in `shared/`, parameterized D1 queries, and explicit
authentication on new routes. Keep tokens, subscriptions, secrets, and message
bodies out of logs. Browser push endpoints are validated because the delivery
worker makes outbound requests to those endpoints.

Treat an installation as one shared workspace. Changes that introduce individual
users must also introduce ownership boundaries for every resource and delivery.

Use Conventional Commits for commits and PR titles, for example
`feat(push): add delivery status`. Working branches use `feat/short-description`,
`fix/short-description`, or another matching lowercase type. The default branch
is `main`.

The custom UI system lives in `src/design-system/`. Prefer existing tokens and
components. Preserve keyboard access, visible focus, reduced motion, readable
contrast, and the iPhone Home Screen onboarding instructions.

# Repository Guidelines

## Project Structure & Module Organization

This repository is a pnpm workspace for a LAN Werewolf game.

- `apps/web/`: React and Vite client. UI code lives in `src/`; browser-ready images belong in `public/assets/`.
- `apps/server/`: Fastify and Socket.IO server. Room state, network selection, runtime controls, and socket handlers live in `src/`.
- `packages/shared/`: Zod schemas, shared types, and client/server event contracts. Add cross-boundary payload definitions here before using them in either app.
- `tests/e2e/`: Playwright workflows spanning the host and mobile player views.
- `docs/`: product requirements, game rules, architecture, and the staged roadmap.
- `incoming-assets/`: source artwork awaiting integration; do not reference it directly from production UI.

Keep unit and integration tests next to their implementation as `*.test.ts`. Avoid committing generated `dist/`, Playwright output, or dependency directories.

## Build, Test, and Development Commands

Run commands from the repository root with Node.js 22 or newer:

- `corepack pnpm install`: install workspace dependencies.
- `corepack pnpm dev`: start the server and Vite client together.
- `corepack pnpm typecheck`: type-check shared, server, and web packages.
- `corepack pnpm test`: run all Vitest suites.
- `corepack pnpm test:e2e`: run Playwright with managed dev servers.
- `corepack pnpm build`: create production builds for all packages.
- `corepack pnpm check`: run type checks, Vitest, and production builds.
- `corepack pnpm check:all`: run the complete check plus Playwright.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, semicolons, and double quotes. Use `PascalCase` for React components and classes, `camelCase` for functions and variables, and descriptive kebab-case filenames such as `phase-clock.ts`. Name shared schemas `...Schema` and derive types with `z.infer`. No formatter or linter is configured, so preserve local formatting and rely on `typecheck`.

## Testing Guidelines

Use Vitest for schema, domain, HTTP, and Socket.IO behavior. Test public outcomes, authorization boundaries, reconnect behavior, and secret-data leakage. Use Playwright for complete multi-client workflows. Every behavioral change should include focused tests; run `corepack pnpm check:all` before review.

## Commit & Pull Request Guidelines

History currently uses Conventional Commit-style subjects, for example `chore: establish project baseline`. Continue with concise forms such as `feat: add player reconnect` or `fix: reject stale join tokens`.

Pull requests should explain the behavior changed, identify the roadmap stage, list verification commands, and note security or information-disclosure implications. Include screenshots for host or player UI changes and document any real-device LAN testing performed.

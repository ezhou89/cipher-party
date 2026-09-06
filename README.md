# Cipher Party

A private, account-free multiplayer word and picture association game built with React 19, TypeScript, Cloudflare Workers, and SQLite-backed Durable Objects.

## Architecture

- `apps/web`: React 19 + Vite client application
- `apps/worker`: Cloudflare Worker + SQLite Durable Object room actor
- `packages/game-core`: Pure deterministic rules and board generator (zero runtime I/O)
- `packages/protocol`: Zod command schemas and role-safe view projections

## Development

- `npm run dev`: Start local development servers for web and worker
- `npm run check`: Run docs check, formatting check, linting, typechecking, and tests
- `npm run build`: Build all workspaces
- `npm run test:e2e`: Run Playwright end-to-end tests

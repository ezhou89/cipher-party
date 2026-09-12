# Local development

This runbook starts Cipher Party's Connected Classic web app and Cloudflare Worker locally. No production deploy is performed by this milestone workflow.

## Prerequisites

- Node.js 22 or newer (`node --version`).
- pnpm 11.23.0 (`pnpm --version`), pinned by the repository's `packageManager`
  field. If `corepack --version` succeeds, run `corepack enable`; Corepack is
  bundled with Node.js from 14.19 through 24.x, but not with Node.js 25 or newer.
  If Corepack is absent, follow its
  [official installation guide](https://github.com/nodejs/corepack#how-to-install)
  and enable it, or install the pinned pnpm directly with
  `npm install --global pnpm@11.23.0`.
- Chromium and WebKit installed for the browser suite. After installing the
  locked dependencies, run `pnpm exec playwright install chromium webkit` once
  if the pinned browsers are not already present.

Wrangler authentication is needed for remote or deployment operations. It is not needed for the normal local unit-test loop, local Worker, or local browser suite.

## Install and run

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

The development command starts both processes:

- Web app: <http://127.0.0.1:5173>
- Worker: <http://127.0.0.1:8787>
- Proxied health check: <http://127.0.0.1:5173/api/health>

Use the web-app URL for play. Vite proxies same-origin `/api` HTTP and WebSocket traffic to the Worker. Stop both processes with `Ctrl+C` in the terminal running `pnpm run dev`.

## Verify

Run the repository checks and isolated multiplayer browser suite:

```bash
pnpm run check
pnpm run test:e2e
```

For release preparation, build first and run the preflight, or run the combined preliminary gate:

```bash
pnpm run build
pnpm run preflight
pnpm run check:release
```

`pnpm run preflight` expects `apps/web/dist` from the build. It validates the locked runtime and Cloudflare configuration, canonical documents, Milestone 1 binding boundary, and the real Room Durable Object expiry integration suite. `pnpm run check:release` also runs both configured Playwright projects.

The Worker dry run validates the production bundle and bindings without deploying:

```bash
pnpm --filter @cipher-party/worker exec wrangler deploy --dry-run --config wrangler.jsonc
```

Do not remove `--dry-run` as part of this milestone workflow. A real remote or production deployment is a separate, explicitly authorized operation and requires Wrangler authentication.

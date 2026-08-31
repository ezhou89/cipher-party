# Local development

This runbook starts Cipher Party's Connected Classic web app and Cloudflare Worker locally. No production deploy is performed by this milestone workflow.

## Prerequisites

- Node.js 22 or newer (`node --version`).
- npm, supplied with Node (`npm --version`).
- Chromium and WebKit installed for the browser suite. After `npm install`, install the pinned Playwright browsers once with `npx playwright install chromium webkit` if they are not already present.

Wrangler authentication is needed for remote or deployment operations. It is not needed for the normal local unit-test loop, local Worker, or local browser suite.

## Install and run

From the repository root:

```bash
npm install
npm run dev
```

The development command starts both processes:

- Web app: <http://127.0.0.1:5173>
- Worker: <http://127.0.0.1:8787>
- Proxied health check: <http://127.0.0.1:5173/api/health>

Use the web-app URL for play. Vite proxies same-origin `/api` HTTP and WebSocket traffic to the Worker. Stop both processes with `Ctrl+C` in the terminal running `npm run dev`.

## Verify

Run the repository checks and isolated multiplayer browser suite:

```bash
npm run check
npm run test:e2e
```

For release preparation, build first and run the preflight, or run the combined preliminary gate:

```bash
npm run build
npm run preflight
npm run check:release
```

`npm run preflight` expects `apps/web/dist` from the build. It validates the locked runtime and Cloudflare configuration, canonical documents, Milestone 1 binding boundary, and the real Room Durable Object expiry integration suite. `npm run check:release` also runs both configured Playwright projects.

The Worker dry run validates the production bundle and bindings without deploying:

```bash
npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc
```

Do not remove `--dry-run` as part of this milestone workflow. A real remote or production deployment is a separate, explicitly authorized operation and requires Wrangler authentication.

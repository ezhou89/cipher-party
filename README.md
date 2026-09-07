# Cipher Party

Cipher Party is a private, account-free multiplayer association game.

## Development

Prerequisites are Node.js 22 or newer and pnpm 11.23.0 (pinned by the
`packageManager` field). Install the locked dependencies and start the local web
and Worker processes:

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

Open the app at <http://127.0.0.1:5173>. The local Worker listens at <http://127.0.0.1:8787>; Vite proxies `/api` and WebSocket traffic from the app to it.

Run the repository quality gate with `pnpm run check`, the isolated multiplayer
browser suite with `pnpm run test:e2e`, and the preliminary release gate with
`pnpm run check:release`.

Wrangler authentication is needed for remote or deployment operations, not the normal local unit-test loop. Connected Classic's milestone workflow performs no production deploy.

See [Local development](docs/runbooks/local-development.md) for the reproducible
setup and [Connected Classic playtest](docs/runbooks/connected-classic-playtest.md)
for the pending four-human exit gate. The preserved Gemini/Antigravity source
is indexed in the [creative archive](creative/README.md), with scope and status
in the [creative handoff](docs/CREATIVE_HANDOFF.md).

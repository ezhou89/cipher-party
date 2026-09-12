# Local release quality and source binding

The provider-neutral gate is `pnpm run check:release`. It runs documentation, formatting, lint, types and ordinary tests; tracked-source classic complexity; sequential Istanbul coverage; builds and local Worker dry run; preflight; then local Chromium/WebKit E2E. It does not deploy or contact staging. Ordinary `pnpm run test` remains distinct from coverage. Run release checks sequentially in a checkout to avoid competing coverage/test-results writes.

## Measured ratchets

Measured on 2026-09-12 with `pnpm run check:complexity` and `pnpm run test:coverage`, using installed ESLint and Istanbul 4.1.11. These are automated coverage measurements, not proof of behavioral completeness or human acceptance.

| Scope        | Statements       | Branches         | Functions        | Lines            | Enforced floors (S/B/F/L) |
| ------------ | ---------------- | ---------------- | ---------------- | ---------------- | ------------------------- |
| game-core    | 97.52% (118/121) | 96.92% (63/65)   | 100% (23/23)     | 97.45% (115/118) | 97/96/100/97              |
| protocol     | 96.90% (94/97)   | 94.59% (70/74)   | 100% (19/19)     | 96.84% (92/95)   | 96/94/100/96              |
| web          | 91.16% (856/939) | 87.84% (730/831) | 91.62% (164/179) | 91.22% (842/923) | 91/87/91/91               |
| Worker       | 93.53% (897/959) | 91.20% (622/682) | 98.39% (184/187) | 93.73% (853/910) | 93/91/98/93               |
| root scripts | 80.59% (436/541) | 77.23% (319/413) | 92.39% (85/92)   | 80.65% (421/522) | 80/77/92/80               |

Each metric's initial floor is its measured percentage rounded down, enforced in the relevant Vitest config. Improve tests before intentionally raising floors; do not lower them to hide regressions. Reports live separately under ignored `coverage/{game-core,protocol,web,worker,root}`. Istanbul includes runtime `src/**/*.ts` (plus web TSX) and root `scripts/**/*.mjs`, including unimported matching files. Tests, specs, typecheck/declaration files, configs, generated files and fixtures are excluded; web additionally excludes `src/test/**` setup/helpers. Root coverage does not claim browser E2E coverage. Worker uses Istanbul, never V8; Cloudflare documents that distinction in its [test integration limitations](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/).

Classic complexity currently measures 444 functions, mean 3.43, maximum 36; 27 exceed 10. Git supplies tracked runtime paths only, excluding test/spec/typecheck/config, generated/fixture/helper paths and artifacts. Inline ESLint directives cannot disable this inventory. Scores above 10 are reported; new functions above 20 fail. Exactly six file/function exceptions are recorded in `scripts/complexity-baseline.json`: `GameWorkspace` 36, `permissionsFor` 34, `applyGameAction` 30, `authorize` 24, `ModerationPanel` 21, and `applyLobbyCommand` 21. These are classic scores, not modified-switch scores. Names are enclosing-function/class-qualified, independent of line numbers; anonymous siblings use deterministic ordinals. Missing, renamed, duplicate, ambiguous, stale (now at most 20), or increased exemptions fail. Reduce/remove exceptions alongside cohesive refactors, not score-only fragmentation.

## Source-bound staging entrypoint

Only an independently authorized live release should invoke `pnpm run deploy:staging`. It captures a clean full Git SHA S, runs a fresh complete local gate, verifies the same clean S, and calls the low-level build/deploy function with `expectedCommit: S`. The low-level function checks exact source before and after building. No reusable pass token or saved timestamp bypasses this sequence.

`pnpm run deploy:staging --dry-run` remains explicit, local and non-uploading; it builds and uses Wrangler's dry-run mode without claiming a completed live release gate. Direct `node scripts/deploy-staging.mjs` refuses live use and directs the operator to the guarded entrypoint; its explicit `--dry-run` is retained. This is an accidental-bypass guard, not protection against an operator deliberately invoking Wrangler or editing the code. No deployment is performed by the quality gates.

Subprocess pnpm resolves only through an absolute existing `npm_execpath`; invoke wrappers via pnpm. JavaScript entries run through the current Node executable; native entries run directly without a shell. Full-gate commands have a 30-minute timeout and a bounded output buffer. Wrappers discard subprocess output/errors and print fixed public diagnostics; inspect the individual local gate command for failure detail rather than publishing credential-bearing logs. A source change or failed gate requires a new complete pass.

## Optional clean-checkout verification

After committing, `pnpm run check:release:clean` requires clean committed source, creates its own temporary directory, clones the local repository without hardlinks, detaches at exactly S, frozen-installs, and runs only inner `check:release`. It verifies the checkout remains clean at S and removes only its own validated temporary directory. Ignored scratch/dependencies are not cloned; untracked non-ignored source blocks entry. The wrapper never deploys and is not included recursively in `check:release`.

Provision Node >=22, the declared pnpm version, dependency registry/cache access for a frozen install, and Playwright Chromium/WebKit with their OS dependencies before running. Local Worker/browser listeners must be permitted by the execution environment. Browser binaries may be installed separately with the repository's declared Playwright CLI; this gate does not silently provision system software or use a remote provider. The clean gate deliberately regenerates build outputs and dependencies instead of copying ignored state.

On failure, record command, exit status, source SHA and failing phase without credentials. Check source status first, then reproduce `pnpm install --frozen-lockfile` and the individual local gate in a clean disposable checkout. Cleanup is attempted on checkout/install/gate failures; an earlier gate failure remains primary if cleanup also fails. A cleanup failure requires inspection of task-prefixed temporary directories, never broad recursive removal. One development install retained obsolete web/Worker Vitest shims after the coverage peer graph changed; resolving the current local Vitest entrypoint isolated the issue. Correct the local installation or use the clean-checkout gate rather than changing application/test semantics to mask module-identity failures.

Hosted CI remains deferred until a repository/provider is selected. A green local or clean-checkout gate does not replace the four-human playtest, authorize staging deployment, or establish live multiplayer behavior. The human playtest remains NOT YET RUN.

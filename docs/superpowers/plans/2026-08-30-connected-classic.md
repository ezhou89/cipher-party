# Connected Classic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a deployable, account-free, two-team Classic game that a host, clue-givers, operatives, and spectators can complete across separate browsers with secure reconnects.

**Architecture:** A React/TypeScript DOM client connects through a Cloudflare Worker to one authoritative Durable Object per room. Pure deterministic rules live in game-core; validated commands and role-specific views live in protocol; the worker owns authorization, persistence, ticketed WebSockets, and per-seat broadcasting.

**Tech Stack:** Node.js 22 or newer, npm workspaces, React, TypeScript, Vite, Cloudflare Workers, SQLite-backed Durable Objects, Zod, Vitest, fast-check, Testing Library, and Playwright.

**Spec:** docs/superpowers/specs/2026-08-30-cipher-party-design.md

**Roadmap:** docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md

## Global Constraints

- Milestone 1 supports two teams, a 5×5 text board, and one board per room.
- Every team has exactly one clue-giver and at least one operative when play starts.
- A room allows at most 16 active players and 16 spectators.
- The server is authoritative; clients send commands and never replacement state.
- An accepted state-changing command persists before any broadcast.
- Unrevealed ownership is structurally absent from operative, host-only, and spectator projections.
- Clue-giver projections alone contain the full key.
- Room codes are six Crockford base-32 characters and are not authorization credentials; input aliases O/I/L normalize to 0/1, while generated codes never contain I, L, O, or U.
- Durable seat and host tokens are random 256-bit values, stored browser-locally, hashed server-side, and absent from URLs and logs.
- The UI uses React DOM and preserves one spatial card order across clients.
- The shipped fixture pack is original and franchise-neutral.
- R2, Workers AI, picture cards, Blitz, multi-team rules, and campaigns are not part of this plan.
- All package versions are resolved once during Task 1 and committed in package-lock.json.

---

## Planned file structure

Each file has one primary responsibility:

~~~text
.
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.base.json
├── eslint.config.js
├── prettier.config.js
├── .prettierignore
├── vitest.config.ts
├── playwright.config.ts
├── scripts/
│   ├── check-project-docs.mjs
│   └── check-project-docs.test.ts
├── apps/
│   ├── web/
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── app/App.tsx
│   │       ├── app/router.tsx
│   │       ├── components/
│   │       ├── features/home/
│   │       ├── features/lobby/
│   │       ├── features/game/
│   │       ├── lib/api.ts
│   │       ├── lib/room-socket.ts
│   │       ├── lib/seat-store.ts
│   │       ├── styles/globals.css
│   │       ├── styles/tokens.css
│   │       └── test/setup.ts
│   └── worker/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── wrangler.dev.jsonc
│       ├── wrangler.test.jsonc
│       ├── wrangler.jsonc
│       ├── src/index.ts
│       ├── src/env.ts
│       ├── src/auth/
│       ├── src/http/
│       ├── src/room/
│       └── test/
├── packages/
│   ├── game-core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── domain.ts
│   │       ├── random.ts
│   │       ├── board.ts
│   │       ├── reducer.ts
│   │       └── index.ts
│   └── protocol/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── commands.ts
│           ├── projections.ts
│           ├── transport.ts
│           └── index.ts
└── e2e/
    ├── helpers/room.ts
    └── connected-classic.spec.ts
~~~

packages/pack-format is intentionally absent until Milestone 2 creates the first pack schema.

## Cross-task interface map

- game-core exports domain IDs, createClassicBoard, createClassicGame, and applyGameAction.
- protocol imports game-core domain types and exports CommandEnvelopeSchema, ClientProjectionSchema, ServerMessageSchema, and projectRoomForSeat.
- worker imports both packages and exports RoomSession for pure authorization tests plus RoomDurableObject for Cloudflare integration.
- web imports protocol only. It never imports game-core reducers or authoritative state.
- All room mutations pass through RoomSession.dispatch(actor, envelope, now).
- Every state-bearing WebSocket message and command result includes protocolVersion or a revision as defined by its schema; token-bearing HTTP bootstrap responses use their explicit response schemas.

---

### Task 1: Repository scaffold and executable quality gate

**Files:**

- Create: package.json
- Create: tsconfig.base.json
- Create: eslint.config.js
- Create: prettier.config.js
- Create: .prettierignore
- Create: vitest.config.ts
- Create: .gitignore
- Create: README.md
- Create: scripts/check-project-docs.mjs
- Create: scripts/check-project-docs.test.ts
- Create: apps/web/package.json
- Create: apps/web/index.html
- Create: apps/web/tsconfig.json
- Create: apps/web/vite.config.ts
- Create: apps/web/src/main.tsx
- Create: apps/web/src/app/App.tsx
- Create: apps/web/src/styles/globals.css
- Create: apps/web/src/test/setup.ts
- Create: apps/worker/package.json
- Create: apps/worker/tsconfig.json
- Create: apps/worker/vitest.config.ts
- Create: apps/worker/wrangler.dev.jsonc
- Create: apps/worker/wrangler.jsonc
- Create: apps/worker/src/env.ts
- Create: apps/worker/src/index.ts
- Create: packages/game-core/package.json
- Create: packages/game-core/tsconfig.json
- Create: packages/game-core/src/index.ts
- Create: packages/protocol/package.json
- Create: packages/protocol/tsconfig.json
- Create: packages/protocol/src/index.ts

**Interfaces:**

- Consumes: AGENTS.md, docs/PROJECT_SNAPSHOT.md, roadmap, and approved spec.
- Produces: npm run check, npm run build, npm run dev, npm run test:e2e, and an HTTP GET /api/health endpoint.

- [x] **Step 1: Create the workspace manifests and shared configuration**

Use this root manifest:

~~~json
{
  "name": "cipher-party",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "npm run build -w @cipher-party/game-core && npm run build -w @cipher-party/protocol && npm run build -w @cipher-party/web && npm run build -w @cipher-party/worker",
    "check": "npm run check:docs && npm run format:check && npm run lint && npm run typecheck && npm run test",
    "check:docs": "node scripts/check-project-docs.mjs",
    "dev": "concurrently -k -n worker,web \"npm run dev -w @cipher-party/worker\" \"npm run dev -w @cipher-party/web\"",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "test": "npm run test --workspaces --if-present && vitest run --config vitest.config.ts",
    "test:e2e": "playwright test",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
~~~

Give each workspace a private ESM package name matching the interface map. Configure TypeScript strict mode, noUncheckedIndexedAccess, exactOptionalPropertyTypes, and DOM libraries only for apps/web. Configure production wrangler.jsonc with main set to src/index.ts, compatibility_date set to the implementation date, CANONICAL_ORIGIN set to http://127.0.0.1:5173 for local validation, and an ASSETS binding whose directory is ../web/dist, not_found_handling is single-page-application, and run_worker_first is ["/api/*"]. Create wrangler.dev.jsonc with the same main/date/vars but no ASSETS binding because Vite serves the SPA during local development. Env types CANONICAL_ORIGIN as string and ASSETS as optional Fetcher.

Use the root Vitest config only for scripts/**/*.test.ts. Use a Node-environment Worker Vitest config for src/**/*.test.ts and test/**/*.test.ts; Task 7 will switch that config to Cloudflare's current Workers plugin. Configure apps/web/vite.config.ts with React, jsdom tests using src/test/setup.ts, and this development proxy so HTTP and WebSocket E2E traffic follows the production same-origin shape:

~~~ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"]
  }
});
~~~

Keep canonical planning documents manually stable by adding AGENTS.md, docs/PROJECT_SNAPSHOT.md, and docs/superpowers/ to .prettierignore. They remain covered by the document checker and git diff --check.

Use these workspace scripts:

- web: dev runs vite; build runs tsc --noEmit then vite build; test initially runs vitest run --passWithNoTests; typecheck runs tsc --noEmit.
- worker: dev runs wrangler dev --config wrangler.dev.jsonc; build runs wrangler deploy --dry-run --config wrangler.jsonc; test initially runs vitest run --passWithNoTests; typecheck runs tsc --noEmit.
- game-core and protocol: test initially runs vitest run --passWithNoTests; build and typecheck each run tsc --noEmit.
- Remove --passWithNoTests from each workspace in the task that adds its first test: Task 2 for game-core/protocol, Task 6 for worker, and Task 9 for web.

All four workspace manifests use version 0.0.0, private true, type module, and source exports where applicable. Declare internal dependencies explicitly so npm links the workspaces: protocol depends on @cipher-party/game-core "*"; worker depends on @cipher-party/game-core "*" and @cipher-party/protocol "*"; web depends on @cipher-party/protocol "*". game-core and protocol export ./src/index.ts. Do not rely on undeclared transitive workspace imports.

- [x] **Step 2: Install the planned dependencies and commit the lockfile**

Run:

~~~bash
npm install -D typescript @types/node eslint @eslint/js typescript-eslint prettier concurrently vitest fast-check @playwright/test jsonc-parser
npm install -w @cipher-party/web react react-dom react-router-dom idb
npm install -D -w @cipher-party/web vite @vitejs/plugin-react @types/react @types/react-dom jsdom fake-indexeddb @testing-library/react @testing-library/user-event @testing-library/jest-dom
npm install -w @cipher-party/protocol zod
npm install -D -w @cipher-party/worker wrangler @cloudflare/workers-types @cloudflare/vitest-plugin
~~~

Expected: package-lock.json records one resolved dependency graph and npm reports no unresolved workspace.

- [x] **Step 3: Write the failing canonical-document test**

Create scripts/check-project-docs.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { verifyProjectDocs } from "./check-project-docs.mjs";

describe("verifyProjectDocs", () => {
  it("finds every canonical project context document", async () => {
    await expect(verifyProjectDocs(process.cwd())).resolves.toEqual({
      agentInstructions: true,
      snapshot: true,
      roadmap: true,
      activePlan: true,
      approvedSpec: true
    });
  });
});
~~~

- [x] **Step 4: Run the document test and observe the missing module failure**

Run:

~~~bash
npx vitest run scripts/check-project-docs.test.ts
~~~

Expected: FAIL because scripts/check-project-docs.mjs does not exist.

- [x] **Step 5: Implement the context-document checker**

Create scripts/check-project-docs.mjs:

~~~js
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const paths = {
  agentInstructions: "AGENTS.md",
  snapshot: "docs/PROJECT_SNAPSHOT.md",
  roadmap: "docs/superpowers/plans/2026-08-30-cipher-party-roadmap.md",
  activePlan: "docs/superpowers/plans/2026-08-30-connected-classic.md",
  approvedSpec: "docs/superpowers/specs/2026-08-30-cipher-party-design.md"
};

export async function verifyProjectDocs(root) {
  const result = {};
  for (const [name, relativePath] of Object.entries(paths)) {
    await access(resolve(root, relativePath));
    result[name] = true;
  }

  const agents = await readFile(resolve(root, paths.agentInstructions), "utf8");
  if (!agents.includes(paths.snapshot)) {
    throw new Error("AGENTS.md does not require the canonical project snapshot");
  }

  const snapshot = await readFile(resolve(root, paths.snapshot), "utf8");
  if (
    !snapshot.includes(paths.roadmap) ||
    !snapshot.includes(paths.activePlan) ||
    !snapshot.includes(paths.approvedSpec)
  ) {
    throw new Error("Project snapshot does not link the roadmap, active plan, and approved spec");
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await verifyProjectDocs(process.cwd());
  console.log("Canonical project documents verified");
}
~~~

- [x] **Step 6: Run the document test and checker**

Run:

~~~bash
npx vitest run scripts/check-project-docs.test.ts
npm run check:docs
~~~

Expected: one passing test and Canonical project documents verified.

- [x] **Step 7: Add the minimal web and worker shells**

The web App renders a heading and calls no game logic:

~~~tsx
export function App() {
  return (
    <main>
      <p className="eyebrow">Private multiplayer</p>
      <h1>Cipher Party</h1>
      <p>Connected Classic is being assembled.</p>
    </main>
  );
}
~~~

The worker exposes health and delegates all other requests to static assets:

~~~ts
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "cipher-party" });
    }
    return env.ASSETS?.fetch(request) ?? new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
~~~

- [x] **Step 8: Run the complete scaffold gate**

Run:

~~~bash
npm run format
npm run check
npm run build
npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc
~~~

Expected: formatting, docs check, lint, typecheck, tests, web build, and Worker dry-run all exit 0.

- [x] **Step 9: Commit Task 1**

~~~bash
git add .gitignore .prettierignore README.md package.json package-lock.json tsconfig.base.json eslint.config.js prettier.config.js vitest.config.ts scripts apps packages
git commit -m "chore: scaffold Cipher Party workspace"
~~~

Update docs/PROJECT_SNAPSHOT.md with the accepted commit, passing commands, and Task 2 as next.

---

### Task 2: Domain IDs and validated command protocol

**Files:**

- Modify: packages/game-core/package.json
- Create: packages/game-core/src/domain.ts
- Modify: packages/game-core/src/index.ts
- Create: packages/game-core/src/domain.test.ts
- Modify: packages/protocol/package.json
- Create: packages/protocol/src/commands.ts
- Create: packages/protocol/src/commands.test.ts
- Create: packages/protocol/src/transport.ts
- Modify: packages/protocol/src/index.ts

**Interfaces:**

- Consumes: no earlier runtime interface.
- Produces: TeamId, PlayerId, CardId, SeatRole, Ownership, CommandEnvelopeSchema, CommandResultSchema, CommandEnvelope, ClientCommand, and PROTOCOL_VERSION.

- [ ] **Step 1: Write failing domain and command-schema tests**

Test exact IDs and schema rejection:

~~~ts
import { describe, expect, it } from "vitest";
import { CommandEnvelopeSchema, PROTOCOL_VERSION } from "./index";

describe("CommandEnvelopeSchema", () => {
  it("accepts a valid submit clue command", () => {
    expect(
      CommandEnvelopeSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
        expectedRevision: 4,
        command: { type: "submit_clue", word: "Cosmic", count: 2 }
      })
    ).toMatchObject({ expectedRevision: 4 });
  });

  it.each([
    { word: "two words", count: 2 },
    { word: "", count: 2 },
    { word: "Cosmic", count: 0 }
  ])("rejects an invalid clue: %o", ({ word, count }) => {
    const result = CommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
      expectedRevision: 4,
      command: { type: "submit_clue", word, count }
    });
    expect(result.success).toBe(false);
  });
});
~~~

- [ ] **Step 2: Run the protocol tests and observe missing exports**

Run:

~~~bash
npm run test -w @cipher-party/protocol -- commands.test.ts
~~~

Expected: FAIL because CommandEnvelopeSchema and PROTOCOL_VERSION are not exported.

- [ ] **Step 3: Implement the shared domain vocabulary**

Define these exact unions in packages/game-core/src/domain.ts:

~~~ts
export const TEAM_IDS = ["red", "blue"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export type PlayerId = string;
export type CardId = string;
export type RoomCode = string;
export type SeatRole = "unassigned" | "clue-giver" | "operative" | "spectator";
export type Ownership = TeamId | "neutral" | "hazard";

export interface TextCard {
  id: CardId;
  label: string;
}
~~~

Export them through packages/game-core/src/index.ts.

- [ ] **Step 4: Implement the discriminated command schema**

In packages/protocol/src/commands.ts define:

~~~ts
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

const graphemeCount = (value: string) =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)).length;

const clueWord = z
  .string()
  .trim()
  .transform((value) => value.normalize("NFC"))
  .pipe(
    z
      .string()
      .min(1)
      .refine((value) => graphemeCount(value) <= 40, "Clue must be at most 40 graphemes")
      .regex(/^[\p{L}\p{M}\p{N}'’-]+$/u)
  );

export const ClientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("randomize_teams") }),
  z.object({ type: z.literal("assign_seat"), playerId: z.string().min(1), teamId: z.enum(["red", "blue"]).nullable() }),
  z.object({ type: z.literal("set_role"), playerId: z.string().min(1), role: z.enum(["unassigned", "clue-giver", "operative", "spectator"]) }),
  z.object({ type: z.literal("lock_room"), locked: z.boolean() }),
  z.object({ type: z.literal("start_board") }),
  z.object({ type: z.literal("submit_clue"), word: clueWord, count: z.number().int().min(1).max(9) }),
  z.object({ type: z.literal("challenge_clue") }),
  z.object({ type: z.literal("resolve_challenge"), decision: z.enum(["accept", "reject"]) }),
  z.object({ type: z.literal("nominate_card"), cardId: z.string().min(1) }),
  z.object({ type: z.literal("clear_nomination") }),
  z.object({ type: z.literal("confirm_reveal"), cardId: z.string().min(1) }),
  z.object({ type: z.literal("end_turn") }),
  z.object({ type: z.literal("pause_room") }),
  z.object({ type: z.literal("resume_room") })
]);

export const CommandEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  command: ClientCommandSchema
}).strict();

export type ClientCommand = z.infer<typeof ClientCommandSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
~~~

Make every object inside ClientCommandSchema strict so unknown or actor-authored fields are rejected rather than stripped. In transport.ts define stable result schemas and infer their types:

~~~ts
import { z } from "zod";

export const CommandErrorCodeSchema = z.enum([
  "invalid_command",
  "unauthorized",
  "wrong_phase",
  "stale_revision",
  "storage_failed",
  "room_locked",
  "room_full"
]);

export const CommandResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), revision: z.number().int().nonnegative() }).strict(),
  z.object({
    ok: z.literal(false),
    revision: z.number().int().nonnegative(),
    code: CommandErrorCodeSchema,
    message: z.string()
  }).strict()
]);

export type CommandErrorCode = z.infer<typeof CommandErrorCodeSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
~~~

- [ ] **Step 5: Run protocol and game-core tests**

Remove --passWithNoTests from the game-core and protocol test scripts now that both workspaces contain tests.

Run:

~~~bash
npm run test -w @cipher-party/game-core
npm run test -w @cipher-party/protocol
npm run typecheck -w @cipher-party/protocol
~~~

Expected: all tests pass and the protocol package resolves game-core types through the workspace.

- [ ] **Step 6: Commit Task 2 after the repository gate**

~~~bash
npm run check
git add packages/game-core packages/protocol
git commit -m "feat: define game commands and domain IDs"
~~~

Update the snapshot to Task 3.

---

### Task 3: Deterministic 5×5 Classic board generator

**Files:**

- Create: packages/game-core/src/random.ts
- Create: packages/game-core/src/board.ts
- Create: packages/game-core/src/board.test.ts
- Modify: packages/game-core/src/index.ts

**Interfaces:**

- Consumes: TextCard, CardId, TeamId, and Ownership.
- Produces: ClassicBoard, BoardCard, createClassicBoard(input), and countOwnership(board).

- [ ] **Step 1: Write failing distribution and determinism tests**

~~~ts
import { describe, expect, it } from "vitest";
import { createClassicBoard, type TextCard } from "./index";

const cards: TextCard[] = Array.from({ length: 40 }, (_, index) => ({
  id: "card-" + index,
  label: "Word " + index
}));

describe("createClassicBoard", () => {
  it("creates the approved 9/8/7/1 distribution", () => {
    const board = createClassicBoard({ cards, seed: "campaign-a/board-0", startingTeam: "red" });
    const counts = Object.values(board.cards).reduce<Record<string, number>>((result, card) => {
      result[card.owner] = (result[card.owner] ?? 0) + 1;
      return result;
    }, {});
    expect(board.order).toHaveLength(25);
    expect(new Set(board.order).size).toBe(25);
    expect(counts).toEqual({ red: 9, blue: 8, neutral: 7, hazard: 1 });
  });

  it("returns the same board for the same seed", () => {
    expect(createClassicBoard({ cards, seed: "same", startingTeam: "blue" })).toEqual(
      createClassicBoard({ cards, seed: "same", startingTeam: "blue" })
    );
  });

  it("does not mutate the source cards", () => {
    const before = structuredClone(cards);
    createClassicBoard({ cards, seed: "immutable", startingTeam: "red" });
    expect(cards).toEqual(before);
  });

  it("rejects fewer than 25 unique cards", () => {
    expect(() =>
      createClassicBoard({ cards: cards.slice(0, 24), seed: "short", startingTeam: "red" })
    ).toThrow("Classic board requires at least 25 unique cards");
  });
});
~~~

- [ ] **Step 2: Run the board test and observe the missing function**

~~~bash
npm run test -w @cipher-party/game-core -- board.test.ts
~~~

Expected: FAIL because createClassicBoard is not defined.

- [ ] **Step 3: Implement a documented deterministic random source**

In random.ts implement xmur3 seed hashing plus mulberry32:

~~~ts
function seedToUint32(seed: string): number {
  let hash = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^= hash >>> 16) >>> 0;
}

export function createSeededRandom(seed: string): () => number {
  let state = seedToUint32(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}
~~~

Document that the seed is cryptographically generated by the server while this PRNG exists only for replayable ordering.

- [ ] **Step 4: Implement Classic board creation**

Use these exported types and signature:

~~~ts
export interface BoardCard extends TextCard {
  owner: Ownership;
  revealed: boolean;
}

export interface ClassicBoard {
  order: CardId[];
  cards: Record<CardId, BoardCard>;
  startingTeam: TeamId;
}

export function createClassicBoard(input: {
  cards: readonly TextCard[];
  seed: string;
  startingTeam: TeamId;
}): ClassicBoard;
~~~

Validate unique IDs before sampling. Shuffle the card pool, take 25, build an ownership list of 9 starting-team values, 8 opposing-team values, 7 neutral values, and 1 hazard, shuffle ownership with a separately derived seed suffix, and zip it to the selected card order. Every card starts revealed false.

- [ ] **Step 5: Add property tests for invariant coverage**

Use fast-check to generate nonempty seeds and both starting teams. For every generated case assert 25 unique IDs, one hazard, seven neutral cards, nine starting-team targets, eight other-team targets, and no mutation of the 40-card input.

- [ ] **Step 6: Run focused and repository tests**

~~~bash
npm run test -w @cipher-party/game-core -- board.test.ts
npm run check
~~~

Expected: distribution, determinism, immutability, rejection, and property tests pass.

- [ ] **Step 7: Commit Task 3**

~~~bash
git add packages/game-core/src
git commit -m "feat: generate deterministic Classic boards"
~~~

Update the snapshot to Task 4.

---

### Task 4: Pure two-team Classic reducer

**Files:**

- Create: packages/game-core/src/reducer.ts
- Create: packages/game-core/src/reducer.test.ts
- Modify: packages/game-core/src/domain.ts
- Modify: packages/game-core/src/index.ts

**Interfaces:**

- Consumes: ClassicBoard, TeamId, PlayerId, and CardId.
- Produces: ClassicGameState, GameAction, createClassicGame(board), applyGameAction(state, action), and GameTransitionError.

- [ ] **Step 1: Write the failing happy-path reducer test**

Build a fixed board fixture and test clue, nomination, confirmation, and turn continuation:

~~~ts
it("continues after revealing the active team's target", () => {
  const game = createClassicGame(fixedBoard());
  const afterClue = applyGameAction(game, {
    type: "submit_clue",
    teamId: "red",
    word: "Cosmic",
    count: 2
  });
  const afterNomination = applyGameAction(afterClue, {
    type: "nominate_card",
    teamId: "red",
    playerId: "red-operative",
    cardId: "red-1"
  });
  const afterReveal = applyGameAction(afterNomination, {
    type: "confirm_reveal",
    teamId: "red",
    playerId: "red-operative",
    cardId: "red-1"
  });

  expect(afterReveal.phase).toBe("guess");
  expect(afterReveal.guessesRemaining).toBe(2);
  expect(afterReveal.board.cards["red-1"]?.revealed).toBe(true);
  expect(afterReveal.nomination).toBeNull();
});
~~~

- [ ] **Step 2: Write the failing outcome table**

Add explicit tests for:

- Neutral reveal: card reveals and turn advances to blue clue phase.
- Blue target revealed by red: card counts for blue and turn advances.
- Blue's final target revealed by red: blue wins immediately.
- Hazard revealed by red: blue wins with completion reason hazard.
- Red's final target revealed by red: red wins with completion reason targets.
- End turn: advances without reveal.
- Guess count plus one: count 2 starts with 3 guesses.
- Exhausted guesses: final allowed correct reveal advances the turn.
- Wrong team, wrong phase, unknown card, mismatched nomination, repeated reveal, and a clue count above the active team's remaining targets throw GameTransitionError with a stable reason.
- Challenge: changes guess to challenged; accept restores guess; reject advances the challenged team.
- Pause and resume: restore the exact prior playable phase.

- [ ] **Step 3: Run reducer tests and observe missing exports**

~~~bash
npm run test -w @cipher-party/game-core -- reducer.test.ts
~~~

Expected: FAIL because createClassicGame and applyGameAction do not exist.

- [ ] **Step 4: Define the reducer state and action union**

Use these exact phase and state fields:

~~~ts
export type PlayPhase = "clue" | "guess" | "challenged" | "paused" | "board_complete";

export interface ClassicGameState {
  board: ClassicBoard;
  phase: PlayPhase;
  resumePhase: Exclude<PlayPhase, "paused" | "board_complete"> | null;
  activeTeam: TeamId;
  clue: { word: string; count: number } | null;
  guessesRemaining: number;
  nomination: { playerId: PlayerId; cardId: CardId } | null;
  winner: TeamId | null;
  completionReason: "targets" | "hazard" | null;
}

export type GameAction =
  | { type: "submit_clue"; teamId: TeamId; word: string; count: number }
  | { type: "challenge_clue"; teamId: TeamId }
  | { type: "resolve_challenge"; decision: "accept" | "reject" }
  | { type: "nominate_card"; teamId: TeamId; playerId: PlayerId; cardId: CardId }
  | { type: "clear_nomination"; teamId: TeamId; playerId: PlayerId }
  | { type: "confirm_reveal"; teamId: TeamId; playerId: PlayerId; cardId: CardId }
  | { type: "end_turn"; teamId: TeamId }
  | { type: "pause" }
  | { type: "resume" };
~~~

- [ ] **Step 5: Implement transition helpers before the public reducer**

Implement:

~~~ts
function otherTeam(teamId: TeamId): TeamId {
  return teamId === "red" ? "blue" : "red";
}

function advanceTurn(state: ClassicGameState): ClassicGameState {
  return {
    ...state,
    phase: "clue",
    resumePhase: null,
    activeTeam: otherTeam(state.activeTeam),
    clue: null,
    guessesRemaining: 0,
    nomination: null
  };
}

function hasRevealedAllTargets(state: ClassicGameState, teamId: TeamId): boolean {
  return Object.values(state.board.cards)
    .filter((card) => card.owner === teamId)
    .every((card) => card.revealed);
}
~~~

GameTransitionError carries one reason from wrong_phase, wrong_team, invalid_count, unknown_card, missing_nomination, nomination_mismatch, already_revealed, or board_complete.

- [ ] **Step 6: Implement every GameAction branch**

applyGameAction must:

- Clone only the state and card being changed; never mutate input.
- Validate phase and team before changing data.
- Set guessesRemaining to clue count plus one.
- Reject a clue count greater than the active team's currently unrevealed target count.
- Keep only one shared nomination.
- Require confirm_reveal to match the current nominated card and active team; any authorized active operative may perform the separate confirmation, not only the nominator.
- Reveal the card before evaluating target completion.
- Advance after neutral/opposing reveal or exhausted guesses.
- Complete immediately on target victory or hazard.
- Preserve challenged clue state until resolved.
- Store and restore resumePhase for manual pause.

Use an exhaustive never check in the switch default so a future action cannot compile without a branch.

- [ ] **Step 7: Run reducer and property tests**

Add a fast-check action-sequence test that applies only generated legal actions and asserts:

- No revealed card becomes unrevealed.
- guessesRemaining never becomes negative.
- board_complete always has a winner and completionReason.
- Non-complete states have no winner.
- The input state remains unchanged after every action.

Run:

~~~bash
npm run test -w @cipher-party/game-core -- reducer.test.ts
npm run check
~~~

Expected: all outcome-table and invariant tests pass.

- [ ] **Step 8: Commit Task 4**

~~~bash
git add packages/game-core/src
git commit -m "feat: implement Classic game reducer"
~~~

Update the snapshot to Task 5.

---

### Task 5: Role-safe client projections

**Files:**

- Create: packages/protocol/src/projections.ts
- Create: packages/protocol/src/projections.test.ts
- Modify: packages/protocol/src/index.ts

**Interfaces:**

- Consumes: ClassicGameState, PlayerId, TeamId, SeatRole, Ownership, and CardId.
- Produces: PublicHistoryEntry, RoomProjectionSource, ViewerContext, PublicProjection, UnassignedProjection, OperativeProjection, ClueGiverProjection, SpectatorProjection, ClientProjectionSchema, and projectRoomForSeat(source, viewer).

- [ ] **Step 1: Write failing hidden-information tests**

Create a source with unrevealed red, blue, neutral, and hazard cards. Assert:

~~~ts
it.each([
  { role: "operative" as const, teamId: "red" as const, isHost: false },
  { role: "spectator" as const, teamId: null, isHost: false },
  { role: "operative" as const, teamId: "red" as const, isHost: true }
])("omits the key and unrevealed ownership for $role", (viewer) => {
  const projection = projectRoomForSeat(roomSource(), {
    playerId: "viewer",
    ...viewer
  });
  expect("key" in projection).toBe(false);
  expect(JSON.stringify(projection)).not.toContain('"hazard"');
  expect(
    projection.board?.cards.filter((card) => !card.revealed).every((card) => !("owner" in card))
  ).toBe(true);
});

it("gives a clue-giver the complete key", () => {
  const projection = projectRoomForSeat(roomSource(), {
    playerId: "red-clue",
    role: "clue-giver",
    teamId: "red",
    isHost: false
  });
  expect(projection.viewRole).toBe("clue-giver");
  expect(projection.key).toEqual(expect.objectContaining({ "hazard-1": "hazard" }));
});
~~~

Also test that a revealed public card exposes only its now-public owner and that host permission flags can coexist with any viewRole without adding a key.

- [ ] **Step 2: Run projection tests and observe missing exports**

~~~bash
npm run test -w @cipher-party/protocol -- projections.test.ts
~~~

Expected: FAIL because projectRoomForSeat is not defined.

- [ ] **Step 3: Define the projection source and public card types**

~~~ts
export interface SeatSummary {
  playerId: PlayerId;
  displayName: string;
  teamId: TeamId | null;
  role: SeatRole;
  connected: boolean;
}

export type PublicHistoryEntry =
  | { revision: number; at: string; type: "clue_submitted"; teamId: TeamId; word: string; count: number }
  | { revision: number; at: string; type: "clue_challenged"; teamId: TeamId }
  | { revision: number; at: string; type: "challenge_resolved"; decision: "accept" | "reject" }
  | { revision: number; at: string; type: "card_revealed"; teamId: TeamId; cardId: CardId; owner: Ownership }
  | { revision: number; at: string; type: "turn_ended"; teamId: TeamId }
  | { revision: number; at: string; type: "room_paused" | "room_resumed" };

export interface RoomProjectionSource {
  protocolVersion: number;
  code: string;
  inviteUrl: string;
  revision: number;
  roomPhase: "lobby" | "playing" | "complete";
  locked: boolean;
  seats: SeatSummary[];
  publicHistory: PublicHistoryEntry[];
  game: ClassicGameState | null;
}

export interface PublicCard {
  id: CardId;
  label: string;
  revealed: boolean;
  owner?: Ownership;
}

export interface ViewerContext {
  playerId: PlayerId;
  teamId: TeamId | null;
  role: SeatRole;
  isHost: boolean;
}
~~~

Only assign PublicCard.owner when revealed is true.

- [ ] **Step 4: Implement strict discriminated projection schemas**

Every projection shares:

~~~ts
interface ProjectionBase {
  protocolVersion: 1;
  revision: number;
  code: string;
  inviteUrl: string;
  roomPhase: "lobby" | "playing" | "complete";
  locked: boolean;
  viewer: ViewerContext;
  permissions: {
    configure: boolean;
    moderate: boolean;
    submitClue: boolean;
    challengeClue: boolean;
    nominate: boolean;
    confirmReveal: boolean;
    endTurn: boolean;
    resolveChallenge: boolean;
    pause: boolean;
    resume: boolean;
  };
  seats: SeatSummary[];
  publicHistory: PublicHistoryEntry[];
  board: {
    order: CardId[];
    cards: PublicCard[];
    activeTeam: TeamId;
    phase: PlayPhase;
    clue: { word: string; count: number } | null;
    guessesRemaining: number;
    nomination: { playerId: PlayerId; cardId: CardId } | null;
    winner: TeamId | null;
    completionReason: "targets" | "hazard" | null;
  } | null;
}
~~~

The discriminant and key rules are:

- viewRole operative: no key field.
- viewRole spectator: no key field and no operative permissions.
- viewRole unassigned: no key field and lobby-only permissions.
- viewRole clue-giver: required key containing every current card ID and Ownership.

Export ClientProjection as the union of the four view-role variants and PublicProjection as the spectator-safe variant intended for later shared-display reuse. Build each Zod object and every nested object with strict mode so an operative payload containing key fails schema parsing. Public history is capped at 100 entries and a card_revealed entry contains ownership only because that ownership is public at the same revision.

Derive every permission from current phase, active team, current seat role/team, connection state, and host authority. Rendering may hide controls based on these booleans, but RoomSession independently repeats authorization for every command.

- [ ] **Step 5: Implement projectRoomForSeat as an allowlist builder**

Construct a fresh DTO field by field. Do not spread RoomProjectionSource, ClassicGameState, or BoardCard into the result. Add a key only inside the clue-giver branch. Host powers set permissions.configure and permissions.moderate but do not alter viewRole.

- [ ] **Step 6: Add compile-time negative assertions**

Use @ts-expect-error in a type-only fixture to prove an OperativeProjection cannot be constructed with key and a ClueGiverProjection cannot be constructed without key. Run typecheck so both assertions are exercised.

- [ ] **Step 7: Run focused security and repository gates**

~~~bash
npm run test -w @cipher-party/protocol -- projections.test.ts
npm run typecheck -w @cipher-party/protocol
npm run check
~~~

Expected: all role cases pass; no non-clue-giver payload contains unrevealed ownership.

- [ ] **Step 8: Commit Task 5**

~~~bash
git add packages/protocol/src
git commit -m "feat: add role-safe room projections"
~~~

Update the snapshot to Task 6.

---

### Task 6: Authoritative room aggregate and lobby rules

**Files:**

- Modify: apps/worker/package.json
- Create: apps/worker/src/fixtures/neutral-words.ts
- Create: apps/worker/src/room/room-state.ts
- Create: apps/worker/src/room/room-session.ts
- Create: apps/worker/src/room/room-session.test.ts

**Interfaces:**

- Consumes: game-core board/reducer, protocol commands/results/projections.
- Produces: RoomState, RoomActor, createLobbyState(input), RoomSession.from(state), session.dispatch(actor, envelope, now), session.project(viewer), and session.snapshot().

- [ ] **Step 1: Add a failing lobby-start test**

Use four seats and the neutral fixture:

~~~ts
it("starts only when both teams have one clue-giver and one operative", async () => {
  const session = configuredSession();
  const result = await session.dispatch(
    hostActor(),
    envelope(0, { type: "start_board" }),
    new Date("2026-08-30T12:00:00Z")
  );
  expect(result).toEqual({ ok: true, revision: 1 });
  expect(session.snapshot().phase).toBe("playing");
  expect(session.snapshot().game?.board.order).toHaveLength(25);
});
~~~

Add rejection tests for a missing or duplicate clue-giver, missing operative, any disconnected/unassigned active seat, uneven teams by more than one, fewer than 25 fixture words, non-host start, assignment after play has started, and assigning an active role without a team. The host can move a disconnected lobby seat to spectator before starting.

- [ ] **Step 2: Add failing authorization and idempotency tests**

Cover:

- Only host: randomize_teams, assign_seat, set_role, lock_room, start_board, resolve_challenge, pause_room, resume_room.
- Connected active clue-giver only: submit_clue.
- Opposing clue-giver only: challenge_clue.
- Connected active operative only: nominate_card, clear_nomination, confirm_reveal, end_turn.
- expectedRevision mismatch returns stale_revision without mutation.
- Repeating the same commandId and payload returns the first result without a second mutation.
- Reusing a commandId with a different payload returns invalid_command.
- Processed-command memory keeps the newest 256 command results.

- [ ] **Step 3: Run room-session tests and observe missing implementation**

~~~bash
npm run test -w @cipher-party/worker -- room-session.test.ts
~~~

Expected: FAIL because RoomSession does not exist.

- [ ] **Step 4: Define persisted room state**

~~~ts
export interface RoomSeat {
  playerId: PlayerId;
  displayName: string;
  seatClass: "active" | "spectator";
  teamId: TeamId | null;
  role: SeatRole;
  connected: boolean;
  seatTokenHash: string;
}

export interface RoomState {
  schemaVersion: 1;
  protocolVersion: 1;
  code: RoomCode;
  inviteUrl: string;
  revision: number;
  phase: "lobby" | "playing" | "complete";
  locked: boolean;
  createdAt: string;
  lastActivity: string;
  boardSeed: string;
  startingTeam: TeamId;
  hostPlayerId: PlayerId;
  hostTokenHash: string;
  seats: RoomSeat[];
  game: ClassicGameState | null;
  publicHistory: PublicHistoryEntry[];
  connectionTickets: Array<{
    ticketHash: string;
    playerId: PlayerId;
    hostAuthority: boolean;
    expiresAt: number;
  }>;
  processedCommands: Array<{
    commandId: string;
    payloadDigest: string;
    result: CommandResult;
  }>;
}

export interface RoomActor {
  playerId: PlayerId;
  hostAuthority: boolean;
}
~~~

New active seats begin with role unassigned and seatClass active. Spectator joins begin with role spectator and seatClass spectator. Changing to spectator clears teamId and changes seatClass; changing back to unassigned, clue-giver, or operative requires an available active-seat slot. Clearing an active seat's team also resets its role to unassigned, and clue-giver/operative roles require a team. Derive startingTeam once from createSeededRandom(boardSeed + "/starting-team") so the first board starter comes from the cryptographic room seed rather than host choice. Initialize publicHistory, connectionTickets, and processedCommands as empty arrays.

- [ ] **Step 5: Add the original neutral fixture**

Export this exact franchise-neutral list as stable TextCard IDs neutral-001 through neutral-050 in order:

~~~ts
const labels = [
  "Lantern", "Orbit", "Harbor", "Velvet", "Compass", "Meadow", "Quartz", "Bridge",
  "Anchor", "Blossom", "Cabin", "Canyon", "Cedar", "Comet", "Copper", "Coral",
  "Crown", "Desert", "Echo", "Ember", "Feather", "Forest", "Fountain", "Glacier",
  "Hammer", "Horizon", "Island", "Ivory", "Journal", "Kite", "Lagoon", "Marble",
  "Meteor", "Mountain", "Needle", "Ocean", "Orchard", "Palace", "Pebble", "Pine",
  "Prism", "River", "Saddle", "Shadow", "Signal", "Summit", "Temple", "Thunder",
  "Willow", "Window"
] as const;

export const neutralWords: TextCard[] = labels.map((label, index) => ({
  id: `neutral-${String(index + 1).padStart(3, "0")}`,
  label
}));
~~~

Include no franchise names, characters, slogans, or artwork.

- [ ] **Step 6: Implement RoomSession dispatch**

Use this public shape:

~~~ts
export class RoomSession {
  static from(state: RoomState): RoomSession;
  dispatch(actor: RoomActor, envelope: CommandEnvelope, now: Date): Promise<CommandResult>;
  project(viewer: ViewerContext): ClientProjection;
  snapshot(): RoomState;
}
~~~

Dispatch order is exact:

1. Validate protocol version and envelope.
2. Check processedCommands by commandId.
3. Reject a payload digest mismatch.
4. Check expectedRevision.
5. Resolve actor.playerId to the current seat, derive its team/role/connected state, and authorize it; host commands additionally require hostAuthority and a matching hostPlayerId.
6. Validate lobby or gameplay preconditions.
7. Apply the lobby mutation or game-core action to a cloned state.
8. Increment revision and set lastActivity.
9. Cache the successful result and trim to 256 entries.
10. Replace the session state.

Hash the canonical JSON command payload with SHA-256 for payloadDigest.

randomize_teams shuffles active non-spectator player IDs with createSeededRandom(boardSeed + "/teams/" + revision), assigns them alternately to red and blue, and resets their roles to unassigned. It is one authoritative command and one revision.

For an accepted gameplay command, append the corresponding allowlisted PublicHistoryEntry after assigning the new revision and trim publicHistory to the newest 100 entries. Never copy a BoardCard or unrevealed owner into history; card_revealed records the owner only after the reveal transition makes it public.

- [ ] **Step 7: Map protocol commands to game-core actions**

Keep the mapping exhaustive:

- submit_clue maps actor.teamId, word, and count.
- challenge_clue maps actor.teamId.
- resolve_challenge maps decision.
- nominate_card and clear_nomination map actor identity and team.
- confirm_reveal maps actor identity, team, and card.
- end_turn maps actor.teamId.
- pause_room and resume_room map to pause and resume.

Do not let a command supply its own actor identity or team.

- [ ] **Step 8: Run room, projection, and core tests**

Remove --passWithNoTests from the Worker test script now that the workspace contains room-session tests.

~~~bash
npm run test -w @cipher-party/worker -- room-session.test.ts
npm run test -w @cipher-party/protocol -- projections.test.ts
npm run test -w @cipher-party/game-core
npm run check
~~~

Expected: authorization, lobby validation, idempotency, and complete reducer integration pass.

- [ ] **Step 9: Commit Task 6**

~~~bash
git add apps/worker/package.json apps/worker/src packages/game-core/src packages/protocol/src
git commit -m "feat: add authoritative room session"
~~~

Update the snapshot to Task 7.

---

### Task 7: SQLite-backed Durable Object persistence

**Files:**

- Modify: apps/worker/wrangler.jsonc
- Modify: apps/worker/wrangler.dev.jsonc
- Create: apps/worker/wrangler.test.jsonc
- Modify: apps/worker/src/env.ts
- Modify: apps/worker/tsconfig.json
- Create: apps/worker/src/room/room-storage.ts
- Create: apps/worker/src/room/room-durable-object.ts
- Modify: apps/worker/vitest.config.ts
- Create: apps/worker/test/tsconfig.json
- Create: apps/worker/test/room-durable-object.test.ts
- Modify: apps/worker/src/index.ts

**Interfaces:**

- Consumes: RoomState and RoomSession.
- Produces: env.ROOMS binding, RoomDurableObject.initialize(input), getSnapshot(), dispatch(actor, envelope), getProjection(viewer), and a 24-hour inactivity alarm.

- [ ] **Step 1: Write the failing persistence integration test**

Using cloudflare:test, obtain the same object by room code twice:

~~~ts
it("persists an accepted command before a new stub reads state", async () => {
  const id = env.ROOMS.idFromName("ABC234");
  const first = env.ROOMS.get(id);
  await first.initialize(roomInitialization("ABC234"));
  await first.dispatch(hostActor(), envelope(0, { type: "lock_room", locked: true }));

  const second = env.ROOMS.get(id);
  const snapshot = await second.getSnapshot();
  expect(snapshot.revision).toBe(1);
  expect(snapshot.locked).toBe(true);
});
~~~

Also test that concurrent initialize calls produce one initialized room and one already_initialized result without replacing tokens or seed. Add alarm tests proving activity reschedules expiry, an early alarm reschedules without deleting, and an alarm at lastActivity plus 24 hours closes sockets and clears the snapshot.

- [ ] **Step 2: Run the Worker integration test and observe the missing binding**

~~~bash
npm run test -w @cipher-party/worker -- room-durable-object.test.ts
~~~

Expected: FAIL because ROOM binding and RoomDurableObject are absent.

- [ ] **Step 3: Configure the SQLite-backed Durable Object**

Add the same Durable Object binding and migration to wrangler.jsonc, wrangler.dev.jsonc, and a new wrangler.test.jsonc. The test config has the same main, compatibility date, CANONICAL_ORIGIN, binding, and migration as development but no ASSETS binding:

~~~json
{
  "durable_objects": {
    "bindings": [
      {
        "name": "ROOMS",
        "class_name": "RoomDurableObject"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["RoomDurableObject"]
    }
  ]
}
~~~

Env exposes ROOMS as DurableObjectNamespace<RoomDurableObject>. Export the class by name from src/index.ts.

Replace the Task 1 Node-only Worker Vitest config with Cloudflare's current plugin configuration:

~~~ts
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" }
    })
  ],
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"]
  }
});
~~~

Add @cloudflare/vitest-plugin to the test tsconfig types so cloudflare:test is typechecked. Do not use the superseded pool-based configuration. Add a configuration-parity assertion that all three Wrangler files use the same compatibility date, Durable Object binding, and v1 SQLite migration.

- [ ] **Step 4: Implement the snapshot store**

room-storage.ts uses one key:

~~~ts
const SNAPSHOT_KEY = "room:snapshot";
export const ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

export class RoomStorage {
  constructor(private readonly storage: DurableObjectStorage) {}

  read(): Promise<RoomState | undefined> {
    return this.storage.get<RoomState>(SNAPSHOT_KEY);
  }

  write(state: RoomState): Promise<void> {
    return this.storage.transaction(async (transaction) => {
      await transaction.put(SNAPSHOT_KEY, state);
      await transaction.setAlarm(Date.parse(state.lastActivity) + ROOM_IDLE_TTL_MS);
    });
  }

  clear(): Promise<void> {
    return this.storage.deleteAll();
  }
}
~~~

- [ ] **Step 5: Implement RoomDurableObject RPC methods**

In the constructor, use blockConcurrencyWhile to load the snapshot once. initialize must write before exposing state. dispatch must:

1. Build RoomSession from the loaded snapshot.
2. Await dispatch with the Durable Object's current server time.
3. If revision changed, await storage.write(nextState).
4. Only then replace the in-memory state.
5. Return the result.

getProjection always derives a new allowlisted projection. getSnapshot is used by trusted Worker routes and tests only; it is never returned directly to a browser.

Every initialization, join, reconnect, and accepted command updates lastActivity before RoomStorage.write, so the same transaction stores the snapshot and reschedules the one room alarm. A passively open socket does not update lastActivity. alarm() reloads the snapshot and:

1. Returns when storage is already empty.
2. Reschedules for lastActivity plus ROOM_IDLE_TTL_MS when that deadline is still in the future.
3. Otherwise closes every ctx.getWebSockets() connection with code 1001 and reason Room expired, calls storage.deleteAll(), and clears the in-memory snapshot.

The compatibility date is later than 2026-02-24, so deleteAll also removes the active alarm. The handler is idempotent because alarms are delivered at least once.

- [ ] **Step 6: Add persistence-failure coverage**

Inject a RoomStorage interface in a pure adapter test. Make write reject and assert:

- dispatch returns storage_failed.
- the in-memory revision does not advance.
- no broadcast hook is called.

- [ ] **Step 7: Run Worker and repository gates**

~~~bash
npm run test -w @cipher-party/worker -- room-durable-object.test.ts
npm run check
npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc
~~~

Expected: Durable Object integration and dry-run binding validation pass.

- [ ] **Step 8: Commit Task 7**

~~~bash
git add apps/worker
git commit -m "feat: persist rooms in Durable Objects"
~~~

Update the snapshot to Task 8.

---

### Task 8: Account-free room, seat-token, and ticket HTTP APIs

**Files:**

- Modify: apps/worker/src/env.ts
- Create: apps/worker/src/auth/token.ts
- Create: apps/worker/src/auth/ticket.ts
- Create: apps/worker/src/http/json.ts
- Create: apps/worker/src/http/router.ts
- Create: apps/worker/src/http/schemas.ts
- Create: apps/worker/src/http/rooms.ts
- Modify: apps/worker/src/room/room-state.ts
- Modify: apps/worker/src/room/room-durable-object.ts
- Modify: apps/worker/src/index.ts
- Create: apps/worker/test/auth.test.ts
- Create: apps/worker/test/rooms-api.test.ts

**Interfaces:**

- Consumes: ROOM binding and room initialization/join methods.
- Produces: POST /api/rooms, POST /api/rooms/:code/join, POST /api/rooms/:code/tickets, randomToken(), hashToken(), verifyToken(), and one-use 60-second WebSocket tickets.

- [ ] **Step 1: Write failing token tests**

~~~ts
it("hashes without retaining the durable token", async () => {
  const token = randomToken();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const digest = await hashToken(token);
  expect(digest).not.toContain(token);
  await expect(verifyToken(token, digest)).resolves.toBe(true);
  await expect(verifyToken(randomToken(), digest)).resolves.toBe(false);
});
~~~

Verify randomToken produces 32 bytes encoded as base64url without padding and compare digest bytes in constant time.

- [ ] **Step 2: Write failing room API tests**

Cover:

- POST /api/rooms with displayName creates a six-character code and returns playerId, seatToken, and hostToken.
- Returned tokens do not appear in Location, inviteUrl, or serialized Durable Object snapshot.
- POST join creates a browser seat while unlocked.
- Duplicate display names are allowed because playerId is authoritative.
- Locked room returns 409 room_locked.
- An active join after play starts returns 409 room_in_progress; an explicitly requested spectator join remains allowed during play only while the room is unlocked.
- The seventeenth active seat returns 409 room_full while spectators remain allowed up to 16.
- A missing or expired room returns the same 404 room_unavailable shape without disclosing whether the code used to exist.
- Invalid control characters, blank names, and names longer than 24 grapheme clusters return 400.
- Ticket request requires Authorization: Bearer seatToken.
- Host authority requires X-Cipher-Host-Token in addition to the seat token.
- A ticket expires after 60 seconds and succeeds only once.

- [ ] **Step 3: Run auth/API tests and observe route failures**

~~~bash
npm run test -w @cipher-party/worker -- auth.test.ts rooms-api.test.ts
~~~

Expected: FAIL because the API routes do not exist.

- [ ] **Step 4: Implement token and display-name validation**

Use crypto.getRandomValues for token bytes and SHA-256 for hashes. Validate display names with:

~~~ts
export const DisplayNameSchema = z
  .string()
  .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value), "Display name has control characters")
  .transform((value) => value.trim().normalize("NFC"))
  .pipe(
    z
      .string()
      .min(1)
      .refine(
        (value) =>
          Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value))
            .length <= 24,
        "Display name is too long"
      )
  );
~~~

Generate room codes from the 32-character Crockford alphabet 0123456789ABCDEFGHJKMNPQRSTVWXYZ. Normalize input to uppercase, map O to 0 and I/L to 1, and reject every other character. Retry a claimed code without returning whether another private room exists.

- [ ] **Step 5: Extend the Durable Object with seat methods**

Add trusted RPC methods:

~~~ts
initialize(input: {
  code: string;
  hostPlayerId: string;
  hostDisplayName: string;
  inviteUrl: string;
  seatTokenHash: string;
  hostTokenHash: string;
  boardSeed: string;
}): Promise<{ ok: true } | { ok: false; code: "already_initialized" }>;

join(input: {
  playerId: string;
  displayName: string;
  seatTokenHash: string;
  asSpectator: boolean;
}): Promise<
  | { ok: true; revision: number }
  | { ok: false; code: "room_locked" | "room_in_progress" | "room_full" }
>;

issueTicket(input: {
  seatToken: string;
  hostToken: string | null;
  now: number;
}): Promise<{ ok: true; ticket: string; expiresAt: number } | { ok: false; code: "unauthorized" }>;
~~~

Store only ticket hashes, playerId, hostAuthority, and expiresAt in RoomState.connectionTickets. A ticket receives hostAuthority true only when both the seat token and host token verify for hostPlayerId. Prune expired tickets when issuing or consuming. Issuing a ticket is reconnect activity: update lastActivity and persist it with the ticket. Consuming a ticket deletes it in the same Durable Object transaction before the socket is accepted.

- [ ] **Step 6: Implement the HTTP routes**

Return JSON with stable shape:

~~~ts
interface CreateRoomResponse {
  code: string;
  inviteUrl: string;
  playerId: string;
  seatToken: string;
  hostToken: string;
}

interface JoinRoomResponse {
  code: string;
  playerId: string;
  seatToken: string;
}

interface TicketResponse {
  ticket: string;
  expiresAt: number;
}

interface ApiErrorResponse {
  error: {
    code: "invalid_request" | "room_unavailable" | "room_locked" | "room_in_progress" | "room_full" | "unauthorized";
    message: string;
  };
}
~~~

Build inviteUrl as new URL(`/room/${code}`, env.CANONICAL_ORIGIN).toString(); never derive it from an untrusted Host header. CANONICAL_ORIGIN is a validated absolute http(s) origin, uses http://127.0.0.1:5173 for local development, and is configured to the selected neutral domain before deployment. Strictly validate JSON content type and cap bootstrap request bodies at 4 KiB. Set Cache-Control: no-store on every token-bearing response. Never log bodies or authorization headers.

- [ ] **Step 7: Run API, security, and dry-run gates**

~~~bash
npm run test -w @cipher-party/worker -- auth.test.ts rooms-api.test.ts
npm run check
npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc
~~~

Expected: all creation, join, capacity, token, and ticket cases pass.

- [ ] **Step 8: Commit Task 8**

~~~bash
git add apps/worker
git commit -m "feat: add private room and ticket APIs"
~~~

Update the snapshot to Task 9.

---

### Task 9: Hibernating WebSockets and browser reconnect client

**Files:**

- Modify: packages/protocol/src/transport.ts
- Create: packages/protocol/src/transport.test.ts
- Modify: packages/protocol/src/index.ts
- Create: apps/worker/src/room/room-websocket.ts
- Modify: apps/worker/src/room/room-durable-object.ts
- Modify: apps/worker/src/index.ts
- Create: apps/worker/test/room-websocket.test.ts
- Create: apps/web/src/lib/api.ts
- Create: apps/web/src/lib/seat-store.ts
- Create: apps/web/src/lib/seat-store.test.ts
- Create: apps/web/src/lib/room-socket.ts
- Create: apps/web/src/lib/room-socket.test.ts
- Modify: apps/web/package.json

**Interfaces:**

- Consumes: one-use tickets, CommandEnvelopeSchema, RoomSession dispatch, and projectRoomForSeat.
- Produces: ServerMessageSchema, RoomSocket, RoomConnectionState, saveCredentials(), loadCredentials(), and DELETE-safe credential replacement.

- [ ] **Step 1: Write failing transport-schema tests**

Define examples for:

~~~ts
const projectionMessage = {
  type: "projection",
  projection: operativeProjection()
};

const commandResultMessage = {
  type: "command_result",
  commandId: "018f6c2e-6f44-7ef0-8000-000000000001",
  result: { ok: true, revision: 5 }
};

const errorMessage = {
  type: "error",
  code: "invalid_message",
  message: "Message did not match protocol"
};
~~~

Assert ServerMessageSchema accepts each valid message and rejects an operative projection with a key.

- [ ] **Step 2: Write failing WebSocket integration tests**

Cover:

- A valid one-use ticket upgrades with status 101.
- A reused or expired ticket returns 401.
- The first frame is the viewer's role-safe projection.
- A valid command returns command_result after persistence and broadcasts newly derived projections.
- Red clue-giver and red operative receive different JSON for the same revision.
- Disconnect and reconnect with a new ticket preserves playerId and gameplay state; presence revisions remain monotonic and converge for all clients.
- Closing an older socket after the same seat reconnects does not mark the newer socket offline.
- A malformed frame returns invalid_message without closing other sockets.
- A failed send to one socket does not roll back an accepted command or prevent projections reaching healthy sockets.

- [ ] **Step 3: Run the transport and socket tests**

~~~bash
npm run test -w @cipher-party/protocol -- transport.test.ts
npm run test -w @cipher-party/worker -- room-websocket.test.ts
~~~

Expected: FAIL because ServerMessageSchema and WebSocket handling are absent.

- [ ] **Step 4: Implement strict server messages**

~~~ts
export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("projection"),
    projection: ClientProjectionSchema
  }).strict(),
  z.object({
    type: z.literal("command_result"),
    commandId: z.string().uuid(),
    result: CommandResultSchema
  }).strict(),
  z.object({
    type: z.literal("error"),
    code: z.enum(["invalid_message", "ticket_expired", "internal_error"]),
    message: z.string()
  }).strict()
]);
~~~

Also export ClientMessageSchema as CommandEnvelopeSchema and infer both message types.

- [ ] **Step 5: Implement the Durable Object WebSocket upgrade**

The Worker forwards /api/rooms/:code/connect?ticket=VALUE to the named Durable Object through stub.fetch(request); the Durable Object fetch handler accepts only this upgrade path. Inside the object:

1. Validate and atomically consume the one-use ticket.
2. Create a WebSocketPair.
3. Accept the server socket with ctx.acceptWebSocket(server, [playerId]).
4. serializeAttachment with a new connectionId, playerId, and hostAuthority only.
5. Mark the seat connected, advance the presence revision and lastActivity, persist, and send a fresh projection.
6. Return the client socket with status 101.

Never serialize a durable token or hidden key in an attachment.

- [ ] **Step 6: Implement per-seat command handling and broadcast**

webSocketMessage rejects non-text or text frames larger than 16 KiB, parses CommandEnvelopeSchema, constructs RoomActor only from the attachment playerId/hostAuthority, dispatches, awaits persistence, sends command_result to the sender, then calls broadcastProjections(). RoomSession derives current team, role, and connection state from its snapshot rather than trusting the attachment or message for those fields.

broadcastProjections iterates accepted sockets, deserializes each playerId, derives that player's ViewerContext from the current persisted seat plus attachment hostAuthority, calls projectRoomForSeat separately, and sends one projection message. It must not build one superset payload and filter it on the client.

Catch send failures per socket. An already-persisted command remains accepted, healthy sockets continue receiving projections, and the failed client recovers from a fresh snapshot after reconnect.

After WebSockets exist, the already-persistent join method also calls broadcastProjections only after its successful write so connected lobby members immediately see the new seat. Ticket issue/consume does not broadcast because it changes no public projection.

webSocketClose marks the seat disconnected only when a room snapshot still exists and no other accepted socket attachment has the same playerId. A changed presence value advances revision, persists before broadcasting, and does not extend lastActivity. A close delivered after the expiry alarm cleared storage is a no-op. Hibernation itself does not close sockets.

- [ ] **Step 7: Write failing IndexedDB credential tests**

Use the idb and fake-indexeddb dependencies already locked in Task 1.

Test:

- Saving code, playerId, seatToken, and optional hostToken can be loaded after a new store instance.
- Replacing a recovered seat overwrites old tokens.
- Removing one room does not remove another.
- No credential is written to localStorage or URL helpers.

Import fake-indexeddb/auto from apps/web/src/test/setup.ts before running these tests.

- [ ] **Step 8: Implement the credential store**

~~~ts
export interface SeatCredentials {
  code: string;
  playerId: string;
  seatToken: string;
  hostToken?: string;
}

export interface SeatStore {
  get(code: string): Promise<SeatCredentials | undefined>;
  put(credentials: SeatCredentials): Promise<void>;
  delete(code: string): Promise<void>;
}
~~~

Use an IndexedDB database named cipher-party with version 1 and object store seats keyed by code.

- [ ] **Step 9: Write failing RoomSocket tests**

With fake fetch and WebSocket implementations, assert:

- connect first requests a ticket with Authorization header.
- X-Cipher-Host-Token appears only when stored.
- the durable token never appears in the WebSocket URL.
- projection frames update current projection and status.
- command envelopes use crypto.randomUUID and current revision.
- a second send is rejected while an earlier command is awaiting its authoritative result/projection.
- an unexpected close retries at 500 ms, 1 s, 2 s, then caps at 5 s.
- close called by the user cancels retries.

- [ ] **Step 10: Implement RoomSocket**

Expose:

~~~ts
export type RoomConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export class RoomSocket {
  connect(credentials: SeatCredentials): Promise<void>;
  send(command: ClientCommand): string;
  close(): void;
  subscribe(listener: (state: {
    connection: RoomConnectionState;
    projection: ClientProjection | null;
    lastResult: CommandResult | null;
  }) => void): () => void;
}
~~~

Reject send while no projection or socket exists or another command is in flight. Use the projection revision as expectedRevision. Clear the in-flight command only after its command_result and a projection at least as new as that result have both arrived. On stale_revision, wait for the server's fresh projection before allowing another command.

- [ ] **Step 11: Run socket, client, and repository gates**

Remove --passWithNoTests from the web test script now that the workspace contains credential and socket tests.

~~~bash
npm run test -w @cipher-party/worker -- room-websocket.test.ts
npm run test -w @cipher-party/web -- seat-store.test.ts room-socket.test.ts
npm run check
~~~

Expected: tickets, role-specific broadcast, reconnect, IndexedDB, and retry behavior pass.

- [ ] **Step 12: Commit Task 9**

~~~bash
git add package.json package-lock.json apps packages/protocol
git commit -m "feat: connect rooms over secure WebSockets"
~~~

Update the snapshot to Task 10.

---

### Task 10: Landing, join, and authoritative lobby UI

**Files:**

- Create: apps/web/src/app/router.tsx
- Modify: apps/web/src/app/App.tsx
- Create: apps/web/src/features/home/HomePage.tsx
- Create: apps/web/src/features/home/HomePage.test.tsx
- Create: apps/web/src/features/lobby/RoomPage.tsx
- Create: apps/web/src/features/lobby/LobbyView.tsx
- Create: apps/web/src/features/lobby/LobbyView.test.tsx
- Create: apps/web/src/features/lobby/useRoom.ts
- Create: apps/web/src/components/ConnectionBadge.tsx
- Create: apps/web/src/components/TeamPanel.tsx
- Create: apps/web/src/components/CopyInviteButton.tsx
- Modify: apps/web/src/lib/api.ts
- Create: apps/web/src/styles/tokens.css
- Modify: apps/web/src/styles/globals.css
- Modify: apps/web/src/main.tsx

**Interfaces:**

- Consumes: room HTTP API, SeatStore, RoomSocket, ClientProjection, and lobby commands.
- Produces: routes / and /room/:code, create/join flows, responsive lobby, host team/role controls, and visible connection state.

- [ ] **Step 1: Write failing landing-page tests**

Test with Testing Library:

- Create Room and Join Room are visible by accessible name.
- Submitting a trimmed display name calls POST /api/rooms.
- Successful creation stores both tokens and navigates to /room/CODE.
- Joining by code normalizes lowercase and whitespace.
- API errors remain visible and focus the error summary.
- No pack builder, image, AI, Blitz, campaign, or public matchmaking control appears.

- [ ] **Step 2: Run the landing tests**

~~~bash
npm run test -w @cipher-party/web -- HomePage.test.tsx
~~~

Expected: FAIL because HomePage and routing are absent.

- [ ] **Step 3: Implement the neutral app shell and landing flow**

Use semantic form controls and these design tokens:

~~~css
:root {
  color-scheme: dark;
  --color-ink: #081522;
  --color-panel: #102638;
  --color-paper: #f4ebd8;
  --color-text: #f8f6ef;
  --color-muted: #9fb2bf;
  --color-red: #e75d5d;
  --color-blue: #4f91e8;
  --color-focus: #ffd66b;
  --radius-card: 0.8rem;
  --shadow-card: 0 0.65rem 1.4rem rgb(0 0 0 / 24%);
}
~~~

The layout uses a maximum readable width, 44 px minimum form targets, visible focus, and no theme skin.

- [ ] **Step 4: Write failing lobby projection tests**

Render lobby fixtures and assert:

- All connected seats and status appear.
- Team panels expose red, blue, and spectator/unassigned areas.
- Only host permissions render assignment, role, lock, and start controls.
- Start is disabled with an explicit reason until each team has one clue-giver and operative.
- A non-host clue-giver sees role/team but no moderation controls.
- Invite copy uses projection.inviteUrl, which contains the configured neutral origin and /room/CODE only.
- Reconnecting and offline statuses are announced through a polite live region.

- [ ] **Step 5: Run lobby tests and observe missing views**

~~~bash
npm run test -w @cipher-party/web -- LobbyView.test.tsx
~~~

Expected: FAIL because LobbyView is absent.

- [ ] **Step 6: Implement useRoom and RoomPage**

useRoom:

1. Reads code from route.
2. Loads browser credentials.
3. Shows join form when no credentials exist.
4. Creates one RoomSocket after credentials exist.
5. Subscribes and exposes projection, connection, lastResult, and send.
6. Closes the socket on unmount.

RoomPage renders LobbyView for roomPhase lobby and reserves GameView for Task 11.

- [ ] **Step 7: Implement lobby controls**

Host controls send exact protocol commands with no optimistic authoritative changes. Disable a control while its command result is pending. Render the next projection as truth. Random assignment sends one randomize_teams command after the host confirms; the server performs the deterministic balanced assignment in one revision.

- [ ] **Step 8: Add responsive and accessibility assertions**

Test keyboard submission, focus after errors, button accessible names, color-independent team labels, and no horizontal page overflow at 320 px. Snapshot only the public DOM; never snapshot credentials.

- [ ] **Step 9: Run web and repository gates**

~~~bash
npm run test -w @cipher-party/web -- HomePage.test.tsx LobbyView.test.tsx
npm run check
npm run build
~~~

Expected: landing and lobby tests pass; production bundle builds.

- [ ] **Step 10: Commit Task 10**

~~~bash
git add apps/web
git commit -m "feat: add private room lobby"
~~~

Update the snapshot to Task 11.

---

### Task 11: Role-aware Classic game board UI

**Files:**

- Create: apps/web/src/features/game/GameView.tsx
- Create: apps/web/src/features/game/GameView.test.tsx
- Create: apps/web/src/features/game/BoardGrid.tsx
- Create: apps/web/src/features/game/BoardCard.tsx
- Create: apps/web/src/features/game/CluePanel.tsx
- Create: apps/web/src/features/game/GuessPanel.tsx
- Create: apps/web/src/features/game/TeamScore.tsx
- Create: apps/web/src/features/game/GameHistory.tsx
- Create: apps/web/src/features/game/PrivacyVeil.tsx
- Create: apps/web/src/features/game/BoardResult.tsx
- Create: apps/web/src/components/ConfirmDialog.tsx
- Modify: apps/web/src/features/lobby/RoomPage.tsx
- Modify: apps/web/src/styles/globals.css

**Interfaces:**

- Consumes: ClientProjection and useRoom.send.
- Produces: spatial 5×5 board, clue submission, clue challenge, nomination/confirmation, end-turn, pause/resume, bounded public history, privacy veil, and board result.

- [ ] **Step 1: Write failing public-board tests**

Assert:

- 25 cards render in projection order.
- Unrevealed operative cards contain label and nomination state but no ownership label, class, data attribute, accessible description, or hidden DOM node.
- Revealed cards expose their public owner using color, symbol, pattern, and text.
- Spectators have no clue, nomination, confirmation, or moderation controls.
- Current team, phase, clue, remaining guesses, and connection state are visible.
- Public clue, challenge, reveal, turn-end, pause, and resume events render newest-last without exposing unrevealed ownership.

- [ ] **Step 2: Write failing clue-giver tests**

Assert:

- The clue-giver receives all ownership indicators from projection.key.
- The key is visible only when PrivacyVeil is open.
- Closing the veil removes ownership text and classes from the rendered board, not merely opacity-hides them.
- The active clue-giver can submit one valid word and count.
- An inactive clue-giver can challenge after a clue exists.
- Client-side validation mirrors the protocol but server errors still render.

- [ ] **Step 3: Write failing operative interaction tests**

Assert:

- Active operatives can nominate an unrevealed card.
- A separate confirmation dialog names the nominated card.
- Confirm sends confirm_reveal with the same card ID.
- Cancel sends no reveal.
- Inactive operatives cannot nominate.
- End Turn requires confirmation when guesses remain.
- A revealed or non-nominated card cannot be confirmed.

- [ ] **Step 4: Run GameView tests and observe missing components**

~~~bash
npm run test -w @cipher-party/web -- GameView.test.tsx
~~~

Expected: FAIL because GameView and board components do not exist.

- [ ] **Step 5: Implement BoardGrid and BoardCard with safe props**

BoardCard accepts only:

~~~ts
export interface BoardCardProps {
  card: PublicCard;
  keyOwner?: Ownership;
  nominated: boolean;
  disabled: boolean;
  onNominate?: (cardId: string) => void;
}
~~~

GameView passes keyOwner only when projection.viewRole is clue-giver and the privacy veil is open. The operative branch never reads a key property.

Use CSS grid-template-columns repeat(5, minmax(0, 1fr)). Preserve DOM order. At narrow widths, cards use compact typography and open the full-size confirmation dialog; the page itself must not reorder or horizontally overflow.

- [ ] **Step 6: Implement clue and guess panels**

CluePanel renders based on permissions.submitClue and permissions.challengeClue. GuessPanel renders based on permissions.nominate, permissions.confirmReveal, and permissions.endTurn. Challenge resolution and pause/resume use their dedicated permission fields. Every action calls send with a protocol command and waits for the authoritative projection. Do not decrement guesses or reveal cards optimistically.

- [ ] **Step 7: Implement challenge, pause, and result states**

- Challenged phase shows the disputed clue and host accept/reject controls.
- Paused phase disables game actions and shows host resume.
- Board complete shows winner and targets/hazard reason.
- GameHistory renders the allowlisted publicHistory entries and labels revealed ownership as public result data.
- No rematch or campaign control is included in Milestone 1.

- [ ] **Step 8: Add keyboard and live-region coverage**

Verify cards are reachable in grid order, Enter opens nomination, Escape closes confirmation, focus returns to the card, and reveal/turn changes announce through one polite live region without rereading all 25 cards.

- [ ] **Step 9: Run game UI and repository gates**

~~~bash
npm run test -w @cipher-party/web -- GameView.test.tsx
npm run check
npm run build
~~~

Expected: all role, privacy veil, interaction, keyboard, and build checks pass.

- [ ] **Step 10: Commit Task 11**

~~~bash
git add apps/web
git commit -m "feat: add role-aware Classic board"
~~~

Update the snapshot to Task 12.

---

### Task 12: Complete multiplayer browser flow and hidden-data regression

**Files:**

- Create: playwright.config.ts
- Create: e2e/helpers/room.ts
- Create: e2e/connected-classic.spec.ts
- Modify: apps/web/src/features/lobby/LobbyView.tsx
- Modify: apps/web/src/features/game/GameView.tsx
- Modify: package.json

**Interfaces:**

- Consumes: all Milestone 1 HTTP, WebSocket, lobby, and game interfaces.
- Produces: one automated full-board proof across isolated browser contexts and a captured-frame hidden-data regression.

- [ ] **Step 1: Configure a deterministic local E2E environment**

Playwright webServer runs npm run dev and waits for http://127.0.0.1:5173/api/health through the Vite proxy. Use:

~~~ts
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "webkit-mobile", use: devices["iPhone 15"] }
  ]
});
~~~

Install the two planned local browser engines once before the first E2E run:

~~~bash
npx playwright install chromium webkit
~~~

- [ ] **Step 2: Write the failing room-setup helper**

e2e/helpers/room.ts creates isolated contexts for:

- Host and red clue-giver.
- Red operative using a phone viewport.
- Blue clue-giver.
- Blue operative.
- Spectator.

It creates the room, joins each context, uses host controls to assign teams/roles, locks, and starts. Return pages and room code.

- [ ] **Step 3: Write the failing full-board test**

The test:

1. Reads red target labels from the red clue-giver view while its privacy veil is open.
2. Confirms the red operative and spectator DOM plus captured socket frames contain no key and no unrevealed owner fields.
3. Submits a clue count that permits all remaining red targets.
4. Nominates and confirms one red target.
5. Refreshes the red operative page and waits for the same player and turn, then for all clients to converge on a newer monotonic revision.
6. Reveals the remaining red targets.
7. Asserts every context sees red as winner with targets reason.
8. Asserts one command result exists per reveal command ID.
9. Asserts public history contains one public card_revealed entry per reveal and no duplicate entries after refresh.

- [ ] **Step 4: Add failure-path browser cases**

Cover:

- Wrong room code shows a focused error.
- Locked room rejects a late active join.
- Spectator can join when allowed but cannot invoke game commands.
- Canceling a reveal leaves the card unrevealed.
- Refreshing after a socket disconnect requests a new ticket and restores the same seat.

- [ ] **Step 5: Run E2E and observe the first real failure**

~~~bash
npm run test:e2e -- --project=chromium
~~~

Expected: FAIL at the first missing selector, proxy, presence, or synchronization behavior. Record the exact failure in the task handoff before changing implementation.

- [ ] **Step 6: Make only the minimal integration fixes**

Fix the observed failures without changing protocol or rule semantics. Add stable accessible labels before adding test-only selectors. If a test-only identifier is unavoidable, use data-testid only on the room code and connection revision, never on hidden ownership.

- [ ] **Step 7: Run desktop and mobile E2E**

~~~bash
npm run test:e2e
~~~

Expected: complete flow and failure paths pass in Chromium and mobile WebKit.

- [ ] **Step 8: Run the full milestone gate**

~~~bash
npm run check
npm run build
npm run test:e2e
npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc
git diff --check
~~~

Expected: every command exits 0.

- [ ] **Step 9: Commit Task 12**

~~~bash
git add playwright.config.ts e2e apps package.json package-lock.json
git commit -m "test: verify Connected Classic multiplayer flow"
~~~

Update the snapshot to Task 13 and record exact browser projects passed.

---

### Task 13: Milestone documentation, local playtest, and exit gate

**Files:**

- Modify: README.md
- Create: docs/runbooks/local-development.md
- Create: docs/runbooks/connected-classic-playtest.md
- Create: scripts/preflight.mjs
- Create: scripts/preflight.test.ts
- Modify: package.json
- Modify: docs/PROJECT_SNAPSHOT.md
- Modify: docs/superpowers/plans/2026-08-30-connected-classic.md

**Interfaces:**

- Consumes: verified Milestone 1 application.
- Produces: reproducible local setup, automated preflight, human playtest record, completed plan ledger, and Pack Studio planning handoff.

- [ ] **Step 1: Write the failing preflight test**

The preflight validates:

- Node major version is at least 22.
- package-lock.json exists.
- wrangler.jsonc contains ROOMS and new_sqlite_classes.
- wrangler.jsonc, wrangler.dev.jsonc, and wrangler.test.jsonc agree on compatibility date, CANONICAL_ORIGIN, the ROOMS class, and the v1 SQLite migration.
- Worker static asset directory resolves to apps/web/dist after build.
- CANONICAL_ORIGIN parses as an absolute http(s) origin with no path, query, or fragment.
- canonical project documents pass.
- no R2 or Workers AI binding exists yet.
- RoomDurableObject exposes the 24-hour inactivity alarm and expiry coverage passes.

Parse JSONC with the jsonc-parser dependency locked in Task 1. Test both a valid fixture and one missing the ROOMS binding.

- [ ] **Step 2: Run the preflight test and observe the missing module**

~~~bash
npx vitest run scripts/preflight.test.ts
~~~

Expected: FAIL because scripts/preflight.mjs does not exist.

- [ ] **Step 3: Implement preflight and add it to the quality gate**

Export runPreflight(root, nodeVersion) for tests and print a concise table when executed. Add npm run preflight and call it after build in npm run check:release.

~~~json
{
  "scripts": {
    "preflight": "node scripts/preflight.mjs",
    "check:release": "npm run check && npm run build && npm run preflight && npm run test:e2e"
  }
}
~~~

- [ ] **Step 4: Document exact local setup**

README and local-development.md include:

1. Node 22+ and npm prerequisites.
2. npm install.
3. npm run dev.
4. local URLs.
5. npm run check and npm run test:e2e.
6. Wrangler authentication is needed for remote/deployment operations, not the normal local unit loop.
7. No production deploy is performed by this milestone plan.

- [ ] **Step 5: Run a four-player human playtest**

Use four separate browser profiles or devices. Record:

- Invite-to-first-clue elapsed time.
- Any role-assignment confusion.
- Any accidental nomination/reveal.
- Card readability on the narrowest device.
- One refresh during guessing and observed recovery time.
- Whether all clients agree on every reveal and final winner.

Write results in connected-classic-playtest.md with date, devices/browsers, pass/fail per item, and concrete defects. Fix critical defects through a new failing regression test before continuing.

- [ ] **Step 6: Run the fresh final exit gate**

~~~bash
npm run check:release
npx wrangler deploy --dry-run --config apps/worker/wrangler.jsonc
git diff --check
git status --short
~~~

Expected:

- check:release exits 0.
- Worker dry run exits 0.
- git diff --check prints nothing.
- git status lists only the intentional documentation/snapshot changes for this task.

- [ ] **Step 7: Close the milestone ledger**

Mark every genuinely completed checkbox in this plan. Update docs/PROJECT_SNAPSHOT.md to:

- Project state: Connected Classic complete.
- Last accepted task: Task 13.
- Active milestone: Milestone 2 — Pack Studio planning.
- Active plan: no detailed Pack Studio plan exists yet.
- Verified commands: exact final commands and pass counts.
- Known blockers: human-playtest defects that were not critical, if any.
- Next action: write and review the Pack Studio detailed plan against the current repository.

- [ ] **Step 8: Commit Task 13**

~~~bash
git add README.md docs scripts package.json
git commit -m "docs: close Connected Classic milestone"
~~~

Do not begin Pack Studio implementation until its detailed plan is written, reviewed against the updated snapshot, and selected for execution.

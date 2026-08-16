# Murlan Depth & Durability Implementation Plan

> **STATUS: EXECUTED.** All eleven tasks are in the code — the integration
> harness and suites, bot seat fill, the stats/history/achievements tables and
> their endpoints, the profile screen, the table's screen-reader description
> and the bundle report. Verified by reading the code, not the checkboxes: the
> unticked `- [ ]` boxes below are how the plan was written, not a record of
> what is outstanding. Kept as a historical record. Open work lives in
> `docs/BACKLOG.md`.

**Goal:** Make the multiplayer layer provably correct under integration test, stop rooms stalling for want of players, and give players a reason to come back — without changing any game rule.

**Architecture:** No structural change. Task 1 makes the server modules loadable by Node's native TypeScript stripping so a real Socket.io server can be booted in tests. Tasks 2–4 build that integration suite. Task 5 fills empty seats with the AI that already exists. Tasks 6–9 add stats, match history and achievements on top of the persistence layer already in place. Tasks 10–11 finish accessibility and measure the bundle.

**Tech Stack:** Express 5, Socket.io 4, Drizzle + Postgres, Expo/React Native 0.81, `node --test` (no jest/vitest — Node strips TypeScript natively).

## Global Constraints

- **Runs on Replit.** Never add a build step requiring native compilation. Never change how the server starts. `PORT`, `DATABASE_URL`, `SESSION_SECRET` come from the environment.
- **The `session` table is pre-created.** `connect-pg-simple` runs with `createTableIfMissing: false`. Never drop or recreate it.
- **Baseline that must hold after every task:** `npx tsc --noEmit` clean, `npm test` green. Current baseline: **433 tests passing**.
- **No new runtime dependency** unless a task says so explicitly and justifies it against bundle size.
- **All user-facing strings go through `t()`** from `lib/i18n.ts`, with the key added to all three of `locales/it.ts`, `locales/en.ts`, `locales/sq.ts`. Italian is the source of truth; a missing key in any locale is a compile error.
- **Do not change game rules.** `docs/RULES.md` is settled. Bots play through the same validation path as humans.
- **Docs are part of the diff** — see `docs/BRIEF.md` §8 for which file owns which topic.
- **Commit after every task.**

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `server/*.ts` (imports only) | Make relative imports explicit so Node can load them | 1 |
| `tests/helpers/testServer.ts` | Boot/teardown a real server + throwaway DB schema for tests | 2 |
| `tests/integration/auth.test.ts` | Ticket auth: reject absent/expired/replayed | 3 |
| `tests/integration/gameplay.test.ts` | Hand secrecy, exchange bypass, seat vacancy, restart survival, malformed payloads | 4 |
| `lib/gameEngine.ts` | (read-only for this plan) — bots reuse `aiChoosePlay` | 5 |
| `server/socket.ts` | Bot seat fill at game start | 5 |
| `shared/schema.ts` | `user_stats`, `match_history`, `user_achievements` | 6 |
| `lib/achievements.ts` | Pure achievement definitions + evaluation | 7 |
| `server/stats.ts` | Write stats/history/achievements at game over | 8 |
| `app/(online)/profile.tsx` | Stats, history and achievements UI | 9 |
| `components/GameTable.tsx` | Screen-reader description of table state | 10 |
| `scripts/bundle-report.mjs` | Per-asset and per-dependency size report | 11 |

---

## Task 1: Make server modules loadable by Node

Integration tests cannot boot the server today. `node -e "import('./server/storage.ts')"` fails with `ERR_MODULE_NOT_FOUND` for two reasons: 13 relative imports omit the `.ts` extension, and 4 files use the `@shared/*` tsconfig path alias, which Node does not resolve. `tsx` and `esbuild` both accept explicit extensions and relative paths, so this change is invisible to `npm run server:dev` and `npm run server:build`.

**Files:**
- Modify: `server/index.ts`, `server/routes.ts`, `server/socket.ts`, `server/session.ts`, `server/storage.ts`, `server/db.ts`, `server/ticket.ts`, `server/cors.ts`, `server/socketSafety.ts`, `server/socketSchemas.ts`, `server/validate.ts`, `server/schemas.ts`, `server/logger.ts`, `server/onlineGameLogic.ts` — imports only
- Test: `tests/serverLoadable.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: every module under `server/` is importable via `await import("../server/<name>.ts")`

- [ ] **Step 1: Write the failing test**

```ts
// tests/serverLoadable.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// Integration tests boot the real server. That is only possible if every server
// module loads under Node's native type-stripping — no bundler, no path aliases.
const MODULES = [
  "logger", "db", "session", "cors", "validate", "schemas",
  "socketSchemas", "socketSafety", "ticket", "storage", "onlineGameLogic",
];

for (const name of MODULES) {
  test(`server/${name}.ts is loadable by plain Node`, async () => {
    const mod = await import(`../server/${name}.ts`);
    assert.ok(mod, `server/${name}.ts failed to load`);
  });
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd C:/Users/roton/murlan && node --test tests/serverLoadable.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND`.

Note: `db.ts`, `session.ts` and `storage.ts` construct a Postgres pool at module scope. If `DATABASE_URL` is unset they may throw a *different* error. That is fine at this step — you only need the test red for the import reason. If the pool is the blocker, set `DATABASE_URL` to any syntactically valid URL for the run; `pg` does not connect until a query is issued.

- [ ] **Step 3: Add explicit `.ts` extensions to every relative import under `server/`**

Every `from "./x"` becomes `from "./x.ts"`, and `from "../lib/x"` becomes `from "../lib/x.ts"`. Do not change any package import (`express`, `drizzle-orm`, …).

- [ ] **Step 4: Replace the `@shared/*` alias in `server/` with relative paths**

Four files: `server/db.ts`, `server/routes.ts`, `server/socket.ts`, `server/storage.ts`.

```ts
// before
import { users, rooms, roomPlayers, friends, activeGames } from "@shared/schema";
// after
import { users, rooms, roomPlayers, friends, activeGames } from "../shared/schema.ts";
```

Leave the `@shared/*` alias in `tsconfig.json` — client code still uses it.

- [ ] **Step 5: Run the test and the full baseline**

```bash
cd C:/Users/roton/murlan
node --test tests/serverLoadable.test.ts   # expect PASS
npx tsc --noEmit                            # expect clean
npm test                                    # expect 433 + 11 passing
```

- [ ] **Step 6: Verify the server still actually starts**

This is the risk in this task — an import change that satisfies Node but breaks `tsx` or `esbuild` would break Replit.

```bash
cd C:/Users/roton/murlan
npm run server:build          # esbuild must succeed
```

If `DATABASE_URL` and `SESSION_SECRET` are available, also run `npm run server:dev` and confirm it logs `express server serving on port …`, then stop it. If they are not available, say so in the report rather than claiming it was verified.

- [ ] **Step 7: Commit**

```bash
git add server tests/serverLoadable.test.ts
git commit -m "Make server modules loadable by plain Node

Explicit .ts extensions on relative imports, and relative paths instead of the
@shared alias, which Node cannot resolve. tsx and esbuild both accept this, so
the Replit run and build paths are unchanged. Required before any integration
test can boot the real server."
```

---

## Task 2: Test server harness

**Files:**
- Create: `tests/helpers/testServer.ts`
- Test: exercised by Tasks 3 and 4

**Interfaces:**
- Consumes: Task 1's loadable modules
- Produces:
  - `startTestServer(): Promise<TestServer>` where `TestServer = { url: string; port: number; stop(): Promise<void>; schema: string }`
  - `hasDatabase(): boolean`
  - `describeIfDb(name: string, fn: () => void): void` — skips the suite with a clear message when no database is configured

- [ ] **Step 1: Write the harness**

```ts
// tests/helpers/testServer.ts
import { createServer } from "node:http";
import pg from "pg";

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Integration tests need a real Postgres. Someone checking out the repo without
 * one must still be able to run `npm test`, so we skip rather than fail.
 */
export function skipMessage(): string {
  return "DATABASE_URL not set — skipping integration tests (unit tests still run)";
}

export interface TestServer {
  url: string;
  port: number;
  schema: string;
  stop(): Promise<void>;
}

/**
 * Boots the real Express + Socket.io app against a throwaway Postgres schema so
 * tests never touch development data. The schema is dropped on stop().
 */
export async function startTestServer(): Promise<TestServer> {
  const schema = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const admin = new pg.Pool({ connectionString: baseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  // Point the app at the throwaway schema via search_path, and at an ephemeral
  // port, before importing the server (module scope reads these).
  process.env.DATABASE_URL = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
  process.env.PORT = "0";
  process.env.SESSION_SECRET ??= "test-secret-not-for-production";

  const { createApp } = await import("../../server/testApp.ts");
  const { app, io } = await createApp();
  const server = createServer(app);
  io.attach(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    schema,
    async stop() {
      io.close();
      await new Promise<void>((r) => server.close(() => r()));
      const cleanup = new pg.Pool({ connectionString: baseUrl });
      await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      await cleanup.end();
      process.env.DATABASE_URL = baseUrl;
    },
  };
}
```

- [ ] **Step 2: Extract an app factory the harness can call**

`server/index.ts` currently builds the app and calls `listen()` inside a top-level IIFE, so importing it starts a server on the real port. Extract the wiring into `server/testApp.ts` exporting `createApp(): Promise<{ app: Express; io: SocketServer }>`, and have `server/index.ts` call it and then `listen()`. `server/index.ts` keeps sole responsibility for binding the port and installing shutdown handlers — do not move those.

Then run the schema push against the throwaway schema inside `startTestServer` before returning, using `drizzle-kit push` programmatically or by executing the DDL directly. If that proves awkward, create the tables with explicit SQL in the harness and note the duplication in the report.

- [ ] **Step 3: Verify the harness boots and tears down**

```bash
cd C:/Users/roton/murlan && node --test tests/integration/ 2>&1 | tail -20
```
Expected: either the suites run, or a clear skip message when `DATABASE_URL` is unset.

- [ ] **Step 4: Commit**

```bash
git add server/testApp.ts server/index.ts tests/helpers/testServer.ts
git commit -m "Add integration test harness booting the real server on a throwaway schema"
```

---

## Task 3: Auth integration tests

Every one of these maps to a defect that actually shipped in this codebase.

**Files:**
- Create: `tests/integration/auth.test.ts`

**Interfaces:**
- Consumes: `startTestServer`, `hasDatabase` from Task 2
- Produces: nothing

- [ ] **Step 1: Write the tests**

```ts
// tests/integration/auth.test.ts
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient } from "socket.io-client";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";

describe("socket authentication", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { await server.stop(); });

  async function register(username: string) {
    const res = await fetch(`${server.url}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "password123" }),
    });
    assert.equal(res.status, 200, await res.text());
    return { user: await res.json(), cookie: res.headers.get("set-cookie")! };
  }

  function connect(auth: Record<string, unknown>): Promise<{ ok: boolean; err?: string }> {
    return new Promise((resolve) => {
      const s = ioClient(server.url, { auth, transports: ["websocket"], reconnection: false });
      s.on("connect", () => { s.close(); resolve({ ok: true }); });
      s.on("connect_error", (e) => { s.close(); resolve({ ok: false, err: e.message }); });
    });
  }

  test("a socket with no credentials is rejected", async () => {
    const r = await connect({});
    assert.equal(r.ok, false);
  });

  test("a bare userId is rejected — this was a full impersonation vector", async () => {
    const { user } = await register("victim_a");
    const r = await connect({ userId: user.id });
    assert.equal(r.ok, false, "connecting with only a victim's userId must fail");
  });

  test("a valid ticket is accepted", async () => {
    const { cookie } = await register("holder_a");
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 200);
    const { ticket } = await res.json();
    const r = await connect({ ticket });
    assert.equal(r.ok, true, r.err);
  });

  test("a ticket cannot be replayed", async () => {
    const { cookie } = await register("holder_b");
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } });
    const { ticket } = await res.json();
    const first = await connect({ ticket });
    assert.equal(first.ok, true, first.err);
    const second = await connect({ ticket });
    assert.equal(second.ok, false, "a consumed ticket must not authenticate a second socket");
  });

  test("a forged ticket is rejected", async () => {
    const r = await connect({ ticket: "not.a.real.ticket" });
    assert.equal(r.ok, false);
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd C:/Users/roton/murlan && node --test tests/integration/auth.test.ts`
Expected: all pass (or a clean skip without `DATABASE_URL`). If the replay test fails, the single-use nonce set is broken — fix the server, not the test.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/auth.test.ts
git commit -m "Integration tests for socket ticket auth, including impersonation and replay"
```

---

## Task 4: Gameplay integrity integration tests

**Files:**
- Create: `tests/integration/gameplay.test.ts`

**Interfaces:**
- Consumes: Task 2's harness; the same `register`/`connect` helpers as Task 3 — extract them into `tests/helpers/client.ts` and import from both rather than copying

- [ ] **Step 1: Extract the shared client helpers**

Move `register` and an authenticated `connectAs(username)` into `tests/helpers/client.ts`, exporting:
- `register(server: TestServer, username: string): Promise<{ user: { id: string; username: string }; cookie: string }>`
- `connectAs(server: TestServer, username: string): Promise<{ socket: Socket; user: { id: string; username: string } }>` — registers, mints a ticket, connects

Update Task 3's file to import them.

- [ ] **Step 2: Write the tests**

Cover exactly these, each of which corresponds to a real fixed bug:

```ts
test("a player never receives another player's hand", async () => {
  // Two players in a started game. Assert the state each receives contains
  // its own cards and, for every other seat, handCount only — hand must be [].
});

test("play and pass are rejected during an active exchange phase", async () => {
  // Drive a rematch to the exchange phase, then emit game:play as the winner.
  // Assert a game:error and that the winner's hand is unchanged.
});

test("a malformed payload on any event does not kill the process", async () => {
  // Emit game:play with 42, game:reaction with no argument, room:join with
  // { code: 12345 }. Then assert a subsequent room:create still succeeds —
  // proving the process survived.
});

test("a vacated seat does not deadlock the table", async () => {
  // Start a game, hard-disconnect one player, wait past the grace period,
  // assert play continues and the turn advances past the vacated seat.
});
```

Write each one out fully. Where a test needs to wait for a socket event, use a
promise helper with a timeout rather than a bare sleep, so a hang fails loudly:

```ts
function waitFor<T>(socket: Socket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => { clearTimeout(timer); resolve(payload); });
  });
}
```

The grace-period test would otherwise take 60 seconds. Make the disconnect grace
and AFK timeouts configurable via environment variables read once at module scope in
`server/socket.ts` (defaulting to the current 60s and 30s), and set them low in tests.
Do not shorten the production defaults.

- [ ] **Step 3: Run, then run the whole suite**

```bash
cd C:/Users/roton/murlan
node --test tests/integration/gameplay.test.ts
npx tsc --noEmit && npm test
```

- [ ] **Step 4: Commit**

```bash
git add tests/ server/socket.ts
git commit -m "Integration tests for hand secrecy, exchange bypass, malformed payloads and seat vacancy"
```

---

## Task 5: Fill empty seats with bots

**Files:**
- Modify: `server/socket.ts` (the `room:start` handler), `server/socketSchemas.ts`, `app/(online)/room.tsx`
- Test: `tests/botFill.test.ts`, plus a case in `tests/integration/gameplay.test.ts`

**Interfaces:**
- Consumes: `aiChoosePlay` from `lib/gameEngine.ts` (already used by the seat-takeover path)
- Produces: `room:start` accepts `{ fillWithBots?: boolean; botDifficulty?: "easy" | "medium" | "hard" }`

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/botFill.test.ts — pure seat-assignment logic, extracted so it is testable
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeatRoster } from "../server/onlineGameLogic.ts";

test("empty seats are filled with bots up to maxPlayers", () => {
  const roster = buildSeatRoster(
    [{ seatIndex: 0, userId: "u1", username: "Ana" }],
    4,
    { fillWithBots: true, botDifficulty: "medium" }
  );
  assert.equal(roster.length, 4);
  assert.equal(roster.filter((r) => r.isBot).length, 3);
  assert.deepEqual(roster.map((r) => r.seatIndex), [0, 1, 2, 3]);
});

test("without fillWithBots the roster is only the humans", () => {
  const roster = buildSeatRoster(
    [{ seatIndex: 0, userId: "u1", username: "Ana" }],
    4,
    { fillWithBots: false }
  );
  assert.equal(roster.length, 1);
});

test("bot seats are excluded from match scoring", () => {
  const roster = buildSeatRoster([{ seatIndex: 0, userId: "u1", username: "Ana" }], 2, { fillWithBots: true });
  const scored = roster.filter((r) => !r.isBot).map((r) => r.userId);
  assert.deepEqual(scored, ["u1"]);
});
```

- [ ] **Step 2: Run it, expect failure** — `buildSeatRoster is not exported`.

- [ ] **Step 3: Implement `buildSeatRoster` in `server/onlineGameLogic.ts`**

```ts
export interface SeatEntry {
  seatIndex: number;
  userId: string;      // for bots, a synthetic "bot:<seat>" id
  username: string;
  isBot: boolean;
  difficulty?: "easy" | "medium" | "hard";
}

export function buildSeatRoster(
  humans: { seatIndex: number; userId: string; username: string }[],
  maxPlayers: number,
  opts: { fillWithBots?: boolean; botDifficulty?: "easy" | "medium" | "hard" }
): SeatEntry[] {
  const roster: SeatEntry[] = humans
    .map((h) => ({ ...h, isBot: false }))
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (!opts.fillWithBots) return roster;

  const taken = new Set(roster.map((r) => r.seatIndex));
  const difficulty = opts.botDifficulty ?? "medium";
  for (let seat = 0; seat < maxPlayers; seat++) {
    if (taken.has(seat)) continue;
    roster.push({
      seatIndex: seat,
      // Synthetic id: bot seats must never collide with a real user id, and the
      // scoring path already excludes ids with this prefix.
      userId: `bot:${seat}`,
      username: `Bot ${seat + 1}`,
      isBot: true,
      difficulty,
    });
  }
  return roster.sort((a, b) => a.seatIndex - b.seatIndex);
}
```

- [ ] **Step 4: Run the test, expect pass.**

- [ ] **Step 5: Wire it into `room:start`**

Use the roster to build `playerSetup`, marking bot entries `type: "ai"` with their difficulty. Reuse the existing turn-arbiter path so a bot seat plays automatically when its turn arrives — the disconnect-takeover work already does this; do not write a second bot driver. Extend the `room:start` zod schema with the two optional fields.

- [ ] **Step 6: Add the host UI**

In `app/(online)/room.tsx`, add a "fill with bots" toggle and a difficulty selector, visible to the host only. All strings via `t()`, keys added to all three locales.

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit && npm test
git add server lib app tests locales
git commit -m "Fill empty seats with bots at game start

Reuses the existing AI and the seat-takeover driver rather than adding a second
bot path. Bot seats carry synthetic bot: ids and stay excluded from scoring."
```

---

## Task 6: Persistence for stats, history and achievements

One migration, one owner — three later tasks depend on this schema and must not each edit it.

**Files:**
- Modify: `shared/schema.ts`

**Interfaces:**
- Produces: `userStats`, `matchHistory`, `userAchievements` Drizzle tables and their inferred types

- [ ] **Step 1: Add the tables**

```ts
export const userStats = pgTable("user_stats", {
  userId: varchar("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  gamesPlayed: integer("games_played").notNull().default(0),
  gamesWon: integer("games_won").notNull().default(0),
  matchesWon: integer("matches_won").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  bombsPlayed: integer("bombs_played").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const matchHistory = pgTable("match_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  finishedAt: timestamp("finished_at").defaultNow().notNull(),
  gameMode: text("game_mode").notNull(),
  placement: integer("placement").notNull(),
  playerCount: integer("player_count").notNull(),
  points: integer("points").notNull(),
  opponents: jsonb("opponents").notNull().default([]),
}, (t) => [index("match_history_user_idx").on(t.userId, t.finishedAt)]);

export const userAchievements = pgTable("user_achievements", {
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  achievementId: text("achievement_id").notNull(),
  unlockedAt: timestamp("unlocked_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.achievementId] })]);
```

Import `index` and `primaryKey` from `drizzle-orm/pg-core`. Every table cascades on user delete — account deletion must keep working (App Store 5.1.1(v)); confirm `server/storage.ts::deleteUser` needs no change because of the cascade, and note it in the commit.

- [ ] **Step 2: Verify typecheck, then apply**

```bash
npx tsc --noEmit
# On Replit, where DATABASE_URL exists:
npm run db:push
```

If `db:push` is unavailable in this environment, say so — do not claim the schema was applied.

- [ ] **Step 3: Commit**

```bash
git add shared/schema.ts
git commit -m "Add user_stats, match_history and user_achievements tables"
```

---

## Task 7: Achievement definitions and evaluation (pure)

**Files:**
- Create: `lib/achievements.ts`, `tests/achievements.test.ts`

**Interfaces:**
- Produces:
  - `ACHIEVEMENTS: readonly AchievementDef[]` where `AchievementDef = { id: string; nameKey: TranslationKey; descKey: TranslationKey }`
  - `evaluateAchievements(result: GameResult): string[]` returning newly-earned ids
  - `interface GameResult { userId: string; placement: number; playerCount: number; playedBomb: boolean; playedJoker: boolean; matchWon: boolean; opponentsFinished: number; }`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAchievements, ACHIEVEMENTS } from "../lib/achievements.ts";

const base = { userId: "u1", placement: 1, playerCount: 4, playedBomb: false, playedJoker: false, matchWon: false, opponentsFinished: 3 };

test("winning a hand unlocks first_win", () => {
  assert.ok(evaluateAchievements(base).includes("first_win"));
});

test("winning without a joker unlocks purist", () => {
  assert.ok(evaluateAchievements({ ...base, playedJoker: false }).includes("purist"));
  assert.ok(!evaluateAchievements({ ...base, playedJoker: true }).includes("purist"));
});

test("losing unlocks nothing", () => {
  assert.deepEqual(evaluateAchievements({ ...base, placement: 4 }), []);
});

test("every achievement has translation keys present in the catalogue", async () => {
  const { default: it } = await import("../locales/it.ts");
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.nameKey in it, `missing ${a.nameKey}`);
    assert.ok(a.descKey in it, `missing ${a.descKey}`);
  }
});
```

- [ ] **Step 2: Run, expect failure. Step 3: implement `lib/achievements.ts` as a flat array plus a predicate per entry — no trigger framework (YAGNI). Step 4: run, expect pass.**

- [ ] **Step 5: Add every `achievements.*` key to all three locales, then commit.**

```bash
npx tsc --noEmit && npm test
git add lib/achievements.ts tests/achievements.test.ts locales
git commit -m "Add achievement definitions and pure evaluation"
```

---

## Task 8: Persist stats, history and achievements at game over

**Files:**
- Create: `server/stats.ts`
- Modify: `server/socket.ts` (the game-over path), `server/routes.ts`

**Interfaces:**
- Consumes: Task 6's tables, Task 7's `evaluateAchievements`
- Produces: `recordGameResult(results: GameResult[]): Promise<void>`; `GET /api/stats/me`, `GET /api/stats/history`, `GET /api/stats/achievements`

- [ ] **Step 1: Implement `recordGameResult`** — upsert stats, insert a history row per human player, prune each user's history beyond **50** rows, and insert newly-earned achievements with `onConflictDoNothing`. Skip bot seats entirely (`userId.startsWith("bot:")`).

- [ ] **Step 2: Call it from the game-over path, wrapped so it can never fail the game.**

```ts
recordGameResult(results).catch((err) =>
  logger.error({ err, roomId }, "Failed to record game results")
);
```

This is deliberately not awaited: a stats write must never block or fail the
game-over broadcast.

- [ ] **Step 3: Add the three read endpoints** behind `requireAuth`, following the existing route style.

- [ ] **Step 4: Add integration coverage** — play a game to completion via the harness and assert stats and history rows appear for the human, and none for bot seats.

- [ ] **Step 5: Verify and commit.**

---

## Task 9: Profile screen

**Files:**
- Create: `app/(online)/profile.tsx`
- Modify: `app/index.tsx` (entry point), `locales/*.ts`

- [ ] **Step 1:** Build the screen with `MenuLayout`/`MenuCard`, three sections — stats, recent matches, achievements (earned and locked). Use `useQuery` against the Task 8 endpoints, following `app/(online)/friends.tsx` for the data-fetching pattern.
- [ ] **Step 2:** Every string via `t()`, keys in all three locales. Every interactive element gets `accessibilityRole` and `accessibilityLabel`, 44pt minimum targets.
- [ ] **Step 3:** Loading, empty and error states for each section — a new player has no history and that must look intentional, not broken.
- [ ] **Step 4:** Verify and commit.

---

## Task 10: Screen-reader support for the game table

**Files:**
- Modify: `components/GameTable.tsx`, `components/gameTableModel.ts`, `locales/*.ts`
- Test: `tests/gameTableModel.test.ts`

- [ ] **Step 1: Write a failing test for a pure description builder**

```ts
test("describes the table for a screen reader", () => {
  const text = describeTableForA11y({
    isMyTurn: true, myCardCount: 7,
    lastPlay: { type: "pair", label: "coppia di 8" },
    opponents: [{ name: "Ana", cardCount: 3 }],
  });
  assert.match(text, /Ana/);
  assert.match(text, /3/);
});
```

- [ ] **Step 2:** Implement `describeTableForA11y` in `gameTableModel.ts` — pure, translated via injected strings so it stays testable without React.
- [ ] **Step 3:** Apply it as `accessibilityLabel` on the table container, and give the hand an accessible summary. Cards already carry individual labels from `CardView`.
- [ ] **Step 4:** Verify colour is never the sole carrier of suit identity — the pip glyph differs per suit, so confirm and record it rather than changing the art.
- [ ] **Step 5:** Verify and commit. State clearly in the report that screen-reader *flow* was not verified on a device.

---

## Task 11: Bundle and dependency size report

**Files:**
- Create: `scripts/bundle-report.mjs`, `docs/BUNDLE.md`

- [ ] **Step 1:** Write a script that reports total and per-file asset sizes, and each production dependency's installed size, sorted descending.
- [ ] **Step 2:** Run it and commit the output as `docs/BUNDLE.md` so future growth shows up in a diff.
- [ ] **Step 3:** Remove anything the report shows as unused. **Measure before cutting** — if something is already small, leave it and say so.
- [ ] **Step 4:** Verify and commit.

---

## Self-Review

**Spec coverage:** S1 → Tasks 1–4. S2 → Task 5. S3 → Tasks 6–9. S4 → Task 10. S5 → Task 11. All five workstreams covered.

**Known gaps accepted deliberately:**
- Task 2's schema creation may need explicit SQL rather than `drizzle-kit push`; the task says to report the duplication rather than hide it.
- Screen-reader flow (Task 10) and real-device locale detection cannot be verified in this environment. Both tasks require the implementer to say so rather than claim coverage.

**Type consistency:** `SeatEntry`, `GameResult`, `AchievementDef` and `TestServer` are each defined once, in the task that produces them, and referenced by name thereafter. `buildSeatRoster`, `evaluateAchievements`, `recordGameResult`, `describeTableForA11y` and `startTestServer` keep the same names throughout.

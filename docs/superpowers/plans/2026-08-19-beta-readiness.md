# Beta Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Murlan from "125 audited findings fixed on `main`" to "in the hands of beta users",
by proving it deploys and plays on real infrastructure, closing the eight items the audit left
open, and leaving the repo with one work queue instead of two.

**Architecture:** Four phases, and the order is the point.

**Phase 0 proves the thing can ship at all.** The app has never been deployed since the audit
began (`docs/BACKLOG.md` O5), and the merged code now *refuses to boot* against the production
database until `npm run db:push` runs. That is the largest unknown in the project and every other
task is wasted effort if it fails, so it goes first — with a database snapshot and a written
rollback before anything is touched. Then four humans play a real match on the deployed app,
because 1,475 automated tests all drive the game the way the tests expect, not the way four
people in a room do.

**Phase 1 makes CI tell the truth**: one duplicated dependency deleted, two long-standing flaky
tests repaired, and only then the browser suite wired into CI — in that order, so CI never goes
red on a flake that was already known.

**Phase 2** is the product and asset work: gendered copy, the spacing scale, the icon fonts.

**Phase 3** retires `audit/2026-08-17/` and writes the deferred items into `docs/BACKLOG.md`, so
one queue remains.

**Tech Stack:** Expo SDK 54 / React 19.1 / React Native 0.81.5 as web · expo-router 6 ·
Express 5 + socket.io 4.8.3 · PostgreSQL via drizzle-orm 0.45 · TypeScript 5.9 ·
`node --test` with native TS type-stripping · jest-expo · Playwright · GitHub Actions ·
Replit Cloud Run.

**Spec:** This plan is its own spec. Its source facts are `audit/2026-08-17/PROGRESS.md`
§ Carried forward (eight open rows), `audit/2026-08-17/OWNER-TODO.md` §§1–8, and
`docs/BACKLOG.md` §2 (owner-blocked). **Phase 3 deletes the first two — read them before it
runs.**

---

## Owner decisions already taken — do not re-open

| # | Decision | Choice |
|---|---|---|
| 1 | Deploy | **Full rehearsal with rollback.** Snapshot, push, deploy, play, and a written way back. |
| 2 | Locked-out beta user | **An owner-run reset script now.** The real answer — self-serve reset plus Sign in with Apple / Google — goes to `docs/BACKLOG.md` for a separate plan. |
| 3 | Beta operations | **Backlog only.** The backup script, the owner stats view, and the login rate limit are wanted but are their own plan. *One exception is carried out here — see Task 1 Step 12 and the note below.* |
| 4 | Proving correctness | **A scripted multi-device play session**, on the deployed app. |
| 5 | React Compiler | **Delete the root pin.** `babel-preset-expo`'s bundled 1.0.0 becomes the only copy. |
| 6 | Flaky tests | **Fix both, then add Playwright to CI** — in that order. |
| 7 | Audit directory | **Move the live parts into `docs/`, delete the rest.** Git keeps every word. |
| 8 | Italian strings | **Rewrite genderless.** No gender field on the account, now or later. |
| 9 | Spacing | **Widen the scale, then enforce.** Additively — see Task 8's correction note. |
| 10 | Comment density | **15.7% in `server/socket.ts` is accepted** as a standing exception. No further cutting. |

**One deliberate deviation from decision 3, stated so it can be vetoed.** `CLAUDE.md` currently
tells every session *"The database is not precious. No real users."* The deploy in Task 1 is the
exact moment that stops being true. Leaving it for a later plan means every session between now
and then reads a standing invitation to drop a table holding beta accounts — including the
sessions that will work on that later plan. Correcting it is three lines of prose and it is
carried out in Task 1 Step 12, inside the task that creates the risk. Everything else from
decision 3 is backlog only, as instructed.

---

## Global Constraints

Copied from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **The app must remain launchable from Replit's Run button with no setup.** Port from
  `process.env.PORT`, database from `process.env.DATABASE_URL`. No build step needing local
  tooling. **Task 1 is the one and only exception in this plan** — a one-time `db:push` — and it
  is why that task exists.
- **Production runs Node 22** (`.replit` `modules`); CI tests on 24; `server:build` carries
  `--target=node22`.
- **`server/schemaDdl.ts` is the only thing that creates tables**, at boot, and every statement
  it emits is additive and idempotent. **No task in this plan changes `shared/schema.ts`.**
- **`locales/en.ts` is the source of truth for UI copy.** `it.ts` and `sq.ts` are
  `Record<keyof typeof en, string>`, so a key present in English and missing elsewhere is a
  compile error. Every user-facing string goes through `t()`.
- **No bare literals for colour, radius, font size or timing** — all from `lib/theme.ts`.
  `fontSize` and `borderRadius` are enforced by `eslint.config.js`; Task 8 adds spacing.
- **Ticket auth only.** The socket handshake accepts a live session or a single-use ticket.
  Never add a `handshake.auth.userId` branch.
- **Comment the code as it is.** No changelogs in code — never write what the code used to be,
  what was wrong with it, or when it was fixed. **The default is no comment.**
- **No self-defeating safeguards.** Never ship a guard together with the thing that gets past
  it. Every new test in this plan has a step that proves it can fail.
- **Never force-push, never `--no-verify`.** One commit per task; one PR per phase or per task.

### Verification commands (exact)

| Command | What it runs | Needs |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | nothing |
| `npm test` | `node --test "tests/**/*.test.ts"` | `DATABASE_URL` for the integration suites |
| `npm run test:native` | `jest`, the `tests/native/` suites × ios/android | nothing |
| `npm run lint` | `expo lint` | nothing |
| `npm run verify` | typecheck + test + test:native | as above |
| `npm run test:e2e` | Playwright | Docker + a built web bundle |

**Postgres for the integration suites.** Leave the container running between tasks:

```bash
docker start murlan-pg 2>/dev/null || docker run -d --name murlan-pg \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=murlan_test \
  -p 55433:5432 postgres:16-alpine
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
```

A run must report `skipped 0` and contain no `DATABASE_URL not set` line.

---

# PHASE 0 — Prove it ships

Nothing in Phases 1–3 matters if this phase fails. Run it against `main` as it stands today.

---

## Task 1: Deploy rehearsal, with a way back

**Why:** `docs/BACKLOG.md` O5 records that Replit boot has been unverified since the `reusePort`
fix. Since then, fifteen batches merged — including a socket-protocol field rename
(`roomCode` → `roomId` on `game:rejoin`), a schema version bump, and two column renames that
`ensureSchema()` is structurally unable to apply. `server/schemaDdl.ts:357`'s
`assertRenamesApplied()` runs before anything else and **throws**, so a deploy without
`npm run db:push` is a boot loop, not a degraded start.

**The two renames that block boot** (`server/schemaDdl.ts:351-354`):

| Table | Old column | New column |
|---|---|---|
| `active_games` | `room_code` | `room_id` |
| `match_replays` | `room_code` | `room_id` |

**Files:**
- Modify: `replit.md` (record the deploy sequence and the rollback)
- Modify: `CLAUDE.md` (the database is precious now — Step 12)
- Modify: `docs/BACKLOG.md` (close O5)

**Interfaces:**
- Consumes: nothing.
- Produces: a deployed, verified URL that Task 3's play session runs against.

- [ ] **Step 1: Confirm what is about to be deployed**

```bash
git fetch origin
git log --oneline origin/main -1
git status --porcelain
```

Expected: `4aaf017` or later, and a clean tree. Deploy from `origin/main`, never from a local
branch.

- [ ] **Step 2: Read the production database's current shape before touching it**

In the Replit shell, with the production `DATABASE_URL` in the environment:

```bash
psql "$DATABASE_URL" -c "\d active_games" | grep -E "room_code|room_id"
psql "$DATABASE_URL" -c "\d match_replays" | grep -E "room_code|room_id"
psql "$DATABASE_URL" -c "SELECT count(*) FROM users;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM active_games;"
```

Expected: both tables still show `room_code`, and `users` is 0 or a handful of your own test
accounts. **If `users` holds accounts you care about, stop and take the backup in Step 3
seriously.** If both tables already show `room_id`, the push has been done and Steps 5–6 are
no-ops — verify rather than assume.

- [ ] **Step 3: Snapshot the database**

```bash
pg_dump "$DATABASE_URL" --no-owner --no-privileges \
  -f "$HOME/murlan-predeploy-$(date +%Y%m%d-%H%M%S).sql"
ls -lh "$HOME"/murlan-predeploy-*.sql
```

Expected: a file with a non-zero size. **Do not proceed without it.** This is the only way back
if `db:push` makes a choice you did not intend.

Write the restore command down before continuing — you want it to hand, not to look up:

```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" -f "$HOME/murlan-predeploy-<timestamp>.sql"
```

- [ ] **Step 4: Confirm there are no case-colliding usernames**

Batch 15 added a unique index on `lower(username)`. `ensureSchema` creates it at boot, and if two
existing rows differ only by case it **throws and the server will not start**:

```bash
psql "$DATABASE_URL" -c \
  "SELECT lower(username), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;"
```

Expected: `(0 rows)`. If not, delete the offending duplicate — on a database with no real users
that is fine, and `CLAUDE.md` permits it.

- [ ] **Step 5: Run the push, and read what it proposes before answering**

```bash
npm run db:push
```

`drizzle-kit` will ask whether each `room_code` is a **rename** of `room_id` or a new column.
**Answer rename for both.** Answering "create" silently drops every live game's join code and
leaves two dead columns.

Expected: two renames applied, no table dropped, no data-loss warning accepted.

- [ ] **Step 6: Verify the renames landed**

```bash
psql "$DATABASE_URL" -c "\d active_games" | grep -E "room_code|room_id"
psql "$DATABASE_URL" -c "\d match_replays" | grep -E "room_code|room_id"
```

Expected: `room_id` present, `room_code` **absent**, in both. If `room_code` survives, boot will
still throw — go back to Step 5.

- [ ] **Step 7: Prove the server boots against it, before deploying**

Still in the Replit shell:

```bash
npm run server:build
NODE_ENV=production PORT=5051 node server_dist/index.mjs &
server_pid=$!
sleep 5
curl -fsS http://127.0.0.1:5051/health
kill "$server_pid"
```

Expected: `{"status":"ok","db":"connected"}` or equivalent. **If `assertRenamesApplied` throws
here, it would have thrown on the deploy** — that is the whole reason this step is before it.

- [ ] **Step 8: Deploy**

Press Deploy in Replit's UI. `.replit` runs
`npm run expo:static:build && npm run expo:web:build && npm run server:build`, then
`npm run server:prod`.

Watch the build log. Expected: all three builds complete, and the run command starts without the
`Database out of date` error.

- [ ] **Step 9: Verify the deployed URL answers**

```bash
curl -fsS https://<your-deployment>/health
curl -sI https://<your-deployment>/ | grep -iE "content-security-policy|content-type"
```

Expected: `/health` reports the database connected, and `/` returns HTML carrying the
`Content-Security-Policy` header batch 15 added. **A missing CSP header means the SPA branch did
not take** — check that `dist/index.html` exists in the deployment.

- [ ] **Step 10: Register, log in, and start a game against the deployed app**

In a browser, against the real URL:

1. Register a new account. Expected: lands in the lobby, no error.
2. Log out, then log back in **with different capitalisation** of the username. Expected: works —
   this is batch 15's SEC-08, and it is the one change that touches the login path.
3. Start an offline game and play three cards. Expected: cards fly, sounds play, no console
   error.
4. Create an online room, fill with bots, start. Expected: the table deals and a bot plays.

Any failure here is a deploy-blocking regression. Capture the browser console and the Replit log
before changing anything.

- [ ] **Step 11: Record the rollback that actually applies**

There are two independent rollbacks and they are not interchangeable. Add to `replit.md`, under
a new `## Rolling back a deploy` heading:

```markdown
## Rolling back a deploy

**The code** — Replit keeps previous deployments; redeploying an earlier one is the fast path.
To undo a batch in git instead: `git revert -m 1 <merge-sha>` for the whole batch, or
`git revert <commit-sha>` for one finding, then redeploy.

**The database** — the two `room_code` → `room_id` renames are *not* undone by reverting the
code. A reverted server expects `room_code` and will not find it. Restore the pre-deploy dump
instead:

    psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    psql "$DATABASE_URL" -f murlan-predeploy-<timestamp>.sql

Take that dump before every deploy that runs `db:push`. `pg_dump "$DATABASE_URL"
--no-owner --no-privileges -f murlan-predeploy-$(date +%Y%m%d-%H%M%S).sql`.
```

- [ ] **Step 12: The database is precious now**

In `CLAUDE.md` § Working agreement, replace:

```
- **The database is not precious.** No real users. Prefer dropping and recreating over
  accreting compatibility. Order by design, not deploy cost: derive from existing rows →
  ride an existing jsonb column → new table → new column.
```

with:

```
- **The database holds real accounts.** Beta users play on it. Design storage by shape, not by
  deploy cost — derive from existing rows → ride an existing jsonb column → new table → new
  column — but a change that cannot be applied additively by `server/schemaDdl.ts` needs a
  `db:push` in the deploy, and a `pg_dump` before it. See `replit.md` § Rolling back a deploy.
```

Also check `docs/BRIEF.md` and `docs/BACKLOG.md` for the same claim:

```bash
grep -rn "not precious\|no real users\|No real users" --include='*.md' . \
  --exclude-dir=node_modules --exclude-dir=audit --exclude-dir=graphify-out
```

Fix every hit. A future session reading the old wording while beta is live is exactly the
accident this prevents.

- [ ] **Step 13: Close O5**

In `docs/BACKLOG.md` §2, delete the `O5 | Replit boot unverified since the reusePort fix` row —
it is now verified. Do not replace it with "verified on <date>": a closed item leaves the queue.

- [ ] **Step 14: Commit**

```bash
git add replit.md CLAUDE.md docs/BACKLOG.md docs/BRIEF.md
git commit -m "docs: record the deploy sequence, and that the database now holds accounts

The two room_code renames need a db:push that ensureSchema cannot carry out, and
reverting the code does not undo them — so the rollback has a database half and a
code half, and they are not interchangeable. Boot is verified on Replit; O5 closes."
```

---

## Task 2: An owner-run password reset

**Why:** There is no password reset. `server/routes.ts` exposes `register`, `login`, `logout`,
`me` and `socket-ticket` — nothing else. No email is stored, so no self-serve recovery is
possible. A beta user who forgets their password is locked out permanently, and you have no way
to help them short of hand-editing the database. At beta scale, where you know every tester, a
script you run is the whole solution.

**The real answer — self-serve reset, Sign in with Apple, Sign in with Google — is deliberately
out of scope** and is written into `docs/BACKLOG.md` by Task 11.

**Files:**
- Create: `scripts/reset-password.mjs`
- Test: `tests/integration/passwordReset.test.ts`
- Modify: `replit.md` (how to run it)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/passwordReset.test.ts`:

```ts
// tests/integration/passwordReset.test.ts — the owner-run password reset.
//
// There is no self-serve recovery, so this script is the only way a locked-out
// account gets back in. It writes a bcrypt hash directly, which means the login
// route has to accept it — asserted here against the real server rather than by
// reading both sides and hoping they agree.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "reset-password.mjs");

describe("owner password reset", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  const login = (username: string, password: string) =>
    fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

  test("a reset password logs in, and the old one stops working", async () => {
    await register(server, "LockedOut");

    const out = execFileSync("node", [script, "LockedOut"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, ALLOW_RESET: "1" },
    });
    const match = out.match(/temporary password: (\S+)/);
    assert.ok(match, `the script printed no password:\n${out}`);
    const temporary = match[1];

    const withNew = await login("LockedOut", temporary);
    assert.equal(withNew.status, 200, await withNew.text());

    const withOld = await login("LockedOut", "password123");
    assert.equal(withOld.status, 401);
  });

  test("the username is matched case-insensitively, like login", async () => {
    await register(server, "CaseLocked");
    const out = execFileSync("node", [script, "caselocked"], {
      encoding: "utf8",
      env: { ...process.env, ALLOW_RESET: "1" },
    });
    const temporary = out.match(/temporary password: (\S+)/)![1];
    const res = await login("CaseLocked", temporary);
    assert.equal(res.status, 200, await res.text());
  });

  test("an unknown username is refused, and changes nothing", () => {
    assert.throws(
      () =>
        execFileSync("node", [script, "NoSuchPerson"], {
          encoding: "utf8",
          env: { ...process.env, ALLOW_RESET: "1" },
          stdio: "pipe",
        }),
      /no account named/i
    );
  });

  test("it refuses to run without the opt-in", () => {
    assert.throws(
      () =>
        execFileSync("node", [script, "LockedOut"], {
          encoding: "utf8",
          env: { ...process.env, ALLOW_RESET: undefined },
          stdio: "pipe",
        }),
      /ALLOW_RESET/
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
node --test tests/integration/passwordReset.test.ts
```

Expected: FAIL — `scripts/reset-password.mjs` does not exist.

- [ ] **Step 3: Write the script**

Create `scripts/reset-password.mjs`, following `scripts/reset-db.mjs`'s opt-in shape:

```js
/**
 * Sets a new random password on one account and prints it once.
 *
 *   ALLOW_RESET=1 node scripts/reset-password.mjs <username>
 *
 * There is no self-serve recovery — no email is stored — so this is the only
 * way a locked-out account gets back in. It is deliberately not an npm script
 * and not a route: it needs the database URL and a person who has decided to
 * run it.
 *
 * The username is matched case-insensitively, the same way login is
 * (server/storage.ts getUserByUsername), so the caller does not have to know
 * the exact casing the account was registered with.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const username = process.argv[2];

if (process.env.ALLOW_RESET !== "1" || !username) {
  console.error(
    "Usage: ALLOW_RESET=1 node scripts/reset-password.mjs <username>\n" +
      "On Windows PowerShell:\n" +
      '  $env:ALLOW_RESET=1; node scripts/reset-password.mjs <username>'
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// Base64url of 9 bytes: 12 characters, no ambiguous punctuation to read aloud.
const temporary = randomBytes(9).toString("base64url");
const hash = await bcrypt.hash(temporary, 10);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query(
    `UPDATE users SET password = $1
      WHERE lower(username) = lower($2)
      RETURNING username`,
    [hash, username]
  );
  if (rows.length === 0) {
    console.error(`There is no account named "${username}".`);
    process.exit(1);
  }
  console.log(`${rows[0].username} — temporary password: ${temporary}`);
  console.log("Shown once. Send it to them, and have them change it.");
} finally {
  await pool.end();
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
node --test tests/integration/passwordReset.test.ts
```

Expected: `pass 4`, `fail 0`, `skipped 0`.

- [ ] **Step 5: Prove the guard can fail**

The "refuses without the opt-in" case is the one at risk of passing vacuously. Break the guard
on purpose:

```bash
sed -i 's/process.env.ALLOW_RESET !== "1" || !username/!username/' scripts/reset-password.mjs
node --test tests/integration/passwordReset.test.ts 2>&1 | grep -E "✖|ℹ (pass|fail)"
git checkout scripts/reset-password.mjs
```

Expected: the fourth case FAILS while the guard is removed.

- [ ] **Step 6: There is no change-password screen — say so plainly**

The script prints *"have them change it"*, and the app offers no way to do that. Verify:

```bash
grep -rn "changePassword\|change-password\|newPassword" --include='*.tsx' --include='*.ts' \
  app components server | head
```

Expected: nothing. **Do not build one here** — it is part of the auth work Task 11 files. Change
the script's second line to the honest instruction instead:

```js
  console.log("Shown once. Send it to them — there is no in-app change-password screen yet.");
```

Shipping a guard together with the thing that gets past it is the failure mode this repo has hit
three times; a script that tells the owner to do something impossible is the same shape.

- [ ] **Step 7: Document it where the owner will look**

Add to `replit.md`, in the scripts table:

```markdown
| `ALLOW_RESET=1 node scripts/reset-password.mjs <username>` | Sets a new random password on one account and prints it once. The only recovery route — no email is stored. |
```

- [ ] **Step 8: Full verification and commit**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
npm run verify && npm run lint
git add scripts/reset-password.mjs tests/integration/passwordReset.test.ts replit.md
git commit -m "feat: an owner-run password reset

No email is stored, so a locked-out account has no route back and the owner has
no way to help without hand-editing the database. This is that way, matched
case-insensitively like login is."
```

---

## Task 3: A scripted multi-device play session

**Why:** 1,059 node tests, 416 native tests and a browser suite all drive the game the way the
tests expect. None of them is four people in a room, on four devices, on the deployed app. Every
path the audit fixed — a seat vacated mid-hand, a lost connection, a second tab, a rematch vote —
was fixed against a test harness and has never been watched happening to a person.

**This task is not code.** It is a script for the owner and three others, written to be handed
over. It runs **after Task 1** (it needs the deployed URL) and **after Task 2** (so a tester who
locks themselves out can be let back in).

**Files:**
- Create: `docs/BETA-PLAYTEST.md` (the script, and space for what it finds)

**Interfaces:**
- Consumes: the deployed URL from Task 1.
- Produces: a list of defects, which become their own fixes before beta opens.

- [ ] **Step 1: Write the script**

Create `docs/BETA-PLAYTEST.md`:

```markdown
# Beta playtest script

Four people, four devices, the deployed URL. Roughly an hour. Every line is a thing
the audit fixed that no human has watched work.

Record the result next to each line: ✅, or what happened.

## Setup
- [ ] Each player registers a new account on their own device. At least one on a phone
      browser, at least one on a laptop.
- [ ] One player registers with a mixed-case username (e.g. `MarcoRossi`), logs out, and
      logs back in typing it all lowercase.

## A full match, uninterrupted
- [ ] Host creates a room, the other three join by code.
- [ ] Play a whole match to the target. Between manches, watch the card exchange happen.
- [ ] Check the scoreboard names are right — not `player_0`.
- [ ] At the end, everyone votes rematch. It starts a new match.

## Someone leaves mid-hand
- [ ] Mid-hand, one player force-quits (close the tab / kill the app).
- [ ] The other three: does the table keep playing with a bot in that seat?
- [ ] Is there a visible marker on that seat for the rest of the match — not just a banner
      that disappears?
- [ ] Does the match finish, and is the seat that left recorded as last place?

## Someone loses signal
- [ ] Mid-hand, one player turns off wi-fi for ~20 seconds, then turns it back on.
- [ ] Do they come back into the same hand, with their own cards?
- [ ] Did the others see a "disconnected" notice, and then a "back" one?
- [ ] Do it again but stay offline for over a minute, past the grace period. What happens?

## The same account twice
- [ ] One player opens the app in a second tab while playing in the first.
- [ ] The first tab should say plainly that the account was opened elsewhere — not go
      silently dead.
- [ ] Does the first tab stop trying to reconnect, or do the two tabs fight?

## The lobby
- [ ] Two players add each other as friends. Does the online dot appear?
- [ ] One invites the other to a room. Does the banner arrive, and does tapping it work?
- [ ] Quickmatch with only one person waiting. What happens?
- [ ] Start a room with bot-fill and one human. Does it play a full match?

## The awkward ones
- [ ] Rotate a phone to portrait mid-game. Does the table survive?
- [ ] Open the settings modal in landscape. Does the app flip to portrait behind it?
- [ ] Turn the phone's text size up to maximum and look at the table. Is anything clipped?
- [ ] Turn on the OS "reduce motion" setting and play a card.
- [ ] Turn the volume up. Do you hear: the deal, a card, a pass, a bomb, the round close,
      the hand end?

## What broke

| What | Who saw it | Device | What happened |
|---|---|---|---|
| | | | |
```

- [ ] **Step 2: Run it**

Four people, the deployed URL, an hour. Fill the table in as you go — write down *what you saw*,
not what you think caused it.

- [ ] **Step 3: Triage what it found**

For each row in the table:

1. Reproduce it locally. If it will not reproduce, note that and keep the row — a defect seen
   once on a real device is still a defect.
2. Find the test that should have caught it. If one exists and passes, the test is wrong; that is
   the more important finding.
3. Write a failing test, then fix it — `superpowers:test-driven-development`. Do not fix
   anything found here without a test that fails first.

- [ ] **Step 4: Decide, explicitly, what blocks beta**

Not everything found needs fixing before testers arrive. Sort into:

- **Blocks beta** — anything that loses a game, strands a player, or exposes another player's
  cards.
- **Fix during beta** — visual, wording, or an awkward-but-recoverable path.
- **Backlog** — everything else.

Write that decision into the table. An undecided defect is one that gets fixed at 2am.

- [ ] **Step 5: Commit the record**

```bash
git add docs/BETA-PLAYTEST.md
git commit -m "docs: the beta playtest script, and what it found

Four people, four devices, the deployed app. Every line is something the audit
fixed that no human had watched work."
```

---

# PHASE 1 — Make CI tell the truth

---

## Task 4: Delete the React Compiler root pin

**Why:** `app.json` sets `experiments.reactCompiler`, which `babel-preset-expo@54.0.12` satisfies
from **its own nested `babel-plugin-react-compiler@1.0.0`**. That is what compiles the shipped
bundle. `package.json` separately pins `19.0.0-beta-ebf51a3-20250411`, and the only thing that
loads it is `tests/reactCompiler.test.ts` — the acceptance test that proves the game table
compiles without bailing out. So that test measures a compiler the bundle never runs.

**Files:**
- Modify: `package.json` (remove the `babel-plugin-react-compiler` devDependency)
- Modify: `package-lock.json` (regenerated)
- Modify: `tests/reactCompiler.test.ts` (assert the resolved version)
- Modify: `CLAUDE.md` § Known pitfalls

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Confirm the split is real before changing anything**

```bash
node -e "
const {createRequire}=require('module');
const r=createRequire(require('path').join(process.cwd(),'node_modules/babel-preset-expo/package.json'));
console.log('preset resolves:', r('babel-plugin-react-compiler/package.json').version);
console.log('root resolves:  ', require('./node_modules/babel-plugin-react-compiler/package.json').version);
"
```

Expected, before the change:

```
preset resolves: 1.0.0
root resolves:   19.0.0-beta-ebf51a3-20250411
```

If the two already agree, stop — the premise has changed and this task is wrong.

- [ ] **Step 2: Write the failing test**

Add to `tests/reactCompiler.test.ts`, after the existing imports:

```ts
test("the compiler under test is the one babel-preset-expo builds with", () => {
  const presetRequire = createRequire(
    path.join(repoRoot, "node_modules", "babel-preset-expo", "package.json")
  );
  const built = presetRequire("babel-plugin-react-compiler/package.json").version;
  const undertest = require("babel-plugin-react-compiler/package.json").version;
  assert.equal(
    undertest,
    built,
    `this suite compiles with ${undertest} but the app is built with ${built}`
  );
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node --test tests/reactCompiler.test.ts
```

Expected: FAIL — `this suite compiles with 19.0.0-beta-ebf51a3-20250411 but the app is built
with 1.0.0`. This is the proof the test can fail. Do not skip it.

- [ ] **Step 4: Remove the root pin**

Delete the `"babel-plugin-react-compiler": "19.0.0-beta-ebf51a3-20250411",` line from
`devDependencies` in `package.json`, then:

```bash
npm install
```

- [ ] **Step 5: Verify only one copy remains**

```bash
npm ls babel-plugin-react-compiler
```

Expected: one entry, nested under `expo > babel-preset-expo`, at `1.0.0`. No top-level entry.

- [ ] **Step 6: Run the test and watch it pass**

```bash
node --test tests/reactCompiler.test.ts
```

Expected: PASS, every case. **If the existing bailout assertions now fail, that is the real
finding** — 1.0.0 handles a component the beta did not, or the reverse. Do not weaken them to
make them pass; report it and stop.

- [ ] **Step 7: Correct the pitfall note in `CLAUDE.md`**

Replace the § Known pitfalls entry:

```
- React Compiler can miscompile `useEffect` references. Note the build and the test do not
  use the same one: `babel-preset-expo` resolves its own nested
  `babel-plugin-react-compiler@1.0.0`, while the root devDependency — what
  `tests/reactCompiler.test.ts` loads — is the pinned 19.0.0 beta.
```

with:

```
- React Compiler can miscompile `useEffect` references. It comes from
  `babel-preset-expo`'s own dependency — do not add a second copy to `package.json`;
  `tests/reactCompiler.test.ts` pins that there is only one.
```

- [ ] **Step 8: Full verification, including a real build**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
npm run verify && npm run lint
npm run expo:web:build
```

Expected: verify clean, lint exit 0, and `dist/index.html` written. The build is the only thing
that exercises the compiler for real.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tests/reactCompiler.test.ts CLAUDE.md
git commit -m "fix: let babel-preset-expo own the React Compiler

app.json turns on experiments.reactCompiler, which babel-preset-expo satisfies
from its own bundled 1.0.0 — so the 19.0.0 beta pinned in package.json compiled
nothing but tests/reactCompiler.test.ts, the suite meant to prove the game table
does not bail out. One copy now, and the suite asserts it is the one the build
uses."
```

---

## Task 5: Fix the httpCaching fixture race

**Why:** `tests/integration/httpCaching.test.ts` failed once in three consecutive full-suite
runs — all seven of its cases together — while passing in isolation and on the runs either side.
It writes fixture files into `dist/` in `before()` and removes them in `after()`. `node --test`
runs files concurrently, and every other integration suite's server reads `dist/` from
`process.cwd()`, so one of them sees a half-built tree.

**Files:**
- Modify: `tests/integration/httpCaching.test.ts`

**Interfaces:**
- Consumes: `startTestServer`, `hasDatabase`, `skipMessage` from `tests/helpers/testServer.ts`
  (unchanged).
- Produces: nothing.

- [ ] **Step 1: Reproduce it**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
for i in 1 2 3 4 5 6; do
  npm test 2>&1 | grep -qE "✖ static asset compression" && echo "RUN $i: FAILED" || echo "RUN $i: ok"
done
```

Expected: at least one `FAILED` in six. If six are clean, run six more before concluding it does
not reproduce — the observed rate was roughly one in three.

- [ ] **Step 2: Confirm the mechanism rather than guessing it**

```bash
grep -n "distPath\|process.cwd" tests/integration/httpCaching.test.ts
grep -n "dist" server/app.ts | head -5
```

Expected: the suite builds `path.resolve(process.cwd(), "dist")`, and `server/app.ts`'s
`configureExpoAndLanding` resolves the same path. Every concurrently-booting server reads the
directory this suite is mutating.

- [ ] **Step 3: Give the suite its own directory**

In `tests/integration/httpCaching.test.ts`, replace the `distDir` constants and the whole
`before()`/`after()` pair with:

```ts
// This suite serves a synthetic dist/ tree. node --test runs files concurrently
// and every other integration suite's server reads dist/ from process.cwd() too,
// so the tree is built in a directory of this suite's own and cwd moves onto it
// for the life of the server — writing into the real one raced them.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "murlan-http-"));
const distDir = path.join(sandbox, "dist");
const indexPath = path.join(distDir, "index.html");
const faviconPath = path.join(distDir, "favicon.ico");
const assetDir = path.join(distDir, "_expo", "static", "js", "web");
const assetPath = path.join(
  assetDir,
  "app-fixture.deadbeefcafebabe0123456789abcdef.js"
);

let originalCwd: string;

before(async () => {
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(indexPath, FIXTURE_INDEX_HTML);
  fs.writeFileSync(faviconPath, FIXTURE_FAVICON);
  fs.writeFileSync(assetPath, FIXTURE_JS);

  originalCwd = process.cwd();
  process.chdir(sandbox);
  server = await startTestServer();
});

after(async () => {
  if (server) await server.stop();
  if (originalCwd) process.chdir(originalCwd);
  fs.rmSync(sandbox, { recursive: true, force: true });
});
```

Add next to the existing `node:fs` and `node:path` imports:

```ts
import os from "node:os";
```

Delete the now-unused `createdDirs` and `createdFiles` arrays and the comment above the old
`before()` describing the write-only-what-is-missing dance.

- [ ] **Step 4: Confirm `process.chdir` is safe here**

```bash
grep -n "concurrency\|--test-concurrency" package.json .github/workflows/ci.yml
```

Expected: no override, so `node --test`'s default of one process per file applies and the chdir
affects only this suite. **If a future change runs suites in-process this breaks**, and the
sandbox would have to be passed to `startTestServer` as an option instead. Note that in the
commit message.

- [ ] **Step 5: Run the suite alone**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
node --test tests/integration/httpCaching.test.ts
```

Expected: `pass 7`, `fail 0`, `skipped 0`.

- [ ] **Step 6: Run the full suite six times and paste the real output**

```bash
for i in 1 2 3 4 5 6; do
  npm test 2>&1 | grep -E "ℹ (pass|fail) " | tr '\n' ' '; echo "  <- run $i"
done
```

Expected: six identical clean runs, `fail 0` each. This is the only evidence the race is gone.

- [ ] **Step 7: Commit**

```bash
git add tests/integration/httpCaching.test.ts
git commit -m "fix(test): stop httpCaching racing every other suite over dist/

It built its synthetic tree inside the real dist/ at process.cwd(), which every
concurrently-booting integration server also reads. It now owns a temp directory
and moves cwd onto it for the life of its server — which relies on node --test
giving each file its own process."
```

---

## Task 6: Make tableFit wait for the table to settle

**Why:** `tests/e2e/tableFit.spec.ts` fails about one run in seven, and has for some time —
measured at 3 failures in 20 against `main`. What escapes the 667px viewport is the right seat's
card fan, built from fixed-size card backs, so no font or text change can widen it. The whole of
its settling logic is `page.waitForTimeout(2_000)` at line 32, and bots start playing immediately
under `EXPO_PUBLIC_E2E_FAST` — so the sweep samples a moment while cards are still in flight.

**Files:**
- Modify: `tests/e2e/tableFit.spec.ts`

**Interfaces:**
- Consumes: `openApp`, `startOfflineGame` from `tests/e2e/helpers/navigation` (unchanged).
- Produces: nothing.

- [ ] **Step 1: Measure the current failure rate before touching it**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
for i in $(seq 1 10); do
  npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/tableFit.spec.ts \
    2>&1 | grep -E "[0-9]+ (passed|failed)" | tr '\n' ' '; echo " <- run $i"
done
```

Expected: roughly 1–2 failures in 10, always `small phone landscape, 4 players`. Write the number
down; Step 6 compares against it.

- [ ] **Step 2: Confirm it is a settling problem, not a layout defect**

```bash
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/tableFit.spec.ts \
  -g "small phone landscape, 4 players" --trace on
npx playwright show-trace test-results/*/trace.zip
```

Expected: the escaping box is a card in flight, and its final position is inside the viewport.
**If the element is still outside once everything has stopped, this is a real layout bug** and
this task is the wrong fix — report it and stop.

- [ ] **Step 3: Replace the fixed wait with a quiescence check**

Replace line 32:

```ts
        await page.waitForTimeout(2_000);
```

with:

```ts
        await waitForTableToSettle(page);
```

and add above `test.describe`, below the `SEATS` constant:

```ts
/**
 * Resolves once the table has stopped moving. The sweep measures laid-out boxes,
 * and a card in flight is outside the viewport for the length of its flight —
 * under EXPO_PUBLIC_E2E_FAST the bots start playing before a fixed wait would
 * have elapsed, which is what made this sample a moving table.
 */
async function waitForTableToSettle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const table = document.querySelector('[data-testid="game-table"]');
      if (!table) return false;
      const w = globalThis as unknown as {
        __murlanSettle?: { seen: string; since: number };
      };
      const boxes = [...table.querySelectorAll("div")]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}`;
        })
        .join("|");
      const now = performance.now();
      if (!w.__murlanSettle || w.__murlanSettle.seen !== boxes) {
        w.__murlanSettle = { seen: boxes, since: now };
        return false;
      }
      // Longer than a card's flight (FLIGHT_MS 380 in
      // components/gameTableModel.ts) plus the settle that follows it.
      return now - w.__murlanSettle.since > 600;
    },
    undefined,
    { timeout: 30_000, polling: 100 }
  );
}
```

- [ ] **Step 4: Prove the helper actually waits**

A quiescence check that returns immediately is the failure mode this repo has hit three times.

```bash
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/tableFit.spec.ts \
  -g "small phone landscape, 4 players" --reporter=list
```

Then temporarily change `> 600` to `> 60_000` and re-run. Expected: the case now fails on the
30s `waitForFunction` timeout. Change it back to `600`. **If it passed at `60_000`, the helper is
not gating anything** and must be fixed before continuing.

- [ ] **Step 5: Confirm the check is not simply hiding the sweep**

Temporarily change `VIEWPORTS[0]`'s width from `667` to `320` and re-run that case. Expected:
FAIL, listing escaping elements. Change it back. This proves the sweep still measures something
after the wait.

- [ ] **Step 6: Run the whole spec twenty times**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
pass=0; fail=0
for i in $(seq 1 20); do
  if npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/tableFit.spec.ts \
      >/dev/null 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); fi
done
echo "passed $pass, failed $fail of 20"
```

Expected: `passed 20, failed 0`. Anything else means the flake is not closed — say so rather than
averaging it away. Paste the real line.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/tableFit.spec.ts
git commit -m "fix(test): wait for the table to stop moving before measuring it

Its settling logic was a flat 2s wait, and bots start playing immediately under
EXPO_PUBLIC_E2E_FAST — so the overflow sweep sampled a table with cards still in
flight, failing about one run in seven on the 667px viewport. It now polls the
laid-out boxes until they hold still."
```

---

## Task 7: Run the browser suite in CI

**Why:** `.github/workflows/ci.yml` runs no Playwright step at all, which is why both flakes went
unmeasured for months and why `tests/e2e/tapTargets.spec.ts` — the accessibility sweep A11Y-09
was written to enforce — gates nothing. **Do not start until Tasks 5 and 6 are merged**: adding
the suite first makes CI red on known flakes.

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/TESTING.md`

**Interfaces:**
- Consumes: the two repaired specs from Tasks 5 and 6.
- Produces: nothing.

- [ ] **Step 1: Confirm the prerequisites are merged**

```bash
git log --oneline origin/main | grep -E "wait for the table to stop|stop httpCaching racing"
```

Expected: both commits on `origin/main`. If either is missing, stop.

- [ ] **Step 2: Establish what the suite costs**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
time npm run test:e2e
```

Write down the wall-clock and the pass count. A runner is slower than a laptop; Step 3's timeout
comes from this number with headroom.

- [ ] **Step 3: Add the steps**

In `.github/workflows/ci.yml`, insert after `Lint` and before `Build the web and server bundles`:

```yaml
      # The only layer that exercises react-native-web's side of every
      # Platform.OS branch, and the only one that measures a laid-out box —
      # tap targets, and whether the table renders off the side of the screen.
      # It builds its own bundle (scripts/e2e-server.mjs), so it runs before
      # the build steps rather than reusing their output.
      - name: Install Playwright's browser
        if: steps.scope.outputs.app == 'true'
        run: npx playwright install --with-deps chromium

      - name: Browser tests
        if: steps.scope.outputs.app == 'true'
        timeout-minutes: 30
        run: npm run test:e2e

      - name: Keep the report when the browser tests fail
        if: failure() && steps.scope.outputs.app == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 4: Check the E2E server reaches CI's Postgres**

```bash
grep -n "DATABASE_URL\|dev-stack\|docker" scripts/e2e-server.mjs
```

Expected: it reads `process.env.DATABASE_URL` and only falls back to `scripts/dev-stack.mjs` when
unset. CI already exports `DATABASE_URL` at the job level. **If it unconditionally starts
Docker**, add an explicit `env:` block to the `Browser tests` step and record that here.

- [ ] **Step 5: Push and watch CI — this cannot be verified locally**

```bash
git add .github/workflows/ci.yml
git commit -m "test(ci): run the browser suite

It is the only layer that measures a laid-out box — tap targets, and whether the
table renders off the side of the screen — and it has never gated a merge, which
is how two flakes went unmeasured for months."
git push -u origin <branch>
gh pr create --base main --title "Run the browser suite in CI" --body "<IDs, and the timing from Step 2>"
gh run watch <run-id> --exit-status
```

Expected: `Browser tests` appears in the run and every spec passes.

- [ ] **Step 6: Prove the step can fail the build**

A CI step that cannot go red is the defect this repo has shipped three times. On the same branch:

```bash
sed -i 's/const VIEWPORTS = \[/const VIEWPORTS = [\n  { name: "impossible", width: 200, height: 150 },/' \
  tests/e2e/tableFit.spec.ts
git commit -am "temp: prove the browser step can fail CI"
git push
gh run watch <run-id> --exit-status
```

Expected: the run **fails** on `Browser tests`, with the `playwright-report` artifact attached.
Then:

```bash
git revert --no-edit HEAD
git push
gh run watch <run-id> --exit-status
```

Expected: green again.

- [ ] **Step 7: Correct `docs/TESTING.md`**

Update the Web e2e row's `Gates` column to say it runs on every pull request, and fix the
sentence below the table that reads *"The Maestro layer is not wired into `verify` or CI"* so it
no longer implies the browser suite is in the same position.

- [ ] **Step 8: Commit and merge**

```bash
git add docs/TESTING.md
git commit -m "docs: the browser suite gates merges now"
git push
gh pr checks --watch
gh pr merge --merge --delete-branch
```

---

# PHASE 2 — Product and assets

Tasks 8, 9 and 10 touch disjoint files and may run in any order or in parallel.

---

## Task 8: Rewrite the four gendered strings

**Why:** `server.PLAYER_AFK_AUTO_PASS`, `server.PLAYER_AFK_AUTO_EXCHANGE`,
`server.PLAYER_DISCONNECTED_GRACE` and `server.PLAYER_RECONNECTED` all carry masculine agreement
(*inattivo*, *disconnesso*, *rientrato*), and every one is shown to the whole table several times
a hand. **Decision taken: reword so no agreement is needed.** No gender field on the account.

**Files:**
- Modify: `locales/it.ts` (four values)
- Modify: `locales/sq.ts` (the same four — Albanian carries the same agreement)
- Test: `tests/i18n.test.ts`

Do **not** modify `locales/en.ts`: English needs no agreement and its wording is the source of
truth.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `tests/i18n.test.ts`, inside the `describe("locale key parity")` block:

```ts
// Shown to the whole table several times a hand, so a form that assumes the
// player's gender misgenders someone on most hands. Italian and Albanian both
// inflect these; English does not.
test("no server.* string assumes the player's gender", () => {
  const GENDERED = {
    it: /\b(inattivo|inattiva|disconnesso|disconnessa|rientrato|rientrata|connesso|connessa)\b/i,
    sq: /\b(joaktiv|joaktive|shkëputur|kthyer)\b/i,
  } as const;

  for (const [name, pattern] of Object.entries(GENDERED)) {
    const catalogue = LOCALES[name as LocaleName] as Record<string, string>;
    const offenders = Object.entries(catalogue)
      .filter(([key]) => key.startsWith("server."))
      .filter(([, value]) => pattern.test(value))
      .map(([key]) => key);
    assert.deepEqual(
      offenders,
      [],
      `${name}: these assume a gender — ${offenders.join(", ")}`
    );
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test tests/i18n.test.ts
```

Expected: FAIL, naming all four Italian keys and their Albanian equivalents.

- [ ] **Step 3: Rewrite the Italian**

In `locales/it.ts`:

```ts
  "server.PLAYER_AFK_AUTO_PASS": "{{username}} non risponde — passo automatico",
  "server.PLAYER_AFK_AUTO_EXCHANGE": "{{username}} non risponde — carta scambiata automaticamente",
```

and:

```ts
  "server.PLAYER_DISCONNECTED_GRACE": "{{username}} ha perso la connessione. Ha {{seconds}} secondi per rientrare.",
  "server.PLAYER_RECONNECTED": "{{username}} è di nuovo in partita.",
```

Every `{{placeholder}}` is unchanged — `tests/i18n.test.ts` pins placeholder parity and will
catch a dropped one.

- [ ] **Step 4: Rewrite the Albanian**

In `locales/sq.ts`:

```ts
  "server.PLAYER_AFK_AUTO_PASS": "{{username}} nuk përgjigjet — kaloi automatikisht",
  "server.PLAYER_AFK_AUTO_EXCHANGE": "{{username}} nuk përgjigjet — letra u shkëmbye automatikisht",
```

and:

```ts
  "server.PLAYER_DISCONNECTED_GRACE": "{{username}} humbi lidhjen. Ka {{seconds}} sekonda për t'u rikthyer.",
  "server.PLAYER_RECONNECTED": "{{username}} është sërish në lojë.",
```

**Flag for the owner:** Albanian has never had a native read (`docs/BACKLOG.md` O3). These are
genderless by construction — *nuk përgjigjet* "does not answer", *humbi lidhjen* "lost the
connection", *është sërish në lojë* "is in the game again" — which is the property being fixed,
but the idiom is unverified. Note it against O3 rather than presenting it as reviewed.

- [ ] **Step 5: Run the test and watch it pass**

```bash
node --test tests/i18n.test.ts
```

Expected: PASS, including the existing key-parity and placeholder-parity cases.

- [ ] **Step 6: Check nothing asserts the old wording**

```bash
grep -rn "inattivo\|disconnesso\|rientrato" tests/ docs/ | grep -v node_modules
```

Expected: no hits. `tests/e2e/playwright.config.ts` pins `locale: "it-IT"` and several specs
assert Italian strings — if one names an old value, update it in the same commit.

- [ ] **Step 7: Full verification and commit**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
npm run verify
git add locales/it.ts locales/sq.ts tests/i18n.test.ts
git commit -m "fix(i18n): stop four server messages assuming the player is a man

inattivo / disconnesso / rientrato and their Albanian equivalents are shown to
the whole table several times a hand. Reworded so no agreement is needed, and a
test now refuses a gendered form in any server.* string."
```

---

## Task 9: Widen the Spacing scale, sweep, and enforce it

**Why:** `eslint.config.js` refuses a bare `fontSize` or `borderRadius`, but `padding`, `margin`
and `gap` are still bare numbers at 321 sites across 20 distinct values, against a six-step
`Spacing` scale.

**Correction to the design as originally sketched.** The obvious move — renumbering `Spacing` so
`sm` becomes 6 and `md` becomes 8 — is wrong here: **213 sites already reference `Spacing.*`**
(`sm` 91, `xs` 60, `md` 41, `lg` 18, `xl` 3), and renumbering silently moves every one of them.
This task is **additive**: the six existing names keep their exact values, and new names are added
for the steps the layouts actually use. Nothing that already uses a token moves at all.

**Files:**
- Modify: `lib/tokens.ts`
- Modify: ~20 files under `app/` and `components/`
- Modify: `eslint.config.js`
- Modify: `CLAUDE.md` § Design system

**Interfaces:**
- Consumes: nothing.
- Produces: `Spacing.xxs`, `Spacing.slim`, `Spacing.snug`, `Spacing.cosy`, `Spacing.wide`,
  `Spacing.xxxl`.

- [ ] **Step 1: Measure the real distribution before choosing steps**

```bash
for p in padding paddingVertical paddingHorizontal paddingTop paddingBottom paddingLeft paddingRight margin marginTop marginBottom marginLeft marginRight gap rowGap columnGap; do
  printf "%-20s " "$p"
  grep -rhoE "\b$p: *[0-9.]+" --include='*.tsx' app components | sed 's/.*: *//' | sort -n | uniq -c | tr '\n' ' '
  echo
done
```

Put the output in the commit message. The scale below is derived from it; if the numbers have
moved, re-derive rather than trusting this plan's.

- [ ] **Step 2: Extend the scale additively**

In `lib/tokens.ts`, replace:

```ts
export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};
```

with:

```ts
// The six original steps keep their exact values: 213 sites already reference
// them by name and renumbering would move every one silently. The additions are
// the fine steps the dense layouts — the table chrome, the seat rows, the menu
// lists — already use, so the sweep onto them moves nothing by more than 2px.
export const Spacing = {
  xxs: 2,
  xs: 4,
  slim: 6,
  sm: 8,
  snug: 10,
  cosy: 12,
  wide: 14,
  md: 16,
  lg: 24,
  xl: 32,
  xxxl: 40,
  xxl: 48,
};
```

- [ ] **Step 3: Verify no existing token changed value**

```bash
node -e "
import('./lib/tokens.ts').then(({ Spacing }) => {
  const before = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
  for (const [k, v] of Object.entries(before)) {
    if (Spacing[k] !== v) { console.error('MOVED:', k, v, '->', Spacing[k]); process.exit(1); }
  }
  console.log('every original step unchanged');
});
"
```

Expected: `every original step unchanged`. If this fails, stop — 213 call sites just moved.

- [ ] **Step 4: Sweep, mapping each literal to the nearest step**

Write the sweep as a script so the mapping is auditable:

```bash
cat > /tmp/spacing-sweep.mjs <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Nearest step, never more than 2px away. 0 is left alone: it means "none",
// not "the smallest step".
const STEPS = { 2:"xxs", 4:"xs", 6:"slim", 8:"sm", 10:"snug", 12:"cosy", 14:"wide", 16:"md", 24:"lg", 32:"xl", 40:"xxxl", 48:"xxl" };
const PROPS = "padding|paddingVertical|paddingHorizontal|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap";

const nearest = (v) =>
  Object.keys(STEPS).map(Number).reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

const files = execSync(
  `grep -rlE "(${PROPS}): *[0-9.]+" --include='*.tsx' app components`,
  { encoding: "utf8" }
).split("\n").filter(Boolean);

const moved = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const out = src.replace(
    new RegExp(`\\b(${PROPS}): *([0-9.]+)`, "g"),
    (whole, prop, num) => {
      const v = Number(num);
      if (v === 0) return whole;
      const step = nearest(v);
      if (Math.abs(step - v) > 2) moved.push(`${f}: ${prop} ${v} -> ${step} (${step - v}px)`);
      return `${prop}: Spacing.${STEPS[step]}`;
    }
  );
  if (out !== src) writeFileSync(f, out);
}
console.log(moved.length ? "MOVED MORE THAN 2px:\n" + moved.join("\n") : "nothing moved more than 2px");
JS
node /tmp/spacing-sweep.mjs
```

Expected: `nothing moved more than 2px`. If anything is listed, look at each by hand — a 3px+
move on the game table is a visual change worth seeing before it lands.

- [ ] **Step 5: Add the missing imports**

```bash
npx tsc --noEmit 2>&1 | grep "Cannot find name 'Spacing'" | cut -d'(' -f1 | sort -u
```

For each file, add `Spacing` to its existing `from "@/lib/theme"` import, keeping the quote style
and alphabetical order. Re-run until clean.

- [ ] **Step 6: Read the diff**

```bash
git diff --stat
git diff -U0 | grep -E "^[-+]" | grep -v "^[-+][-+]" | grep -vE "Spacing\.|^[-+]import" | head -20
```

Expected: the last command prints nothing — every changed line is a spacing value or an import.

- [ ] **Step 7: Extend the lint rule**

In `eslint.config.js`, change the selector from:

```js
            "Property[key.name=/^(fontSize|borderRadius)$/] > Literal[raw=/^[0-9.]+$/]",
```

to:

```js
            "Property[key.name=/^(fontSize|borderRadius|padding|paddingVertical|paddingHorizontal|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap)$/] > Literal[raw=/^[1-9][0-9.]*$/]",
```

Note `[1-9][0-9.]*` rather than `[0-9.]+`: `0` stays legal, because "no padding" is not a step on
a scale. Update the message to name spacing, and delete the comment above it saying Spacing is
deliberately absent — no longer true.

- [ ] **Step 8: Prove the extended rule fires**

```bash
npx expo lint; echo "exit=$?"
```

Expected: exit 0. Then break one on purpose:

```bash
sed -i '0,/gap: Spacing\./s//gap: 7, x: Spacing./' components/ErrorFallback.tsx
npx eslint components/ErrorFallback.tsx
git checkout components/ErrorFallback.tsx
```

Expected: the middle command reports `no-restricted-syntax` naming `gap`. **If it reports
nothing, the selector is wrong** — esquery does not coerce a numeric `value`, which is why this
matches on `raw`.

- [ ] **Step 9: Update `CLAUDE.md` § Design system**

Replace:

```
- **No bare literals for colour, radius, font size or timing** — all from `lib/theme.ts`.
  A component-local one-off may be a named module constant. `fontSize` and `borderRadius`
  are enforced by `eslint.config.js`; **`Spacing` is not** — its steps are 4/8/16/24/32/48
  and the layouts nudge by 1, 2, 3 and 6, so paddings and gaps are still bare numbers.
```

with:

```
- **No bare literals for colour, radius, font size, spacing or timing** — all from
  `lib/theme.ts`, and `eslint.config.js` refuses a bare number for any of them. A
  component-local one-off may be a named module constant. `0` is still a plain `0`.
```

- [ ] **Step 10: Verify against a real browser**

This is a visual change across 20 files; the unit suites cannot see it.

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
npm run verify && npm run lint
npx playwright test --config tests/e2e/playwright.config.ts \
  tests/e2e/tapTargets.spec.ts tests/e2e/tableFit.spec.ts
```

Expected: verify clean, lint exit 0, both specs fully passing. `tapTargets` is what catches a
control that shrank below 44pt.

- [ ] **Step 11: Commit**

```bash
git add lib/tokens.ts eslint.config.js CLAUDE.md app components
git commit -m "fix(UI-07): put spacing on the token scale too

321 bare padding/margin/gap literals across 20 values, against a six-step scale.
The scale gains the fine steps the dense layouts already use — added, never
renumbered, since 213 sites reference the existing names — so nothing moves by
more than 2px, and the lint rule now refuses a bare number for any spacing
property."
```

---

## Task 10: Subset the icon fonts

**Why:** PERF-02 took the six text weights from 2,123,508 bytes of TTF to 99,016 bytes of WOFF2.
`Ionicons.ttf` (389,724 B) and `Feather.ttf` (55,596 B) still ship whole, for a few dozen glyphs
— **82% of the font bytes the web downloads**.

**Hazard this task must handle.** Icon names reach `<Ionicons>` both as literals (`name="trophy"`)
and through variables (`name={icon}`, `name={mode.icon}`, `name={modeIcon}`). A missing glyph
renders as a blank box with no error. The character set cannot come from a grep for `name="..."`
alone, and the guard has to be a test that fails on an uncovered name.

**Files:**
- Create: `scripts/iconSubsetChars.mjs`, `scripts/build-icon-fonts.mjs`,
  `scripts/icon-subset.json` (generated)
- Create: `assets/fonts/Ionicons.subset.ttf`, `assets/fonts/Feather.subset.ttf` (committed)
- Create: `tests/iconSubset.test.ts`
- Modify: `metro.config.js`, `docs/HANDOFF.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `iconNames(repoRoot)` → `{ Ionicons: string[], Feather: string[] }` and
  `iconCharacters(repoRoot)` → `{ Ionicons: string, Feather: string }`, both exported from
  `scripts/iconSubsetChars.mjs` and imported by the build script and the test.

- [ ] **Step 1: Enumerate every icon name the app can render**

Create `scripts/iconSubsetChars.mjs`:

```js
/**
 * Every @expo/vector-icons glyph name the app can render, and the characters
 * they map to.
 *
 * Names arrive three ways: as a literal `name="trophy"` prop, as a literal in a
 * table the props read (`icon: "game-controller"`), and as a variable holding
 * one of those. Scanning for the first two catches the third, because every
 * variable is ultimately assigned a literal at some call site — a name built at
 * runtime would be missed, so tests/iconSubset.test.ts refuses a `name={}`
 * expression that is not a plain identifier, member access or literal ternary.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SOURCE_DIRS = ["app", "components", "lib", "context"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

export function iconNames(repoRoot) {
  const found = { Ionicons: new Set(), Feather: new Set() };
  const files = SOURCE_DIRS.flatMap((d) => walk(path.join(repoRoot, d)));

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<(Ionicons|Feather)\b[^>]*?\bname="([a-zA-Z0-9-]+)"/gs)) {
      found[m[1]].add(m[2]);
    }
    // icon: "x" / icon="x" in the tables those props read. Attributed to
    // Ionicons: every such table in this app feeds an <Ionicons>, and a name
    // that is not in its glyphMap is caught by the test rather than silently
    // subsetted into the wrong face.
    for (const m of src.matchAll(/\bicon[:=]\s*"([a-zA-Z0-9-]+)"/g)) {
      found.Ionicons.add(m[1]);
    }
  }
  return { Ionicons: [...found.Ionicons].sort(), Feather: [...found.Feather].sort() };
}

export function iconCharacters(repoRoot) {
  const names = iconNames(repoRoot);
  const out = {};
  for (const family of ["Ionicons", "Feather"]) {
    const glyphMap = JSON.parse(
      readFileSync(
        path.join(
          repoRoot,
          "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps",
          `${family}.json`
        ),
        "utf8"
      )
    );
    const chars = names[family]
      .filter((n) => glyphMap[n] !== undefined)
      .map((n) => String.fromCodePoint(glyphMap[n]));
    out[family] = [...new Set(chars)].join("");
  }
  return out;
}
```

- [ ] **Step 2: Check the extraction before building anything**

```bash
node -e "
import('./scripts/iconSubsetChars.mjs').then((m) => {
  const names = m.iconNames(process.cwd());
  const chars = m.iconCharacters(process.cwd());
  for (const f of ['Ionicons', 'Feather']) {
    console.log(f, names[f].length, 'names ->', [...chars[f]].length, 'glyphs');
    const glyphMap = require('./node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/' + f + '.json');
    const unknown = names[f].filter((n) => glyphMap[n] === undefined);
    if (unknown.length) console.log('  NOT IN GLYPHMAP:', unknown.join(', '));
  }
});
"
```

Expected: roughly 50 Ionicons names and a handful of Feather ones, name count equal to glyph
count for each, and **no `NOT IN GLYPHMAP` line**. If there is one, the attribution is wrong —
fix it before continuing.

- [ ] **Step 3: Write the guard test first**

Create `tests/iconSubset.test.ts`:

```ts
// tests/iconSubset.test.ts — the shipped icon subsets carry every glyph the app
// can render, and no icon name is built at runtime where the scan cannot see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// @ts-ignore -- .mjs helper shared with scripts/build-icon-fonts.mjs
import { iconNames, iconCharacters } from "../scripts/iconSubsetChars.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const glyphmapDir = path.join(
  repoRoot,
  "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps"
);

test("every icon name the app uses exists in its family's glyphmap", () => {
  const names = iconNames(repoRoot) as { Ionicons: string[]; Feather: string[] };
  for (const family of ["Ionicons", "Feather"] as const) {
    const glyphMap = JSON.parse(readFileSync(path.join(glyphmapDir, `${family}.json`), "utf8"));
    const unknown = names[family].filter((n) => glyphMap[n] === undefined);
    assert.deepEqual(unknown, [], `${family}: names not in its glyphmap — ${unknown.join(", ")}`);
  }
});

test("the subsets exist and are much smaller than the originals", () => {
  for (const family of ["Ionicons", "Feather"] as const) {
    const subset = path.join(repoRoot, "assets", "fonts", `${family}.subset.ttf`);
    assert.ok(existsSync(subset), `${subset} is missing — run node scripts/build-icon-fonts.mjs`);
    const original = path.join(
      repoRoot,
      "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts",
      `${family}.ttf`
    );
    const ratio = statSync(subset).size / statSync(original).size;
    assert.ok(ratio < 0.5, `${family}.subset.ttf is ${Math.round(ratio * 100)}% of the original`);
  }
});

// The scan reads literals. A name assembled at runtime would be invisible to it
// and would render as a blank box on the web with no error anywhere.
test("no icon name is built at runtime", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e)) files.push(p);
    }
  };
  for (const d of ["app", "components", "lib", "context"]) walk(path.join(repoRoot, d));

  const offenders: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<(Ionicons|Feather)\b[^>]*?\bname=\{([^}]+)\}/gs)) {
      const expr = m[2].trim();
      // A plain identifier, a member access, or a ternary between two string
      // literals all resolve to a literal the scan above already found.
      const resolvable =
        /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(expr) ||
        /^[^?]+\?\s*"[a-zA-Z0-9-]+"\s*:\s*"[a-zA-Z0-9-]+"$/.test(expr);
      if (!resolvable) offenders.push(`${path.relative(repoRoot, file)}: name={${expr}}`);
    }
  }
  assert.deepEqual(offenders, [], `icon names the subset scan cannot see:\n${offenders.join("\n")}`);
});

test("the characters the subsets were built from cover every name", () => {
  const chars = iconCharacters(repoRoot) as Record<string, string>;
  const manifest: Record<string, string> = JSON.parse(
    readFileSync(path.join(repoRoot, "scripts", "icon-subset.json"), "utf8")
  );
  for (const family of ["Ionicons", "Feather"] as const) {
    const have = new Set(manifest[family]);
    const missing = [...chars[family]].filter((c) => !have.has(c));
    assert.deepEqual(
      missing.map((c) => c.codePointAt(0)?.toString(16)),
      [],
      `${family}: the shipped subset was built without these codepoints — run node scripts/build-icon-fonts.mjs`
    );
  }
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
node --test tests/iconSubset.test.ts
```

Expected: FAIL — the subsets and `scripts/icon-subset.json` do not exist. The first case should
already PASS; if it does not, fix the extraction before building anything.

- [ ] **Step 5: Write the build script**

Create `scripts/build-icon-fonts.mjs`:

```js
/**
 * Rebuilds assets/fonts/{Ionicons,Feather}.subset.ttf and the manifest recording
 * what they were built from.
 *
 *   node scripts/build-icon-fonts.mjs
 *
 * @expo/vector-icons ships both faces whole — 389,724 B and 55,596 B — for the
 * few dozen glyphs this app draws. Committed rather than built on deploy, the
 * same way public/fonts/ and assets/sounds/ are, so Replit needs no extra
 * tooling. tests/iconSubset.test.ts fails if a new icon is used that the shipped
 * subsets were not built with.
 *
 * TTF out, not WOFF2: metro.config.js resolves the vendor .ttf specifier to
 * these, and @expo/vector-icons' own font loading expects a TTF.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import { iconCharacters } from "./iconSubsetChars.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(
  ROOT,
  "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts"
);
const OUT_DIR = path.join(ROOT, "assets", "fonts");

const chars = iconCharacters(ROOT);
mkdirSync(OUT_DIR, { recursive: true });

const manifest = {};
for (const family of ["Ionicons", "Feather"]) {
  const sourcePath = path.join(VENDOR, `${family}.ttf`);
  const subset = await subsetFont(readFileSync(sourcePath), chars[family], {
    targetFormat: "truetype",
  });
  const out = path.join(OUT_DIR, `${family}.subset.ttf`);
  writeFileSync(out, subset);
  manifest[family] = chars[family];
  const before = statSync(sourcePath).size;
  const after = statSync(out).size;
  console.log(
    `${family}: ${before} -> ${after} B (${Math.round((1 - after / before) * 100)}% smaller), ` +
      `${[...chars[family]].length} glyphs`
  );
}

writeFileSync(
  path.join(ROOT, "scripts", "icon-subset.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);
```

- [ ] **Step 6: Build the subsets**

```bash
node scripts/build-icon-fonts.mjs
```

Expected, roughly:

```
Ionicons: 389724 -> ~12000 B (97% smaller), 49 glyphs
Feather: 55596 -> ~4000 B (93% smaller), 8 glyphs
```

- [ ] **Step 7: Point Metro at the subsets**

Replace `metro.config.js` with:

```js
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// @expo/vector-icons ships Ionicons and Feather whole — together 82% of the font
// bytes the web downloaded — for the few dozen glyphs this app draws.
// scripts/build-icon-fonts.mjs writes the subsets; this is what makes the bundle
// use them. tests/iconSubset.test.ts fails if a new icon is used that the subsets
// were not built with.
const ICON_SUBSETS = {
  Ionicons: path.resolve(__dirname, "assets/fonts/Ionicons.subset.ttf"),
  Feather: path.resolve(__dirname, "assets/fonts/Feather.subset.ttf"),
};

const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const family = Object.keys(ICON_SUBSETS).find((f) => moduleName.endsWith(`/Fonts/${f}.ttf`));
  if (family) return { type: "sourceFile", filePath: ICON_SUBSETS[family] };
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
```

- [ ] **Step 8: Prove the bundle actually carries the subset**

```bash
rm -rf dist
npm run expo:web:build
find dist -iname "*onicons*" -o -iname "*eather*" | while read f; do
  echo "$(stat -c%s "$f") $f"
done
```

Expected: both present, each under ~20,000 bytes. **If they are still 389,724 and 55,596 the
resolver did not fire** — log `moduleName` inside `resolveRequest` to see the specifier Metro
actually asks for, and match on that. Do not proceed until the bytes drop.

- [ ] **Step 9: Prove the icons still render**

A subset that drops a needed glyph shows a blank box, silently.

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/tapTargets.spec.ts
```

Expected: all cases pass — that suite visits every screen. Then look with your own eyes:

```bash
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/tapTargets.spec.ts \
  --headed -g "lobby"
```

Confirm the icons are drawn, not empty boxes. **This is the check that cannot be automated
away** — a `.notdef` glyph has a bounding box like any other.

- [ ] **Step 10: Run the guard, then prove it can fail**

```bash
node --test tests/iconSubset.test.ts
```

Expected: PASS, all four cases. Then:

```bash
sed -i 's|<Ionicons name="trophy"|<Ionicons name="rocket-sharp"|' "app/(online)/profile.tsx"
node --test tests/iconSubset.test.ts
git checkout "app/(online)/profile.tsx"
```

Expected: the middle command FAILS on "the characters the subsets were built from cover every
name", naming the missing codepoint.

- [ ] **Step 11: Record the new build output**

In `docs/HANDOFF.md` § Regenerated, not hand-authored, add:

```
- `assets/fonts/*.subset.ttf` — `node scripts/build-icon-fonts.mjs`
```

- [ ] **Step 12: Full verification and commit**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
npm run verify && npm run lint
git add scripts/iconSubsetChars.mjs scripts/build-icon-fonts.mjs scripts/icon-subset.json \
        assets/fonts tests/iconSubset.test.ts metro.config.js docs/HANDOFF.md
git commit -m "perf: subset the icon fonts

Ionicons (389,724 B) and Feather (55,596 B) shipped whole for a few dozen glyphs
— 82% of the font bytes the web downloaded after PERF-02 subset the text faces.
Metro now resolves both to committed subsets, and a test refuses an icon the
shipped subsets were not built with, including one whose name is assembled at
runtime where the scan could not see it."
```

---

# PHASE 3 — One work queue

---

## Task 11: Retire the audit directory and write the deferred work down

**Why:** The remediation is finished — all 15 batches merged, every box ticked. What remains in
`audit/2026-08-17/` is 11,384 lines across 19 files, of which three parts are still live: the
open carried-forward rows, the owner list, and the record of why each decision was taken.
`CLAUDE.md` still tells every session that this backlog outranks `docs/BACKLOG.md`.

**Run this last.** It reads the open rows, and Tasks 1–10 close most of them.

**Files:**
- Modify: `docs/BACKLOG.md`, `docs/BRIEF.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `README.md`,
  `docs/HANDOFF.md`
- Delete: `audit/2026-08-17/`, `.claude/commands/batch.md`

**Interfaces:**
- Consumes: everything closed by Tasks 1–10.
- Produces: `docs/BACKLOG.md` as the single work queue.

- [ ] **Step 1: Take stock of what is still open**

```bash
sed -n '/^## Carried forward/,/^### Not carried forward/p' audit/2026-08-17/PROGRESS.md
cat audit/2026-08-17/OWNER-TODO.md
```

Expected after Tasks 1–10: the `db:push` row is closed by Task 1, the React Compiler and both
flake rows by Tasks 4–6, the icon fonts by Task 10, the Italian strings by Task 8. The iOS sound
check remains. Anything else still open must be carried into `docs/BACKLOG.md` in Step 3 rather
than lost.

- [ ] **Step 2: Rehome the decisions that live nowhere else**

`DECISIONS.md` holds D1–D14. The rule decisions were copied into `docs/BRIEF.md` §3.1 by earlier
batches; the rest are product and lifecycle calls.

```bash
grep -n "^## D" audit/2026-08-17/DECISIONS.md
```

For each, check `docs/BRIEF.md` §3.1 or `docs/ARCHITECTURE.md` already carries it. These do not
and must be added before the file is deleted — one short paragraph each, in present tense, beside
the behaviour they describe, with no reference to the audit:

- **D2** — one human plus bots is a full online match.
- **D3** — a vacated seat keeps playing as a bot, and the table can see it is a bot.
- **D5** — one session per account; the older tab is evicted visibly.
- **D7** — English first, everywhere (`docs/ARCHITECTURE.md`, beside the i18n description).
- **D11** — the room's join code is stored with the saved game.
- **D12** — CI never cancels a run on `main`.

- [ ] **Step 3: Write the deferred work into `docs/BACKLOG.md` §2**

Add these, renumbering to follow the last existing `O<n>`. **The auth item is the one the owner
explicitly asked to be recorded for a separate plan.**

```markdown
| O12 | **Real account recovery, and third-party sign-in.** There is no password reset — no email is stored — and `scripts/reset-password.mjs` is an owner-run stopgap that does not scale past people you know personally. The full answer is its own plan: an email (or phone) on the account, a reset-token table and a sender, an in-app change-password screen, and **Sign in with Apple** and **Sign in with Google**. Apple's guideline 4.8 makes Sign in with Apple mandatory once any other third-party sign-in is offered, so the two arrive together. Touches `shared/schema.ts`, `server/routes.ts`, the auth screens and the store listing. | L | owner |
| O13 | **The database has no backup.** `pg_dump` before a deploy is written into `replit.md` § Rolling back a deploy, but nothing takes one on a schedule. A `scripts/backup-db.mjs` plus somewhere to keep the output. Wanted before the beta user count is large enough that losing it matters. | M | owner |
| O14 | **There is no way to see what beta users are doing.** Client crash reports go to the server log (`POST /api/client-errors`) and nowhere else, and nothing answers "how many people played today" or "did anyone get stuck". An owner-only authenticated view over signups, games played and recent client errors. | M | owner |
| O15 | **Login is rate-limited per IP, 20 attempts per 15 minutes.** Beta testers on one home or office network share that budget and can lock each other out — a confusing first impression that looks like a broken app. Either raise it, or key it per-username with a separate per-IP ceiling. `server/routes.ts` `authLimiter`. | S | owner |
| O16 | **The twelve sound effects have never been played on real iOS or Android hardware.** Asserted, not heard. AVFoundation has decoded MP3 for as long as it has existed, so the risk is small — but a simulator is not the check. Ten minutes with a phone; the list is in `docs/BETA-PLAYTEST.md`. | S | owner |
```

Also note against the existing **O3** (Albanian needs a native pass) that Task 8 reworded four
`server.*` strings without one.

- [ ] **Step 4: Correct O11, which is stale**

O11 says *"`origin/main` is 74 commits behind local `main`, so `.github/workflows/maestro.yml`
does not exist on the remote at all"*. Fifteen batches have since merged.

```bash
git log --oneline origin/main -1
ls .github/workflows/
gh workflow list
```

Rewrite O11 to say what is actually true now, or delete it if Q11 and Q12 are no longer blocked.

- [ ] **Step 5: Cut the audit section out of `CLAUDE.md`**

Delete this section, heading included:

```
## Audit remediation in progress

125 findings in `audit/2026-08-17/`, executed in 15 batches. **Run `/batch <n>` — do not
improvise an implementation prompt.** `PROGRESS.md` holds the queue, per-batch treatment and
run order; `DECISIONS.md` holds settled answers (do not re-open them). While this is live,
that backlog outranks `docs/BACKLOG.md`.
```

Nothing replaces it. `docs/BACKLOG.md` is the work queue again.

- [ ] **Step 6: Find every remaining pointer**

```bash
grep -rn "audit/2026-08-17\|/batch \|OWNER-TODO\|PROGRESS\.md" \
  --include='*.md' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.yml' \
  . --exclude-dir=node_modules --exclude-dir=audit --exclude-dir=graphify-out
```

Expected after Step 5: hits only in `.claude/commands/batch.md`, which Step 7 deletes. Fix any
other file — a dangling pointer is exactly the defect the last batch spent itself removing.

- [ ] **Step 7: Delete**

```bash
git rm -r audit/2026-08-17
git rm .claude/commands/batch.md
```

Every word survives in git: `git log --follow -- audit/2026-08-17/PROGRESS.md` reaches it, and
the per-finding commit messages carry the reasoning for each fix.

- [ ] **Step 8: Verify nothing depended on it**

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
npm run verify && npm run lint
```

Expected: clean. Several tests source-scan the repo; if one reads `audit/`, fix the test rather
than keeping the directory.

- [ ] **Step 9: Read the docs once more as a stranger**

```bash
wc -l docs/*.md *.md
grep -rn "audit" docs/*.md *.md | grep -viE "npm audit|security audit|audited"
```

Expected: no document presents the audit as ongoing or points at a file that no longer exists.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "docs: retire the audit directory, and write down what beta still needs

All 15 batches are merged. What is still open moves to docs/BACKLOG.md §2 —
account recovery and third-party sign-in, a database backup, an owner view over
what beta users are doing, the per-IP login limit, and the iOS sound check — along
with the decisions that had no home outside DECISIONS.md. CLAUDE.md stops telling
every session that an audit backlog outranks docs/BACKLOG.md. Git holds the
11,384 lines."
```

---

## Self-review

**1. Spec coverage.** Every open row and every owner decision maps to a task:

| Source | Task |
|---|---|
| `PROGRESS.md` — React Compiler split | 4 |
| `PROGRESS.md` — TEST-13 step 2 (evaluate 1.0.0) | 4 (deleting the root pin *is* the evaluation — the build already runs 1.0.0) |
| `PROGRESS.md` — `httpCaching` flake | 5 |
| `PROGRESS.md` — `tableFit` flake | 6 |
| `PROGRESS.md` — icon fonts | 10 |
| `PROGRESS.md` — gendered Italian | 8 |
| `PROGRESS.md` — production `db:push` | 1 |
| `PROGRESS.md` — iOS sound check | 3 (script) + 11 (backlog row O16) |
| `docs/BACKLOG.md` O5 — Replit boot unverified | 1 |
| `docs/BACKLOG.md` O11 — stale | 11 Step 4 |
| Owner decision — deploy rehearsal | 1 |
| Owner decision — locked-out user | 2, and O12 for the real answer |
| Owner decision — beta ops to backlog | 11 (O13, O14, O15) |
| Owner decision — play session | 3 |
| Owner decision — Playwright in CI | 7 |
| Owner decision — Spacing | 9 |

Two scope-downs the owner did not overturn — ARCH-16's nullable socket, ARCH-18's comment density
— are deliberately absent.

**2. Placeholder scan.** No TBD, no "similar to Task N", no step that describes without showing.
The `--body "<IDs, and the timing from Step 2>"` in Task 7 Step 5 is a `gh` argument the executor
fills from that task's own output, not a gap in the design.

**3. Type consistency.** `iconNames(repoRoot)` and `iconCharacters(repoRoot)` are defined in Task
10 Step 1 and consumed under exactly those names in Steps 2, 3 and 5. `Spacing`'s new keys
(`xxs`, `slim`, `snug`, `cosy`, `wide`, `xxxl`) are defined in Task 9 Step 2 and every one appears
in the sweep's `STEPS` map in Step 4 — the two lists match. `waitForTableToSettle(page)` is
defined and called in Task 6 Step 3. `assertRenamesApplied` and `RENAMED_COLUMNS` are quoted from
`server/schemaDdl.ts:351-372` as they exist.

**4. Ordering constraints.**
- **Phase 0 runs first, in order 1 → 2 → 3.** Task 3 needs Task 1's deployed URL and Task 2's
  reset script.
- **Task 7 must follow Tasks 5 and 6** — its Step 1 checks.
- **Task 11 runs last** — its Step 1 reads what the others closed.
- Tasks 4, 8, 9 and 10 are independent of each other; they touch disjoint files.

**5. Risk concentration.** Task 1 carries the project's largest unknown — a database change that
cannot be undone by reverting code, which is why it takes a dump first and rehearses the boot
before the deploy. Task 9 (20 files, visual) and Task 10 (a Metro resolver, and a silent failure
mode) carry the implementation risk; both end in a browser check, because neither failure mode is
visible to `node --test`.

**6. What this plan does not do.** It does not add email, third-party sign-in, a backup schedule,
an owner dashboard, or a change-password screen. Those are recorded in `docs/BACKLOG.md` §2 by
Task 11 and are the owner's separate plan. It also does not re-open the two audit scope-downs.

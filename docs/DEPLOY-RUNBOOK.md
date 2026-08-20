# Deploy runbook

> **Scope of this file:** the exact sequence for a Replit deploy that changes the database
> schema destructively (a `db:push`, not just `ensureSchema`'s additive boot-time DDL). Ran
> and verified end to end on 2026-08-19. If a deploy needs no destructive schema change,
> Steps 2–6 are no-ops — verify rather than skip them, since the current column shape is
> what tells you that.
>
> Rolling back is `replit.md` § Rolling back a deploy, not here — the two are one topic split
> across "how to go forward" and "how to go back" so neither buries the other.

## Before you start

- A Replit shell with the production `DATABASE_URL` in the environment.
- A clean `origin/main` — this deploys from `origin/main`, never from a local branch.
- `psql` and `pg_dump` on the shell's `PATH` (Replit's Postgres environment provides both).

## The sequence

1 — Sync to what is about to ship:

```bash
git checkout main && git pull
```

2 — Read the current column shape before touching it. This is what tells you whether Steps
3–6 are live work or a no-op:

```bash
psql "$DATABASE_URL" -c "\d active_games" | grep -E "room_code|room_id"
psql "$DATABASE_URL" -c "\d match_replays" | grep -E "room_code|room_id"
```

If both already show `room_id` and no `room_code`, the push has already been done — skip to
Step 7 and verify rather than assume.

3 — Back up. **Do not proceed without this.** It is the only way back if `db:push` makes a
choice you did not intend:

```bash
pg_dump "$DATABASE_URL" --no-owner --no-privileges \
  -f ~/murlan-predeploy-$(date +%Y%m%d-%H%M%S).sql
```

4 — Check for case-colliding usernames. Boot creates a unique index on `lower(username)`,
and it throws — refusing to start — if two existing rows collide under it:

```bash
psql "$DATABASE_URL" -c \
  "SELECT lower(username), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;"
```

Expected: `(0 rows)`. If not, delete the offending duplicate before continuing.

5 — Run the push, and read what it proposes before answering:

```bash
npm run db:push
```

`drizzle-kit` asks, for each table, whether `room_code` is a **rename** of `room_id` or a new
column. **Answer rename for both.** Answering "create" discards every live game's join code
and leaves two dead columns behind.

6 — Verify the renames landed, and that a second push is a no-op:

```bash
psql "$DATABASE_URL" -c "\d active_games" | grep -E "room_code|room_id"
psql "$DATABASE_URL" -c "\d match_replays" | grep -E "room_code|room_id"
npm run db:push
```

Expected: `room_id` present and `room_code` absent in both tables, and the second `db:push`
reports no changes detected — that is the idempotence proof, not just a formality.

7 — Prove the built server boots against the now-migrated database, before deploying.
**Poll, do not sleep** — a fixed sleep is a race against `ensureSchema` applying its own
statements on top of the push, and a `curl` that runs too early reads as a false failure:

```bash
npm run server:build
NODE_ENV=production PORT=5051 node server_dist/index.mjs > /tmp/boot.log 2>&1 &
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:5051/health && break || sleep 1; done
cat /tmp/boot.log
kill %1
```

Expected: `{"status":"ok","db":"connected", ...}` from `/health` (`server/app.ts`), and the
boot log shows no thrown error. If `assertRenamesApplied()` (`server/schemaDdl.ts`) were
going to throw, it throws here — that is the whole reason this step runs before Deploy rather
than after.

8 — Press **Deploy** in Replit's UI. `.replit` runs
`npm run expo:static:build && npm run expo:web:build && npm run server:build`, then
`npm run server:prod`. Watch the build log for all three builds completing and the run
command starting clean.

9 — Verify the live deployment:

```bash
curl -fsS https://<your-deployment>/health
curl -sI https://<your-deployment>/ | grep -iE "content-security-policy|content-type"
```

Expected: `/health` reports the database connected, and `/` carries a
`Content-Security-Policy` header. **A missing CSP header means the SPA branch did not
take** — check that `dist/index.html` exists in the deployment rather than the Expo Go
landing page.

## If something goes wrong

`replit.md` § Rolling back a deploy — the code half and the database half are separate, and
the database half is not optional once Step 5 has run: reverting the server does not undo the
column renames.

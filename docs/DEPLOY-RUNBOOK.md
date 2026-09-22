# Deploy runbook

> **Scope of this file:** two deploy targets that share only the word. Everything up to
> § What breaks the host is the Replit web deploy; § Backups is the schedule that runs
> independently of any deploy; § Store build numbers is the app stores. The sequence below
> is the exact ordering for a Replit deploy that changes the database
> schema destructively (a `db:push`, not just `ensureSchema`'s additive boot-time DDL). Ran
> and verified end to end on 2026-08-19. If a deploy needs no destructive schema change,
> Steps 2–6 are no-ops — verify rather than skip them, since the current column shape is
> what tells you that.
>
> Rolling back is § Rolling back a deploy, after the sequence — the two are one topic split
> across "how to go forward" and "how to go back" so neither buries the other. What the host
> needs to run at all is § Secrets and § What breaks the host.
>
> § #897 below is a second, unrelated destructive change — dropping the old unconditional
> email index — with its own short sequence, not a step inside the one above.

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
npm run db:backup
```

`scripts/backup-db.mjs` shells out to `pg_dump` and refuses non-zero if it is missing, if the
dump fails, or if it exits 0 having written an empty file — the last being the one a runbook
step would otherwise trust. It writes a timestamped file under `backups/`, which is gitignored
because a dump holds every account; pass a path to put it elsewhere.

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
boot log shows no thrown error. If `assertRenamesApplied()` (`server/store/schemaDdl.ts`) were
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

§ Rolling back a deploy — the code half and the database half are separate, and the database
half is not optional once Step 5 has run: reverting the server does not undo the column renames.

## Rolling back a deploy

There are two independent rollbacks and they are not interchangeable.

**The code** — Replit keeps previous deployments; redeploying an earlier one is the fast path.
To undo a batch of commits in git instead: `git revert -m 1 <merge-sha>` for a whole merge, or
`git revert <commit-sha>` for one commit, then redeploy.

**The database** — a rename applied by `npm run db:push` (§ The sequence) is *not* undone by
reverting the code. A reverted server expects the old column and will not find it, because the
code that wrote it has been rolled back but the schema it left behind has not. Restore the
pre-deploy dump instead:

```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" -f backups/murlan-<timestamp>.sql
```

Take that dump before every deploy that runs `db:push`:

```bash
npm run db:backup
```

There are no migration files — the project uses `drizzle-kit push` against a schema that is
the source of truth. If a push conflicts with existing rows (for example a new unique index
over data that already contains duplicates), the intended recovery is `npm run db:reset`,
not a hand-written migration.

Restoring the dump undoes every write since it was taken, not just the schema change — any
game played, account created, or match finished in that window is gone with it. That is the
trade the dump exists to make available, not one to reach for by default.

## Secrets

The server refuses to boot without these (`server/http/bootEnv.ts`):

- `DATABASE_URL` — in production it must carry an `sslmode` (`?sslmode=require`;
  `sslmode=disable` is an explicit opt-out)
- `SESSION_SECRET` — also used to sign socket auth tickets
- `PUBLIC_HOST` — production only: the bare hostname the app is served from. Browsers on
  `https://$PUBLIC_HOST` and on each origin in the optional comma-separated `ALLOWED_ORIGINS`
  may call the API

`PORT` is read when the host assigns one and defaults to 5000; never hardcode it.

Missing either of these does not stop the server from booting — `server/http/mail.ts` logs a
warning and skips the send, so signup and email verification still complete without them:

- `RESEND_API_KEY` — Resend API key for `server/http/mail.ts`
- `MAIL_FROM_ADDRESS` — the verified "from" address Resend sends as

## What breaks the host

- **The `session` table.** `connect-pg-simple` runs with `createTableIfMissing: false`, so
  `server/store/schemaDdl.ts` creates it at boot instead — nothing else can, because
  `drizzle.config.ts` excludes it from `db:push`. Without that exclusion, a push that adds
  any new table asks whether the new one is a *rename* of `session`, and answering yes
  renames it and logs out every account. Clearing its rows is fine (`scripts/reset-db.mjs`
  does exactly that); dropping it under a running server breaks every login until restart.
- **`app.set("trust proxy", 1)`** in `server/app.ts`. Replit terminates TLS at a proxy,
  so without this Express never considers the connection secure, `Set-Cookie` is silently
  dropped in production, and `express-rate-limit` collapses every client into one bucket.
- **Build steps needing native compilation.** Not available on the host. Native binaries are
  built in EAS Cloud (`eas.json`) — the backend stays on the host, the apps build there.

Express serves the API and, when `dist/` exists, the exported Expo web build as an SPA.
With no web build present it serves the Expo Go QR landing page instead
(`server/http/templates/landing-page.html`). Both paths are in `configureExpoAndLanding()`.

`ALLOW_RESET=1 node scripts/reset-password.mjs <username>` sets a new random password on one
account and prints it once.

## #897 — dropping the old email uniqueness index (required, not optional)

`shared/schema.ts` now declares `users_email_verified_lower_uq`, a **partial** unique index on
`lower(email) WHERE email_verified_at IS NOT NULL`, in place of the old unconditional
`users_email_lower_uq`. `ensureSchema()` (`server/store/schemaDdl.ts`) is additive only, so it
creates the new index on its own at the next boot — no manual step for that half. What it
never does is drop the old one, and the two disagree: while both exist, the old index still
refuses two accounts sharing an unverified email, which is exactly the claim (not possession)
behaviour #897 exists to allow.

**This step must run as part of this deploy, not "when convenient."** Registration no longer
degrades safely against an un-migrated database. The code review behind this note (#894) found
that the previous safe-looking degradation — a neutral 202 with no account and no session
cookie — was itself a defect: it was a second, non-neutral registration outcome the client
could not tell apart from success, and it answered a stranger's probe just as precisely as the
oracle #897 exists to close. `server/http/routes.ts`'s register route no longer catches
`EmailTakenError` at all. Against an un-migrated database — one where the old unconditional
index still stands — every registration that collides with an existing unverified email now
throws uncaught and the route replies **500**, loudly, until this step runs. That is the
intended failure mode: loud and visible in the server log rather than a silent leak. But it
means real registrations can 500 from the moment this code boots, so treat dropping
`users_email_lower_uq` as part of this deploy's own steps, before announcing the app or
opening it to new signups — not a follow-up to get to later.

1 — Back up. Same requirement as Step 3 above, for the same reason:

```bash
npm run db:backup
```

2 — Confirm the new index already exists (a normal deploy creates it at boot) and the old one
still does:

```bash
psql "$DATABASE_URL" -c "\d users" | grep -E "users_email_lower_uq|users_email_verified_lower_uq"
```

Expected: both present. If `users_email_verified_lower_uq` is missing, a deploy carrying this
change has not yet booted against this database — deploy first, then come back to this step.

3 — Run the push, and **read what it proposes before answering**:

```bash
npm run db:push
```

`drizzle-kit` will ask whether removing `users_email_lower_uq` from the schema means to
**drop** it or **rename** it to something else. **Answer drop.** There is no column or index
in the new schema this one could be a rename of — `users_email_verified_lower_uq` is a
differently-scoped index on the same expression, not the same index renamed. Answering
"rename" would leave the unconditional constraint alive under a new name and this step would
have accomplished nothing.

4 — Verify the drop landed, and that a second push is a no-op:

```bash
psql "$DATABASE_URL" -c "\d users" | grep -E "users_email_lower_uq|users_email_verified_lower_uq"
npm run db:push
```

Expected: only `users_email_verified_lower_uq` present, and the second `db:push` reports no
changes detected.

## Backups

`npm run db:backup` (Step 3 above) also runs on a schedule, independent of any deploy, so
nobody has to remember it. Set up a **Replit Scheduled Deployment** (dashboard: *Publishing →
Scheduled*) with:

- **Run command:** `npm run db:backup && npm run db:backup:prune`
- **Schedule:** once daily; the exact hour doesn't matter, only that it runs.
- **Storage:** a Replit Volume mounted so `backups/` persists between runs — a Scheduled
  Deployment's filesystem is otherwise ephemeral, and a dump nobody can find tomorrow is not
  a backup. This is the destination the owner chose (2026-08-24): it survives a bad migration
  or a mis-answered `db:push` prompt, not the loss of the Replit instance itself. Moving
  dumps off-box is a separate decision, not made here.

`scripts/prune-backups.mjs` deletes dumps older than `BACKUP_RETENTION_DAYS` (default 14),
read from the timestamp already in each dump's filename. It never deletes the most recent
dump regardless of age — a lapsed schedule must not leave zero backups behind.

Restoring a dump is § Rolling back a deploy, not duplicated here.

## Store build numbers

`app.json` carries `version` and no `ios.buildNumber` or `android.versionCode`, and that is
deliberate. `eas.json` sets `appVersionSource: "remote"`, which moves both to EAS's servers:
[Expo's reference](https://docs.expo.dev/build-reference/app-versions/) is explicit that
under it "the build version values stored in app config are ignored and not updated when the
version is incremented remotely". Putting them back would leave a number in the tree that
reads as authoritative, is never consulted, and drifts from the counter the stores enforce.

Nothing to bump per submission. The `production` profile sets `autoIncrement: true`, so each
`eas build --profile production` raises both by one. Because there is no local value to seed
from, the first such build initialises the remote counter at `1`.

Reading or correcting them — a submission made outside EAS is the case that needs it:

```bash
eas build:version:set     # overwrite the remote counter
eas build:version:sync    # copy the remote values down into app.json
```

`sync` is for looking, not a step: it writes the two fields into `app.json`, which is the
state this section exists to avoid. Revert it once you have read the numbers.

`version` is unrelated and stays local. It is what the product calls itself, and it moves
when the product does — not when a build does.

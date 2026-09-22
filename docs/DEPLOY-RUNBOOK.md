# Deploy runbook

> **Host status:** Replit is no longer the host, and the next one is undecided
> (`docs/adr/0006-the-host-is-no-longer-replit.md`, #1107). This file keeps only what holds on
> any host — the database procedure, the env contract, and the app-store build numbers. Every
> step that depended on Replit specifically (the shell, the Deploy button, the Scheduled
> Deployment, redeploying a previous build) is cut to a stub below, to be rewritten once #1107
> lands.

## Before a destructive schema change

A destructive `db:push` — a rename, a drop, a new unique index over data that may already
collide — is not undone by `ensureSchema()`'s additive boot-time DDL. Do this every time, on
whatever host is current:

1 — Back up. **Do not proceed without this.** It is the only way back if `db:push` makes a
choice you did not intend:

```bash
npm run db:backup
```

`scripts/backup-db.mjs` shells out to `pg_dump` and refuses non-zero if it is missing, if the
dump fails, or if it exits 0 having written an empty file — the last being the one a runbook
step would otherwise trust. It writes a timestamped file under `backups/`, which is gitignored
because a dump holds every account; pass a path to put it elsewhere.

2 — Check for case-colliding usernames. `shared/schema.ts` declares
`users_username_lower_uq`, a unique index on `lower(username)`, and it is not in
`schemaDdl.ts`'s `DEDUPE_ON_BOOT` set — so unlike a handful of other indexes, boot does *not*
delete the colliding rows for you, and `CREATE UNIQUE INDEX` throws, refusing to start, if two
existing rows collide under it:

```bash
psql "$DATABASE_URL" -c \
  "SELECT lower(username), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;"
```

Expected: `(0 rows)`. If not, delete the offending duplicate before continuing.

3 — Run the push, and **read what it proposes before answering**. `drizzle-kit push` has no
migration files — `shared/schema.ts` is the source of truth, and for every column or index it
can't match up it asks whether the new name is a **rename** of the old one or a brand-new one.
Answer from what the change actually is:

```bash
npm run db:push
```

Answering "create" where the intent was a rename discards the old column's data and leaves a
dead column behind; answering "rename" where the intent was a genuinely new object carries
old data onto it. If a push conflicts with existing rows (for example a new unique index over
data that already contains duplicates), the intended recovery is `npm run db:reset`, not a
hand-written migration.

4 — Verify the change landed and that a second push is a no-op:

```bash
npm run db:push
```

Expected: `db:push` reports no changes detected — that is the idempotence proof, not just a
formality.

5 — Prove the built server boots against the migrated database before it serves traffic.
**Poll, do not sleep** — a fixed sleep races `ensureSchema()` applying its own statements on
top of the push, and a `curl` that runs too early reads as a false failure:

```bash
npm run server:build
NODE_ENV=production PORT=5051 node server_dist/index.mjs > /tmp/boot.log 2>&1 &
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:5051/health && break || sleep 1; done
cat /tmp/boot.log
kill %1
```

Expected: `{"status":"ok","db":"connected", ...}` from `/health` (`server/app.ts`), and the
boot log shows no thrown error.

## Rolling back

**The database** — a change applied by `npm run db:push` is *not* undone by reverting the
code. A reverted server expects the old shape and will not find it, because the code that
wrote the new one has been rolled back but the schema it left behind has not. Restore the
pre-change dump instead:

```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" -f backups/murlan-<timestamp>.sql
```

Restoring the dump undoes every write since it was taken, not just the schema change — any
game played, account created, or match finished in that window is gone with it. That is the
trade the dump exists to make available, not one to reach for by default.

**The code** — host-specific; § Host-specific steps.

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

The runtime shape any host must provide is `deploy/runtime.json`: the Node and Postgres
majors, the number of proxy hops in front of the app (`trustProxySetting()` in
`server/http/cors.ts`), the SIGTERM grace period, and the Postgres connection budget per
instance. `tests/server/deployRuntime.test.ts` pins the code against this file.

## What holds on any host

- **The `session` table.** `connect-pg-simple` runs with `createTableIfMissing: false`, so
  `server/store/schemaDdl.ts` creates it at boot instead — nothing else can, because
  `drizzle.config.ts` excludes it from `db:push`. Without that exclusion, a push that adds
  any new table asks whether the new one is a *rename* of `session`, and answering yes
  renames it and logs out every account. Clearing its rows is fine (`scripts/reset-db.mjs`
  does exactly that); dropping it under a running server breaks every login until restart.
- **`app.set("trust proxy", …)`** in `server/app.ts`, sized by `deploy/runtime.json`'s
  `proxyHops`. Any host that terminates TLS in front of the app needs this — without it
  Express never considers the connection secure, `Set-Cookie` is silently dropped in
  production, and `express-rate-limit` collapses every client into one bucket.
- **Build steps needing native compilation.** Native binaries are built in EAS Cloud
  (`eas.json`) regardless of where the backend runs — the two are independent.

Express serves the API and, when `dist/` exists, the exported Expo web build as an SPA.
With no web build present it serves the Expo Go QR landing page instead
(`server/http/templates/landing-page.html`). Both paths are in `configureExpoAndLanding()`.

`ALLOW_RESET=1 node scripts/reset-password.mjs <username>` sets a new random password on one
account and prints it once.

## Backups

`npm run db:backup` (§ Before a destructive schema change) is meant to also run on a schedule,
independent of any deploy, so nobody has to remember it:

- **Run command:** `npm run db:backup && npm run db:backup:prune`
- **Schedule:** once daily; the exact hour doesn't matter, only that it runs.
- **Storage:** wherever `backups/` persists between runs on the current host — a dump nobody
  can find tomorrow is not a backup.

`scripts/prune-backups.mjs` deletes dumps older than `BACKUP_RETENTION_DAYS` (default 14),
read from the timestamp already in each dump's filename. It never deletes the most recent
dump regardless of age — a lapsed schedule must not leave zero backups behind.

Where the schedule itself runs is host-specific; § Host-specific steps.

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

## Host-specific steps: pending #1107 (ADR-0006)

Everything that depended on a specific host — where to run `psql`/`pg_dump` from, what
triggers a build and deploy, how to verify a live deployment, where a previous build is kept
for fast rollback, and where the daily backup schedule executes — is undecided until #1107
picks the next host. Rewrite this section once it does.

# Server

Loaded when you read anything under `server/`. When a rule number is cited and you cannot see
the rule, it lives in `docs/agents/RULES.md`; invariants here are pinned by the test named on
each line.

## Production — breaking any of these takes it down

The host is being chosen (#1105; ADR-0006 retired Replit). `deploy/runtime.json` is the contract
any host must meet — Node and Postgres majors, SIGTERM grace, proxy hops, connections per
instance — and the server and tests read it.

- **Boot fails fast without its env** (`server/http/bootEnv.ts`): `SESSION_SECRET` and
  `DATABASE_URL` always; in production also `PUBLIC_HOST`, and a `DATABASE_URL` carrying an
  `sslmode`. `PORT` defaults to 5000.
- **Production runs `deploy/runtime.json`'s Node (22), not the repo's.** `server:build`'s
  `--target=node22` lowers *syntax* only, so a newer-Node builtin compiles at exit 0 and throws in
  production. CI's `build` job boots on that Node and is the one that catches it.
- **`server/store/schemaDdl.ts` is the only thing that creates tables**, at boot, from
  `shared/schema.ts`. Keep every statement additive and idempotent. The one exception: a unique
  index named in `DEDUPE_ON_BOOT` is preceded by a delete of the rows it would reject, or
  `CREATE UNIQUE INDEX` fails and the server does not start; `tests/server/schemaDdl.test.ts`
  allows that delete only for a listed index and only on its own key. A second creator is how
  `session` came to exist on one database and nowhere else.
- **`session` table**: `createTableIfMissing: false`, absent from `shared/schema.ts`, excluded from
  drizzle-kit by `tablesFilter`. Clear its rows; never drop it while the server runs.
- **Before a schema change** — `pg_dump` first, and read `db:push`'s rename-or-drop prompt
  (`docs/DEPLOY-RUNBOOK.md`) rather than accepting it. The database holds no real accounts yet, so
  a reshape loses nothing today — reject a design for losing data only once there is data; the
  habit is built ahead of it. Order a change by design, not deploy cost: derive from existing rows
  → ride an existing jsonb column → new table → new column.

## Server invariants — each is a bug that shipped

Verify against source before changing any.

- **Server authority.** The server validates every move and broadcasts sanitized state; never
  trust client state for an outcome.
- **Ticket auth only.** The handshake accepts a live session or a single-use ticket; a bare
  `handshake.auth.userId` is an impersonation vector (`tests/integration/auth.test.ts`).
- **Register every listener before the first `await`** in the socket connection handler.
  Socket.io drops events with no listener, and the client emits `game:rejoin` synchronously on
  connect.
- **One socket per userId**, via `lib/socket.ts`; `SocketContext` owns the lifecycle.
- **A winner is an engine player id (`player_N`)** — the only identity every client can map at
  every moment `game:over` can arrive, and the only one surviving a vacated seat.

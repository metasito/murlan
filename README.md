# Murlan

A digital version of Murlan, a traditional Albanian shedding-type card game. The UI is
English, Italian and Albanian; English (`locales/en.ts`) is the source of truth and the
other two are translations of it. The game itself is Albanian in origin.

## Stack

- **Frontend:** Expo Router (React Native, also runs as a web build)
- **Backend:** Express.js + Socket.io
- **Database:** PostgreSQL via Drizzle ORM
- **Auth:** bcryptjs + express-session, 30-day httpOnly cookies stored in Postgres
- **Real-time:** socket.io / socket.io-client

See `docs/ARCHITECTURE.md` for how the system is built, and `CLAUDE.md` for the
conventions an agent working here has to keep.

## Running it locally

```sh
npm install
```

You need `DATABASE_URL` and `SESSION_SECRET` set (see `.env` / your shell environment) —
the server fails fast on boot if either is missing. In production it also needs `PUBLIC_HOST`,
and a `DATABASE_URL` carrying an `sslmode`. `PORT` defaults to 5000.

```sh
npm run server:dev   # Express + Socket.io (tsx, no build step)
EXPO_PUBLIC_DOMAIN=<host:port> npm run expo:dev   # Expo dev server, over a tunnel
```

## Deploying it

Starting the built server (`npm run server:build && npm run server:prod`) serves both the
REST API and the Expo web bundle — no extra setup beyond the env in `docs/DEPLOY-RUNBOOK.md`
§ Secrets. The host itself is undecided (`docs/adr/0006-the-host-is-no-longer-replit.md`,
#1107); deploy details (the `session` table, `trust proxy`, deployment shape) are documented
in `docs/DEPLOY-RUNBOOK.md`, not here.

## Tests

```sh
npm run typecheck    # tsc --noEmit
npm run typecheck:strict  # scripts/checkStrictIndexed.mjs
npm test             # node --test, everything under tests/
npm run loop:test    # node --test, the ticket loop under tools/loop/tests/
npm run test:native  # jest, the tests/native/ renderer suites
npm run lint         # npx expo lint
npm run verify       # typecheck, typecheck:strict, test, test:native and lint — the game's sweep, lint last
npm run test:e2e     # Playwright — needs Docker and a built web bundle
```

## Database

The server applies `shared/schema.ts` itself on every start (`server/store/schemaDdl.ts`):
missing tables, columns, indexes and enum types are created, nothing is dropped or
retyped. Running the app against an empty database is all the setup there is.

```sh
npm run db:push   # only for destructive changes — dropping, retyping, renaming
npm run db:reset  # DESTRUCTIVE — refuses unless you opt in explicitly (see below)
```

`db:reset` empties every table's contents except `session` (which is only
emptied, never dropped — see `docs/DEPLOY-RUNBOOK.md` for why), then re-applies the schema.

It cannot run from the npm script alone, by design: the script does not set the
opt-in variable, and the underlying script refuses outright when
`NODE_ENV=production`. To really wipe a non-production database:

```sh
ALLOW_DESTRUCTIVE=1 node scripts/reset-db.mjs --yes && npm run db:push
```

## Documentation map

| Doc | Owns |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | Agent operating instructions, conventions, file map |
| [`docs/GAME-RULES.md`](./docs/GAME-RULES.md) | The canonical Murlan rule specification |
| [`docs/BRIEF.md`](./docs/BRIEF.md) | Scope, decisions and their rationale |
| [GitHub Issues](https://github.com/metasito/murlan/issues) | Everything outstanding, and what was decided against (`rejected` label) |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Layers, data flow, socket lifecycle, persistence |
| [`docs/agents/checks.md`](./docs/agents/checks.md) | Which check catches what, what it costs, and the traps that pass every check |
| [`docs/BETA-PLAYTEST.md`](./docs/BETA-PLAYTEST.md) | The manual pre-beta playtest script, and what it has to cover |
| [`docs/DEPLOY-RUNBOOK.md`](./docs/DEPLOY-RUNBOOK.md) | Deploying, rolling back, the host's Secrets and what breaks it |

## Licence and contributions

**This source is public to read. It is not licensed for reuse.** There is no
`LICENSE` file and that is deliberate (#297): all rights are reserved, so it may
not be copied, modified or redistributed. Read it, learn from it, and write your
own.

Outside pull requests are not accepted. Issues are welcome — a bug report on the
live game is useful whether or not the code is reusable.

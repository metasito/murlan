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
the server fails fast on boot if either is missing.

```sh
npm run server:dev   # Express + Socket.io (tsx, no build step)
npm run expo:dev      # Expo dev server
```

## Running it on Replit

The Run button starts the Express server, which serves both the REST API and the Expo
web bundle — no extra setup. Replit-specific details (required Secrets, the `session`
table, `trust proxy`, deployment shape) are documented in `replit.md`, not here.

## Tests

```sh
npm run typecheck    # tsc --noEmit
npm test             # node --test, everything under tests/
npm run test:native  # jest, the tests/native/ renderer suites
npm run lint         # npx expo lint
npm run verify       # all four of the above, lint last
npm run test:e2e     # Playwright — needs Docker and a built web bundle
```

## Database

The server applies `shared/schema.ts` itself on every start (`server/schemaDdl.ts`):
missing tables, columns, indexes and enum types are created, nothing is dropped or
retyped. Running the app against an empty database is all the setup there is.

```sh
npm run db:push   # only for destructive changes — dropping, retyping, renaming
npm run db:reset  # DESTRUCTIVE — refuses unless you opt in explicitly (see below)
```

`db:reset` empties every table's contents except `session` (which is only
emptied, never dropped — see `replit.md` for why), then re-applies the schema.

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
| [`docs/RULES.md`](./docs/RULES.md) | The canonical Murlan rule specification |
| [`docs/BRIEF.md`](./docs/BRIEF.md) | Scope, decisions and their rationale |
| [GitHub Issues](https://github.com/metasito/murlan/issues) | Everything outstanding, and what was decided against (`rejected` label) |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Layers, data flow, socket lifecycle, persistence |
| [`docs/TESTING.md`](./docs/TESTING.md) | What each test layer covers and how to run it |
| [`replit.md`](./replit.md) | Replit-specific run/deploy notes |

# Murlan

A digital version of Murlan, a traditional Albanian shedding-type card game. The UI is
English, Italian and Albanian; English (`locales/en.ts`) is the source of truth and the
other two are translations of it. The game itself is Albanian in origin. The stack is
`package.json`'s dependency list.

- **Before working in this repo** — `CLAUDE.md`: the conventions an agent keeps here.
- **Before asking how the system is built** — `docs/ARCHITECTURE.md`: layers, data flow,
  socket lifecycle, persistence.
- **Before changing or arguing about a game rule** — `docs/GAME-RULES.md`: the specification
  the engine implements.

## Running it locally

```sh
npm install
npm run server:dev   # Express + Socket.io (tsx, no build step)
EXPO_PUBLIC_DOMAIN=<host:port> npm run expo:dev   # Expo dev server, over a tunnel
```

Needs `DATABASE_URL` and `SESSION_SECRET` in the environment — the server fails fast on boot
without them. `server/CLAUDE.md`'s Production section has the full env contract (what's needed
only in production, `PORT`'s default).

## Deploying it

Starting the built server (`npm run server:build && npm run server:prod`) serves both the
REST API and the Expo web bundle — no extra setup beyond the env in `docs/DEPLOY-RUNBOOK.md`
§ Secrets. The host itself is undecided (`docs/adr/0006-the-host-is-no-longer-replit.md`,
#1105); `deploy/runtime.json` is the contract any host must meet, and deploy details (the
`session` table, `trust proxy`, deployment shape) are documented in `docs/DEPLOY-RUNBOOK.md`,
not here.

## Tests

Before running or picking a check — `docs/agents/checks.md`: which one catches what, what it
costs, and the traps that pass every check and still ship broken. The commands themselves are
`package.json`'s scripts; `npm run verify` is the local sweep.

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

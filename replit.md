# Murlan — Replit Environment Notes

> **Scope of this file:** how to run and deploy Murlan *on Replit*, and nothing else.
> It deliberately does not describe the architecture, the game rules, or the roadmap —
> those live elsewhere and duplicating them here is how the two copies drifted apart
> in the first place.
>
> | You want | Read |
> |---|---|
> | How the system is built | `CLAUDE.md` |
> | The game's rules, and their sources | `docs/RULES.md` |
> | Scope, decisions, definition of done | `docs/BRIEF.md` |
> | Everything still outstanding | `docs/BACKLOG.md` |

---

## Running it

The Run button starts the Express server, which serves both the REST API and the Expo
bundle. No extra setup.

| Script | Purpose |
|---|---|
| `npm run server:dev` | Express + Socket.io in dev (tsx, no build step) |
| `npm run expo:dev` | Expo dev server, proxied through the Replit domain |
| `npm run server:build` / `server:prod` | esbuild bundle, then run it |
| `npm run verify` | Typecheck + tests. Run this before pushing. |
| `npm run db:push` | Reconcile the database *destructively* — drops, retypes, renames. Not needed to deploy: the server applies additive schema changes itself at boot |
| `npm run db:reset` | **Destructive.** Refuses on its own — needs `ALLOW_DESTRUCTIVE=1 node scripts/reset-db.mjs --yes`, and never runs under `NODE_ENV=production` |

## Required Secrets

All three must be set in Replit Secrets or the server refuses to boot
(`server/index.ts` fails fast on missing values):

- `DATABASE_URL` — Replit-managed PostgreSQL
- `SESSION_SECRET` — also used to sign socket auth tickets
- `PORT` — assigned by Replit; never hardcode it

## Things that will break Replit if you change them

- **`process.env.PORT`.** Replit assigns it dynamically.
- **The `session` table.** `connect-pg-simple` runs with `createTableIfMissing: false`, so
  `server/schemaDdl.ts` creates it at boot instead — nothing else can, because
  `drizzle.config.ts` excludes it from `db:push`. Without that exclusion, a push that adds
  any new table asks whether the new one is a *rename* of `session`, and answering yes
  renames it and logs out every account. Clearing its rows is fine (`scripts/reset-db.mjs`
  does exactly that); dropping it under a running server breaks every login until restart.
- **`app.set("trust proxy", 1)`** in `server/index.ts`. Replit terminates TLS at a proxy,
  so without this Express never considers the connection secure, `Set-Cookie` is silently
  dropped in production, and `express-rate-limit` collapses every client into one bucket.
  This was a live bug; do not remove it.
- **Build steps needing native compilation.** Not available here. Native binaries are built
  in EAS Cloud (`eas.json`), not on Replit — the backend stays here, the apps build there.

## Database

Managed PostgreSQL, accessed through Drizzle (`server/db.ts`). Schema is
`shared/schema.ts`, and `server/schemaDdl.ts` applies it on every server start:
tables, columns, indexes and enum types that are missing get created, and
nothing is ever dropped or retyped. Deploying a schema change needs no manual
step, and a database Replit has just reprovisioned works on the first boot.

`npm run db:push` is for the changes boot deliberately will not make — dropping
a column, narrowing a type, renaming anything.

There are no migration files — the project uses `drizzle-kit push` against a schema that is
the source of truth. If a push conflicts with existing rows (for example a new unique index
over data that already contains duplicates), the intended recovery is
`npm run db:reset`, not a hand-written migration.

## Deployment shape

Express serves the API and, when `dist/` exists, the exported Expo web build as an SPA.
With no web build present it serves the Expo Go QR landing page instead
(`server/templates/landing-page.html`). Both paths are in `configureExpoAndLanding()`.

# 0015. Every runtime and service on its latest usable stable release: Node 26, Postgres 18, Valkey 9

**Status:** Accepted; supersedes ADR-0014's "Redis 7"
**Date:** 2026-11-02

## Context

On 2026-11-02 the owner asked for every runtime, service and dependency to be on its latest
stable release, and for each product's best features to be used where they help (#1911). The
stack had versions nobody chose on purpose. Postgres 16 was pinned before the audit. Redis 7 came
over from the audit's decision sheet into ADR-0014. Production ran Node 22 while dev ran 24.

#1911 defines **usable** as three conditions. The release is GA. The libraries we depend on
support it. And it is offered by the one-provider hosting candidates of #1107: Render, Fly.io
and DigitalOcean. The host itself is still undecided.

The evidence, the per-package table and the ticket breakdown are in
`docs/research/2026-11-02-latest-stable-releases.md`.

## Decision

`deploy/runtime.json` holds the majors. Every image and job follows it, as before.

1. **Node 26 LTS, for dev, CI and production alike.** One major removes the gap that
   `--target=node22` used to hide. `tsx` goes: Node runs the server's TypeScript itself.
2. **Postgres 18 (18.6).** Postgres 19 is not GA. It moves only once it is GA and one #1107
   candidate offers it.
3. **Valkey 9 (9.1.3) replaces Redis.** *Why:* no one-provider host offers Redis 8, and Render
   and DigitalOcean both run Valkey. Valkey is BSD, while Redis 7.4 and 8 are not. The protocol
   is unchanged, so `REDIS_URL`, the `redis` client and the streams adapter stay. No code uses a
   Valkey-9-only command. If the chosen host offers only Valkey 8, the manifest follows the host,
   at no cost.
4. **Every library moves to its newest release that its peers allow.** Four are held back by
   their peers, not by choice:
   - TypeScript stays on 6, because of typescript-eslint.
   - ESLint stays on 9, because of Expo's lint plugins.
   - Babel stays on 7, because of babel-preset-expo.
   - drizzle stays on 0.45, because 1.0 is an RC.

   Expo SDK 58 sets React Native 0.88.1 and React 19.3.0. `prom-client` is replaced by
   `@prometheus-io/client`, its renamed successor.
5. **Features adopted**, each measured by its ticket before it lands:
   - Postgres 18's `uuidv7()` for the append-only tables' ids.
   - Postgres 17's `transaction_timeout` on the round-results transaction.
   - Postgres 18's skip scan, used to drop `events_occurred_idx` if `EXPLAIN` shows it redundant.
   - Node's type stripping, in place of `tsx`.
   - Zod 4's faster parsing on the socket and persistence paths.
   - Jest 30, if it is not slower.

   Asynchronous I/O and Postgres 17's `= ANY` lookups come with the bump itself.
6. **Features rejected.** Each is judged no better than what the code already does:
   - Hash-field expiry for presence: it needs a periodic write per online user, which #1894
     forbids, and an expired field leaves the sweeper no member to clean up.
   - `DELIFEQ`: it saves one script and ties the code to Valkey 9 before the host is chosen.
   - Redis 8's `INCREX`, `XNACK` and `XREADGROUP CLAIM`: they are Redis-only, and nothing here
     uses consumer groups.
   - Postgres's `OLD`/`NEW` in `RETURNING`, virtual generated columns, `MERGE … RETURNING`,
     `JSON_TABLE` and `COPY`: no statement here needs them.
   - Node's Temporal, `module.SourceMap`, the permission model and zstd.
   - Anything in Valkey 9.2 or Postgres 19: neither is GA.

## Consequences

- An agent who meets `redis:7`, `postgres:16` or Node 22 is looking at what this record retires.
  An agent who meets "Redis" in code or docs reads it as the protocol, which Valkey serves.
- A Valkey-only or Redis-only command, such as `DELIFEQ` or `INCREX`, needs the host to offer it.
  Before #1107 is decided, it needs a new decision.
- A held-back library moves when its blocking peer does. Until then it is not a forgotten bump.
- The host chosen in #1107 must offer Postgres 18 and Valkey 8 or newer.
- The work is carried by the tickets in the research note, A to N, created on map #1898.

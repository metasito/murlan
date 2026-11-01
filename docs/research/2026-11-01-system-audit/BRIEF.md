# System design and performance audit: brief

Owner request, 2026-11-01, rewritten as a brief.

## Goal

Judge whether Murlan's backend and its client data paths meet the bar of a top-tier real-time
multiplayer game. Prove each verdict from the code and from measurements, not from diagrams or
convention. Then fix what falls short.

## Out of scope

The 2026-10-16 design-audit programme (#1650) already covered ownership: one owner per decision.
This audit does not re-review module boundaries. It covers how the system behaves under load:
latency, throughput, cost per operation, and failure modes.

## Questions to answer

1. **Schema and indexes.** Does every query the server runs have an index that serves it? Are
   foreign keys, uniqueness and cascades correct for the access patterns? Are there unbounded
   scans, N+1 loops, or per-row queries that should be one set-based query?
2. **Caching.** Which reads hit Postgres on every request though their answer rarely changes
   (profiles, ratings, leaderboards, friend lists, room lookups)? Where would a cache cut database
   calls without serving stale data that matters? What already lives in memory (live tables)?
3. **Slow work on the hot path.** Which operations block a socket handler or an HTTP response on
   I/O they need not wait for: mail, push, stats, ratings, replays, analytics events, error
   recording? Which belong behind an in-process queue, a batch, or a durable job?
4. **Real-time path.** What does one move cost end to end: CPU, database writes, bytes broadcast,
   `pg_notify` calls? How does it scale with tables, seats and spectators? Where is the ceiling of
   the Postgres Socket.io adapter?
5. **Connection pools.** Are pool sizes, idle and connection timeouts, keep-alive, statement
   timeouts and recycling right for `deploy/runtime.json`'s host contract? What happens when
   Postgres restarts, a connection goes stale, or the pool runs dry?
6. **Horizontal scale.** Can a second and a tenth instance join? Which state is per-process
   (rate limits, presence, table ownership), and what breaks when an instance dies or deploys?
7. **Client data paths.** Does the client fetch only what a screen needs, dedupe and cache it
   (React Query settings), and avoid refetch storms on reconnect?

## Method

- **Read the code.** Trace every query, every pool and every socket path to file and line.
- **Measure.** Run each hot query with `EXPLAIN (ANALYZE, BUFFERS)` against a seeded database
  sized for launch (for example 50k users, 5M `round_history` rows). Load-test the live table
  path with simulated clients on the dev-stack Postgres: many concurrent tables of bots and
  humans, reporting move latency (P50/P99), database writes per move, pool wait time and
  `NOTIFY` volume. A claim without a number says so.
- **Verify.** Every finding is re-checked against the source and the measurement before it is
  reported. A finding that does not survive is dropped, not softened.

## Deliverables

1. `REPORT.md` beside this brief: each finding ranked by impact, with file and line, the
   measurement that proves it, the fix, and its expected effect.
2. The simulation scripts and their raw results, so every number can be rerun.
3. Fixes grouped into a few PRs, one per area, each red-then-green, through the normal review
   and CI gates. A fix that changes the socket protocol, storage or many files gets a design
   first.

## Done when

Every question above has a verdict backed by code and a number, every confirmed finding has a fix
merged or a ticket filed, and the load test is rerun after the fixes to show the change.

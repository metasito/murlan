# Valkey 9.1.3 against Redis 7.4.12 on our store patterns (part of #1921)

Run 2026-11-03 on one Linux machine (4 vCPU Xeon @ 2.10 GHz). Each engine was started with the same
flags (no persistence, `--io-threads 1`, `noeviction`) and pinned to core 1; one `valkey-benchmark`
9.1.3 drove both from cores 2-3. Median of 3 runs; spreads, p50/p99 and every command are in
`raw/bench/summary.md` and `raw/bench/commands.txt` (`bench.sh`). The payloads are real inbox
entries of the measured median sizes (`raw/payload-*.json`).

| pattern | Redis 7.4.12 req/s | Valkey 9.1.3 req/s |
|---|---|---|
| inbox `XADD NOMKSTREAM MAXLEN ~ 120000` (state delivery) | 83,250 | 81,599 |
| same, at the cap | 86,926 | 85,063 |
| same, table-ask sized | 108,050 | 102,375 |
| `XREAD COUNT 1` | 92,963 | 90,868 |
| `XREAD COUNT 100` | 5,937 | 5,674 |
| rate-limit increment script | 72,685 | 75,432 |
| rate-limit decrement script | 105,230 | 99,970 |
| owner clear, the Lua it replaced | 85,063 | 83,250 |
| owner clear, `DELIFEQ` | — | **117,509** |
| owner refresh, the Lua it replaced | 85,063 | 83,292 |
| owner refresh, `SET … IFEQ` | — | **107,365** |

Same-command rows agree within the run-to-run spread. The native commands that replaced the Lua are
1.41x (`DELIFEQ`) and 1.29x (`SET … IFEQ`) the Lua on the same engine.

## Entry sizes (`entry-sizes.ts`, 16 tables over 2 instances, ~2 min, seeds 4242-4244)

- Inbox entry field+value: mean 1,703-1,708 B, p50 353 B, p99 ~4.26 KB; `MEMORY USAGE` 1,885-1,890 B/entry.
- State deliveries mean ~3.29 KB; table-ask 327 B; table-answer 91 B.

## One stream at its cap (`fill.ts`, 120,000 replayed real entries, 3 runs each)

- Redis 7.4.12: `MEMORY USAGE` 222.2 MiB (1,942 B/entry).
- Valkey 9.1.3: `MEMORY USAGE` 208.4 MiB (1,821 B/entry).

So each capped stream costs ~210 MiB on Valkey: one inbox per instance plus the adapter stream, about
650 MiB at the design peak for two instances.

## Not measured here (still open on #1921)

The `active_games` fillfactor (`fillfactor.sh` is written but was not run), the `DEPLOY-RUNBOOK.md`
`maxmemory` entry, and every Postgres 19 comparison (#1913, #1927).

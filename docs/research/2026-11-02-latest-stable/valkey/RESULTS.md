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

- Redis 7.4.12: `MEMORY USAGE` 222.2 MiB (1,942 B/entry); `used_memory` grew 208.5 MiB.
- Valkey 9.1.3: `MEMORY USAGE` 208.4 MiB (1,821 B/entry); `used_memory` grew 208.5 MiB.

`used_memory` is what `maxmemory` counts, and both engines grow it by the same 208.5 MiB; Redis
7.4's `MEMORY USAGE` overstates its own stream. The adapter's room stream received no entry in the
two-instance soak: every game message is addressed through the inboxes. `docs/DEPLOY-RUNBOOK.md`
§ Key-value store memory turns this into `maxmemory` (1 GiB for two instances at the design peak).

## `active_games` fillfactor 70 against the default (`fillfactor.sh`, Postgres 16.15)

The move write (`activeGameStore.write`'s upsert, epoch fence included) as a pgbench custom script
over 1,000 rows, with the median envelope from the soak (9,548 B of text, 2,782 B stored), 8
clients, 60 s a run, 5 runs per setting, interleaved. Raw: `raw/fillfactor.txt`.

| fillfactor | tps median | tps spread | HOT ratio (`n_tup_hot_upd / n_tup_upd`) |
|---|---|---|---|
| default (100) | 1,544 | 1,325-2,565 | 0.9982 (0.9963-0.9992) |
| 70 | 1,581 | 1,252-2,293 | 1.0000 |

**Rejected.** Throughput differs by 2.4%, inside a run-to-run spread of 1,252-2,565 tps; the HOT ratio moves from
99.8% to 100%. The default already gets nearly every update HOT because the envelope is compressed
and stored out of line: the heap row is about 150 B, so each page keeps room for its update chain,
and the per-move cost is the TOAST rewrite, which a heap fillfactor does not touch. The soaked
table itself read 0.9952 at the default. A first, non-interleaved run showed 70 ahead 1.8x; run
interleaved under the same load, the gap vanished, so it was the run order (kept, labelled, in the
raw file). `server/store/schemaDdl.ts` is unchanged.

## Not measured here (still open on #1921)

Every Postgres 19 comparison (#1913, #1927).

# #1911 research: Redis / Valkey

Date of research: 2026-11-02. Read-only on the repo. No benchmarks run, nothing executed against an engine.

**Access limits of this session.** `render.com`, `valkey.io`, `redis.io`, `upstash.com`, `fly.io` did not resolve (not on the session's network allow-list); `docker.io`/`hub.docker.com`, `github.com`, `raw.githubusercontent.com`, `registry.npmjs.org`, `mirror.gcr.io` did. Anything about Render, Upstash and Fly below comes from search-result summaries, not from reading their docs, and is marked **[unverified]** where a number or behaviour could not be confirmed. Ask for those five hosts to be allowed if the owner wants the open items closed.

---

## 0. Executive recommendation

- **Engine: Valkey, major 8 (pin 8.1.11) for CI, soak, mutation and the dev stack, because Render Key Value runs Valkey 8.x.** Production and test must be the same engine. Render's changelog: new instances use Valkey 8.1 (2025-04-22) ([changelog](https://render.com/changelog/new-render-key-value-instances-use-valkey-8-1)); docs say "new instances run Valkey 8" ([docs](https://render.com/docs/key-value)). I found no Render announcement of Valkey 9. Heroku already ships Valkey 9 GA ([Heroku changelog](https://devcenter.heroku.com/changelog-items/3793)); Render has not, as far as searchable.
- **Every ADOPT item below works on Valkey 8.1** (nothing needs the hash-field-TTL or DELIFEQ of 9.0). The two features that would simplify the unbuilt presence/owner designs (HEXPIRE, DELIFEQ) are LATER: they need Valkey 9.0 and give no measurable gain over three short Lua scripts.
- **Upgrade path**: Valkey 8.1 -> 9.x has no listed breaking changes in the 9.0.0 or 9.1.0 GA notes. Re-pin when Render offers 9. Optional: a non-gating soak run on `9.1.3` to pre-qualify.
- **Redis 8: reject as the target.** Different engine from the likely host, tri-licence (fine for us, but needless friction), and its best new features (DELEX, XACKDEL, `SET IF*` 8.4) are spelled differently from Valkey's.
- **Do not use Upstash for this workload** unless on a fixed-price plan: the idle command rate of our connection design is about 9.5M commands per instance-month (section 6).
- **Client stack stays**: node-redis, `@socket.io/redis-streams-adapter`, `rate-limit-redis`.

Proposed `deploy/runtime.json` change: replace `"redis": 7` with
```json
"keyValue": { "engine": "valkey", "major": 8, "maxmemoryPolicy": "noeviction" }
```
(`maxmemoryPolicy` is a host setting the manifest should state; section 4.)

---

## 1. Latest GA versions, licensing, governance

### Versions (all as of 2026-11-02)

| Line | Latest GA | Date | Source |
|---|---|---|---|
| Valkey 9.1 | 9.1.3 ("Latest") | 26 Oct 2026 | [valkey releases](https://github.com/valkey-io/valkey/releases) |
| Valkey 9.0 | 9.0.7 | 26 Oct 2026 | same |
| Valkey 8.1 | 8.1.11 | 26 Oct 2026 | same |
| Valkey 8.0 | 8.0.12 | 26 Oct 2026 | same |
| Valkey 9.2 | 9.2.0-rc1 (pre-release, not GA) | 16 Sep 2026 (page) | same |
| Redis 8.10 | 8.10.3 ("Latest") | 26 Oct 2026 | [redis releases](https://github.com/redis/redis/releases) |
| Redis 8.8 / 8.6 / 8.4 / 8.2 | 8.8.4 / 8.6.8 / 8.4.8 / 8.2.11 | 26 Oct 2026 | same |
| Redis 7.4 (our current pin, `redis:7-alpine`) | 7.4.12 | image updated 2026-10-29 | [Docker Hub tags API](https://hub.docker.com/v2/repositories/library/redis/tags?name=alpine) |

There is no Valkey 8.2 (the 8.x line ends at 8.1). The 8.10.3/8.8.4/8.6.8/8.4.8/8.2.11 and Valkey patch releases of 26 Oct all carry a security fix (Redis: heap overflow in cluster-bus message propagation, [redis releases](https://github.com/redis/redis/releases)); pins must be re-bumped regularly, which the digest pin plus a bot already handles.

Release cadence: Valkey 8.0 (2024), 8.1 GA 31 Mar 2025 ([8.1 notes](https://raw.githubusercontent.com/valkey-io/valkey/8.1.0/00-RELEASENOTES)), 9.0 GA 21 Oct 2025 ([9.0.0](https://github.com/valkey-io/valkey/releases/tag/9.0.0)), 9.1 GA 19 May 2026 ([9.1 notes](https://raw.githubusercontent.com/valkey-io/valkey/9.1.0/00-RELEASENOTES)): about two minors a year. Redis ships a minor roughly every two to three months (8.0 -> 8.10 in 18 months by the tag list), each a new line to track.

### Licensing

- **Redis 8.0+: choose one of RSALv2, SSPLv1, AGPLv3** ([8.0.0 release page](https://github.com/redis/redis/releases/tag/8.0.0)). Redis 7.4 (what we run today) was released under RCL/SSPL and 7.2 was the last BSD-3 release ([Percona summary](https://www.percona.com/blog/its-end-of-life-for-redis-enterprise-7-2-in-six-months-what-are-your-options/)). So our current pin is already source-available, not OSI-open.
- **What this means for us** (not legal advice; the AGPL text is the authority; sources on Redis 8 licensing in the press only describe the network clause, [tocao](https://tocao.substack.com/p/redis-8-is-here-back-to-open-source)):
  - AGPL section 13 obliges whoever **modifies** the program and lets users interact with it over a network to offer those users the modified source. We run an unmodified binary as a backing service and do not modify it: nothing is triggered. Our server speaks the Redis wire protocol to it; that is not linking or a derivative work, so our own code's licence is unaffected.
  - We do not distribute the image (CI pulls it; a host runs it). Conveying obligations (AGPL sections 4-6) fall on whoever redistributes.
  - A managed host (Render, ElastiCache) that offers Redis 8 as a service carries RSALv2/SSPL/AGPL obligations itself; that is why hosts ship Valkey. For us as the host's customer: no obligation.
  - If we ever patched Redis (we have no reason to), AGPL would require publishing the patch to users of our service.
  - Practical cost is policy friction (some employers and acquirers reject AGPL outright), not a legal trigger.
- **Valkey: BSD-3-Clause** (the container build records `licenseDeclared: BSD-3-Clause`, [valkey-container Dockerfile](https://raw.githubusercontent.com/valkey-io/valkey-container/mainline/8.1/alpine/Dockerfile)). No obligations beyond notice.

### Governance and longevity

- **Valkey**: Linux Foundation project, created March 2024 by former Redis maintainers; a six-member technical steering committee from six different companies so that no vendor dominates ([Linux Foundation / admin-magazine](https://www.admin-magazine.com/HPC/News/Linux-Foundation-Launches-Valkey); [wiki](https://en.wikipedia.org/wiki/Valkey)). Supported by AWS, Google Cloud, Oracle, Ericsson, Snap, and now offered by Render, Heroku, ElastiCache, Memorystore. I did not retrieve a current TSC roster or contributor counts (valkey.io unreachable). Active patching of 8.0, 8.1, 9.0 and 9.1 in parallel on 26 Oct 2026 (above).
- **Redis**: single vendor (Redis Ltd), licence changed twice in 24 months (BSD -> RSAL/SSPL 2024 -> + AGPL in 8.0, 2025). Healthy release cadence, but the licence history is the risk the Valkey fork exists for.

---

## 2. Compatibility

### Client (node-redis)

- Latest is **6.3.1** (`npm view redis version`, modified 2026-10-29); the repo pins 6.3.0 (the npm-deps agent owns the bump). Engines: Node >= 20.
- Static check of the 6.3.1 tarball (`dist/lib/commands`): typed commands exist for `HEXPIRE`, `HPEXPIRE`, `HEXPIREAT`, `HTTL`, `HPERSIST`, `HGETEX`, `HSETEX`, `HGETDEL`, `MSETEX`, `DELEX`, `DIGEST`, `XACKDEL`, `XDELEX`, `SET` with `condition: 'IFEQ'|'IFNE'|'IFDEQ'|'IFDNE'` (documented "since 8.4"), and `XREADGROUP` with `CLAIM`. So no `sendCommand` is needed for Redis spellings.
- **Not portable between engines**: node-redis exposes Redis's `DELEX key IFEQ v`; Valkey's equivalent is a separate command `DELIFEQ key v` (Valkey 9.0, [9.0 notes](https://raw.githubusercontent.com/valkey-io/valkey/9.0.0/00-RELEASENOTES): "Add DELIFEQ command (#1975)") which node-redis has no helper for, so it would go through `sendCommand`. `SET ... IFEQ` is Valkey 8.1 ([8.1.0-rc1 note, #1324](https://github.com/valkey-io/valkey/releases/tag/8.1.0); [PHP client changelog](https://pecl.php.net/package-changelog.php?package=redis&release=6.3.0)) and Redis 8.4 with the same `SET key value IFEQ match` shape. Valkey 9.0 added hash field expiration (`Introduce HASH items expiration (#2089)`), including `HSETEX`, `HGETEX`, `HEXPIRE`, `HPERSIST` ([9.0 notes](https://raw.githubusercontent.com/valkey-io/valkey/9.0.0/00-RELEASENOTES); command list per [skills.sh guide](https://skills.sh/avifenesh/valkey-skills/valkey), secondary). I found no `XACKDEL`/`XDELEX` in the Valkey 9.0 or 9.1 release notes.
- **Handshake**: `server/store/redis.ts` sets `maintNotifications: "disabled"`. That is the right setting for Valkey (the maint-notification handshake is a Redis feature); it also removes a startup `CLIENT` command a non-Redis server would reject. Keep it. RESP: node-redis 6 defaults to RESP2; Valkey and Redis 8 both speak it. No RESP3 change needed or wanted.
- **`_maintenanceUpdate`** (private API used in `watchForHalfOpen`) is node-redis-specific: switching client library means rewriting `server/store/redis.ts` and its blackhole test. This is the main reason to stay.

### Alternatives considered

- **Valkey GLIDE** (`@valkey/valkey-glide` 2.5.3, [npm](https://www.npmjs.com/package/@valkey/valkey-glide)): Rust core, official Valkey client. REJECT: `@socket.io/redis-streams-adapter` takes a node-redis (v4+/v5-shaped) or ioredis client; it calls `duplicate()`, `xRead`, `xAdd`, `subscribe` on it (checked in `dist/util.js`). GLIDE is neither, and our half-open watchdog, offline-queue semantics and error listener contract are node-redis-shaped. Gain would be unmeasured.
- **iovalkey** (0.4.0, ioredis fork): REJECT for the same wiring reason, plus a thinner maintainer base; the adapter supports ioredis, but we would still rewrite `redis.ts`, the limiter's `sendCommand`, and tests.

### Streams adapter and rate-limit-redis

- `@socket.io/redis-streams-adapter` 0.3.1 (latest; `npm view`, modified 2026-03-12). Commands issued (read from `dist/util.js`, `dist/adapter.js`): `XADD key MAXLEN ~ n * ...`, `XREAD BLOCK ms COUNT n STREAMS key id`, `XRANGE`, `PUBLISH`/`SUBSCRIBE` (private + reply channels), `SPUBLISH`/`SSUBSCRIBE` only in sharded mode, `SET`/`GETDEL` for connection-state recovery, plus our own `PUBSUB CHANNELS pattern`. All core commands unchanged since Redis 5/6.2; Valkey 8.1 states it is "fully compatible with all previous Valkey releases as well as Redis OSS 7.2.4" ([8.1.0 notes](https://raw.githubusercontent.com/valkey-io/valkey/8.1.0/00-RELEASENOTES)). Expect it to work; **I did not run it**. The proof is the existing integration suite pointed at the new image (`redisBlackhole`, `redisDegraded`, adapter tests).
- `rate-limit-redis` 6.0.2 available (repo ^6.0.1). Its scripts (read from `dist/index.mjs`) are `PTTL`/`SET ... PX`/`INCR`/`GET` through `SCRIPT LOAD` + `EVALSHA` with NOSCRIPT recovery: fine on any Lua-capable engine. Valkey 9.1 moves the Lua engine into a module that is "statically linked by default" ([9.1 notes](https://raw.githubusercontent.com/valkey-io/valkey/9.1.0/00-RELEASENOTES)); scripts still work.

### Breaking changes 7.x -> target

- **RDB/AOF**: Valkey reads/writes files compatible with Redis OSS 7.2; **RDB from Redis 7.4+ (format 12, hash-field TTL) cannot be loaded by Valkey** ([Valkey migration guide](https://valkey.io/topics/migration/); [valkey#645](https://github.com/valkey-io/valkey/issues/645)). **Irrelevant for us**: Postgres is the record (ADR-0014), Redis holds only TTL'd, rebuildable keys. The engine switch is "start empty". Cost to plan: instances on the old and new engine cannot talk to each other during the cutover, so it is a stop-the-world flip of `REDIS_URL` with a brief `TABLE_UNREACHABLE` window, which degraded mode is designed to absorb. Do it before real players exist (the DB holds no real accounts yet).
- **Valkey vs Redis server name**: Valkey reports Redis compat version 7.2.4 in `INFO` for client compatibility; engine-detection code must read the Valkey-specific field, not `redis_version`. **[unverified from docs; read `INFO server` on the pinned image before writing the check]**.
- **Docker image differences (verified in the Dockerfile)**: the Dockerfile re-links every `valkey*` binary to `valkey-server` ([Dockerfile lines 78-84](https://raw.githubusercontent.com/valkey-io/valkey-container/mainline/8.1/alpine/Dockerfile)). **Correction, 2026-11-02:** `redis-cli` and `redis-server` still exist, because Valkey's own `make install` adds them as links by default (`USE_REDIS_SYMLINKS?=yes`, [src/Makefile:379 at 8.1.11](https://raw.githubusercontent.com/valkey-io/valkey/8.1.11/src/Makefile)). So `--health-cmd "redis-cli ping"` keeps working, and the advice below to change it is withdrawn. The image patches `protected-mode` off for Docker. Runs as user `valkey` (uid 999).
- **Redis 8**: modules (JSON, time series, five probabilistic types, Query Engine, vector set beta) are in every binary; the release notes list no breaking changes ([8.0.0](https://github.com/redis/redis/releases/tag/8.0.0)). Default `protected-mode`/ACL changes: not found in the sources I could read **[unverified]**.
- `KEYS`: not used anywhere in `server/` (grep clean); `PUBSUB CHANNELS pattern` in `socketAdapter.ts` is O(channels) and is the only keyspace-wide command.

---

## 3. Feature survey

What we use today (grep of `server/`): `XADD MAXLEN ~` + `EXPIRE` in one `EVAL` (inbox), `XREAD BLOCK 2000`, `SET PX`, three tiny Lua scripts (`REFRESH_IF_MINE`, `CLEAR_IF_MINE`, `DECREMENT_LIVE_COUNT`) plus rate-limit-redis's two, `PUBSUB CHANNELS`, `PING` every 5 s on every connection. Planned (D8, TICKETS.md lines 124-141): `presence:<userId>` hash `{instance, socket, table}` with CAS on `socket` (two scripts), `instance:<id>` key with 10 s TTL refreshed every 3 s, set `instances`, set `instance-users:<id>`, `MGET`/pipelined `HMGET`.

Numbers below are the release notes' own and are workload-specific; "unmeasured" means nobody measured it on our workload (and I did not benchmark).

| Feature | Replaces | Expected gain | Risk | Verdict |
|---|---|---|---|---|
| **Hash-field TTL** (`HEXPIRE`, `HPEXPIRE`, `HGETEX`, `HSETEX`, `HPERSIST`; Redis 7.4/8.0, Valkey 9.0) for presence and liveness | Nothing it can fully replace. D8 needs the *identity* of a dead instance to notify its users' friends; a field that has expired is gone, so the set `instances` + `instance-users:<id>` stay. A `HSETEX alive ... PX 10000` hash would only save N `EXISTS` calls on a handful of instances | None measurable | Needs Valkey >= 9.0, which Render does not offer; 9.1 fixed a `HPERSIST` protocol bug ([9.1 rc2](https://raw.githubusercontent.com/valkey-io/valkey/9.1.0/00-RELEASENOTES)) and 9.0.0 fixed `HSETEX FXX` creating keys, i.e. young code | **LATER** (revisit when host is on 9.x and a design needs per-field expiry) |
| **Conditional `SET ... IFEQ`** (Valkey 8.1, Redis 8.4) | `REFRESH_IF_MINE`'s "mine -> extend" branch (`SET k v PX ttl IFEQ v`); the "absent -> create" branch still needs `SET NX`, so two commands where one script is today | Removes 1 of 3 scripts at the price of a two-step refresh. Unmeasured | Low; works on both engines with the same spelling | **LATER**: a swap with no gain; take it only if a script is touched anyway |
| **`DELIFEQ` (Valkey 9.0) / `DELEX ... IFEQ` (Redis 8.4)** | `CLEAR_IF_MINE` exactly, and presence delete-if-socket if presence is stored as a string `"<instance>:<socket>"` (CAS on whole value) rather than a hash field | Removes up to 2 more scripts. Unmeasured | **Engine-specific spelling**; not on Render's 8.1; node-redis exposes only the Redis form | **LATER** (reject the lock-in; Lua is portable and already tested) |
| **`DIGEST`, `IFDEQ/IFDNE`** (Redis 8.4) | nothing | none | Redis-only | **REJECT** |
| **`XACKDEL` / `XDELEX`** (Redis 8.2), **`XREADGROUP ... CLAIM`** (Redis 8.4) | Nothing: the inbox is plain `XREAD` from an in-memory offset, trimmed by `MAXLEN ~` and `EXPIRE 120`. Consumer groups would add at-least-once redelivery, but an instance id is a fresh `randomUUID()` per boot, so a dead instance's inbox must never be replayed (its tables are taken over from Postgres, ADR-0014 decision 3) | Negative: pending lists and acks per message for no semantic need | Redis-only (not in Valkey 9.0/9.1 notes) | **REJECT** |
| **Valkey 8 multi-threaded I/O**; Redis 8's new I/O threads ("30% more throughput for caching on 4 cores", [8.4.0 notes](https://github.com/redis/redis/releases/tag/8.4.0)) | nothing | Design peak is `maxClusterMessagesPerSecond` = 1,000 messages/s cluster-wide (`deploy/runtime.json`), two orders of magnitude under what one thread serves; `io-threads` off by default and a small host plan has few cores | none | **REJECT** as a driver (unmeasured for us; not worth a tuning knob) |
| **Valkey 8.x memory efficiency** (new hashtable, key embedding, hash value embedding; [8.1 notes](https://raw.githubusercontent.com/valkey-io/valkey/8.1.0/00-RELEASENOTES) give no figures) and 9.1 (embedded string threshold 64 -> 128 bytes, "30% GET throughput gain"; IO-thread redesign "8-17%", [9.1 rc2](https://raw.githubusercontent.com/valkey-io/valkey/9.1.0/00-RELEASENOTES)) | nothing | A free side effect of choosing Valkey; our keyspace is tiny. The memory that matters is stream payloads (below), which these do not change | none | **N/A** (comes with the engine) |
| **Valkey 9: atomic slot migration, numbered DBs in cluster** | n/a: single node, non-cluster, db `/0` | none | none | **REJECT** (irrelevant) |
| **Redis 8 built-ins** (Query Engine, JSON, time series, Bloom/Cuckoo/CMS/Top-k/t-digest) | nothing; leaderboards/stats are Postgres | none | Bigger attack surface; Redis-only (Valkey has them as separate modules) | **REJECT** |
| **`CLIENT NO-EVICT`**, **`CLIENT NO-TOUCH`** | `NO-EVICT` protects a connection from client-eviction when `maxmemory-clients` is set; `NO-TOUCH` stops LRU/LFU updates. We set neither and `noeviction` makes both moot | none | none | **REJECT** |
| **`WAITAOF`** | n/a: loss of Redis is survivable by design | none | would turn a degraded mode into a stall | **REJECT** |
| **Redis Functions vs `EVAL`** | The 3 scripts. Functions survive restart, avoid shipping script text | Inbox `SEND` is an `EVAL` of the full text on every message (about 200 bytes/message); `EVALSHA` via node-redis `defineScript` would cut that. Unmeasured | `FUNCTION LOAD` at boot per instance, library-version coordination across a rolling deploy, host may restrict | **REJECT Functions; ADOPT `EVALSHA`** for the inbox send (see below) |
| **Keyspace notifications** for liveness expiry | The 3 s heartbeat sweep in D8 | none: pub/sub is fire-and-forget (a missed event strands a dead instance's users), needs `notify-keyspace-events` which a managed host may not let us set | fragile | **REJECT** (keep D8's polling sweep) |
| **RESP3 + `CLIENT TRACKING`** | nothing: no hot read-mostly cache in Redis | none | RESP3 changes reply shapes the adapter and limiter parse | **REJECT** |
| **`maxmemory-policy noeviction`** | n/a, a setting | Prevents silent loss; see section 4 | OOM errors become write failures, which our code already treats as degraded mode | **ADOPT** |
| **`INFO` polling for metrics/guards** (works on every engine and version) | health.ts only `PING`s | Makes eviction, memory, blocked clients, rejected connections and engine version visible | none | **ADOPT** |
| **Inbox/adapter `XADD ... MINID ~`** instead of `MAXLEN ~` (since 6.2) | the count-based bound derived from the design peak | Memory would follow real traffic, but a burst is no longer bounded | lose the hard cap | **REJECT** (the cap is the point; the adapter hardcodes `MAXLEN` anyway) |

### Current-version features we are not using but should (checked against code)

1. **`EVALSHA` for `instanceInbox.ts` SEND**: `writer.eval(SEND, ...)` sends the script body on every cross-instance message; with N messages per second that is N x about 200 bytes of pointless upload and a server-side SHA1 per call. node-redis `defineScript` does `EVALSHA` with NOSCRIPT fallback (the limiter already depends on that behaviour via rate-limit-redis). Check it against the offline-queue comment ("one script, not a MULTI"): it stays one command. ADOPT, small.
2. **`INFO`-based observability** (above): `used_memory`, `maxmemory`, `evicted_keys`, `blocked_clients`, `connected_clients`, `rejected_connections`, `maxmemory_policy`, and the engine name/version as a labelled gauge. The repo has `redis_reconnects_total` and two stream-lag histograms (`server/shared/metrics.ts`) but nothing about the server's own state. A boot check that logs loudly (not exits) if `maxmemory_policy` is not `noeviction` or the engine differs from `deploy/runtime.json` closes the prod/CI drift this whole ticket is about. `CONFIG GET` may be denied on a managed host; `INFO memory` carries `maxmemory_policy` without it.
3. **Persistence off** for the host instance if the host offers it: nothing in Redis needs to survive a restart (presence/liveness/owners/limit counts all rebuild or expire), and Render itself says to turn persistence off for cache-style use ([Render docs via search](https://render.com/docs/key-value)). Paid Render instances default to disk-backed `appendfsync everysec` ([Render skill](https://github.com/render-oss/skills/blob/main/skills/render-keyvalue/SKILL.md)); harmless, but a restart then reloads stale entries until their TTLs lapse. **[Render option names unverified]**
4. **ACL user scoped to the key prefix**: LATER; depends on whether the host exposes ACLs.

### What simplifies #1893-#1896

Nothing in Valkey 8.1 or Redis 8 removes a ticket. The only feature that touches their design is conditional delete, and it removes lines of Lua, not a failure mode. The correctness risk in those tickets (compare-and-set races, dead-instance cleanup) is application design, which is the same on every engine. Do not let the version floor drive the D8 shape; **write D8 against Valkey 8.1 primitives (strings, hashes, sets, TTL, Lua)**.

### Stream memory sizing (affects the Render plan, not the engine)

`streamMaxLen()` = 1,000 x 120 = **120,000 entries** per stream (adapter room stream, plus one inbox stream per instance). `MAXLEN ~` overshoots by up to one listpack node (about 100 entries). Stream memory is therefore about 120,000 x average packet size: at 1 KB packets that is about 120 MB per stream at the *design peak sustained for 2 minutes*, far less in real use, but the plan must be chosen with `maxmemory` > (1 + instances) x that, or `noeviction` turns a burst into write errors. **Unmeasured**; the benchmark agent should supply real average packet size.

---

## 4. Eviction policy: `noeviction`, and why it is necessary

Everything we store is either a bounded stream or a key with a TTL: `allkeys-*` policies may evict a live presence entry, a table-owner record, a limit counter, or a stream mid-read, silently, and the design cannot tell eviction from expiry (a missing `presence:` key means "offline", a missing `table-owner:` means "unowned"). `volatile-*` policies skip the adapter's stream (it has no TTL) but would evict the others. With `noeviction`, the failure is an `OOM command not allowed` error on a write: each of our paths already turns a Redis error into degraded mode (limiter falls back to local memory, `send` rejects -> `TABLE_UNREACHABLE`, owner writes log a warning). Render lets you choose the policy at creation and change it later; the options are `allkeys-lru`, `noeviction`, `volatile-lru`, `volatile-lfu`, `allkeys-lfu`, `volatile-random`, `allkeys-random`, `volatile-ttl`, and it recommends `noeviction` for job queues ([Render skill](https://github.com/render-oss/skills/blob/main/skills/render-keyvalue/SKILL.md)). Its default was not stated in anything I could read **[unverified]**: set it explicitly in `render.yaml` (`maxmemoryPolicy: noeviction`).

---

## 5. Hosting candidates

### Render Key Value (recommended by the issue)

- Engine: **Valkey 8.x**; new instances on 8.1 since 2025-04-22; instances created before 2025-02-12 are on Redis 6 and never updated ([Render changelog](https://render.com/changelog/new-render-key-value-instances-use-valkey-8-1), [docs](https://render.com/docs/key-value)). No Valkey 9 announcement found. Pre-April-2025 8.x instances sit on 8.0.1 per the changelog, so a new instance matters: **after provisioning, run `INFO server` and record the exact version**.
- Persistence: paid instances are disk-backed with `appendfsync everysec`; free instances have none, and upgrading from free loses data ([Render skill](https://github.com/render-oss/skills/blob/main/skills/render-keyvalue/SKILL.md)).
- Access: internal URL `redis://red-xxx:6379` for same-region, same-workspace services, unauthenticated by default (auth can be required); external access is off unless an IP allow-list is set, and uses `rediss://` with auth. `render.yaml` type is `keyvalue` (the `redis` alias is deprecated) with `plan`, `region`, `maxmemoryPolicy`, `ipAllowList` (required; `[]` = internal only) ([same skill](https://github.com/render-oss/skills/blob/main/skills/render-keyvalue/SKILL.md)).
- Open: per-plan memory and max connections (our per-instance count is about 9 connections: adapter x3, inbox x2, limits, owners, health, plus presence planned), whether Valkey 9 is on a roadmap, whether `INFO`/`CONFIG GET` are allowed. **[unverified; render.com not reachable]**

### Fly.io

- `fly redis` provisions **Upstash Redis**, billed through Fly ([Fly docs, per search](https://fly.io/docs/reference/redis/)); Fly's docs still describe it, no deprecation found. Self-run Valkey on a Fly machine with a volume is the alternative (a template page for KeyDB exists, [fly.io/launch/keydb](https://fly.io/launch/keydb)); I could not read Fly docs to confirm sizing, HA or private networking. **[unverified]**
- **Upstash**: protocol compatibility "up to 6.2"; List and Streams commands including `BLPOP` and `XREAD` are marked supported; the REST SDKs do not support `BLPOP`/`BLMPOP`, but TCP clients such as node-redis do ([Upstash compatibility](https://www.upstash.com/docs/redis/overall/rediscompatibility), [XREAD](https://upstash.com/docs/redis/commands/streams/xread)). The XREAD page advises setting client timeouts above the BLOCK time. So `XREAD BLOCK 2000` over TCP is documented as supported. **How a blocked call is metered is not documented in anything I could read** **[unverified]**.
- **Billing**: pay-as-you-go **$0.20 per 100K commands**, $0.25/GB-month storage (1 GB free); fixed plans from $10/month for 250 MB; one command = one billable request, REST or Redis protocol ([Upstash billing](https://upstash.com/docs/redis/overall/billing), [pricing comparison](https://upstash.com/blog/redis-pricing-comparison-every-major-provider-in-2026-with-numbers)). Whether fixed plans have a command cap I could not confirm.
- **Idle command rate of our design** (arithmetic from `server/store/redis.ts` and `socketAdapter.ts` constants, not a measurement; assumes every command counts once and a blocked `XREAD` counts once per 2 s timeout):

| Source | Per instance-month | Cost at $0.20/100K |
|---|---|---|
| `PING` every 5 s x 9 connections | 4.67M | $9.33 |
| `XREAD BLOCK 2000` loops (adapter + inbox) | 2.59M | $5.18 |
| Adapter heartbeat every 3 s | 0.86M | $1.73 |
| Planned liveness refresh every 3 s (D8) | 0.86M | $1.73 |
| **Total idle, before one game move** | **about 9.0M** | **about $18** |

  Four instances: about $72/month for idle traffic alone. If the PAYG model is the only option, REJECT; a fixed plan removes the cost question but I could not confirm its limits. This also says the keep-alive `PING`s are the largest line: raising `PING_INTERVAL_MS` is a trade against the 15 s half-open detection requirement (P2) and must not be done for billing.
- Verdict: Fly + Upstash PAYG is the worst fit; Fly + self-run Valkey is workable but gives us a stateful machine to operate. Render is simpler.

### Fallbacks

- **AWS ElastiCache for Valkey**: supports Valkey 8.x, 9.0 and 9.1; hash field expiration listed for 9.0+; node-based Valkey 20% cheaper than other engines (2024 launch figure); MemoryDB for Valkey 30% below MemoryDB for Redis OSS (2024 figure) ([engine versions](https://docs.aws.amazon.com/hi_in/AmazonElastiCache/latest/dg/engine-versions.html), [AWS blog](https://aws.amazon.com/blogs/database/amazon-elasticache-and-amazon-memorydb-announce-support-for-valkey/), [9.0 announcement](https://aws.amazon.com/about-aws/whats-new/2026/05/valkey-amazon-elasticache/)). Node-based ElastiCache Redis OSS stops at 7.1. The only host here that offers Valkey 9. Needs a VPC, so only for an AWS-hosted app.
- **Heroku Key-Value Store**: Valkey 9 GA 19 Aug 2026 ([changelog](https://devcenter.heroku.com/changelog-items/3793)); Google Memorystore for Valkey also exists.
- **Redis Cloud**: Redis Ltd's managed service, Redis 8 line; not researched (redis.io unreachable). Different engine from Valkey hosts.

---

## 6. Pinning

### Candidate images (Docker Hub tags API, `hub.docker.com/v2/repositories/...`, 2026-11-02)

| Image | Index digest |
|---|---|
| `valkey/valkey:8.1.11-alpine` (= `8-alpine`, `8.1-alpine`) | `sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a` (amd64 `sha256:ac81eb0a7b37e054...`, arm64 `sha256:880f09f3e1bacbbe...`) |
| `valkey/valkey:9.0.7-alpine` | `sha256:2d04268dfa26ab31cfa3fdc538866e76438b2d00e41db41b8cb86d780ac5a416` |
| `valkey/valkey:9.1.3-alpine` (= `9-alpine`) | `sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b` |
| `redis:8.10.3-alpine` | `sha256:21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537` |
| `redis:7.4.12-alpine` (current pin `8da19c7...`) | `sha256:8da19c7399dca900c6822a1cf30f9d2285585e2c4b457ff4095b0f4500054d3f` |

The pin is the multi-arch **index** digest (both amd64 and arm64 are in it), as the repo's current pin is.

### Mirror

- `https://mirror.gcr.io/v2/valkey/valkey/manifests/8.1.11-alpine` returns **200 with the same index digest** as Docker Hub (`sha256:2602ace2...`), likewise `9.0.7-alpine` and `9.1.3-alpine`; the amd64 manifest and its first layer blob also return 200. So **`mirror.gcr.io/valkey/valkey` works** (anonymous, checked from this session). The brief's premise ("mirror only mirrors library images") is not strictly true for this image, but it is a cache, not a guarantee: `mirror.gcr.io/grafana/grafana:11.0.0` returned 404 in the same session, and **`library/valkey` does not exist** on Docker Hub (404) and `mirror.gcr.io/library/valkey` returned 429 (rate limit on a non-existent path, not an answer). Re-check at pin time and in the failure mode (if the mirror stops carrying it, CI breaks loudly on pull; the digest pin guarantees what runs).
- `tests/tooling/noDockerHubPulls.test.ts` allows any ref with a registry host, so `mirror.gcr.io/valkey/valkey:...` passes with no change.

### Pin

```
mirror.gcr.io/valkey/valkey:8.1.11-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a
```

### Files to change

1. `scripts/dev-stack.mjs:34` `REDIS_IMAGE` (rename `KEY_VALUE_IMAGE`; also the container name constant `REDIS_NAME` and the `present/pull/run` block at lines ~185-195 use it). Port stays 6379.
2. `.github/workflows/ci.yml` lines 268 and 898 (image). The health commands at 272 and 902 stay `redis-cli ping` (see the correction in §2).
3. `.github/workflows/soak.yml:54` and `:58`.
4. `.github/workflows/mutation.yml:59` and `:63`.
5. `deploy/runtime.json`: `"redis": 7` -> `"keyValue": {"engine": "valkey", "major": 8, "maxmemoryPolicy": "noeviction"}`.
6. `tests/tooling/redisImage.test.ts`: both tests. `REDIS_REF` (`redis:\d`) would match nothing in the new image, the `redis:(\d+)` major regex and `.redis` manifest read break, and the `SERVICE` regex pins `redis-cli ping`. Rewrite as a Valkey image test: same "every ref equals the dev-stack constant, digest-pinned" rule, major from `valkey/valkey:(\d+)` == `manifest.keyValue.major`, and the health command kept. Rename the file (`keyValueImage.test.ts`).
7. Docs: `docs/DEPLOY-RUNBOOK.md:105` ("Redis 7"), ADR-0014 lines 38 and 73 ("Redis 7": a new ADR or a note rather than editing an accepted record), the 2026-11-01 audit's `TICKETS.md` D5 (history), `server/CLAUDE.md` line 9 ("Postgres and Redis majors"; mentions only the manifest).
8. Nothing reads `runtime.redis` in code: `server/store/redis.ts` imports the manifest only for `maxClusterMessagesPerSecond`. The other readers of `runtime.json` (`tests/server/deployRuntime.test.ts`, `shutdownBudget.test.ts`, `cors.test.ts`, `installAction.test.ts`, `postgresMajor.test.ts`, `server/http/{cors,shutdown}.ts`) read other keys. Only `redisImage.test.ts` reads `.redis`.
9. `tests/tooling/noDockerHubPulls.test.ts` mentions `redis:7` only as fixture strings for the scanner: leave.
10. New (ADOPT): engine/`maxmemory_policy` boot check and `INFO` gauges in `server/shared/metrics.ts` + a poller beside `server/http/health.ts`; `defineScript`/`EVALSHA` in `server/store/instanceInbox.ts`.

### Why not Redis 8.10.3 or Valkey 9.1.3 in CI

CI must equal production. Redis 8 is a different engine from Render's. Valkey 9.1 is a newer engine than Render's 8.1 and would pass tests that 8.1 cannot (hash-field TTL, `DELIFEQ`). Revisit when Render offers 9: then bump `keyValue.major` to 9 and the pin to `9.1.x` in one change, and the LATER items become available.

---

## 7. Open items for the owner or a follow-up

1. Allow `render.com`, `valkey.io`, `redis.io`, `upstash.com`, `fly.io` to close the **[unverified]** items: Render's plan memory/connection limits, default policy, persistence options, and Valkey 9 roadmap; Upstash's blocking-command metering and fixed-plan limits; Fly's sizing.
2. After provisioning the Render instance: `INFO server` (record exact version and the engine-name field), `CONFIG GET maxmemory-policy`, `CLIENT LIST` count under load against the plan's connection cap.
3. Run the existing Redis integration tests (`redisBlackhole`, `redisDegraded`, adapter/inbox) against `valkey/valkey:8.1.11-alpine` before merging the pin change; nothing here was executed.
4. Benchmark agent: supply average packet size to size `maxmemory` against 120,000-entry streams (section 3).

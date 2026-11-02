# Valkey 9 (latest GA) as the key-value store: versions, features, clients, and what it deletes from our code

Date of research: 2026-11-02. Owner direction: switch immediately to Valkey 9 on its latest stable
release; where Valkey does a job better than our code, use its command and delete ours; the host
must run Valkey 9 (or we run it). This file supersedes the Valkey 8.1 pin in `redis.md` § 6 and
ADR-0015 decision 2 (#1919 asks for 8.1.11; #1925 asks for the move to 9; both collapse into one
change to 9.1.3).

What was executed: nothing against an engine. A Docker daemon is not running in the research
session, and running the downloaded image's binary was refused by the session's permission layer.
The image layers were fetched from `mirror.gcr.io` and listed (`redis-cli`, `redis-server`,
`valkey-cli`, `valkey-server` are all in `/usr/local/bin`), and command syntax was read from the
engine's own `src/commands/*.json` at tag 9.1.3. Every "works" below is therefore **read from
source, not run**; the first CI run on the pin is the proof (listed in § 8).

Network limits of this session: `valkey.io`, `render.com`, `devcenter.heroku.com`,
`docs.aws.amazon.com`, `docs.digitalocean.com`, `docs.cloud.google.com`, `aiven.io`,
`api.github.com` and `github.com/.../releases` did not resolve or returned 403. Reachable:
`raw.githubusercontent.com`, `hub.docker.com`, `mirror.gcr.io`, `registry.npmjs.org`,
`git ls-remote github.com`, and web search summaries.

---

## 1. Version facts

### 1.1 Newest GA

| Fact | Value | Source |
|---|---|---|
| Newest GA line | **Valkey 9.1**, first GA 19 May 2026 | [9.1.0 notes](https://raw.githubusercontent.com/valkey-io/valkey/9.1.0/00-RELEASENOTES) |
| Newest GA patch | **9.1.3**, released 26 Oct 2026, urgency SECURITY (heap overflow in cluster Pub/Sub message construction; we run no cluster bus) | [9.1.3 notes](https://raw.githubusercontent.com/valkey-io/valkey/9.1.3/00-RELEASENOTES), [version.h at 9.1.3](https://raw.githubusercontent.com/valkey-io/valkey/9.1.3/src/version.h) (`VALKEY_VERSION "9.1.3"`, `VALKEY_RELEASE_STAGE "ga"`) |
| Previous patches | 9.1.0 (19 May), 9.1.1 (21 Jul per search summary), 9.1.2 (31 Aug), 9.1.3 (26 Oct) | tags via `git ls-remote --tags https://github.com/valkey-io/valkey`; [9.1.3 notes](https://raw.githubusercontent.com/valkey-io/valkey/9.1.3/00-RELEASENOTES) |
| 9.0 line | GA 21 Oct 2025; newest **9.0.7** (tag exists; Docker Hub image 2026-10-27) | [9.0.0 notes](https://raw.githubusercontent.com/valkey-io/valkey/9.0.0/00-RELEASENOTES), `git ls-remote` |
| **Is 9.2 GA?** | **No.** There is no `9.2.0` tag (`git ls-remote` lists `9.2.0-rc1` as the only 9.2 tag; `.../9.2.0/00-RELEASENOTES` returns 404). 9.2.0-rc1 was released 16 Sep 2026. 9.1 went rc1 (17 Mar) to GA (19 May) in about nine weeks, so 9.2.0 GA is plausible in Nov-Dec 2026 **[unverified prediction]** | [9.2.0-rc1 notes](https://raw.githubusercontent.com/valkey-io/valkey/9.2.0-rc1/00-RELEASENOTES) |
| Pin | **`valkey/valkey:9.1.3-alpine`**, index digest below | § 1.2 |
| Engine identity in `INFO server` | `server_name:valkey`, `valkey_version:9.1.3`, and **`redis_version:7.2.4`** (a frozen compatibility value, "should never exceed 7.2.x"). This closes `redis.md` § 2's open question: an engine check must read `server_name` and `valkey_version`, never `redis_version` | [server.c:6130-6134 at 9.1.3](https://raw.githubusercontent.com/valkey-io/valkey/9.1.3/src/server.c), [version.h](https://raw.githubusercontent.com/valkey-io/valkey/9.1.3/src/version.h) |
| Support window | Third-party trackers: every minor gets 3 years of maintenance from its first GA; the latest minor of a major gets extended security-only support to 5 years; 9.0 maintenance to 21 Oct 2028; 9.1 end date not set. **[unverified: valkey.io/topics/releases was unreachable; confirm there]** Upstream patched 8.0, 8.1, 9.0 and 9.1 in parallel on 26 Oct 2026 | [endoflife.date/valkey](https://www.endoflife.date/valkey), [versionlog.com/valkey](https://versionlog.com/valkey/) (search summaries) |

### 1.2 Images (checked 2026-11-02)

Docker Hub tag list: [`https://hub.docker.com/v2/repositories/valkey/valkey/tags?name=9&page_size=50`](https://hub.docker.com/v2/repositories/valkey/valkey/tags?name=9&page_size=50)
(`registry.hub.docker.com/v2/...` is blocked in this session; `hub.docker.com/v2/...` answers the same API).
Registry check: `https://mirror.gcr.io/v2/valkey/valkey/manifests/<tag>` (HEAD, `Docker-Content-Digest`).

| Tag | Multi-arch index digest | Hub = mirror? |
|---|---|---|
| **`9.1.3-alpine`** (= `9.1-alpine` = `9-alpine`, also `-alpine3.24`) | **`sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b`** (amd64 manifest `sha256:de6fbe9626fea9f6f297b6867d2c8cf8f0394ee5ed171613166fc093cb49d0a6`) | yes |
| `9.1.3` (trixie, Debian) | `sha256:3add1a336a920ea54770a001ab6feb3da5fceea96a40373a3a2cd469b815f0b7` | Hub only checked |
| `9.0.7-alpine` | `sha256:2d04268dfa26ab31cfa3fdc538866e76438b2d00e41db41b8cb86d780ac5a416` | yes |
| `8.1.11-alpine` (the pin this replaces) | `sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a` | yes |
| `9.2.0-rc1-alpine` (never pin: pre-release) | Hub `sha256:59c3b2f1ca8a8c9e24dfd1ea803ed79223be7d489d266e3c84097119349689d1` (re-pushed today); mirror still `sha256:cdcb7b1c7b6f1c9cb9442c71ac6275e78184657448407b2c1fdde7ee8024f4fb` | **no**: a floating rc tag differs between registries |

Ref to use: `mirror.gcr.io/valkey/valkey:9.1.3-alpine@sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b`.
Files to change are those listed in `redis.md` § 6 (dev-stack, three workflows, runtime.json,
`redisImage.test.ts`, runbook), with major 9 and the extra rows in § 7 below.

The 9.1.3 alpine image contains `redis-cli` and `redis-server` links beside the `valkey-*` binaries
(listed from the amd64 layers), so `--health-cmd "redis-cli ping"` still works **[listed, not run]**.

### 1.3 Which hosts offer Valkey 9

| Host | Valkey 9 status | Source / confidence |
|---|---|---|
| **AWS ElastiCache (node-based)** | **9.1 supported** since 23 Jun 2026 (9.0 earlier); node-based only | [What's New](https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-elasticache-valkey-9-1/), [blog](https://aws.amazon.com/blogs/database/announcing-valkey-9-1-for-amazon-elasticache/) (search summaries) |
| **Google Memorystore for Valkey** | 7.2, 8.0, **9.0 (default)**, **9.1 Preview** as of the 27 Jul 2026 page | [supported versions](https://docs.cloud.google.com/memorystore/docs/valkey/supported-versions) (search summary) |
| **Aiven for Valkey** | **9 announced 17 Mar 2026**, "the two latest upstream versions" selectable; whether 9.1 is offered **[unverified]** | [Aiven blog](https://aiven.io/blog/announcing-aiven-for-valkey-9-and-multi-version-support) (search summary) |
| **Heroku Key-Value Store** | **Valkey 9 GA, 19 Aug 2026**; minor not read | [Heroku changelog 3793](https://devcenter.heroku.com/changelog-items/3793) via `redis.md` (secondary) |
| **DigitalOcean Managed Valkey** | Said to default to 9 in #1919's body; **[unverified: docs unreachable]** | #1919 |
| **Render Key Value** | Last verified fact: new instances on **Valkey 8.1** (2025-04-22); no Valkey 9 announcement found, **and this session could not read render.com**. Under the owner's rule Render is out until it offers 9 **[unverified]** | [Render changelog](https://render.com/changelog/new-render-key-value-instances-use-valkey-8-1), `redis.md` § 5 |
| **Fly.io** | `fly redis` is Upstash (a Redis-protocol service "up to 6.2"; not Valkey 9, pay per command). Valkey 9 on Fly means running it ourselves on a Machine with a volume **[unverified: fly.io unreachable]** | `redis.md` § 5 |
| **Upstash** | Not Valkey; reject (protocol level, billing) | `redis.md` § 5 |
| **Self-run** | `valkey/valkey:9.1.3-alpine` on any Docker host; we own patching (Valkey shipped security patches on 31 Aug and 26 Oct) | § 1.2 |

Consequence for #1107: the key-value requirement becomes "Valkey 9.1 or newer, `maxmemory-policy
noeviction`, `INFO` readable, `DELIFEQ` and `SET ... IFEQ` allowed (no restrictive ACL command
list)". ElastiCache and Heroku meet it on the evidence read; Render does not on the evidence read.

---

## 2. Valkey 9.0, 9.1 and 9.2-rc features, judged for this repo

Release notes: [9.0.0](https://raw.githubusercontent.com/valkey-io/valkey/9.0.0/00-RELEASENOTES),
[9.1.0](https://raw.githubusercontent.com/valkey-io/valkey/9.1.0/00-RELEASENOTES),
[9.1.3](https://raw.githubusercontent.com/valkey-io/valkey/9.1.3/00-RELEASENOTES),
[9.2.0-rc1](https://raw.githubusercontent.com/valkey-io/valkey/9.2.0-rc1/00-RELEASENOTES).
Command definitions: `https://raw.githubusercontent.com/valkey-io/valkey/9.1.3/src/commands/<name>.json`
(`since` fields below come from there); prose: `https://raw.githubusercontent.com/valkey-io/valkey-doc/main/commands/<name>.md`.
`valkey.io/commands` itself was unreachable.

| Feature | Release | What it replaces here | Decision | Reason |
|---|---|---|---|---|
| `SET key v [PX n] IFEQ cmp` | 8.1.0 (`set.json`); IFEQ is in the same `oneof` as NX/XX, so it **cannot be combined with NX** | `REFRESH_IF_MINE` "mine -> extend" branch, `server/store/tableOwners.ts:5-7` | **ADOPT** | One command, compare-and-extend; null reply means "not mine or absent" |
| `DELIFEQ key v` | **9.0.0** (`delifeq.json`, #1975); returns 1/0; WRONGTYPE on a non-string | `CLEAR_IF_MINE`, `tableOwners.ts:4`, and presence delete-if-socket (#1893/#1894) | **ADOPT** | Exactly the Lua it replaces; the return value is also a claim token (§ 3.3) |
| `SET ... IFNE` | 9.2.0-rc1 only (#3105) | nothing | not available (rc) | |
| `EXEC IFEQ/IFNE/NX/XX` (optimistic transaction without `WATCH`) | 9.2.0-rc1 only (#4019); syntax **[unverified: release note only]** | would make "CAS presence and update the instance set" one atomic transaction (§ 3.3) | **LATER, at 9.2.0 GA** | rc; `redis` 6.3.1 has no typed form |
| `INCREX` (atomic increment that sets expiry, NX/XX) | 9.2.0-rc1 only (#3253); node-redis 6.3.1 types `INCREX`/`INCREXBYFLOAT` in the Redis spelling, equality with Valkey's **[unverified]** | rate-limit window counter and `DECREMENT_LIVE_COUNT` (`rateLimit.ts:150-154`) | **LATER, at 9.2.0 GA** | rc; § 3.4 |
| `XACKDEL`, `XDELEX` | 9.2.0-rc1 only (#4629); `xackdel.json`/`xdelex.json` absent at 9.1.3 | nothing (the inbox is plain `XREAD`, a fresh boot never replays a dead instance's stream) | **REJECT** | consumer-group tooling we do not use |
| `XADD ... NOMKSTREAM` | 6.2, present in 9.1.3 `xadd.json` | the `XADD`+`EXPIRE` Lua `SEND`, `instanceInbox.ts:33-35,104-108` | **ADOPT** | § 3.2 |
| Hash-field expiration: `HSETEX`, `HGETEX`, `HEXPIRE`/`HPEXPIRE`/`HEXPIREAT`, `HTTL`/`HPTTL`, `HPERSIST` | **9.0.0** (#2089); `HSETEX NX/XX` 9.1.0 | judged for presence/liveness in § 4 | **REJECT for presence** (rejection stands); **LATER** only as a micro-gain | § 4 |
| `HGETDEL` | 9.1.0 (#2851) | nothing today | not needed | a hash-per-instance design would use it (rejected, § 4) |
| `MSETEX numkeys k v ... [NX/XX] [EX/PX]` | 9.1.0 (#3121) | nothing: table-owner records are written one at a time, each with its own epoch | not needed | |
| Atomic slot migration, numbered DBs in cluster, `CLUSTERSCAN`, `CLUSTER KEYSLOT` standalone, cluster failover work | 9.0/9.1 | none: single node, non-cluster, db `/0` | **REJECT** | irrelevant |
| Lua engine moved into a module, statically linked by default | 9.1.0 (#2858, #3392) | our 2 hand-sent scripts + `rate-limit-redis`'s 2 | informational | scripts still run; each Lua CVE (9.0.0-rc3 four CVEs incl. RCE; 9.1.0 CVE-2026-23631; 9.1.2 GHSA-fq2f-crmw-q97r, an unauthenticated UAF) is a reason to keep scripts few, which § 3 does |
| `COMMANDLOG` (replaces slowlog; large-request/large-reply) | 8.1.0 (`commandlog-get.json`) | nothing | optional ops tool | no code |
| `CLIENT SETINFO LIB-NAME/LIB-VER` | 7.2 | node-redis sends both itself at every connect (`client/index.js:591-612`), failures ignored | nothing to do | |
| `CLIENT NO-EVICT` | 7.0 | nothing | **REJECT** | only matters with `maxmemory-clients`, which we do not set |
| `CLIENT NO-TOUCH` | 7.2 | nothing | **REJECT** | LRU/LFU is moot under `noeviction` |
| `SHUTDOWN ... SAFE`, `CLIENT LIST` filters, `HOTKEYS`, ACL roles/`ACL DIGEST`, forkless snapshots | 9.0 / 9.2-rc | none | not needed | host operations |
| Database-level ACL | 9.1.0 | none | **LATER**, with host ACL scoping | |
| I/O threading redesign (8-17% throughput), embedded strings 64 -> 128 bytes (30% GET), pipelining prefetch (#2092), BITCOUNT/hash SIMD, memory savings | 9.0 / 9.1 | none: design peak 1,000 msgs/s is two orders under one thread | free with the engine; **no tuning** | |
| Keyspace notifications (`notify-keyspace-events Ex`) | old | liveness sweep | **REJECT** | § 4 |
| `maxmemory-policy noeviction` | default in 9.1.3 (`valkey.conf:1346`, `server.c:3072`) | n/a | **ADOPT**: still assert it at boot | a host can change it; `INFO memory` carries `maxmemory_policy` (`server.c:6312`), `evicted_keys` (`:6471`), `rejected_connections` (`:6461`), `blocked_clients` (`:6231`) with no `CONFIG GET` |

9.1.3's own fixes worth knowing: `HDEL/HGETDEL/HPERSIST/HEXPIRE` no longer propagate fields they
treat as expired (#4772), `HSETEX/HGETEX` mis-parsed a key named `fields` (#4945), stream
commands that change group/PEL state did not trigger `WATCH` (#3459). Hash-field TTL is young code.

---

## 3. Re-judging every code path and every planned ticket

### 3.1 Table of decisions

| Path | Today / planned | Valkey 9 replacement | Deleted | Added |
|---|---|---|---|---|
| Table-owner clear | `tableOwners.ts:4` `CLEAR_IF_MINE` Lua, `:49-53` `.eval` | `DELIFEQ key <instance>:<epoch>` through `client.sendCommand` (node-redis has no helper: it types Redis's `DELEX key IFEQ v`, not `DELIFEQ`) | script constant and `eval` call | 1 line |
| Table-owner refresh | `tableOwners.ts:5-7` `REFRESH_IF_MINE` Lua, `:41-46` | `SET key v PX ttl IFEQ v`; if the reply is null, `SET key v PX ttl NX` (puts back a record Redis lost, never overwrites a later owner). Two commands because IFEQ and NX are exclusive. Each is atomic and the pair is safe in either interleaving; the common path is one command | script constant and `eval` call | ~4 lines; node-redis types `condition: "IFEQ", matchValue` (the wire shape `SET k v PX n IFEQ m` is Valkey's) |
| Table-owner record | `tableOwners.ts:35-39` plain `SET PX` | unchanged: the Postgres epoch fences the write, a CAS here would add a second authority | none | none |
| Inbox send | `instanceInbox.ts:33-35` Lua = `XADD MAXLEN ~` + `EXPIRE`, `:104-108` `writer.eval` | `XADD key NOMKSTREAM MAXLEN ~ n * m payload` (`client.XADD_NOMKSTREAM`); see § 3.2 | script, the "one script, not a MULTI" comment, `CLUSTER_GAP_SECONDS` as an `EXPIRE` argument | boot-time create, owner-side TTL refresh |
| Rate limits | `rateLimit.ts:94-96,170` `rate-limit-redis` (its own `SCRIPT LOAD`/`EVALSHA`: `INCR`, `PEXPIRE`, `PTTL`), `:150-154` and `:215-220` `DECREMENT_LIVE_COUNT` Lua | nothing in 9.1: § 3.4. Keep the library; keep `DECREMENT_LIVE_COUNT` | nothing now | nothing |
| Adapter peer count | `socketAdapter.ts:85-133` `PUBSUB CHANNELS pattern` plus `heard`/`noticed`/`left`/`PEER_GRACE_MS` bookkeeping | after #1894/#1895 remove `fetchSockets`/forwarding `serverSideEmit` consumers (`socketOutbox.ts:42,53,64,80`, `socketRegistry.ts:62,92`, `tableRouter.ts:152`, `seating.ts:49`), the live-instance registry (§ 3.3) answers "how many live peers" and `serverCount` can go; if a consumer survives, answer it from the registry | up to ~50 lines and the `PUBSUB` command | **conditional on an audit of the surviving `serverSideEmit` callers** (`socketPresence.ts:242` revocation, `seating.ts:49`) |
| `PING` every 5 s x connections | `redis.ts:12-13` | keep: it is the half-open watchdog; `CLIENT NO-TOUCH`/tracking do not help | none | none |
| Ownership of tables | `gameOwnership.ts` is Postgres advisory locks | **do not move to Valkey** (`SET NX PX` + `DELIFEQ` would lock, but a dead session releases an advisory lock at once while a TTL lock stays held until expiry; ADR-0014 decision 3-4 couples lock, epoch and DB write) | none | none |
| Health | `health.ts:67-69` `PING` | add the `INFO` poll of #1919 reading `server_name`, `valkey_version`, `maxmemory_policy`, `used_memory`, `maxmemory`, `evicted_keys`, `blocked_clients`, `rejected_connections` | none | #1919 |

### 3.2 The inbox: delete the script by giving the stream an owner

Valkey 9.1 has no `XADD ... EXPIRE`. The script exists so an entry never lands in a stream with no
TTL. The root cause is that the *sender* owns the TTL of a stream the *receiver* owns. Move it:

- The receiving instance creates `inbox:<id>` at boot (one `XADD` with a `boot` kind, which the
  existing `deliver` already drops with a debug line) and keeps it alive with `PEXPIRE inbox:<id> <liveness ttl>` in the same pipeline as its liveness refresh (#1894's 3 s heartbeat; before #1894, a 3 s timer in `instanceInbox.ts`). A graceful stop `DEL`s it; the dead-instance sweep `DEL`s it.
- Every sender uses `XADD key NOMKSTREAM MAXLEN ~ n * m payload`: one command, no script, and
  **it can never recreate a stream the owner or the sweep removed**. A null reply means "that
  instance is gone": the send rejects with the same error as a Redis outage. Today a send to a dead
  instance succeeds and sits for 120 s in a stream nobody reads, and #1896's "peer claimed within
  budget" and #1895's routing then wait on a message that nobody will answer.
- A dead instance's inbox disappears within one liveness TTL instead of 120 s after its last message.

Cost: one more command in an existing heartbeat, and the inbox now depends on the heartbeat being
alive (a Redis outage longer than the TTL drops the inbox; the instance re-creates it on the next
heartbeat when `PEXPIRE` returns 0, and an instance that long out is already treated as dead by the
sweep). If the owner prefers no coupling, the fallback is `defineScript` for the existing Lua
(#1919's wording); that keeps one Lua script. **Recommendation: the NOMKSTREAM design.**

### 3.3 Presence (#1893, #1894) on Valkey 9 primitives

Planned: hash `presence:<userId> {instance, socket, table}`, CAS on `socket` in two Lua scripts,
`instance:<id>` TTL key refreshed every 3 s, set `instances`, set `instance-users:<id>` kept in the
same scripts, a sweep each heartbeat.

Proposed, no Lua:

| Key | Value | Written by |
|---|---|---|
| `presence:<userId>` | string `<instance>\|<socket>` (immutable for a socket's life) | connect: `SET` (the newest socket wins; this is the overwrite). Disconnect: `DELIFEQ key <instance>\|<socket>`. |
| `table:<socketId>` | `<roomId>` | join: `SET ... PX <safety ttl>`; leave and disconnect: `DEL`. A socket only touches its own key, so a stale socket cannot clobber its replacement and no CAS is needed. |
| `instance-users:<instance>` | set of userIds | connect: `SADD` **then** `SET presence`. Disconnect: `DELIFEQ presence`, and `SREM` only when it returned 1. The set is therefore always a superset of the users really present, so a crash between two commands strands nobody. |
| `instance:<id>` | `1`, `SET ... PX 10000` every 3 s | heartbeat |
| `instances` | set of ids | boot `SADD`, graceful stop `SREM` |

- **Delivery read (#1893)**: `MGET presence:u1 presence:u2 ...` is one command for a whole recipient list (a hash design needs one `HMGET` per user, pipelined). The instance is the part before `|`. Offline = null.
- **Compare-and-set on socket**: `DELIFEQ` and unconditional `SET` cover the two cases the ticket names; the table field is moved out of the compared value (own key per socket), which is why no field-level CAS is needed. Test required by #1894 ("evicted socket A's late disconnect leaves B's entry intact; the same for the table") holds: A's `DELIFEQ` sees B's value; A's `DEL table:A` touches only A.
- **Dead-instance sweep**: `SMEMBERS instances`, one pipelined `EXISTS instance:<id>` each; for a dead `D`: `SMEMBERS instance-users:D`, `MGET presence:<u>...`, for each value naming `D`: `DELIFEQ presence:<u> <that value>`. **The return value is the claim**: whichever instance gets 1 sends the friend notices; any other gets 0, so notices are sent once with no sweep lock and no leader. A user who reconnected elsewhere returns 0 and is correctly skipped. Then `DEL table:<socket>` for the cleared users, `DEL instance-users:D`, `DEL inbox:D`, `SREM instances D`.
- **Superset leak**: when a disconnect's `DELIFEQ` returns 0 (the user moved to another socket or instance) the member stays in this instance's set until it stops or sweeps; bounded by distinct users per boot, and the sweep skips them. Not worth a read to trim.
- **Divergence**: nothing is compared against in-memory state, so a lost reply cannot wedge later writes (the failure mode of whole-value CAS with a mutable value). That is the reason the table field is not in `presence:` and why the earlier idea of `SET ... IFEQ old` for table changes was dropped.
- **Atomicity**: the one place Lua gave more is "SADD and SET and DELIFEQ in one step". The ordering rule above recovers the invariant that matters (superset). `EXEC IFEQ` (9.2.0-rc1) would make it a single conditional transaction; revisit at 9.2.0 GA, no sooner.

Net: the two presence scripts, their NOSCRIPT/`defineScript` plumbing, and the script-flush test
that #1919 asked for presence's sake disappear; about nine single-purpose commands remain, each
with a one-line reason. #1893's "one pipelined read per send" becomes one `MGET`.

### 3.4 Rate limits

`rate-limit-redis` 6.0.2 takes a `sendCommand` (client-agnostic, `dist/index.mjs:72-76`; peer dependency `express-rate-limit >= 8.6.0`). Its increment is `INCR` + first-hit `PEXPIRE` + `PTTL`. On 9.1 this could be `MULTI; INCR; PEXPIRE k w NX; PTTL; EXEC`, atomic without Lua. It is not worth replacing, because `DECREMENT_LIVE_COUNT` (conditional on existence, count > 0 and a live TTL, `rateLimit.ts:150-154`) has **no 9.1 equivalent**: a bare `DECR` recreates an expired key at -1 with no TTL. So Lua stays in this file either way. At 9.2.0 GA, `INCREX` (with its NX/XX conditions) is the intended one-command replacement for both; then drop the library and the shim.

### 3.5 #1895 (routing) and #1896 (shutdown)

- #1895: `table-owner:<roomId>` = `<instance>:<epoch>` is read with `GET` (or `MGET` for several rooms); the forwarded intent is one `XADD NOMKSTREAM` to that instance's inbox. If the reply is null (inbox gone), the owner is dead: answer `TABLE_UNREACHABLE` at once instead of waiting 3.5 s. No new script.
- #1896: "a live peer chosen at random" is `SRANDMEMBER instances 3` then `XADD NOMKSTREAM` the `resume` to each in turn until one accepts: the inbox's existence is the liveness test, so the separate `EXISTS instance:<id>` pass is not needed on this path. After the hand-off, graceful stop issues `DEL inbox:<me>`, `DEL instance:<me>`, `DEL instance-users:<me>` (it has no users left, each disconnect already cleared its own), `SREM instances <me>`.

---

## 4. Hash-field TTL for presence: the rejection, re-examined

Reasons recorded in ADR-0015: "a per-user field expiry needs a periodic write per online user,
which #1894 forbids, and an expired instance field cannot tell the sweep which instance died."

| Design tried with 9.0/9.1 primitives | Result |
|---|---|
| Per-user fields with TTL (`HSETEX presence ... PX`), refreshed by the owning instance | Still one refresh write per online user every few seconds. #1894's "online users cost no periodic writes" is violated. **Rejection holds.** |
| One hash `instance-users:<id>` whose *key* TTL is the liveness (one `PEXPIRE` per instance) | Users of a dead instance read offline at once with no sweep, but the key vanishes, so nobody can tell which users to notify. The friends' offline notice (ADR-0014 decision 8) is lost. **Fails on correctness.** Keeping a non-expiring shadow set to find them returns to the current plan. |
| A hash `instances-alive` with per-field TTL replacing `instance:<id>` keys | `HKEYS` lists live instances in one command instead of `SMEMBERS` + N `EXISTS`. But the sweep still needs the permanent registry (`instances` set) to know who is missing, so two structures remain. Gain: one pipeline pass on a handful of ids. Cost: depends on 9.0-era code, whose last three patch lines each fixed a hash-TTL bug (§ 2). **Not worth it.** |
| Keyspace notification on `instance:<id>` expiry | A missed pub/sub event strands the dead instance's users forever, so the polling sweep must exist anyway; notification then only saves a few seconds and needs `notify-keyspace-events` which a managed host may not allow. **Rejected.** |

**The rejection holds on correctness.** The simplification that does exist is different: § 3.3
(strings, `DELIFEQ`, an own key for the table, `DELIFEQ` return value as the claim) removes both
Lua scripts and the per-user hash without needing field TTL.

---

## 5. Clients

| Question | Finding | Source |
|---|---|---|
| Does node-redis run against Valkey 9? | Yes for everything we send: RESP2 by default (no `HELLO` unless RESP3 or auth), `CLIENT SETINFO` at every connect with failures ignored, `maintNotifications: "disabled"` (already set) avoids the Redis-Enterprise `CLIENT MAINT_NOTIFICATIONS` handshake. Valkey answers `HELLO 2|3`, `CLIENT SETINFO`, `PUBSUB`, `XREAD BLOCK`, `XADD`, `SET PX`. Not run **[unverified]** | `redis`/`@redis/client` 6.3.1 tarball: `dist/lib/client/index.js:393,448,467,591-612` |
| Latest | `redis` 6.3.1 (modified 2026-10-29), Node >= 20; repo pins 6.3.0 | [npm](https://registry.npmjs.org/redis/latest) |
| `SET ... IFEQ` typed? | Yes: `SetOptions.condition: 'NX'\|'XX'\|'IFEQ'\|'IFNE'\|'IFDEQ'\|'IFDNE'` with `matchValue`; documented "since 8.4" (Redis) and marked `@experimental`, but the wire form `SET k v [PX n] IFEQ m` is the same as Valkey's `set.json`. **Never use `IFDEQ`/`IFDNE`/`DIGEST`**: Redis-only | `dist/lib/commands/SET.d.ts`, `SET.js:35-37` |
| `DELIFEQ` typed? | **No.** Typed is `DELEX key IFEQ v` (Redis 8.4), which Valkey does not have. Use `client.sendCommand(["DELIFEQ", key, value])` (the repo already does this for `PUBSUB` and the limiter); one line, not a script | `dist/lib/commands/DELEX.js` |
| Other typed commands | `HSETEX`, `HGETEX`, `HGETDEL`, `HEXPIRE` family, `MSETEX`, `XADD_NOMKSTREAM`, `INCREX`, `CLIENT NO-EVICT`, `CLIENT NO-TOUCH` exist, with Redis spellings | `dist/lib/commands/` |
| `@socket.io/redis-streams-adapter` 0.3.1 (latest, 2026-03-12) | Accepts a node-redis v4+ client (detected by `typeof client.sSubscribe === "function"`) or an ioredis-shaped one; calls `duplicate()`, `xRead`/`xread`, `xAdd`/`xadd` with `MAXLEN ~`, `xRange`, `set ... PX`, `getDel`, `publish`/`subscribe`, `sendCommand(["PUBSUB", ...])`. Peer dependency `socket.io-adapter ^2.5.4`. No mention of Valkey. **There is no Valkey-native Socket.IO adapter** (none found on npm search in `redis.md`; not re-searched here **[unverified]**) | `dist/util.js:37-39,55-147,247-254`; [npm](https://registry.npmjs.org/@socket.io/redis-streams-adapter/latest) |
| `@valkey/valkey-glide` 2.5.3 (2026-10-23) | Valkey's official Rust-core client. It has no node-redis methods (`duplicate`, `xRead`, `sSubscribe`), so the adapter cannot take it; it would need a shim that re-implements the adapter's client contract plus our half-open watch. **Reject** | [npm](https://registry.npmjs.org/@valkey/valkey-glide/latest) |
| `iovalkey` 0.4.0 (2026-07-27, ioredis fork) | Passes the adapter's ioredis branch (no `sSubscribe`) so it would run, but `redis.ts` (offline queue, `_maintenanceUpdate`, `ping-interval` events, per-connection watchdog), `rateLimit.ts`, and `socketAdapter.ts`'s `Object.create(publisher)` wrapper are all node-redis-shaped; its typed surface lacks `DELIFEQ` too. Gain: none. **Reject** | [npm](https://registry.npmjs.org/iovalkey/latest) |
| `rate-limit-redis` 6.0.2 | Client-agnostic: takes `sendCommand(...args)`; scripts via `SCRIPT LOAD`/`EVALSHA`, NOSCRIPT recovery | `dist/index.mjs:36,72-76,93` |

**Recommendation: stay on node-redis (`redis` 6.3.1).** It is the only client the streams adapter and
our own connection module are written against; it types `SET IFEQ` and `XADD NOMKSTREAM`; the one
missing command (`DELIFEQ`) is a `sendCommand` line. Bump 6.3.0 -> 6.3.1 with the pin change.
Re-judge GLIDE only if a Valkey-native adapter appears.

---

## 6. Redis 7 to Valkey 9: breaking changes that touch us

| Item | Finding |
|---|---|
| Data | Postgres is the record (ADR-0014); Valkey holds only TTL'd or rebuildable keys; RDB from Redis 7.4 (format 12) cannot be loaded by Valkey (`valkey.io/topics/migration`, [valkey#645](https://github.com/valkey-io/valkey/issues/645)). **Start empty**, flip `REDIS_URL` once; both sides cannot talk during the cutover and degraded mode covers it. Do it before real players exist. |
| `redis_version` | Frozen at `7.2.4`; engine check reads `server_name:valkey` and `valkey_version` (§ 1.1). |
| Binaries | `valkey-server`/`valkey-cli` are primary; `redis-server`/`redis-cli` links ship in the image (listed in 9.1.3-alpine). `VALKEYCLI_AUTH` is read alongside `REDISCLI_AUTH`; valkey-cli defaults use valkey naming with fallback (#2334, #1995). |
| Image | Runs as user `valkey` (uid 999), `protected-mode` patched off for Docker, alpine 3.24 base (`redis.md` § 2). Digests in § 1.2. |
| Defaults | `maxmemory-policy` default `noeviction` (unchanged); `TCP_NODELAY` on by default (#1763); `hz`, persistence defaults as Redis 7.2. Enable `appendonly` only if the host does by default; nothing here needs durability. |
| Command behaviour changes in 9.x | Auth check now precedes unknown-command/arity checks (#1475); error text in MULTI includes the command's full name (#2286); `SCRIPT EXISTS/SHOW/FLUSH` carry the STALE flag; `sanitize-dump-payload` and its ACL flags are no-ops (listpacks always validated, 9.1.2). None is in our code path. |
| 9.2 pre-warnings | Active expiration now bumps the dirty counter, so `BGSAVE` save points may fire more often (#3118); large sorted sets report `btree` encoding. Only matters on the move to 9.2. |
| TLS | 9.1.0-rc2 reverted strict certificate validation at config load, deferred to the next **major** (#3572): expect it in Valkey 10. |
| ACL | New in 9.1: database-level ACL (`db=`, `alldbs`); 9.1.2 closed an `HGETEX` write-permission gap. A host-supplied ACL user must be allowed `DELIFEQ` and `SET` with `IFEQ` (they are ordinary commands, no special category) **[unverified on any host]**. |
| `KEYS` / `SCAN` | Not used in `server/`; unchanged. `PUBSUB CHANNELS pattern` (`socketAdapter.ts:103`) is O(channels) and goes with § 3.1. |
| Persistence/licensing | Valkey is BSD-3-Clause under the Linux Foundation (`redis.md` § 1). |

---

## 7. Changes that follow (for the ticket author, not done here)

1. `scripts/dev-stack.mjs:31-34` constant, three workflows' two-and-more service blocks, `deploy/runtime.json`: replace `"redis": 7` with `"keyValue": { "engine": "valkey", "major": 9, "maxmemoryPolicy": "noeviction" }` (or `"version": "9.1"` if the host contract should pin the minor; hosts differ), `tests/tooling/redisImage.test.ts` rewritten for `valkey/valkey:(\d+)`.
2. `server/store/tableOwners.ts`: delete both Lua constants; `DELIFEQ` and `SET IFEQ`/`NX` as in § 3.1.
3. `server/store/instanceInbox.ts`: delete `SEND`; boot-time create; `XADD_NOMKSTREAM`; TTL by owner (§ 3.2). #1919's "`defineScript` for every hand-sent script" drops to `rateLimit.ts:150-154` only.
4. #1893/#1894 settle-lists: replace "hash `{instance, socket, table}` + two Lua scripts + `instance-users` maintained in the scripts" by § 3.3; `MGET` for the pipelined read.
5. #1895/#1896: null `XADD NOMKSTREAM` reply as "instance gone" (§ 3.5).
6. A new ADR (or a revision of ADR-0015 decision 2, which is Proposed): Valkey 9.1.3, `DELIFEQ`/`SET IFEQ`/`XADD NOMKSTREAM` adopted, hash-field TTL rejected again (§ 4), and the host rule "must run Valkey 9.1 or newer".
7. `docs/DEPLOY-RUNBOOK.md:105`, `server/CLAUDE.md` (the production section's "Redis" majors), `CONTEXT.md` terms if "Redis" is used as the store's name.
8. `tests/tooling/noDockerHubPulls.test.ts` accepts the mirror ref unchanged.

---

## 8. What the first CI run on the pin must prove (nothing here was executed)

- The existing integration suites (`redisDegraded`, `redisBlackhole`, `ownerEpoch`, `crossInstance`, `sharedRateLimits`, inbox, adapter) green on `9.1.3-alpine`.
- `redis-cli ping` health command answers in the image.
- `SET k v PX n IFEQ v`, `DELIFEQ`, and `XADD k NOMKSTREAM MAXLEN ~ n * m x` return as § 3 assumes (OK/nil, 1/0, nil on a missing key), through node-redis 6.3.1.
- `INFO` yields `server_name:valkey` and `maxmemory_policy:noeviction`.
- The 9.1 Lua module still runs `rate-limit-redis`'s `EVALSHA` flow (NOSCRIPT recovery included).

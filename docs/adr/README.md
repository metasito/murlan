# Decisions

Read this index; open a record only when it covers the area you are about to change.

An ADR is history and is never rewritten. A decision that no longer holds gets
`**Status:** Superseded by ADR-XXXX` added at the top and nothing else changed.

| # | Title | Status | In one line |
|---|---|---|---|
| [0001](0001-keep-react-native-expo-client-and-replit-host.md) | Keep the React Native/Expo client and the Replit host | Accepted; host clause superseded by 0006 | A turn-based card game with ≤54 sprites and a 0.96 ms rules engine has no rendering or simulation problem, so no game engine or host change is justified. |
| [0002](0002-a-play-leaves-the-seat-it-was-thrown-from.md) | A play leaves the seat it was thrown from | Superseded by 0008 | A flight starts at the throwing seat's real position, not a fixed unscaled offset in the pile's frame. |
| [0003](0003-cloud-run-already-runs-multiple-instances.md) | Cloud Run already runs the app on multiple instances | Accepted; adapter clause superseded by 0014 | Multi-instance is the deployed reality today, not a deferred future — the ownership/routing protocol is load-bearing, not speculative. |
| [0004](0004-the-queue-loop-serialises-and-owns-the-merge.md) | The queue loop serialises its tickets and the supervisor owns the merge | Accepted | One ticket at a time and nothing held in memory: ~22% of wall clock buys away the whole class of defect where the supervisor and the session disagree about which ticket is live. |
| [0005](0005-the-compiler-is-not-the-enforcer-of-the-adopted-rules.md) | The React Compiler is not the enforcer of the three rules #891 adopted | Accepted | `eslintSuppressionRules` stays unset: the compiler's penalty is an unmemoized component in production, which is a worse answer than the lint error two source scans already give. |
| [0006](0006-the-host-is-no-longer-replit.md) | The host is no longer Replit, and the next one is still to be chosen | Accepted | Supersedes ADR-0001's "Stay on Replit for now": the subscription ended, the dev-sync machinery is deleted, and the new host is #1107's to choose. |
| [0007](0007-account-recovery-email-verification-and-password-reset.md) | Account recovery: email verification and password reset | Accepted | Six boxes (migration, token storage, sender, rate limiting, enumeration-safety, session clearing) shipped across #861–#864; `server/http/routes/auth.ts` and related source cite them by number. |
| [0008](0008-the-throw-is-the-lantern-mockups.md) | The throw is the lantern mockup's, and its landing is the card's contact | Accepted | The flight is the mockup's pose on one UI-thread clock; every landing effect follows the sampled contact frame, and `impactDelayMs()` is gone. |
| [0009](0009-audio-and-haptics-libraries.md) | Audio is react-native-audio-api and haptics are react-native-turbo-haptics | Accepted | expo-audio and expo-haptics go; the libraries' known defects are guarded in our code, and adoption waits for CI builds and a soak on both platforms. |
| [0010](0010-the-loop-on-the-5-5-family.md) | The loop on the 5.5 family: no Haiku executor, effort by round, Opus review | Accepted; decision 3 superseded by 0011 | Opus 5.5 builds a fresh ticket at `medium` and a fix round at `high`; reviewers and refuter run Opus at `medium`; no advisor or orchestrator; `loop-cost` prices each 5.5 release; `PreToolUse` guards are `onFailure: "block"`. |
| [0011](0011-review-converges-and-the-loop-works-toward-launch.md) | Review converges, and the loop works toward launch | Accepted | One Opus reviewer, only a Blocking finding holds, at most 3 reviews and never a land at the cap; the loop files no agent work; the picker takes main-red and ci-flake, then the Launch milestone, first. Supersedes ADR-0010 decision 3. |
| [0012](0012-a-rules-model-is-a-test-oracle.md) | A rules model under tests/model/ is a test oracle, not a second copy | Accepted | A model written from `docs/GAME-RULES.md` alone and compared with the engine by fast-check is merged with it by the comparison, so rule 48 holds; it imports nothing from `lib/` at runtime. |
| [0013](0013-a-move-intent-names-the-turn-it-was-made-against.md) | A move intent names the turn it was made against | Accepted | Every play, pass and giveback carries an opaque `turn` token for the state it was made against, and the table drops a stale one, so a retry across a restart is not applied twice; protocol 13. |
| [0014](0014-postgres-is-the-record-redis-carries-the-hot-path.md) | Postgres is the record, Redis carries the hot path, a move is an event | Accepted; Redis 7 engine superseded by 0015 | Postgres `NOTIFY` capped the whole cluster near 650 moves a second, so Redis carries the cluster channel, per-instance inboxes, presence and HTTP rate limits; an owner epoch fences every table write, a finished round lands once from its envelope, and shutdown hands each table to a peer. Supersedes ADR-0003's adapter clause. |
| [0015](0015-every-runtime-and-service-on-its-latest-usable-stable-release.md) | Every runtime and service on its latest usable stable release | Accepted; Postgres and Valkey decisions superseded by 0016, TypeScript and ESLint clauses by 0017 | Postgres 18, Valkey 8.1 (the engine Render runs) instead of Redis 7, Node 26 everywhere with no dev/prod split, Expo SDK 58, zod 4 and current CI actions; each product's adopted features named, and each rejected one with its reason. |
| [0016](0016-postgres-19-and-valkey-9-now.md) | Postgres 19 and Valkey 9 now, and their own commands in place of ours | Accepted | Postgres 16 goes straight to 19 at GA with `uuid` ids, `uuidv7()`, skip scan and `transaction_timeout`; Valkey 9.1 replaces Redis 7, and `DELIFEQ`, `SET … IFEQ` and `XADD … NOMKSTREAM` replace our Lua; the host must run both. Supersedes ADR-0015 decisions 1 and 2. |
| [0017](0017-eslint-10-without-the-expo-preset-and-typescript-7-for-typecheck.md) | ESLint 10 without the Expo preset, and TypeScript 7 for `typecheck` | Accepted | `eslint.base.cjs` keeps every rule `eslint-config-expo` enabled, with eslint-plugin-import-x for import and eslint-plugin-react on a pinned React version; TypeScript 7 runs `npm run typecheck` (about 3x cold, 2.6x incremental), 6 stays for the API, typescript-eslint and `typecheck:strict`. Supersedes ADR-0015 decision 5's TypeScript and ESLint clauses. |
| [0018](0018-the-skia-table-is-held-to-counted-budgets.md) | The Skia table is held to counted budgets, and to no time budget | Accepted | `tests/e2e/skiaPerf.spec.ts` gates every draw and style write its counters see (WebGL, 2D, offscreen, `readPixels`, style writes under `game-root`, and card writes and felt frames on their own) at 4x CPU, at rest and through a turn, against `tests/e2e/helpers/skiaPerfBudgets.ts`. Script time is not gated: the virtual clock hides frame work from it, so a pure-CPU regression passes. |
| [0019](0019-the-ruleset-stays-under-its-line-cap.md) | The ruleset stays under its line cap | Accepted | `RULES.md` keeps its line cap; a rule that does not fit merges or retires another in review. |
| [0020](0020-the-table-at-rest-plays-precomputed-tracks.md) | The table at rest plays precomputed tracks | Accepted | Ambient motion is baked at each settle and played on the compositor via `ambient()`; nothing redraws at rest. |

## Writing one

Four headings, in this order: **Context** (what forced the decision, quoting the reporter
where their words exist), **Decision**, **Consequences**, and a `**Status:**` /
`**Date:**` pair under the title. Add a row here in the same commit — the index is what
agents read, and a record nothing points at is a record nobody opens.

Write one only for a decision that constrains future changes. A completed task, a run log
or a session summary is not a decision and does not belong in this directory.

A plan, a research note or a design spec is a working artefact: it is deleted once its work
lands, and anything in it worth keeping is a record here. `docs/README.md` points at this index.

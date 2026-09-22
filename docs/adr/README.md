# Decisions

Read this index; open a record only when it covers the area you are about to change.

An ADR is history and is never rewritten. A decision that no longer holds gets
`**Status:** Superseded by ADR-XXXX` added at the top and nothing else changed.

| # | Title | Status | In one line |
|---|---|---|---|
| [0001](0001-keep-react-native-expo-client-and-replit-host.md) | Keep the React Native/Expo client and the Replit host | Accepted; host clause superseded by 0006 | A turn-based card game with ≤54 sprites and a 0.96 ms rules engine has no rendering or simulation problem, so no game engine or host change is justified. |
| [0002](0002-a-play-leaves-the-seat-it-was-thrown-from.md) | A play leaves the seat it was thrown from | Accepted | A flight starts at the throwing seat's real position, not a fixed unscaled offset in the pile's frame. |
| [0003](0003-cloud-run-already-runs-multiple-instances.md) | Cloud Run already runs the app on multiple instances | Accepted | Multi-instance is the deployed reality today, not a deferred future — the ownership/routing protocol is load-bearing, not speculative. |
| [0004](0004-the-queue-loop-serialises-and-owns-the-merge.md) | The queue loop serialises its tickets and the supervisor owns the merge | Accepted | One ticket at a time and nothing held in memory: ~22% of wall clock buys away the whole class of defect where the supervisor and the session disagree about which ticket is live. |
| [0005](0005-the-compiler-is-not-the-enforcer-of-the-adopted-rules.md) | The React Compiler is not the enforcer of the three rules #891 adopted | Accepted | `eslintSuppressionRules` stays unset: the compiler's penalty is an unmemoized component in production, which is a worse answer than the lint error two source scans already give. |
| [0006](0006-the-host-is-no-longer-replit.md) | The host is no longer Replit, and the next one is still to be chosen | Accepted | Supersedes ADR-0001's "Stay on Replit for now": the subscription ended, the dev-sync machinery is deleted, and the new host is #1105's to choose. |
| [0007](0007-account-recovery-email-verification-and-password-reset.md) | Account recovery: email verification and password reset | Accepted | Six boxes (migration, token storage, sender, rate limiting, enumeration-safety, session clearing) shipped across #861–#864; `server/http/routes.ts` and related source cite them by number. |

## Writing one

Four headings, in this order: **Context** (what forced the decision, quoting the reporter
where their words exist), **Decision**, **Consequences**, and a `**Status:**` /
`**Date:**` pair under the title. Add a row here in the same commit — the index is what
agents read, and a record nothing points at is a record nobody opens.

Write one only for a decision that constrains future changes. A completed task, a run log
or a session summary is not a decision and does not belong in this directory.

A plan, a research note or a design spec is a working artefact: it is deleted once the work it
describes has landed, and anything in it worth keeping past that point is a record here, not a
file kept alive by habit. `docs/README.md` is where a reader finds this index; nothing links
into a deleted plan/research/specs/design file, because nothing does anymore.

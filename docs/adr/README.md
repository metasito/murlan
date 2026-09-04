# Decisions

Read this index; open a record only when it covers the area you are about to change.

An ADR is history and is never rewritten. A decision that no longer holds gets
`**Status:** Superseded by ADR-XXXX` added at the top and nothing else changed.

| # | Title | Status | In one line |
|---|---|---|---|
| [0001](0001-keep-react-native-expo-client-and-replit-host.md) | Keep the React Native/Expo client and the Replit host | Accepted | A turn-based card game with ≤54 sprites and a 0.96 ms rules engine has no rendering or simulation problem, so no game engine or host change is justified. |
| [0002](0002-a-play-leaves-the-seat-it-was-thrown-from.md) | A play leaves the seat it was thrown from | Accepted | A flight starts at the throwing seat's real position, not a fixed unscaled offset in the pile's frame. |

## Writing one

Four headings, in this order: **Context** (what forced the decision, quoting the reporter
where their words exist), **Decision**, **Consequences**, and a `**Status:**` /
`**Date:**` pair under the title. Add a row here in the same commit — the index is what
agents read, and a record nothing points at is a record nobody opens.

Write one only for a decision that constrains future changes. A completed task, a run log
or a session summary is not a decision and does not belong in this directory.

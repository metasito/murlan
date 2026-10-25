# 0012. A move intent names the seq it was made against

**Status:** Accepted
**Date:** 2026-10-21

## Context

#1824: "After a server restart, a client that re-sends an intent it already sent gets it applied a
second time." The only record of an applied intent was `applied` in `server/game/tableRouter.ts`,
kept in process memory for 60 s. A restart or a second instance loses it, and the intent itself
carried nothing a restored table could judge it by. A re-sent play happened to be refused because
its cards had left the hand. A re-sent pass was legal again as soon as the turn came back to its
seat, so the seat lost a turn it never chose to pass. The #1816 soak reproduced this on seeds 31
and 1816.

Two fixes were proposed: carry the `seq` in the intent, or persist `applied` in Postgres next to
`active_games`. The owner chose the first on 2026-10-21.

## Decision

1. **Every move intent (`game:play`, `game:pass`, `game:exchange_give_card`) carries `seq`.** It
   is the table's `lastMove.seq` when the move was chosen, as `intentSeq` in `lib/game/moves.ts`
   reads it. The schemas in `shared/socketSchemas.ts` require it.
2. **The table drops a stale move before the engine sees it.** `moveAction` in
   `server/game/tableMoves.ts` refuses a move whose `seq` is not the table's current one
   (`isStaleIntent`). It answers `NOT_YOUR_TURN`, silently, as for a move out of turn.
3. **`PROTOCOL_VERSION` and `MIN_PROTOCOL_VERSION` go to 13.** A bundle that sends no `seq` is
   turned away at the handshake, so no path accepts a move without one.

## Consequences

- The record of applied moves is the game state itself, so it holds across restarts and
  instances without storage. `applied` still answers a same-process retry with its first outcome.
- A new move kind, or a new event that carries one, must carry `seq` as well.
- `seq` counts from 0 at each deal. A retry that outlives its round could match a seq of the
  next round, and that needs the seat to be on move at the same count with the move still legal.
  Nothing here prevents it.

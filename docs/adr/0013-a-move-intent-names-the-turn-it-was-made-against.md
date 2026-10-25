# 0013. A move intent names the turn it was made against

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

Two fixes were proposed: carry the move's place in the round in the intent, or persist `applied`
in Postgres next to `active_games`. The owner chose the first on 2026-10-21.

## Decision

1. **Every wire game state carries `turn`, an opaque token, and every move intent
   (`game:play`, `game:pass`, `game:exchange_give_card`) echoes the `turn` of the state it was
   made against.** `turnOf` in `lib/game/moves.ts` is the one owner of the token; the server writes
   it into each state (`sanitizeStateForPlayer`), and the client never computes or reads into it.
   The schemas in `shared/socketSchemas.ts` require it.
2. **The table drops a stale move before the engine sees it.** `moveAction` in
   `server/game/tableMoves.ts` refuses a move whose `turn` is not the table's current one
   (`isStaleTurn`). It answers `NOT_YOUR_TURN`, silently, as for a move out of turn, and the
   client answers its own move refused so by asking for the table again (`game:rejoin`).
3. **`PROTOCOL_VERSION` and `MIN_PROTOCOL_VERSION` go to 13.** A bundle that sends no `turn` is
   turned away at the handshake, so no path accepts a move without one.

## Consequences

- The record of applied moves is the game state itself, so it holds across restarts and
  instances without storage. `applied` still answers a same-process retry with its first outcome.
- A new move kind, or a new event that carries one, must carry `turn` as well.
- Today the token is the round's move count, which restarts at each deal: a retry that outlives
  its round could match the next round's token with the move still legal. Because the client only
  echoes the token, `turnOf` can add a deal or round id without another `MIN_PROTOCOL_VERSION`
  raise.

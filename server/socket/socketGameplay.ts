// server/socket/socketGameplay.ts — everything a player does at a live table: playing
// and passing, the exchange a round winner owes, rejoining a round in progress,
// reactions, and voting for another round.
//
// Every handler here resolves the room and hands the intent to
// `applyOrForward`, which runs it on the instance that owns the table. None of
// them reads `activeGames`: the game lives in one process, and reading the map
// where the socket happens to be is how half a table was refused every move.
//
// Registration is synchronous and runs before the connection handler's first
// `await`, exactly as it did inline — `game:rejoin` in particular is emitted
// by the client from its own `connect` handler, and a packet that arrives
// with no listener attached is dropped.
import type { HandlerContext } from "./socketTypes.ts";
import { onEvent, type EventContext } from "./socketSafety.ts";
import { socketRoomMap } from "../game/gameRoom.ts";
import type { TableActionDraft } from "../game/tableActions.ts";
import type { Outcome } from "../shared/refusal.ts";
import { seatSocket } from "./seating.ts";
import { rejoinFailure } from "./rejoinFailure.ts";
import {
  NoPayloadSchema,
  GamePlaySchema,
  GameRejoinSchema,
  GameReactionSchema,
  GameExchangeGiveCardSchema,
  GameEndMatchVoteSchema,
} from "../../shared/socketSchemas.ts";

const GAME_ACTION_RATE_LIMIT = 60;

type DraftBody = TableActionDraft extends infer T
  ? T extends TableActionDraft
    ? Omit<T, "roomId" | "userId" | "intentId">
    : never
  : never;

export function registerGameplayHandlers({ rt, socket, userId }: HandlerContext) {

    const rejoinFailed = (code: string, roomId: unknown) => {
      socket.emit("game:rejoin_failed", rejoinFailure(code, roomId));
    };

    /** Routes the intent to this socket's table, or refuses it when the socket is at none. */
    const atTable =
      <P,>(toDraft: (p: P) => DraftBody) =>
      async (p: P, { intentId }: EventContext): Promise<Outcome> => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        return rt.route({ ...toDraft(p), roomId, userId, intentId });
      };

    onEvent(socket, "game:play", GamePlaySchema, atTable(({ cardIds }) => ({ kind: "move", move: { kind: "play", cardIds } })), { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 });

    onEvent(socket, "game:pass", NoPayloadSchema, atTable(() => ({ kind: "move", move: { kind: "pass" } })), { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 });

    onEvent(socket, "game:rematch_vote", NoPayloadSchema, atTable(() => ({ kind: "rematchVote" })), { limit: 20, windowMs: 60_000 });

    onEvent(socket, "game:end_match_vote", GameEndMatchVoteSchema, atTable(({ wants }) => ({ kind: "endMatchVote", wants })), { limit: 20, windowMs: 60_000 });

    onEvent(
      socket,
      "game:rejoin",
      GameRejoinSchema,
      async ({ roomId }) => {
        const outcome = await rt.route({ kind: "rejoin", roomId, userId });
        if (!outcome.ok) return outcome;
        // Only once the table has accepted them: a socket joined to a room it
        // holds no seat at would receive every broadcast for that table.
        await seatSocket(rt, socket, userId, roomId);
        return outcome;
      },
      {
        limit: 20,
        windowMs: 60_000,
        // Every failure, a thrown handler's SERVER_ERROR included, resolves on
        // the one channel the client's rejoin handling listens on.
        refuse: (refusal, raw) => rejoinFailed(refusal.code, (raw as { roomId?: unknown } | undefined)?.roomId),
      }
    );

    onEvent(socket, "game:reaction", GameReactionSchema, atTable(({ emoji }) => ({ kind: "reaction", emoji })), { limit: 8, windowMs: 10_000 });

    onEvent(socket, "game:exchange_give_card", GameExchangeGiveCardSchema, atTable(({ cardId }) => ({ kind: "move", move: { kind: "giveback", cardId } })), { limit: 30, windowMs: 60_000 });
}

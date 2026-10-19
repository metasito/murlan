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
import { applyOrForward } from "../game/tableRouter.ts";
import type { TableActionDraft } from "../game/tableActions.ts";
import type { Outcome } from "../shared/refusal.ts";
import { seatSocket } from "./seating.ts";
import { payload } from "../shared/payload.ts";
import {
  NoPayloadSchema,
  GamePlaySchema,
  GameRejoinSchema,
  GameReactionSchema,
  GameExchangeGiveCardSchema,
  GameEndMatchVoteSchema,
} from "../../shared/socketSchemas.ts";
import { testOnlyEnv } from "../http/testOnlyEnv.ts";

/**
 * Read once at module scope — same shape as the rate-limit env reads in server/http/routes.ts — so
 * a test process must set MURLAN_GAME_ACTION_RATE_LIMIT before this module
 * is first imported. Shared by game:play and game:pass: a suite replaying
 * several rounds down one socket to reach a probabilistic phase needs
 * headroom a live session never does.
 */
function gameActionLimitFromEnv(): number {
  const parsed = Number(testOnlyEnv("MURLAN_GAME_ACTION_RATE_LIMIT"));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 60;
}
const GAME_ACTION_RATE_LIMIT = gameActionLimitFromEnv();

type RejoinCode =
  | "UNAUTHORIZED"
  | "SEAT_RELEASED"
  | "NO_LIVE_GAME"
  | "GAME_NO_LONGER_VALID"
  | "INVALID_PAYLOAD"
  | "SERVER_ERROR";

/**
 * What the client is told when a rejoin fails, keyed by the refusal the owning
 * instance gave. `game:rejoin_failed` is the only failure the client's rejoin
 * handling listens for, and `roomId` stays top-level because its stale-reply
 * guard matches on it.
 */
const REJOIN_FAILURE: Record<RejoinCode, ReturnType<typeof payload>> = {
  UNAUTHORIZED: payload("UNAUTHORIZED"),
  SEAT_RELEASED: payload("SEAT_RELEASED"),
  NO_LIVE_GAME: payload("GAME_NOT_FOUND"),
  GAME_NO_LONGER_VALID: payload("GAME_NO_LONGER_VALID"),
  INVALID_PAYLOAD: payload("INVALID_PAYLOAD"),
  SERVER_ERROR: payload("SERVER_ERROR"),
};

type DraftBody = TableActionDraft extends infer T
  ? T extends TableActionDraft
    ? Omit<T, "roomId" | "userId" | "intentId">
    : never
  : never;

export function registerGameplayHandlers({ io, socket, userId }: HandlerContext) {

    const rejoinFailed = (code: string, roomId: unknown) => {
      const failure = REJOIN_FAILURE[code as RejoinCode] ?? REJOIN_FAILURE.SERVER_ERROR;
      socket.emit("game:rejoin_failed", { ...failure, roomId: typeof roomId === "string" ? roomId : undefined });
    };

    /** Routes the intent to this socket's table, or refuses it when the socket is at none. */
    const atTable =
      <P,>(toDraft: (p: P) => DraftBody) =>
      async (p: P, { intentId }: EventContext): Promise<Outcome> => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        return applyOrForward(io, { ...toDraft(p), roomId, userId, intentId });
      };

    onEvent(socket, "game:play", GamePlaySchema, atTable(({ cardIds }) => ({ kind: "play", cardIds })), { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 });

    onEvent(socket, "game:pass", NoPayloadSchema, atTable(() => ({ kind: "pass" })), { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 });

    onEvent(socket, "game:rematch_vote", NoPayloadSchema, atTable(() => ({ kind: "rematchVote" })), { limit: 20, windowMs: 60_000 });

    onEvent(socket, "game:end_match_vote", GameEndMatchVoteSchema, atTable(({ wants }) => ({ kind: "endMatchVote", wants })), { limit: 20, windowMs: 60_000 });

    onEvent(
      socket,
      "game:rejoin",
      GameRejoinSchema,
      async ({ roomId }) => {
        const outcome = await applyOrForward(io, { kind: "rejoin", roomId, userId });
        if (!outcome.ok) return outcome;
        // Only once the table has accepted them: a socket joined to a room it
        // holds no seat at would receive every broadcast for that table.
        await seatSocket(io, socket, userId, roomId);
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

    onEvent(socket, "game:exchange_give_card", GameExchangeGiveCardSchema, atTable(({ cardId }) => ({ kind: "exchange", cardId })), { limit: 30, windowMs: 60_000 });
}

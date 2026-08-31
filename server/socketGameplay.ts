// server/socketGameplay.ts — everything a player does at a live table: playing
// and passing, the exchange a round winner owes, rejoining a hand in progress,
// reactions, and voting for another manche.
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
import type { Server as SocketServer, Socket } from "socket.io";
import { logger } from "./logger.ts";
import { onEvent } from "./socketSafety.ts";
import type { EventOutcome } from "./socketSafety.ts";
import { socketRoomMap } from "./gameRoom.ts";
import { applyOrForward } from "./tableRouter.ts";
import { joinSocketToRoom } from "./socketTable.ts";
import {
  NoPayloadSchema,
  GamePlaySchema,
  GameRejoinSchema,
  GameReactionSchema,
  GameExchangeGiveCardSchema,
  GameRematchIntentSchema,
} from "./socketSchemas.ts";

/**
 * Read once at module scope — same shape as authMaxFromEnv in routes.ts — so
 * a test process must set MURLAN_GAME_ACTION_RATE_LIMIT before this module
 * is first imported. Shared by game:play and game:pass: a suite replaying
 * several hands down one socket to reach a probabilistic phase needs
 * headroom a live session never does.
 */
function gameActionLimitFromEnv(): number {
  const parsed = Number(process.env.MURLAN_GAME_ACTION_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 60;
}
const GAME_ACTION_RATE_LIMIT = gameActionLimitFromEnv();

/**
 * What the client is told when a rejoin fails, keyed by the refusal the owning
 * instance gave. `game:rejoin_failed` is the only failure the client's rejoin
 * handling listens for, and `roomId` stays top-level because its stale-reply
 * guard matches on it.
 */
const REJOIN_FAILURE: Record<string, { message: string; code: string }> = {
  UNAUTHORIZED: { message: "Not authorized", code: "UNAUTHORIZED" },
  NO_LIVE_GAME: { message: "Game not found", code: "GAME_NOT_FOUND" },
  GAME_NO_LONGER_VALID: { message: "Game no longer valid", code: "GAME_NO_LONGER_VALID" },
  SERVER_ERROR: { message: "Server error", code: "SERVER_ERROR" },
};

export interface GameplayHandlerContext {
  io: SocketServer;
  socket: Socket;
  userId: string;
  username: string;
}

export function registerGameplayHandlers({
  io,
  socket,
  userId,
  username,
}: GameplayHandlerContext) {

    /** The table this socket is at, or the refusal to send back. */
    const atTable = (): string | null => socketRoomMap.get(socket.id) ?? null;

    onEvent(
      socket,
      "game:play",
      GamePlaySchema,
      async ({ cardIds }) => {
        const roomId = atTable();
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        return applyOrForward(io, { kind: "play", roomId, userId, username, cardIds });
      },
      { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:pass",
      NoPayloadSchema,
      async () => {
        const roomId = atTable();
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        return applyOrForward(io, { kind: "pass", roomId, userId, username });
      },
      { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:rematch_intent",
      GameRematchIntentSchema,
      async ({ wants }) => {
        const roomId = atTable();
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        return applyOrForward(io, { kind: "rematchIntent", roomId, userId, username, wants });
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:rematch_vote",
      NoPayloadSchema,
      async () => {
        const roomId = atTable();
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        return applyOrForward(io, { kind: "rematchVote", roomId, userId, username });
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:rejoin",
      GameRejoinSchema,
      async ({ roomId }) => {
        // onEvent's catch turns a throw into a generic `game:error`, which the
        // client's rejoin-failed handling never listens for. Every failure in
        // here must resolve as game:rejoin_failed instead.
        let outcome: EventOutcome;
        try {
          outcome = await applyOrForward(io, { kind: "rejoin", roomId, userId, username });
        } catch (err) {
          logger.error({ err, roomId, userId }, "game:rejoin failed");
          outcome = { ok: false, code: "SERVER_ERROR" };
        }
        if (!outcome.ok) {
          const failure = REJOIN_FAILURE[outcome.code ?? ""] ?? REJOIN_FAILURE.SERVER_ERROR;
          socket.emit("game:rejoin_failed", { ...failure, roomId });
          return outcome;
        }
        // Only once the table has accepted them: a socket joined to a room it
        // holds no seat at would receive every broadcast for that table.
        joinSocketToRoom(socket, roomId);
        return outcome;
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:reaction",
      GameReactionSchema,
      async ({ emoji }) => {
        const roomId = atTable();
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        return applyOrForward(io, { kind: "reaction", roomId, userId, username, emoji });
      },
      { limit: 8, windowMs: 10_000 }
    );

    onEvent(
      socket,
      "game:exchange_give_card",
      GameExchangeGiveCardSchema,
      async ({ cardId }) => {
        const roomId = atTable();
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        return applyOrForward(io, { kind: "exchange", roomId, userId, username, cardId });
      },
      { limit: 30, windowMs: 60_000 }
    );
}

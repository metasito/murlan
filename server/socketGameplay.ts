// server/socketGameplay.ts — everything a player does at a live table: playing
// and passing, the exchange a round winner owes, rejoining a hand in progress,
// reactions, and voting for another manche.
//
// Registration is synchronous and runs before the connection handler's first
// `await`, exactly as it did inline — `game:rejoin` in particular is emitted
// by the client from its own `connect` handler, and a packet that arrives
// with no listener attached is dropped.
import type { Server as SocketServer, Socket } from "socket.io";
import { eq } from "drizzle-orm";
import { storage } from "./storage.ts";
import { logger } from "./logger.ts";
import { DEFAULT_LOCALE, translate } from "../shared/i18n.ts";
import { trackEvent } from "./events.ts";
import { db } from "./db.ts";
import { activeGames as activeGamesTable } from "../shared/schema.ts";
import { onEvent } from "./socketSafety.ts";
import { activeGames, seatOfUser, socketRoomMap } from "./gameRoom.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import {
  broadcastGameState,
  disposeGame,
  gameOverWriters,
  persistGameState,
} from "./gamePersistence.ts";
import {
  broadcastRematchIntents,
  handleGameOver,
  tableWantsRematch,
} from "./gameOver.ts";
import { armTurn, recordPlayFlags } from "./gameTurn.ts";
import {
  teamKeyMap,
  restoredMatchOver,
  unpackPersistedState,
} from "./onlineGameLogic.ts";
import { rejoinSocketToTable } from "./socketTable.ts";
import {
  NoPayloadSchema,
  GamePlaySchema,
  GameRejoinSchema,
  GameReactionSchema,
  GameExchangeGiveCardSchema,
  GameRematchIntentSchema,
} from "./socketSchemas.ts";
import {
  initializeGame,
  initializeRematch,
  nextDealFirstSeat,
  processPlay,
  processPass,
  processExchangeChoice,
  buildCombination,
  canPlay,
} from "../lib/gameEngine.ts";
import type { GameState } from "../lib/gameEngine.ts";
import { appendReplayMove } from "./replayShape.ts";
import { dealManche } from "./dealManche.ts";

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

    onEvent(
      socket,
      "game:play",
      GamePlaySchema,
      async ({ cardIds }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        const game = activeGames.get(roomId);
        if (!game || game.gameState.gameOver) return { ok: false, code: "NO_LIVE_GAME" };

        const { gameState, playerMap } = game;

        // The round winner owes a card: nobody may play until it is given,
        // otherwise they keep the card and freeze the table behind the
        // exchange overlay.
        if (gameState.exchangePhase?.active) {
          socket.emit("game:error", {
            message: "You must complete the exchange first",
            code: "EXCHANGE_PENDING",
          });
          return { ok: false, code: "EXCHANGE_PENDING" };
        }

        const currentIdx = gameState.currentTurnIndex;
        if (playerMap[currentIdx] !== userId) return { ok: false, code: "NOT_YOUR_TURN" };

        const player = gameState.players[currentIdx];
        if (!player) return { ok: false, code: "NO_LIVE_GAME" };
        const unique = Array.from(new Set(cardIds));
        const cards = player.hand.filter((c) => unique.includes(c.id));
        if (cards.length !== unique.length) {
          socket.emit("game:error", { message: "Invalid card", code: "INVALID_CARD" });
          return { ok: false, code: "INVALID_CARD" };
        }

        const combo = buildCombination(cards);
        if (!combo) {
          socket.emit("game:error", { message: "Invalid combination", code: "INVALID_COMBINATION" });
          return { ok: false, code: "INVALID_COMBINATION" };
        }

        const isNewRound = gameState.lastPlayedCombination === null;
        // Read before the engine sets it, so the transition is observable once
        // rather than on every play after it.
        const wasFirstPlay = !gameState.firstPlayMade;

        if (!gameState.firstPlayMade && gameState.startCard) {
          const startCardId = gameState.startCard.id;
          if (!combo.cards.some((c) => c.id === startCardId)) {
            const sc = gameState.startCard;
            socket.emit("game:error", {
              message: translate(DEFAULT_LOCALE, "server.MUST_PLAY_START_CARD", { rank: sc.rank }),
              code: "MUST_PLAY_START_CARD",
              params: { rank: sc.rank },
            });
            return { ok: false, code: "MUST_PLAY_START_CARD" };
          }
        }

        if (!canPlay(combo, isNewRound ? null : gameState.lastPlayedCombination)) {
          socket.emit("game:error", { message: "Invalid move", code: "INVALID_MOVE" });
          return { ok: false, code: "INVALID_MOVE" };
        }

        // Achievement bookkeeping — see recordPlayFlags; this is the
        // human-initiated path, autoMoveForSeat covers bot/AFK-forced plays.
        recordPlayFlags(game, currentIdx, combo);

        const newState = processPlay(gameState, combo);
        appendReplayMove(game, currentIdx, combo, newState);
        game.gameState = newState;

        // A count and a type, never card identities: enabling debug in
        // production must not be able to expose a hand.
        logger.debug(
          {
            roomId,
            seat: currentIdx,
            comboType: combo.type,
            cardCount: combo.cards.length,
          },
          "Play accepted"
        );

        broadcastGameState(io, game);
        persistGameState(roomId, game);

        if (wasFirstPlay && newState.firstPlayMade) {
          trackEvent("game.firstMoveMade", userId, {
            playerCount: newState.players.length,
            gameMode: newState.gameMode,
          });
        }

        if (newState.gameOver) {
          await handleGameOver(io, roomId, game, gameOverWriters);
        } else {
          armTurn(io, roomId);
        }
      },
      { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:pass",
      NoPayloadSchema,
      async () => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        const game = activeGames.get(roomId);
        if (!game || game.gameState.gameOver) return { ok: false, code: "NO_LIVE_GAME" };

        const { gameState, playerMap } = game;
        if (gameState.exchangePhase?.active) {
          socket.emit("game:error", {
            message: "You must complete the exchange first",
            code: "EXCHANGE_PENDING",
          });
          return { ok: false, code: "EXCHANGE_PENDING" };
        }

        const currentIdx = gameState.currentTurnIndex;
        if (playerMap[currentIdx] !== userId) return { ok: false, code: "NOT_YOUR_TURN" };
        if (gameState.lastPlayedCombination === null) {
          socket.emit("game:error", { message: "You cannot pass", code: "CANNOT_PASS" });
          return { ok: false, code: "CANNOT_PASS" };
        }

        const newState = processPass(gameState);
        appendReplayMove(game, currentIdx, null, newState);
        game.gameState = newState;

        broadcastGameState(io, game);
        persistGameState(roomId, game);
        armTurn(io, roomId);
      },
      { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:rematch_intent",
      GameRematchIntentSchema,
      async ({ wants }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game) return;
        if (seatOfUser(game, userId) === null) return;

        game.rematchIntents.set(userId, wants);
        broadcastRematchIntents(io, game);
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:rematch_vote",
      NoPayloadSchema,
      async () => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game || !game.gameState.gameOver) return;
        if (seatOfUser(game, userId) === null) return;

        // `total` is the seated-seat count: bots and seats whose player left
        // hold no vote, exactly as countRematchAnswers counts them.
        const broadcastVoteState = () =>
          io.to(roomId).emit("game:vote_state", {
            votes: Array.from(game.rematchVotes),
            total: Object.keys(game.playerMap).length,
          });

        // The table was asked during the closing manche and said no. Nobody
        // gets to restart it from the results screen after that.
        if (game.matchOver && !tableWantsRematch(game)) {
          socket.emit("game:error", {
            message: "The table chose not to play again",
            code: "REMATCH_DECLINED",
          });
          return;
        }

        game.rematchVotes.add(userId);
        broadcastVoteState();
        if (game.rematchVotes.size < Object.keys(game.playerMap).length) return;

        // The database is read for the room's settings and nothing else: the
        // next manche's seats are copied from the running game. `room_players`
        // holds humans only, so a roster rebuilt from it drops every bot seat
        // and renumbers whatever is left.
        const room = await storage.getRoomById(roomId);
        if (!room) {
          socket.emit("game:error", { message: "Room not found", code: "ROOM_NOT_FOUND" });
          broadcastVoteState();
          return;
        }

        const seats = game.gameState.players;
        if (seats.length < 2) {
          socket.emit("game:error", {
            message: "At least 2 players are required",
            code: "MIN_PLAYERS_REQUIRED",
          });
          broadcastVoteState();
          return;
        }

        // Cleared only once the next manche is certain to be dealt. A vote
        // discarded on the way out of a bail-out can never be retried: the
        // overlay would sit below its own threshold with nothing left to press.
        game.rematchVotes.clear();

        const prevRankings = game.gameState.rankings;
        // Engine ids ride across the manche, so prevRankings resolves to the
        // same seats it named — initializeRematch never has to fall back to a
        // guessed winner, and the exchange runs between the right two players.
        const playerSetup = seats.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          personality: p.personality,
          team: room.gameMode === "teams" ? p.team : undefined,
        }));

        const nextFirstSeat = nextDealFirstSeat(game.dealFirstSeat, playerSetup.length);
        const newGameState =
          prevRankings.length >= 2
            ? initializeRematch(playerSetup, room.gameMode, prevRankings, nextFirstSeat)
            : initializeGame(playerSetup, room.gameMode, nextFirstSeat);
        game.dealFirstSeat = nextFirstSeat;

        // `game.playerMap` is deliberately left alone: seat i of the new state
        // is seat i of the old one, because playerSetup was built from that
        // same array in order. playerMap is what sanitizeStateForPlayer reads
        // to decide whose hand each viewer is sent, so renumbering it here is
        // how a player ends up holding someone else's cards.
        game.gameMode = room.gameMode;
        game.maxPlayers = room.maxPlayers;

        await dealManche(io, game, newGameState);
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
        // here must resolve as game:rejoin_failed instead, carrying { code,
        // message } — and `roomId` stays top-level, because the client's
        // stale-reply guard matches on it.
        try {
          const existingGame = activeGames.get(roomId);
          if (existingGame) {
            const seat = seatOfUser(existingGame, userId);
            if (seat === null) {
              socket.emit("game:rejoin_failed", { message: "Not authorized", code: "UNAUTHORIZED", roomId });
              return;
            }

            // Idempotent — an INSERT on every reconnect would pile up
            // duplicate room_players rows and corrupt the next rematch.
            await storage
              .upsertRoomPlayer(roomId, userId, seat)
              .catch((err: unknown) =>
                logger.warn({ err, roomId, userId }, "upsertRoomPlayer failed")
              );

            await rejoinSocketToTable(
              io,
              socket,
              userId,
              username,
              roomId,
              existingGame
            );
            logger.info({ userId, roomId }, "Player rejoined game (from memory)");
            return;
          }

          const row = await db.query.activeGames.findFirst({
            where: eq(activeGamesTable.roomId, roomId),
          });
          if (!row) {
            socket.emit("game:rejoin_failed", { message: "Game not found", code: "GAME_NOT_FOUND", roomId });
            return;
          }

          const restored = unpackPersistedState<GameState>(row.gameState);
          if (!restored.ok) {
            // Written under an older persisted shape, or holding a value the
            // restore path would carry straight into the engine. Restoring it
            // deals a silently corrupt hand rather than crashing, which is
            // worse than refusing outright.
            logger.warn(
              { roomId, reason: restored.reason },
              "Discarding unrestorable persisted game"
            );
            disposeGame(roomId);
            socket.emit("game:rejoin_failed", { message: "Game no longer valid", code: "GAME_NO_LONGER_VALID", roomId });
            return;
          }

          const { playerMap, scores, gameMode, matchLength, matchTarget, maxPlayers } =
            restored.match;
          if (!Object.values(playerMap).includes(userId)) {
            socket.emit("game:rejoin_failed", { message: "Not authorized", code: "UNAUTHORIZED", roomId });
            return;
          }

          const restoredState = restored.gameState;
          const restoredPlayers = restoredState.players;
          const game: OnlineGameState = {
            roomId,
            joinCode: restored.joinCode,
            gameState: restoredState,
            playerMap,
            rematchVotes: new Set(),
            rematchIntents: new Map(),
            cumulativeScores: scores,
            gameMode,
            maxPlayers,
            matchTarget,
            matchLength,
            matchOver: restoredMatchOver({
              matchLength,
              gameMode,
              handOver: restoredState.gameOver,
              scores,
              target: matchTarget,
              teamOfKey: teamKeyMap(playerMap, restoredPlayers),
              playerCount: restoredPlayers.length,
            }),
            handFlags: restored.handFlags,
            // A hand restored after a restart has no record of who walked out
            // of it: the map is memory-only and the restart emptied it.
            abandonedSeats: new Map<number, string>(),
            spectators: new Set<string>(),
            // The log is memory-only, so a hand restored after a restart has
            // none and produces no replay. The next hand starts a fresh one.
            moveLog: null,
            dealFirstSeat: restored.dealFirstSeat,
          };
          activeGames.set(roomId, game);
          logger.info({ roomId }, "Rehydrated activeGames from DB after restart");

          const seat = seatOfUser(game, userId);
          if (seat !== null) {
            await storage
              .upsertRoomPlayer(roomId, userId, seat)
              .catch((err: unknown) =>
                logger.warn({ err, roomId, userId }, "upsertRoomPlayer failed")
              );
          }

          await rejoinSocketToTable(io, socket, userId, username, roomId, game);
          logger.info({ userId, roomId }, "Player rejoined game (from DB)");
        } catch (err) {
          logger.error({ err, roomId, userId }, "game:rejoin failed");
          socket.emit("game:rejoin_failed", { message: "Server error", code: "SERVER_ERROR", roomId });
        }
      },
      { limit: 20, windowMs: 60_000 }
    );

    onEvent(
      socket,
      "game:reaction",
      GameReactionSchema,
      ({ emoji }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game) return;

        const seat = seatOfUser(game, userId);
        if (seat === null) return;
        io.to(roomId).emit("game:reaction", {
          emoji,
          fromSeat: seat,
          username,
        });
      },
      { limit: 8, windowMs: 10_000 }
    );

    // ── Exchange card give ───────────────────────────────────────────────────

    onEvent(
      socket,
      "game:exchange_give_card",
      GameExchangeGiveCardSchema,
      ({ cardId }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
        const game = activeGames.get(roomId);
        if (!game?.gameState.exchangePhase?.active) return { ok: false, code: "NO_EXCHANGE" };

        const seat = seatOfUser(game, userId);
        if (seat === null || seat !== game.gameState.exchangePhase.winnerIdx)
          return { ok: false, code: "NOT_YOUR_EXCHANGE" };

        const next = processExchangeChoice(game.gameState, cardId);
        if (next === game.gameState) {
          socket.emit("game:error", { message: "Invalid card", code: "INVALID_CARD" });
          return { ok: false, code: "INVALID_CARD" };
        }
        game.gameState = next;

        broadcastGameState(io, game);
        persistGameState(roomId, game);
        armTurn(io, roomId);
      },
      { limit: 30, windowMs: 60_000 }
    );
}

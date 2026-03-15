import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { eq } from "drizzle-orm";
import { storage } from "./storage";
import { logger } from "./logger";
import { sessionMiddleware } from "./session";
import { db } from "./db";
import { activeGames as activeGamesTable } from "@shared/schema";
import {
  initializeGame,
  initializeRematch,
  processPlay,
  processPass,
  processExchangeChoice,
  buildCombination,
  sortHand,
  canPlay,
} from "../lib/gameEngine";
import type { GameState, Card } from "../lib/gameEngine";

interface OnlineGameState {
  gameState: GameState;
  playerMap: Record<number, string>; // seatIndex -> userId
  socketMap: Record<string, string>; // socketId -> userId
  roomId: string;
  rematchVotes: Set<string>;
  cumulativeScores: Record<string, number>;
}

const activeGames = new Map<string, OnlineGameState>();
const socketRoomMap = new Map<string, string>();
const userSocketMap = new Map<string, string>();
const publicRoomIds = new Set<string>();

// AFK timer tracking
const afkTimers = new Map<string, ReturnType<typeof setTimeout>>();
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

let _io: SocketServer | null = null;

export function emitToUser(userId: string, event: string, data: unknown) {
  if (!_io) return;
  const socketId = userSocketMap.get(userId);
  if (socketId) {
    _io.to(socketId).emit(event, data);
  }
}

export function isUserOnline(userId: string): boolean {
  return userSocketMap.has(userId);
}

function sanitizeStateForPlayer(
  state: GameState,
  viewerUserId: string,
  playerMap: Record<number, string>
) {
  return {
    ...state,
    players: state.players.map((p, idx) => {
      const isViewer = playerMap[idx] === viewerUserId;
      return {
        ...p,
        hand: isViewer ? p.hand : ([] as Card[]),
        handCount: p.hand.length,
      };
    }),
  };
}

function clearAfkTimer(roomCode: string, userId: string) {
  const key = `${roomCode}:${userId}`;
  const t = afkTimers.get(key);
  if (t) {
    clearTimeout(t);
    afkTimers.delete(key);
  }
}

function handleAutoPass(roomCode: string, userId: string) {
  if (!_io) return;
  const game = activeGames.get(roomCode);
  if (!game || game.gameState.gameOver) return;
  const { gameState, playerMap } = game;

  if (gameState.exchangePhase?.active) {
    const winnerSeat = gameState.exchangePhase.winnerIdx;
    if (playerMap[winnerSeat] !== userId) return;
    const VALID = ["3","4","5","6","7","8","9","10"];
    const winnerHand = gameState.players[winnerSeat].hand;
    const validCard = winnerHand.find((c) => VALID.includes(c.rank));
    if (validCard) {
      const newState = processExchangeChoice(gameState, validCard.id);
      game.gameState = newState;
      broadcastGameState(_io, game);
      persistGameState(roomCode, game);
      // Start AFK timer for the next player (loser goes first after exchange)
      const nextIdx = newState.currentTurnIndex;
      const nextUserId = playerMap[nextIdx];
      const nextUsername = newState.players[nextIdx]?.name ?? "";
      if (nextUserId) startAfkTimer(roomCode, nextUserId, nextUsername);
    }
    return;
  }

  const currentIdx = gameState.currentTurnIndex;
  if (playerMap[currentIdx] !== userId) return;

  if (gameState.lastPlayedCombination === null) {
    // Round/game start — must play a card, cannot pass
    const player = gameState.players[currentIdx];
    let cardToPlay: Card | undefined;
    if (!gameState.firstPlayMade) {
      // First play of the game: 3♠ is mandatory
      cardToPlay = player.hand.find((c) => c.rank === "3" && c.suit === "spades");
    }
    if (!cardToPlay) {
      // New round start: play lowest card
      const sorted = sortHand([...player.hand]);
      cardToPlay = sorted[0];
    }
    if (cardToPlay) {
      const combo = buildCombination([cardToPlay]);
      if (combo) {
        const newState = processPlay(gameState, combo);
        game.gameState = newState;
        broadcastGameState(_io, game);
        persistGameState(roomCode, game);
      }
    }
    return;
  }

  const newState = processPass(gameState);
  game.gameState = newState;
  broadcastGameState(_io, game);
  persistGameState(roomCode, game);
}

function startAfkTimer(
  roomCode: string,
  userId: string,
  username: string
) {
  clearAfkTimer(roomCode, userId);
  afkTimers.set(
    `${roomCode}:${userId}`,
    setTimeout(() => {
      afkTimers.delete(`${roomCode}:${userId}`);
      handleAutoPass(roomCode, userId);
      if (_io) {
        _io.to(roomCode).emit("game:notification", {
          type: "afk",
          message: `${username} è inattivo — passato automaticamente`,
        });
      }
    }, 30_000)
  );
}

function persistGameState(roomCode: string, game: OnlineGameState) {
  const playerIds = Object.values(game.playerMap);
  db.insert(activeGamesTable)
    .values({
      roomCode,
      gameState: game.gameState as any,
      playerIds: playerIds as any,
      isPublic: false,
      maxPlayers: playerIds.length,
      gameMode: "free_for_all",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: activeGamesTable.roomCode,
      set: { gameState: game.gameState as any, updatedAt: new Date() },
    })
    .catch((err: unknown) =>
      logger.error({ err, roomCode }, "Failed to persist game state")
    );
}

export function setupSocket(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });
  _io = io;

  // Inject session into socket requests
  io.use((socket, next) => {
    sessionMiddleware(socket.request as any, {} as any, next as any);
  });

  // Auth: prefer session, fall back to handshake.auth.userId
  io.use(async (socket, next) => {
    const req = socket.request as any;

    const sessionUserId = req.session?.userId as string | undefined;
    if (sessionUserId) {
      const user = await storage.getUser(sessionUserId).catch(() => null);
      if (user) {
        socket.data.userId = sessionUserId;
        socket.data.username = user.username;
        return next();
      }
    }

    const handshakeUserId = socket.handshake.auth?.userId as string | undefined;
    if (handshakeUserId) {
      const user = await storage.getUser(handshakeUserId).catch(() => null);
      if (user) {
        socket.data.userId = handshakeUserId;
        socket.data.username = user.username;
        return next();
      }
    }

    return next(new Error("Non autenticato"));
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId as string;
    const username = socket.data.username as string;
    userSocketMap.set(userId, socket.id);
    logger.debug({ userId, username, socketId: socket.id }, "Socket connected");

    const pendingDcTimer = disconnectTimers.get(userId);
    if (pendingDcTimer) {
      clearTimeout(pendingDcTimer);
      disconnectTimers.delete(userId);

      for (const [roomId, game] of activeGames.entries()) {
        const seatEntry = Object.entries(game.playerMap).find(([, uid]) => uid === userId);
        if (seatEntry && !game.gameState.gameOver) {
          socket.join(roomId);
          socketRoomMap.set(socket.id, roomId);
          socket.emit(
            "game:state",
            sanitizeStateForPlayer(game.gameState, userId, game.playerMap)
          );
          io.to(roomId).emit("game:player_reconnected", {
            userId,
            username,
          });

          const currentIdx = game.gameState.currentTurnIndex;
          if (game.playerMap[currentIdx] === userId) {
            startAfkTimer(roomId, userId, username);
          }
          logger.info({ userId, username, roomId }, "Player reconnected within grace period");
          break;
        }
      }
    }

    emitFriendStatus(io, userId, true);

    try {
      const friends = await storage.getFriends(userId);
      const onlineIds = friends
        .map((f) => f.friend.id)
        .filter((id) => userSocketMap.has(id));
      socket.emit("friend:online_list", { onlineIds });
    } catch {
      // non-critical
    }

    // ── Room events ──────────────────────────────────────────────────────────

    socket.on(
      "room:create",
      async ({
        gameMode,
        maxPlayers,
      }: {
        gameMode: "free_for_all" | "teams";
        maxPlayers: number;
      }) => {
        try {
          const room = await storage.createRoom(userId, gameMode, maxPlayers);
          await storage.addRoomPlayer(room.id, userId, 0);

          socket.join(room.id);
          socketRoomMap.set(socket.id, room.id);

          const players = await storage.getRoomPlayers(room.id);
          socket.emit("room:state", {
            roomId: room.id,
            code: room.code,
            hostUserId: room.hostUserId,
            status: room.status,
            gameMode: room.gameMode,
            maxPlayers: room.maxPlayers,
            players: players.map((p) => ({
              seatIndex: p.seatIndex,
              userId: p.userId,
              username: p.user.username,
            })),
          });
          logger.info({ roomId: room.id, code: room.code, userId }, "Room created");
        } catch (err) {
          logger.error({ err, userId }, "room:create error");
          socket.emit("room:error", {
            message: "Errore nella creazione della stanza",
          });
        }
      }
    );

    socket.on("room:join", async ({ code }: { code: string }) => {
      try {
        const room = await storage.getRoomByCode(code.toUpperCase());
        if (!room) {
          socket.emit("room:error", { message: "Stanza non trovata" });
          return;
        }
        if (room.status !== "waiting") {
          socket.emit("room:error", { message: "Partita già iniziata" });
          return;
        }

        const players = await storage.getRoomPlayers(room.id);
        if (players.length >= room.maxPlayers) {
          socket.emit("room:error", { message: "Stanza piena" });
          return;
        }
        if (players.some((p) => p.userId === userId)) {
          socket.emit("room:error", { message: "Sei già nella stanza" });
          return;
        }

        const seatIndex = players.length;
        await storage.addRoomPlayer(room.id, userId, seatIndex);

        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);

        const updatedPlayers = await storage.getRoomPlayers(room.id);
        const roomState = {
          roomId: room.id,
          code: room.code,
          hostUserId: room.hostUserId,
          status: room.status,
          gameMode: room.gameMode,
          maxPlayers: room.maxPlayers,
          players: updatedPlayers.map((p) => ({
            seatIndex: p.seatIndex,
            userId: p.userId,
            username: p.user.username,
          })),
        };
        io.to(room.id).emit("room:state", roomState);
      } catch (err) {
        logger.error({ err, userId, code }, "room:join error");
        socket.emit("room:error", {
          message: "Errore nell'unirsi alla stanza",
        });
      }
    });

    socket.on("room:leave", async () => {
      const leavingRoomId = socketRoomMap.get(socket.id);
      await handleLeaveRoom(io, socket, userId);
      if (leavingRoomId && publicRoomIds.has(leavingRoomId)) {
        const remaining = await storage.getRoomPlayers(leavingRoomId);
        if (remaining.length === 0) publicRoomIds.delete(leavingRoomId);
      }
    });

    socket.on(
      "room:quickmatch",
      async ({
        maxPlayers,
        gameMode,
      }: {
        maxPlayers: number;
        gameMode: "free_for_all" | "teams";
      }) => {
        try {
          const safeMax = [2, 3, 4].includes(maxPlayers) ? maxPlayers : 4;
          const safeMode: "free_for_all" | "teams" =
            gameMode === "teams" ? "teams" : "free_for_all";

          let joinedRoomId: string | null = null;
          for (const roomId of publicRoomIds) {
            const room = await storage.getRoomById(roomId);
            if (!room || room.status !== "waiting") {
              publicRoomIds.delete(roomId);
              continue;
            }
            if (room.maxPlayers !== safeMax || room.gameMode !== safeMode)
              continue;
            const players = await storage.getRoomPlayers(roomId);
            if (players.length >= room.maxPlayers) {
              publicRoomIds.delete(roomId);
              continue;
            }
            if (players.some((p) => p.userId === userId)) continue;

            const seatIndex = players.length;
            await storage.addRoomPlayer(roomId, userId, seatIndex);
            socket.join(roomId);
            socketRoomMap.set(socket.id, roomId);

            const updatedPlayers = await storage.getRoomPlayers(roomId);
            const roomState = {
              roomId: room.id,
              code: room.code,
              hostUserId: room.hostUserId,
              status: room.status,
              gameMode: room.gameMode,
              maxPlayers: room.maxPlayers,
              players: updatedPlayers.map((p) => ({
                seatIndex: p.seatIndex,
                userId: p.userId,
                username: p.user.username,
              })),
            };
            io.to(roomId).emit("room:state", roomState);

            if (updatedPlayers.length >= room.maxPlayers)
              publicRoomIds.delete(roomId);
            joinedRoomId = roomId;
            break;
          }

          if (!joinedRoomId) {
            const room = await storage.createRoom(userId, safeMode, safeMax);
            await storage.addRoomPlayer(room.id, userId, 0);
            publicRoomIds.add(room.id);
            socket.join(room.id);
            socketRoomMap.set(socket.id, room.id);

            const players = await storage.getRoomPlayers(room.id);
            socket.emit("room:state", {
              roomId: room.id,
              code: room.code,
              hostUserId: room.hostUserId,
              status: room.status,
              gameMode: room.gameMode,
              maxPlayers: room.maxPlayers,
              players: players.map((p) => ({
                seatIndex: p.seatIndex,
                userId: p.userId,
                username: p.user.username,
              })),
            });
          }
        } catch (err) {
          logger.error({ err, userId }, "room:quickmatch error");
          socket.emit("room:error", {
            message: "Errore nella ricerca di una partita",
          });
        }
      }
    );

    socket.on(
      "room:set_game_mode",
      async ({ gameMode }: { gameMode: "free_for_all" | "teams" }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const room = await storage.getRoomById(roomId);
        if (!room || room.hostUserId !== userId) return;
        await storage.updateRoomGameMode(roomId, gameMode);
        const players = await storage.getRoomPlayers(roomId);
        const updatedRoom = await storage.getRoomById(roomId);
        io.to(roomId).emit("room:state", {
          roomId: updatedRoom!.id,
          code: updatedRoom!.code,
          hostUserId: updatedRoom!.hostUserId,
          status: updatedRoom!.status,
          gameMode: updatedRoom!.gameMode,
          maxPlayers: updatedRoom!.maxPlayers,
          players: players.map((p) => ({
            seatIndex: p.seatIndex,
            userId: p.userId,
            username: p.user.username,
          })),
        });
      }
    );

    socket.on("room:start", async () => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const room = await storage.getRoomById(roomId);
      if (
        !room ||
        room.hostUserId !== userId ||
        (room.status !== "waiting" && room.status !== "finished")
      )
        return;

      const players = await storage.getRoomPlayers(room.id);
      if (players.length < 2) {
        socket.emit("room:error", {
          message: "Servono almeno 2 giocatori",
        });
        return;
      }

      if (activeGames.has(roomId)) {
        activeGames.delete(roomId);
      }

      const playerSetup = players.map((p) => ({
        name: p.user.username,
        type: "human" as const,
        team:
          room.gameMode === "teams"
            ? ((p.seatIndex % 2 === 0 ? "A" : "B") as "A" | "B")
            : undefined,
      }));

      const gameState = initializeGame(playerSetup, room.gameMode);
      const playerMap: Record<number, string> = {};
      players.forEach((p) => {
        playerMap[p.seatIndex] = p.userId;
      });

      const existingGame = activeGames.get(roomId);
      const newGame: OnlineGameState = {
        gameState,
        playerMap,
        socketMap: {},
        roomId,
        rematchVotes: new Set(),
        cumulativeScores: existingGame?.cumulativeScores ?? {},
      };
      activeGames.set(roomId, newGame);

      publicRoomIds.delete(roomId);
      await storage.updateRoomStatus(roomId, "in_progress");

      players.forEach((p) => {
        const playerSocket = userSocketMap.get(p.userId);
        if (playerSocket) {
          io.to(playerSocket).emit(
            "game:state",
            sanitizeStateForPlayer(gameState, p.userId, playerMap)
          );
        }
      });

      io.to(roomId).emit("game:started");

      // Start AFK timer for first turn
      const firstTurnIdx = gameState.currentTurnIndex;
      const firstTurnUserId = playerMap[firstTurnIdx];
      const firstTurnUsername = gameState.players[firstTurnIdx]?.name ?? "";
      if (firstTurnUserId) {
        startAfkTimer(roomId, firstTurnUserId, firstTurnUsername);
      }

      persistGameState(roomId, newGame);
      logger.info({ roomId, playerCount: players.length }, "Game started");
    });

    // ── Game events ──────────────────────────────────────────────────────────

    socket.on("game:play", async ({ cardIds }: { cardIds: string[] }) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const game = activeGames.get(roomId);
      if (!game || game.gameState.gameOver) return;

      const { gameState, playerMap } = game;
      const currentIdx = gameState.currentTurnIndex;
      if (playerMap[currentIdx] !== userId) return;

      const player = gameState.players[currentIdx];
      const cards = player.hand.filter((c) => cardIds.includes(c.id));
      if (cards.length !== cardIds.length) return;

      const combo = buildCombination(cards);
      if (!combo) {
        socket.emit("game:error", { message: "Combinazione non valida" });
        return;
      }

      const isNewRound = gameState.lastPlayedCombination === null;

      if (!gameState.firstPlayMade && gameState.startCard) {
        const startCardId = gameState.startCard.id;
        if (!combo.cards.some((c) => c.id === startCardId)) {
          const sc = gameState.startCard!;
          socket.emit("game:error", {
            message: `Devi giocare il ${sc.rank}♠ come prima carta`,
          });
          return;
        }
      }

      if (!canPlay(combo, isNewRound ? null : gameState.lastPlayedCombination)) {
        socket.emit("game:error", { message: "Mossa non valida" });
        return;
      }

      clearAfkTimer(roomId, userId);

      const newState = processPlay(gameState, combo);
      game.gameState = newState;

      broadcastGameState(io, game);
      persistGameState(roomId, game);

      if (newState.gameOver) {
        const numPlayers = newState.players.length;
        const updatedCumulative = { ...game.cumulativeScores };
        newState.rankings.forEach((playerName, rankIdx) => {
          const pts = Math.max(0, numPlayers - 1 - rankIdx);
          updatedCumulative[playerName] =
            (updatedCumulative[playerName] ?? 0) + pts;
        });
        game.cumulativeScores = updatedCumulative;
        game.gameState = newState;
        game.rematchVotes = new Set();
        io.to(roomId).emit("game:over", {
          rankings: newState.rankings,
          cumulativeScores: updatedCumulative,
        });
        await storage.updateRoomStatus(roomId, "finished");
        db.delete(activeGamesTable)
          .where(eq(activeGamesTable.roomCode, roomId))
          .catch((err: unknown) =>
            logger.error({ err, roomId }, "Failed to delete game state")
          );
      } else {
        const nextTurnIdx = newState.currentTurnIndex;
        const nextUserId = playerMap[nextTurnIdx];
        const nextUsername = newState.players[nextTurnIdx]?.name ?? "";
        if (nextUserId) startAfkTimer(roomId, nextUserId, nextUsername);
      }
    });

    socket.on("game:pass", async () => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const game = activeGames.get(roomId);
      if (!game || game.gameState.gameOver) return;

      const { gameState, playerMap } = game;
      const currentIdx = gameState.currentTurnIndex;
      if (playerMap[currentIdx] !== userId) return;
      if (gameState.lastPlayedCombination === null) {
        socket.emit("game:error", { message: "Non puoi passare" });
        return;
      }

      clearAfkTimer(roomId, userId);

      const newState = processPass(gameState);
      game.gameState = newState;

      broadcastGameState(io, game);
      persistGameState(roomId, game);

      const nextTurnIdx = newState.currentTurnIndex;
      const nextUserId = playerMap[nextTurnIdx];
      const nextUsername = newState.players[nextTurnIdx]?.name ?? "";
      if (nextUserId) startAfkTimer(roomId, nextUserId, nextUsername);
    });

    socket.on("game:rematch_vote", async () => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const game = activeGames.get(roomId);
      if (!game || !game.gameState.gameOver) return;

      if (!game.rematchVotes) game.rematchVotes = new Set<string>();
      game.rematchVotes.add(userId);

      const totalPlayers = Object.keys(game.playerMap).length;
      const voteList = Array.from(game.rematchVotes);

      io.to(roomId).emit("game:vote_state", {
        votes: voteList,
        total: totalPlayers,
      });

      if (game.rematchVotes.size >= totalPlayers) {
        game.rematchVotes.clear();

        const room = await storage.getRoomById(roomId);
        if (!room) return;
        const players = await storage.getRoomPlayers(roomId);
        if (players.length < 2) return;

        const prevRankings = game.gameState.rankings;
        const playerSetup = players.map((p) => ({
          id: `player_${p.seatIndex}`,
          name: p.user.username,
          type: "human" as const,
          team:
            room.gameMode === "teams"
              ? ((p.seatIndex % 2 === 0 ? "A" : "B") as "A" | "B")
              : undefined,
        }));

        const newGameState =
          prevRankings.length >= 2
            ? initializeRematch(playerSetup, room.gameMode, prevRankings)
            : initializeGame(playerSetup, room.gameMode);
        const playerMap: Record<number, string> = {};
        players.forEach((p) => {
          playerMap[p.seatIndex] = p.userId;
        });

        game.gameState = newGameState;
        game.playerMap = playerMap;

        await storage.updateRoomStatus(roomId, "in_progress");

        players.forEach((p) => {
          const playerSocket = userSocketMap.get(p.userId);
          if (playerSocket) {
            io.to(playerSocket).emit(
              "game:state",
              sanitizeStateForPlayer(newGameState, p.userId, playerMap)
            );
          }
        });

        io.to(roomId).emit("game:started");

        const firstTurnIdx = newGameState.currentTurnIndex;
        const firstTurnUserId = playerMap[firstTurnIdx];
        const firstTurnUsername = newGameState.players[firstTurnIdx]?.name ?? "";
        if (firstTurnUserId) {
          startAfkTimer(roomId, firstTurnUserId, firstTurnUsername);
        }

        persistGameState(roomId, game);
      }
    });

    socket.on("game:rejoin", async ({ roomCode }: { roomCode: string }) => {
      try {
        const row = await db.query.activeGames.findFirst({
          where: eq(activeGamesTable.roomCode, roomCode),
        });
        if (!row) {
          socket.emit("game:rejoin_failed", { reason: "Partita non trovata" });
          return;
        }

        const ids = row.playerIds as string[];
        if (!ids.includes(userId)) {
          socket.emit("game:rejoin_failed", { reason: "Non autorizzato" });
          return;
        }

        socket.join(roomCode);
        socketRoomMap.set(socket.id, roomCode);

        let game = activeGames.get(roomCode);
        if (!game) {
          const restoredState = row.gameState as GameState;
          game = {
            roomId: roomCode,
            gameState: restoredState,
            playerMap: Object.fromEntries(ids.map((id, i) => [i, id])),
            socketMap: {},
            rematchVotes: new Set(),
            cumulativeScores: {},
          };
          activeGames.set(roomCode, game);
          logger.info({ roomCode }, "Rehydrated activeGames from DB after server restart");
        }

        const seatEntry = Object.entries(game.playerMap).find(([, uid]) => uid === userId);
        if (seatEntry) {
          const seatIndex = parseInt(seatEntry[0]);
          await storage.addRoomPlayer(roomCode, userId, seatIndex).catch(() => {});
        }
        socket.emit(
          "game:state",
          sanitizeStateForPlayer(game.gameState, userId, game.playerMap)
        );
        io.to(roomCode).emit("game:player_reconnected", {
          userId,
          username: socket.data.username ?? userId,
        });
        logger.info({ userId, roomCode }, "Player rejoined game");
      } catch (err) {
        logger.error({ err, roomCode, userId }, "game:rejoin failed");
        socket.emit("game:rejoin_failed", { reason: "Errore del server" });
      }
    });

    socket.on(
      "game:reaction",
      ({ emoji }: { emoji: string }) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;
        const game = activeGames.get(roomId);
        if (!game) return;

        const seatIndex = Object.entries(game.playerMap).find(
          ([, uid]) => uid === userId
        )?.[0];
        io.to(roomId).emit("game:reaction", {
          emoji,
          fromSeat: seatIndex ? parseInt(seatIndex) : 0,
          username: socket.data.username,
        });
      }
    );

    // ── Exchange card give ───────────────────────────────────────────────────

    socket.on("game:exchange_give_card", ({ cardId }: { cardId: string }) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const game = activeGames.get(roomId);
      if (!game?.gameState.exchangePhase?.active) return;

      const winnerSeat = game.gameState.exchangePhase.winnerIdx;
      const mySeat = Object.entries(game.playerMap).find(
        ([, uid]) => uid === userId
      )?.[0];
      if (mySeat === undefined || parseInt(mySeat) !== winnerSeat) return;

      clearAfkTimer(roomId, userId);
      game.gameState = processExchangeChoice(game.gameState, cardId);
      broadcastGameState(io, game);
      persistGameState(roomId, game);
      // Start AFK timer for the next player (loser goes first after exchange)
      const nextIdx = game.gameState.currentTurnIndex;
      const nextUserId = game.playerMap[nextIdx];
      const nextUsername = game.gameState.players[nextIdx]?.name ?? "";
      if (nextUserId) startAfkTimer(roomId, nextUserId, nextUsername);
    });

    // ── Friend invite ────────────────────────────────────────────────────────

    socket.on(
      "friend:invite",
      async ({
        friendUserId,
        roomCode,
      }: {
        friendUserId: string;
        roomCode: string;
      }) => {
        const friendSocket = userSocketMap.get(friendUserId);
        if (friendSocket) {
          io.to(friendSocket).emit("friend:invite", {
            from: socket.data.username,
            roomCode,
          });
        }
      }
    );

    socket.on("friend:get_online_list", async () => {
      try {
        const userFriends = await storage.getFriends(userId);
        const onlineIds = userFriends
          .map((f) => f.friend.id)
          .filter((id) => userSocketMap.has(id));
        socket.emit("friend:online_list", { onlineIds });
      } catch {
        // non-critical
      }
    });

    // ── Disconnect ───────────────────────────────────────────────────────────

    socket.on("disconnect", async () => {
      userSocketMap.delete(userId);
      logger.debug({ userId, socketId: socket.id }, "Socket disconnected");

      try {
        await storage.updateLastSeen(userId);
      } catch { /* ignore */ }

      const lastSeen = new Date().toISOString();
      emitFriendStatusOffline(io, userId, lastSeen);

      const currentRoomId = socketRoomMap.get(socket.id);
      socketRoomMap.delete(socket.id);

      if (currentRoomId) {
        clearAfkTimer(currentRoomId, userId);
        const game = activeGames.get(currentRoomId);

        if (game && !game.gameState.gameOver) {
          io.to(currentRoomId).emit("game:player_disconnected", {
            userId,
            username,
            message: `${username} si è disconnesso. Ha 60 secondi per rientrare.`,
          });

          const prevTimer = disconnectTimers.get(userId);
          if (prevTimer) clearTimeout(prevTimer);

          const dcTimer = setTimeout(async () => {
            disconnectTimers.delete(userId);
            const sockets = await io.in(currentRoomId).fetchSockets();
            const stillGone = !sockets.some(
              (s) => (s as any).data?.userId === userId
            );
            if (stillGone) {
              handleAutoPass(currentRoomId, userId);
              await storage.removeRoomPlayer(currentRoomId, userId).catch(() => {});
              const g = activeGames.get(currentRoomId);
              if (g) {
                g.rematchVotes?.delete(userId);
                delete g.playerMap[
                  Object.entries(g.playerMap).find(([, uid]) => uid === userId)?.[0] as string
                ];
                const remainingPlayerIds = Object.values(g.playerMap);
                if (remainingPlayerIds.length <= 1) {
                  activeGames.delete(currentRoomId);
                  await storage.updateRoomStatus(currentRoomId, "finished").catch(() => {});
                }
              }

              io.to(currentRoomId).emit("game:player_left", {
                userId,
                username,
              });
              logger.info({ userId, username, roomId: currentRoomId }, "Player disconnect timeout — removed from game");
            }
          }, 60_000);
          disconnectTimers.set(userId, dcTimer);
        } else {
          await handleLeaveRoom_lobby(io, currentRoomId, userId, username);
        }
      }
    });
  });

  return io;
}

function broadcastGameState(io: SocketServer, game: OnlineGameState) {
  const { gameState, playerMap, roomId } = game;
  Object.entries(playerMap).forEach(([, uid]) => {
    const playerSocket = userSocketMap.get(uid);
    if (playerSocket) {
      io.to(playerSocket).emit(
        "game:state",
        sanitizeStateForPlayer(gameState, uid, playerMap)
      );
    }
  });
}

async function handleLeaveRoom(
  io: SocketServer,
  socket: { id: string; leave: (r: string) => void; data?: { username?: string } },
  userId: string
) {
  const roomId = socketRoomMap.get(socket.id);
  if (!roomId) return;
  socketRoomMap.delete(socket.id);

  const dcTimer = disconnectTimers.get(userId);
  if (dcTimer) {
    clearTimeout(dcTimer);
    disconnectTimers.delete(userId);
  }

  await storage.removeRoomPlayer(roomId, userId);
  socket.leave(roomId);

  const room = await storage.getRoomById(roomId);
  if (!room) return;

  if (room.status === "waiting") {
    const remaining = await storage.getRoomPlayers(roomId);
    if (remaining.length === 0) {
      await storage.updateRoomStatus(roomId, "finished");
      return;
    }
    let newHostId = room.hostUserId;
    if (room.hostUserId === userId) {
      const nextHost = remaining.sort((a, b) => a.seatIndex - b.seatIndex)[0];
      newHostId = nextHost.userId;
      await storage.updateRoomHost(roomId, newHostId).catch(() => {});
    }
    io.to(roomId).emit("room:state", {
      roomId: room.id,
      code: room.code,
      hostUserId: newHostId,
      status: room.status,
      gameMode: room.gameMode,
      maxPlayers: room.maxPlayers,
      players: remaining.map((p) => ({
        seatIndex: p.seatIndex,
        userId: p.userId,
        username: p.user.username,
      })),
    });
  } else if (room.status === "in_progress") {
    const game = activeGames.get(roomId);
    if (game) {
      game.rematchVotes?.delete(userId);
    }
    io.to(roomId).emit("game:player_left", {
      userId,
      username: socket.data?.username ?? userId,
    });
  }
}

async function handleLeaveRoom_lobby(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string
) {
  await storage.removeRoomPlayer(roomId, userId).catch(() => {});

  const room = await storage.getRoomById(roomId);
  if (!room) return;

  if (room.status === "waiting") {
    const remaining = await storage.getRoomPlayers(roomId);
    if (remaining.length === 0) {
      await storage.updateRoomStatus(roomId, "finished");
      return;
    }
    let newHostId = room.hostUserId;
    if (room.hostUserId === userId) {
      const nextHost = remaining.sort((a, b) => a.seatIndex - b.seatIndex)[0];
      newHostId = nextHost.userId;
      await storage.updateRoomHost(roomId, newHostId).catch(() => {});
    }
    io.to(roomId).emit("room:state", {
      roomId: room.id,
      code: room.code,
      hostUserId: newHostId,
      status: room.status,
      gameMode: room.gameMode,
      maxPlayers: room.maxPlayers,
      players: remaining.map((p) => ({
        seatIndex: p.seatIndex,
        userId: p.userId,
        username: p.user.username,
      })),
    });
  } else if (room.status === "finished") {
    const remaining = await storage.getRoomPlayers(roomId);
    if (remaining.length === 0) {
      await storage.updateRoomStatus(roomId, "finished");
    }
  }
}

async function emitFriendStatus(
  io: SocketServer,
  userId: string,
  online: boolean
) {
  const friends = await storage.getFriends(userId).catch(() => []);
  // Abort if user disconnected while we were fetching friends
  if (online && !userSocketMap.has(userId)) return;
  friends.forEach((f) => {
    const friendSocket = userSocketMap.get(f.friend.id);
    if (friendSocket) {
      io.to(friendSocket).emit("friend:status", { userId, online });
    }
  });
}

async function emitFriendStatusOffline(
  io: SocketServer,
  userId: string,
  lastSeen: string
) {
  // Short debounce: if the user reconnects within 400ms, skip the offline emit
  await new Promise((resolve) => setTimeout(resolve, 400));
  // Abort if user already reconnected before the delay elapsed
  if (userSocketMap.has(userId)) return;
  const friends = await storage.getFriends(userId).catch(() => []);
  // Double-check after the DB query: reconnect might have happened during getFriends
  if (userSocketMap.has(userId)) return;
  friends.forEach((f) => {
    const friendSocket = userSocketMap.get(f.friend.id);
    if (friendSocket) {
      io.to(friendSocket).emit("friend:status", {
        userId,
        online: false,
        lastSeen,
      });
    }
  });
}

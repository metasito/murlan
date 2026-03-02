import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { storage } from "./storage";
import {
  initializeGame,
  processPlay,
  processPass,
  buildCombination,
  canPlay,
} from "../lib/gameEngine";
import type { GameState, Card } from "../lib/gameEngine";

interface OnlineGameState {
  gameState: GameState;
  playerMap: Record<number, string>; // seatIndex -> userId
  socketMap: Record<string, string>; // socketId -> userId
  roomId: string;
}

// In-memory map of active online games
const activeGames = new Map<string, OnlineGameState>();
// socketId -> roomId (for quick disconnect lookup)
const socketRoomMap = new Map<string, string>();
// userId -> socketId (for friend notifications)
const userSocketMap = new Map<string, string>();

function sanitizeStateForPlayer(state: GameState, viewerUserId: string, playerMap: Record<number, string>) {
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

export function setupSocket(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Auth middleware: expect userId in handshake.auth
  io.use(async (socket, next) => {
    const userId = socket.handshake.auth?.userId as string | undefined;
    if (!userId) return next(new Error("Non autenticato"));
    const user = await storage.getUser(userId);
    if (!user) return next(new Error("Utente non trovato"));
    socket.data.userId = userId;
    socket.data.username = user.username;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    userSocketMap.set(userId, socket.id);

    // Notify friends of online status
    emitFriendStatus(io, userId, true);

    // ── Room events ──────────────────────────────────────────────────────────

    socket.on("room:create", async ({ gameMode, maxPlayers }: { gameMode: "free_for_all" | "teams"; maxPlayers: number }) => {
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
          players: players.map((p) => ({ seatIndex: p.seatIndex, userId: p.userId, username: p.user.username })),
        });
      } catch (err) {
        socket.emit("room:error", { message: "Errore nella creazione della stanza" });
      }
    });

    socket.on("room:join", async ({ code }: { code: string }) => {
      try {
        const room = await storage.getRoomByCode(code.toUpperCase());
        if (!room) { socket.emit("room:error", { message: "Stanza non trovata" }); return; }
        if (room.status !== "waiting") { socket.emit("room:error", { message: "Partita già iniziata" }); return; }

        const players = await storage.getRoomPlayers(room.id);
        if (players.length >= room.maxPlayers) { socket.emit("room:error", { message: "Stanza piena" }); return; }
        if (players.some((p) => p.userId === userId)) { socket.emit("room:error", { message: "Sei già nella stanza" }); return; }

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
          players: updatedPlayers.map((p) => ({ seatIndex: p.seatIndex, userId: p.userId, username: p.user.username })),
        };
        io.to(room.id).emit("room:state", roomState);
      } catch (err) {
        socket.emit("room:error", { message: "Errore nell'unirsi alla stanza" });
      }
    });

    socket.on("room:leave", async () => {
      await handleLeaveRoom(io, socket, userId);
    });

    socket.on("room:set_game_mode", async ({ gameMode }: { gameMode: "free_for_all" | "teams" }) => {
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
        players: players.map((p) => ({ seatIndex: p.seatIndex, userId: p.userId, username: p.user.username })),
      });
    });

    socket.on("room:start", async () => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const room = await storage.getRoomById(roomId);
      if (!room || room.hostUserId !== userId || (room.status !== "waiting" && room.status !== "finished")) return;

      const players = await storage.getRoomPlayers(room.id);
      if (players.length < 2) { socket.emit("room:error", { message: "Servono almeno 2 giocatori" }); return; }

      // Clear any existing game state when restarting from finished
      if (activeGames.has(roomId)) {
        activeGames.delete(roomId);
      }

      // Build player setup for game engine
      const playerSetup = players.map((p) => ({
        name: p.user.username,
        type: "human" as const,
        team: room.gameMode === "teams" ? (p.seatIndex % 2 === 0 ? "A" : "B") as "A" | "B" : undefined,
      }));

      const gameState = initializeGame(playerSetup, room.gameMode);
      const playerMap: Record<number, string> = {};
      players.forEach((p) => { playerMap[p.seatIndex] = p.userId; });

      activeGames.set(roomId, {
        gameState,
        playerMap,
        socketMap: {},
        roomId,
      });

      await storage.updateRoomStatus(roomId, "in_progress");

      // Send each player their personalized game state
      players.forEach((p) => {
        const playerSocket = userSocketMap.get(p.userId);
        if (playerSocket) {
          io.to(playerSocket).emit("game:state", sanitizeStateForPlayer(gameState, p.userId, playerMap));
        }
      });

      io.to(roomId).emit("game:started");
    });

    // ── Game events ──────────────────────────────────────────────────────────

    socket.on("game:play", async ({ cardIds }: { cardIds: string[] }) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const game = activeGames.get(roomId);
      if (!game || game.gameState.gameOver) return;

      const { gameState, playerMap } = game;
      const currentIdx = gameState.currentTurnIndex;
      if (playerMap[currentIdx] !== userId) return; // not your turn

      const player = gameState.players[currentIdx];
      const cards = player.hand.filter((c) => cardIds.includes(c.id));
      if (cards.length !== cardIds.length) return;

      const combo = buildCombination(cards);
      if (!combo) { socket.emit("game:error", { message: "Combinazione non valida" }); return; }

      const isNewRound = gameState.lastPlayedCombination === null;

      // First play must include the starting spade (3♠ or next lowest if 3♠ is excluded)
      if (!gameState.firstPlayMade && gameState.startCard) {
        const startCardId = gameState.startCard.id;
        if (!combo.cards.some((c) => c.id === startCardId)) {
          const sc = gameState.startCard!;
          socket.emit("game:error", { message: `Devi giocare il ${sc.rank}♠ come prima carta` });
          return;
        }
      }

      if (!canPlay(combo, isNewRound ? null : gameState.lastPlayedCombination)) {
        socket.emit("game:error", { message: "Mossa non valida" });
        return;
      }

      const newState = processPlay(gameState, combo);
      game.gameState = newState;

      // Broadcast personalized state to each player
      broadcastGameState(io, game);

      if (newState.gameOver) {
        io.to(roomId).emit("game:over", { rankings: newState.rankings });
        await storage.updateRoomStatus(roomId, "finished");
        activeGames.delete(roomId);
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
      if (gameState.lastPlayedCombination === null) { socket.emit("game:error", { message: "Non puoi passare" }); return; }

      const newState = processPass(gameState);
      game.gameState = newState;

      broadcastGameState(io, game);
    });

    socket.on("game:reaction", ({ emoji }: { emoji: string }) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const game = activeGames.get(roomId);
      if (!game) return;

      // Find sender's seat
      const seatIndex = Object.entries(game.playerMap).find(([, uid]) => uid === userId)?.[0];
      io.to(roomId).emit("game:reaction", { emoji, fromSeat: seatIndex ? parseInt(seatIndex) : 0, username: socket.data.username });
    });

    // ── Friend invite ────────────────────────────────────────────────────────

    socket.on("friend:invite", async ({ friendUserId, roomCode }: { friendUserId: string; roomCode: string }) => {
      const friendSocket = userSocketMap.get(friendUserId);
      if (friendSocket) {
        io.to(friendSocket).emit("friend:invite", { from: socket.data.username, roomCode });
      }
    });

    // ── Disconnect ───────────────────────────────────────────────────────────

    socket.on("disconnect", async () => {
      userSocketMap.delete(userId);
      emitFriendStatus(io, userId, false);
      await handleLeaveRoom(io, socket, userId);
    });
  });

  return io;
}

function broadcastGameState(io: SocketServer, game: OnlineGameState) {
  const { gameState, playerMap, roomId } = game;
  Object.entries(playerMap).forEach(([seatStr, uid]) => {
    const playerSocket = userSocketMap.get(uid);
    if (playerSocket) {
      io.to(playerSocket).emit("game:state", sanitizeStateForPlayer(gameState, uid, playerMap));
    }
  });
}

async function handleLeaveRoom(io: SocketServer, socket: { id: string; leave: (r: string) => void }, userId: string) {
  const roomId = socketRoomMap.get(socket.id);
  if (!roomId) return;
  socketRoomMap.delete(socket.id);

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
    // Reassign host if needed
    if (room.hostUserId === userId && remaining.length > 0) {
      // For now just notify remaining players
    }
    io.to(roomId).emit("room:state", {
      roomId: room.id,
      code: room.code,
      hostUserId: room.hostUserId,
      status: room.status,
      gameMode: room.gameMode,
      maxPlayers: room.maxPlayers,
      players: remaining.map((p) => ({ seatIndex: p.seatIndex, userId: p.userId, username: p.user.username })),
    });
  } else if (room.status === "in_progress") {
    io.to(roomId).emit("game:player_left", { userId, username: socket.id });
  }
}

async function emitFriendStatus(io: SocketServer, userId: string, online: boolean) {
  const friends = await storage.getFriends(userId).catch(() => []);
  friends.forEach((f) => {
    const friendSocket = userSocketMap.get(f.friend.id);
    if (friendSocket) {
      io.to(friendSocket).emit("friend:status", { userId, online });
    }
  });
}

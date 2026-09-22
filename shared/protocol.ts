// The wire contract between the server and every client bundle in the field.
// Bump PROTOCOL_VERSION with any change to this file; tests/server/protocolVersion.test.ts
// holds that. Raise MIN_PROTOCOL_VERSION to turn away the bundles a change breaks.
import { z } from "zod";
import type { DefaultEventsMap } from "socket.io";
import type { GameState, Player } from "../lib/gameEngine.ts";
import type { GameOverPayload } from "../lib/matchState.ts";

export const PROTOCOL_VERSION = 2;
export const MIN_PROTOCOL_VERSION = 1;

/** The handshake's refusal for a bundle older than MIN_PROTOCOL_VERSION. */
export const CLIENT_OUTDATED = "CLIENT_OUTDATED";

/** The handshake's refusal when the server could not check the credential, as against a bad one. */
export const AUTH_UNAVAILABLE = "AUTH_UNAVAILABLE";

/** A seat as one viewer receives it: every hand but theirs is blanked. */
export type WirePlayer = Player & { handCount: number; vacated: boolean };

export type WireGameState = Omit<GameState, "players"> & {
  players: WirePlayer[];
  viewerSeatIndex: number | null;
  turnDeadlineMs?: number;
  turnSecondsRemaining: number;
};

export interface WireRoomState {
  roomId: string;
  code: string;
  hostUserId: string | null;
  status: "waiting" | "in_progress" | "finished";
  gameMode: "free_for_all" | "teams";
  visibility: "public" | "private";
  maxPlayers: number;
  players: { seatIndex: number; userId: string; username: string }[];
  /** Remaining, never a deadline: the client's clock is not the server's. */
  seatHolds?: { seatIndex: number; username: string; expiresInMs: number }[];
}

/** Every other event stays untyped; inbound ones are server/socketSchemas.ts's to check. */
export interface ServerToClientEvents extends DefaultEventsMap {
  "game:state": (state: WireGameState, ack: () => void) => void;
  "game:over": (payload: GameOverPayload) => void;
  "room:state": (room: WireRoomState) => void;
}

export type ClientToServerEvents = DefaultEventsMap;

// Tolerant on purpose: each checks what rendering dereferences and passes the
// rest through, so a field a newer server adds never refuses a state.
const card = z.object({ id: z.string() }).passthrough();

const wirePlayer = z
  .object({ id: z.string(), name: z.string(), hand: z.array(card), handCount: z.number() })
  .passthrough();

export const gameStateSchema = z
  .object({
    players: z.array(wirePlayer).min(1),
    currentTurnIndex: z.number(),
    gameOver: z.boolean(),
    rankings: z.array(z.string()).default([]),
  })
  .passthrough();

export const gameOverSchema = z
  .object({
    rankings: z.array(z.string()),
    scores: z.array(z.object({ engineId: z.string(), points: z.number(), total: z.number() }).passthrough()),
    matchOver: z.boolean(),
    matchWinnerIds: z.array(z.string()),
    ratingDeltas: z.record(z.number()),
  })
  .passthrough();

export const roomStateSchema = z
  .object({
    roomId: z.string(),
    code: z.string(),
    status: z.enum(["waiting", "in_progress", "finished"]),
    players: z.array(z.object({ seatIndex: z.number(), userId: z.string(), username: z.string() }).passthrough()),
  })
  .passthrough();

export function handCountOf(player: Player | WirePlayer): number {
  return "handCount" in player ? player.handCount : player.hand.length;
}

/** Never true offline, which vacates nobody. */
export function vacatedOf(player: Player | WirePlayer): boolean {
  return "vacated" in player && player.vacated;
}

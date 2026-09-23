// The wire contract between the server and every client bundle in the field.
// Bump PROTOCOL_VERSION with any change to this file; tests/server/protocolVersion.test.ts
// holds that. Raise MIN_PROTOCOL_VERSION to turn away the bundles a change breaks.
import { z } from "zod";
import type { GameState, MatchLength, Player } from "../lib/game/gameEngine.ts";
import type { GameOverPayload } from "../lib/game/matchState.ts";
import type { FriendRequestAccepted, FriendRequestIncoming } from "../lib/wire.ts";
import type * as Inbound from "./socketSchemas.ts";
import type { TranslationParams } from "./i18n.ts";

export const PROTOCOL_VERSION = 3;
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

export interface ServerPayload {
  code?: string;
  message?: string;
  /** A few endpoints (e.g. the rate limiters) use `error` instead of `message`. */
  error?: string;
  params?: TranslationParams;
}

interface SeatEvent {
  userId: string;
  username: string;
  seatIndex: number;
}

/** A seat the server could not place is sent as `null`. */
type MaybeSeated = Omit<SeatEvent, "seatIndex"> & { seatIndex: number | null };

interface VoteState {
  votes: string[];
  total: number;
}

export interface ServerToClientEvents {
  "game:state": (state: WireGameState, ack: () => void) => void;
  "game:over": (payload: GameOverPayload) => void;
  "room:state": (room: WireRoomState) => void;
  "game:started": () => void;
  "game:match_state": (match: { target: number; length: MatchLength; handsPlayed: number; scores: Record<string, number> }) => void;
  "game:vote_state": (votes: VoteState) => void;
  "game:end_match_vote_state": (votes: VoteState) => void;
  "game:turn_deadline": (deadline: { turnDeadlineMs?: number; turnSecondsRemaining: number }) => void;
  "game:notification": (notice: ServerPayload & { type: string }) => void;
  "game:player_left": (seat: SeatEvent) => void;
  "game:seat_bot_takeover": (seat: SeatEvent & ServerPayload) => void;
  "game:player_disconnected": (seat: MaybeSeated & ServerPayload) => void;
  "game:player_reconnected": (seat: MaybeSeated & ServerPayload) => void;
  "game:rejoin_failed": (refusal: ServerPayload & { roomId?: string }) => void;
  "game:reaction": (reaction: { emoji: string; fromSeat: number; username: string }) => void;
  "game:rematch_intents": (intents: { yes: number; total: number; answers: Record<string, boolean> }) => void;
  "game:error": (error: ServerPayload) => void;
  "room:error": (error: ServerPayload) => void;
  "socket:error": (error: ServerPayload) => void;
  "friend:error": (error: ServerPayload) => void;
  "friend:online_list": (list: { onlineIds: string[] }) => void;
  "friend:invite": (invite: { from: string; roomCode: string }) => void;
  "friend:invite_retired": (invite: { roomCode: string }) => void;
  "friend:room_joinable": (invite: { roomCode: string; joinable: boolean }) => void;
  "friend:status": (status: { userId: string; online: boolean; lastSeen?: string }) => void;
  "friend:request_incoming": (request: FriendRequestIncoming) => void;
  "friend:request_accepted": (request: FriendRequestAccepted) => void;
}

/** How the server answers an intent: `ok: false` is a refusal, as against no answer at all. */
export interface IntentReply {
  ok: boolean;
  code?: string;
}

/** Each intent and the schema the server parses it with, which is also its payload's type. */
export interface IntentSchemas {
  "room:create": typeof Inbound.RoomCreateSchema;
  "room:join": typeof Inbound.RoomJoinSchema;
  "room:spectate": typeof Inbound.RoomSpectateSchema;
  "room:rejoin": typeof Inbound.RoomRejoinSchema;
  "room:unspectate": typeof Inbound.NoPayloadSchema;
  "room:leave": typeof Inbound.NoPayloadSchema;
  "room:setVisibility": typeof Inbound.RoomSetVisibilitySchema;
  "room:quickmatch": typeof Inbound.RoomQuickmatchSchema;
  "room:start": typeof Inbound.RoomStartSchema;
  "game:play": typeof Inbound.GamePlaySchema;
  "game:pass": typeof Inbound.NoPayloadSchema;
  "game:rematch_intent": typeof Inbound.GameRematchIntentSchema;
  "game:rematch_vote": typeof Inbound.NoPayloadSchema;
  "game:end_match_vote": typeof Inbound.GameEndMatchVoteSchema;
  "game:rejoin": typeof Inbound.GameRejoinSchema;
  "game:reaction": typeof Inbound.GameReactionSchema;
  "game:exchange_give_card": typeof Inbound.GameExchangeGiveCardSchema;
}

export type IntentEvent = keyof IntentSchemas;

/** `z.input`, not `z.infer`: the client sends what the schema accepts, before its transforms. */
export type IntentPayload<E extends IntentEvent> = Exclude<z.input<IntentSchemas[E]>, undefined | null>;

type IntentEvents = {
  [E in IntentEvent]: (message: IntentPayload<E> & { intentId?: string }, ack: (reply: IntentReply) => void) => void;
};

export interface ClientToServerEvents extends IntentEvents {
  "friend:invite": (
    invite: z.input<typeof Inbound.FriendInviteSchema>,
    ack: (reply: IntentReply) => void
  ) => void;
  "friend:get_online_list": () => void;
}

/** The schema behind every inbound event, by the name `onEvent` registers it under. */
export type InboundSchemas = IntentSchemas & {
  "friend:invite": typeof Inbound.FriendInviteSchema;
  "friend:get_online_list": typeof Inbound.NoPayloadSchema;
};

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

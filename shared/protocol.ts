// The wire contract between the server and every client bundle in the field.
// Bump PROTOCOL_VERSION with any change to this file or to a type it sends:
// tests/server/protocolVersion.test.ts holds the file, tests/server/storedShapeVersions.test.ts
// the types. Raise MIN_PROTOCOL_VERSION to turn away the bundles a change breaks.
import { z } from "zod";
import { matchLengthSchema } from "./gameStateSchema.ts";
import type { Card, GameState, MatchLength, Player } from "../lib/game/gameEngine.ts";
import type { FriendRequestAccepted, FriendRequestIncoming } from "./http.ts";
import type * as Inbound from "./socketSchemas.ts";
import type { TranslationParams } from "./i18n.ts";

export const PROTOCOL_VERSION = 14;
export const MIN_PROTOCOL_VERSION = 12;

/** The handshake's refusal for a bundle older than MIN_PROTOCOL_VERSION. */
export const CLIENT_OUTDATED = "CLIENT_OUTDATED";

/** The handshake's refusal when the server could not check the credential, as against a bad one. */
export const AUTH_UNAVAILABLE = "AUTH_UNAVAILABLE";

/** A seat as one viewer receives it: every hand but theirs is blanked. */
export type WirePlayer = Player & { handCount: number; vacated: boolean };

/** An exchange as one viewer receives it; who sees which card is `visibleExchangePhase`'s (server/game/onlineGameLogic.ts). */
export type WireExchangePhase =
  | { kind: "twoJokers"; winnerIdx: number; loserIdx: number }
  | { kind: "open"; winnerIdx: number; loserIdx: number; cardFromLoser: Card }
  | { kind: "settled"; winnerIdx: number; loserIdx: number; cardToLoser?: Card; cardFromLoser?: Card };

/** A state the table is drawn from: the engine's own offline, or one viewer's online. */
export type ViewedGameState = Omit<GameState, "exchangePhase"> & { exchangePhase?: WireExchangePhase };

export type WireGameState = Omit<ViewedGameState, "players"> & {
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
  /** The next-round vote's deadline: a reset key, never read as a time, since device clocks drift. */
  deadlineMs?: number;
  secondsRemaining?: number;
}

export interface ServerToClientEvents {
  "game:state": (state: WireGameState, ack: () => void) => void;
  "game:round_over": (payload: RoundOverPayload) => void;
  "room:state": (room: WireRoomState) => void;
  "game:started": () => void;
  "game:match_state": (match: { target: number; length: MatchLength; roundsPlayed: number; scores: Record<string, number> }) => void;
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
    roundOver: z.boolean(),
    finishingOrder: z.array(z.string()).default([]),
    // Looser than parseGameState's tally on purpose: the server already held its state to that,
    // and a stricter wire would refuse a state over a tally a newer server reshaped.
    playedRanks: z.array(z.number()),
    openingCard: card.nullable(),
  })
  .passthrough();

/** One seat's line on the end-of-round scoreboard, in every identity it is indexed by. */
const scoreLine = z.object({
  seatIndex: z.number(),
  /** The engine player id the finishingOrder and the match winners are stated in. */
  engineId: z.string(),
  userId: z.string().nullable(),
  username: z.string(),
  points: z.number(),
  total: z.number(),
  /**
   * The seat is a human's that left, played on by the engine. `username` is
   * still the person's real name — the client renders the departed label
   * itself, through `t()`, rather than reading it off the wire as text.
   */
  vacated: z.boolean(),
});

const ratingAfter = z.object({ rating: z.number(), rounds: z.number() });

/**
 * `game:round_over`, as the server states it and the client reads it: every field required, so a
 * server that stops sending one is refused rather than read as one that never did.
 */
const roundOverFields = z.object({
  /** Finish order, as engine player ids. */
  finishingOrder: z.array(z.string()),
  scores: z.array(scoreLine),
  matchTarget: z.number(),
  matchLength: matchLengthSchema,
  roundsPlayed: z.number(),
  matchOver: z.boolean(),
  matchWinnerIds: z.array(z.string()),
  matchContinues: z.boolean(),
  isDraw: z.boolean(),
  /**
   * By user id, and empty for a round that earns no rating. The server reads
   * this before it writes the ladder, because the inputs stop existing once
   * that write lands (server/game/ratings.ts).
   */
  ratingDeltas: z.record(z.number()),
  /**
   * Each rated seat's standing once this round is written, keyed as
   * `ratingDeltas`. Sent rather than fetched: the ladder write lands after
   * `game:round_over`, so `GET ratings/me` read on it can still be the old rating.
   */
  ratingsAfter: z.record(ratingAfter),
  /**
   * Whether this round wrote a `GET stats/history` row — a bot-majority
   * table writes none. Wider than `ratingDeltas` being empty: a teams round
   * is recorded and unrated.
   */
  recorded: z.boolean(),
  /**
   * The match ended before its first point, on an abandonment
   * (docs/GAME-RULES.md § Decisions) — nothing earned, nothing taken, rated for nobody.
   * `finishingOrder` and `scores` are empty and `recorded` is false alongside it;
   * false for every other round, voided or not.
   */
  voided: z.boolean(),
});

export const roundOverSchema = roundOverFields.passthrough();

export type RoundOverPayload = z.infer<typeof roundOverFields>;
export type ScoreLine = z.infer<typeof scoreLine>;
export type RatingAfter = z.infer<typeof ratingAfter>;

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

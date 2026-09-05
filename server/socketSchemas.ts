import { z } from "zod";

/**
 * Runtime schemas for every inbound socket event.
 *
 * TypeScript annotations on the handler payloads are erased at runtime, so
 * without these a hand-crafted emit (`code: 42`, `cardIds: "x"`, a 1 MB
 * `emoji`) would reach the game logic and throw inside the io handler —
 * taking the whole process down for every table on the server.
 */

const GameModeSchema = z.enum(["free_for_all", "teams"]);
const IdSchema = z.string().min(1).max(64);

/** Events that carry no payload still receive `undefined` from socket.io. */
export const NoPayloadSchema = z
  .union([z.undefined(), z.null(), z.object({}).passthrough()])
  .transform(() => ({}));

export const RoomCreateSchema = z.object({
  gameMode: GameModeSchema,
  maxPlayers: z.number().int().min(2).max(4),
});

export const RoomJoinSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4)
    .max(10)
    .regex(/^[A-Za-z0-9]+$/, "Invalid room code"),
});

/** Watching a table. Same shape as joining one; the difference is the seat. */
export const RoomSpectateSchema = RoomJoinSchema;

/**
 * Taking back a seat in a lobby after a dropped connection. Same handle a
 * player would type, so the same shape as joining — the difference is that the
 * caller was already in the room and is not asking for a new seat.
 */
export const RoomRejoinSchema = RoomJoinSchema;

export const RoomQuickmatchSchema = z.object({
  maxPlayers: z.number().int().min(2).max(4),
  gameMode: GameModeSchema,
});

// Not a strict enum of BOT_PERSONALITIES: a client on an older bundle can
// still send an id this build has since removed, and getBotPersonality (#904)
// is what resolves that to the default — rejecting the payload here instead
// would refuse the whole room:start message before it ever reaches that
// fallback. IdSchema's bound is enough to keep this a bot-personality-shaped
// string rather than an open field.
const BotPersonalitySchema = IdSchema;
const MatchLengthSchema = z.enum(["match", "single"]);

/**
 * `room:start` is emitted with no payload from most call sites (rematch,
 * legacy clients), so this must tolerate `undefined`/`null` the same way
 * NoPayloadSchema does — but still validate the two optional bot-fill fields
 * when the host's room does send them.
 */
export const RoomStartSchema = z
  .union([
    z.undefined(),
    z.null(),
    z.object({
      fillWithBots: z.boolean().optional(),
      botPersonality: BotPersonalitySchema.optional(),
      matchLength: MatchLengthSchema.optional(),
    }),
  ])
  .transform((v) => v ?? {});

/** The side-panel rematch question: one boolean per seat, majority decides. */
export const GameRematchIntentSchema = z.object({
  wants: z.boolean(),
});

/**
 * The vote to end a match a seat has been vacated from, as a toggle rather
 * than a second event. `wants` defaults to `true` when the field is absent —
 * an old native client, built before withdrawal existed, emits no payload at
 * all and must keep voting yes; it simply cannot withdraw until it updates.
 */
export const GameEndMatchVoteSchema = z
  .union([z.undefined(), z.null(), z.object({ wants: z.boolean().optional() }).passthrough()])
  .transform((v) => ({ wants: v?.wants ?? true }));

export const GamePlaySchema = z.object({
  cardIds: z.array(IdSchema).min(1).max(14),
});

export const GameRejoinSchema = z.object({
  roomId: IdSchema,
});

export const GameReactionSchema = z.object({
  // Emoji only, and short: this is broadcast to the whole room.
  emoji: z.string().min(1).max(8),
});

export const GameExchangeGiveCardSchema = z.object({
  cardId: IdSchema,
});

export const FriendInviteSchema = z.object({
  friendUserId: IdSchema,
  roomCode: IdSchema,
});

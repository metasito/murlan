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
    .regex(/^[A-Za-z0-9]+$/, "Codice non valido"),
});

export const RoomQuickmatchSchema = z.object({
  maxPlayers: z.number().int().min(2).max(4),
  gameMode: GameModeSchema,
});

export const RoomSetGameModeSchema = z.object({
  gameMode: GameModeSchema,
});

const BotDifficultySchema = z.enum(["easy", "medium", "hard"]);
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
      botDifficulty: BotDifficultySchema.optional(),
      matchLength: MatchLengthSchema.optional(),
    }),
  ])
  .transform((v) => v ?? {});

/** The side-panel rematch question: one boolean per seat, majority decides. */
export const GameRematchIntentSchema = z.object({
  wants: z.boolean(),
});

export const GamePlaySchema = z.object({
  cardIds: z.array(IdSchema).min(1).max(14),
});

export const GameRejoinSchema = z.object({
  roomCode: IdSchema,
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

// The engine's `GameState` as a stored document reads back: `active_games` on the server, the
// offline save on the device. The wire's sanitized state is `shared/protocol.ts`'s, tolerant on
// purpose; this one is exact, because a state that parses here is handed straight to the engine.
import { z } from "zod";
import { isBotPersonalityId, type BotPersonalityId } from "../lib/game/botPersonalities.ts";
import { DECK_BY_STRENGTH, RANK_SLOTS, exchangeIsSatisfiable, type GameState } from "../lib/game/gameEngine.ts";

export const UNSATISFIABLE_EXCHANGE = "an open exchange nobody can give back from";

const seat = z.number().int().nonnegative();

const card = z.object({
  id: z.string(),
  suit: z.enum(["hearts", "diamonds", "clubs", "spades"]).nullable(),
  rank: z.enum(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "joker_bw", "joker_colored"]),
  isJoker: z.boolean(),
});

const player = z.object({
  id: z.string(),
  name: z.string(),
  hand: z.array(card),
  type: z.enum(["human", "bot"]),
  personality: z.custom<BotPersonalityId>(isBotPersonalityId, "an unknown bot personality").optional(),
  team: z.enum(["A", "B"]).optional(),
  finishPosition: z.number().int().optional(),
});

const combination = z.object({
  type: z.enum(["single", "pair", "triple", "straight", "bomb", "royal_straight"]),
  cards: z.array(card),
  strength: z.number(),
});

const lastMove = z.union([
  z.object({ seq: z.literal(0), kind: z.literal("deal") }),
  z.object({ seq: z.number().int().nonnegative(), kind: z.literal("play"), seat }),
  z.object({ seq: z.number().int().nonnegative(), kind: z.literal("pass"), seat, closedTrick: z.boolean() }),
  z.object({ seq: z.number().int().nonnegative(), kind: z.literal("giveback"), seat }),
]);

const playedRanks = z
  .array(z.number().int().nonnegative())
  .length(RANK_SLOTS, `a played-rank tally of other than ${RANK_SLOTS} ranks`)
  .refine((tally) => tally.every((n, i) => n <= DECK_BY_STRENGTH[i]), "more of a rank played than the deck holds");

export const gameStateSchema = z
  .object({
    players: z.array(player).min(1, "no players"),
    currentTurnIndex: z.number().int(),
    lastPlayedCombination: combination.nullable(),
    lastPlayedBy: z.number().int(),
    passCount: z.number().int().nonnegative(),
    gameMode: z.enum(["free_for_all", "teams"]),
    trickWinner: z.number().int().nullable(),
    roundOver: z.boolean(),
    finishingOrder: z.array(z.string()),
    firstPlayMade: z.boolean(),
    startCard: card.optional(),
    startReason: z
      .object({
        type: z.enum(["start_card", "lost_round", "won_no_exchange"]),
        card: card.optional(),
        playerIdx: seat,
      })
      .optional(),
    exchangePhase: z
      .object({
        active: z.boolean(),
        winnerIdx: seat,
        loserIdx: seat,
        cardFromLoser: card.optional(),
        cardToLoser: card.optional(),
        twoJokerException: z.boolean(),
        settledAt: z.number().optional(),
      })
      .optional(),
    playedRanks,
    lastMove,
  })
  .refine((state) => exchangeIsSatisfiable(state), UNSATISFIABLE_EXCHANGE);

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const declaresGameState: Same<z.infer<typeof gameStateSchema>, GameState> = true;
void declaresGameState;

export type GameStateParse = { ok: true; state: GameState } | { ok: false; reason: string };

/** A stored state as the engine's, or the first thing wrong with it, its path leading. */
export function parseGameState(raw: unknown): GameStateParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "no game state" };
  const parsed = gameStateSchema.safeParse(raw);
  if (parsed.success) return { ok: true, state: parsed.data };
  const issue = parsed.error.issues[0];
  const at = issue.path.join(".");
  return { ok: false, reason: at ? `game state ${at}: ${issue.message}` : issue.message };
}

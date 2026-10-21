// The engine's `GameState` as a stored document reads back: `active_games` on the server, the
// offline save on the device. The wire's sanitized state is `shared/protocol.ts`'s, tolerant on
// purpose; this one is exact, because a state that parses here is handed straight to the engine.
import { z } from "zod";
import { isBotPersonalityId, type BotPersonalityId } from "../lib/game/botPersonalities.ts";
import {
  COMBINATION_TYPES,
  DECK_BY_STRENGTH,
  RANK_ORDER,
  RANK_SLOTS,
  SUITS,
  exchangeIsSatisfiable,
  type GameMode,
  type GameState,
  type MatchLength,
} from "../lib/game/gameEngine.ts";

export const UNSATISFIABLE_EXCHANGE = "an open exchange nobody can give back from";

const seat = z.number().int().nonnegative();

const card = z.object({
  id: z.string(),
  suit: z.enum(SUITS).nullable(),
  rank: z.enum(RANK_ORDER),
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
  type: z.enum(COMBINATION_TYPES),
  cards: z.array(card),
  strength: z.number(),
});

const lastMove = z.union([
  z.object({ seq: z.literal(0), kind: z.literal("deal") }),
  z.object({ seq: z.number().int().nonnegative(), kind: z.literal("play"), seat }),
  z.object({ seq: z.number().int().nonnegative(), kind: z.literal("pass"), seat, closedTrick: z.boolean() }),
  z.object({ seq: z.number().int().nonnegative(), kind: z.literal("giveback"), seat }),
]);

export const gameModeSchema = z.enum(["free_for_all", "teams"]);
export const matchLengthSchema = z.enum(["match", "single"]);

const playedRanksSchema = z
  .array(z.number().int().nonnegative())
  .length(RANK_SLOTS, `a played-rank tally of other than ${RANK_SLOTS} ranks`)
  .refine((tally) => tally.every((n, i) => n <= DECK_BY_STRENGTH[i]), "more of a rank played than the deck holds");

function repeatedCard(state: GameState): string | undefined {
  const seen = new Set<string>();
  const held = state.players.flatMap((p) => p.hand).concat(state.lastPlayedCombination?.cards ?? []);
  return held.find(({ id }) => seen.size === seen.add(id).size)?.id;
}

const gameStateSchema = z
  .object({
    players: z.array(player).min(1, "no players"),
    currentTurnIndex: z.number().int(),
    lastPlayedCombination: combination.nullable(),
    lastPlayedBy: z.number().int(),
    passCount: z.number().int().nonnegative(),
    gameMode: gameModeSchema,
    roundOver: z.boolean(),
    finishingOrder: z.array(z.string()),
    openingCard: card.nullable(),
    startReason: z
      .object({
        type: z.enum(["start_card", "lost_round", "won_no_exchange"]),
        card: card.optional(),
        playerIdx: seat,
      })
      .optional(),
    exchangePhase: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("twoJokers"), winnerIdx: seat, loserIdx: seat }),
        z.object({ kind: z.literal("open"), winnerIdx: seat, loserIdx: seat, cardFromLoser: card }),
        z.object({
          kind: z.literal("settled"),
          winnerIdx: seat,
          loserIdx: seat,
          cardFromLoser: card,
          cardToLoser: card,
          settledAt: z.number().optional(),
        }),
      ])
      .optional(),
    playedRanks: playedRanksSchema,
    lastMove,
  })
  .superRefine((state, ctx) => {
    const id = repeatedCard(state);
    if (id !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `card ${id} more than once` });
  })
  .refine((state) => exchangeIsSatisfiable(state), UNSATISFIABLE_EXCHANGE);

type Filled<T> = T extends (infer U)[] ? Filled<U>[] : T extends object ? { [K in keyof T]-?: Filled<T[K]> } : T;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Whether two types match field for field, optional fields included: neither may lack one the other has. */
export type Same<A, B> = Mutual<Filled<A>, Filled<B>>;
const declaresGameState: Same<z.infer<typeof gameStateSchema>, GameState> = true;
const declaresGameMode: Same<z.infer<typeof gameModeSchema>, GameMode> = true;
const declaresMatchLength: Same<z.infer<typeof matchLengthSchema>, MatchLength> = true;
void [declaresGameState, declaresGameMode, declaresMatchLength];

export type GameStateParse = { ok: true; state: GameState } | { ok: false; reason: string };

type Raw = Record<string, unknown>;

function fromOpeningFlags(raw: Raw): Raw {
  const { firstPlayMade, startCard, trickWinner: _trickWinner, ...rest } = raw;
  return { ...rest, openingCard: firstPlayMade === false && startCard !== undefined ? startCard : null };
}

function fromExchangeFlags(raw: Raw): Raw {
  if (typeof raw.exchangePhase !== "object" || raw.exchangePhase === null) return raw;
  const { active, twoJokerException, ...phase } = raw.exchangePhase as Raw;
  if (twoJokerException === true) {
    const { winnerIdx, loserIdx } = phase;
    return { ...raw, exchangePhase: { kind: "twoJokers", winnerIdx, loserIdx } };
  }
  if (active === true) {
    const { cardToLoser: _unchosen, settledAt: _unsettled, ...open } = phase;
    return { ...raw, exchangePhase: { kind: "open", ...open } };
  }
  return { ...raw, exchangePhase: { kind: "settled", ...phase } };
}

/**
 * How a stored state was written, oldest first; each shape is read by converting it to the next.
 * `openingFlags` came before `openingCard`, when the opening card was `startCard`, owed only while
 * `firstPlayMade` was false, and a closed trick also named `trickWinner`. `exchangeFlags` came
 * before the exchange phase's `kind`, when it was `active` and `twoJokerException` flags.
 */
const STORED_SHAPES = [
  { shape: "openingFlags", toNext: fromOpeningFlags },
  { shape: "exchangeFlags", toNext: fromExchangeFlags },
  { shape: "current", toNext: (raw: Raw) => raw },
] as const;

export type StoredStateShape = (typeof STORED_SHAPES)[number]["shape"];

/** The version each shape after the oldest began at. */
export type ShapesSince = Record<Exclude<StoredStateShape, (typeof STORED_SHAPES)[0]["shape"]>, number>;

/** The shape a document of `version` was written in: the newest one begun at or before it. */
export function storedShapeAt(version: number, since: ShapesSince): StoredStateShape {
  const begun = STORED_SHAPES.slice(1).filter(({ shape }) => version >= since[shape as keyof ShapesSince]);
  return (begun.at(-1) ?? STORED_SHAPES[0]).shape;
}

function asCurrent(raw: Raw, shape: StoredStateShape): Raw {
  return STORED_SHAPES.slice(STORED_SHAPES.findIndex((s) => s.shape === shape)).reduce((doc, s) => s.toNext(doc), raw);
}

/** A stored state as the engine's, or the first thing wrong with it, its path leading. */
export function parseGameState(raw: unknown, shape: StoredStateShape = "current"): GameStateParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "no game state" };
  const parsed = gameStateSchema.safeParse(asCurrent(raw as Raw, shape));
  if (parsed.success) return { ok: true, state: parsed.data };
  const issue = parsed.error.issues[0];
  const at = issue.path.join(".");
  return { ok: false, reason: at ? `game state ${at}: ${issue.message}` : issue.message };
}

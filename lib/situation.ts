// A named table situation: a real deal and the moves played into it, so every state it yields is
// one the engine wrote. Pure and relatively imported: the capture screen, node, jest and Playwright
// all load it.
import {
  applyMove,
  createDeck,
  dealCards,
  startRound,
  type Card,
  type GameMode,
  type GameState,
  type Move,
  type Opening,
  type SeatSetup,
} from "./game/gameEngine.ts";

/** One move of a script; `play` is space-separated card ids. */
export type Step =
  | { seat: number; play: string }
  | { seat: number; pass: true }
  | { seat: number; giveback: string };

export interface Situation {
  /** Named in every error, so a script gone illegal says which one. */
  name: string;
  seats: 2 | 3 | 4;
  mode: GameMode;
  firstSeat?: number;
  opening?: Opening;
  /** Per seat, the space-separated cards the script needs; the deal fills the rest. */
  holding: Partial<Record<number, string>>;
  moves: readonly Step[];
}

const ids = (cards: string | undefined): string[] => cards?.split(/\s+/).filter(Boolean) ?? [];

const FIXED: { getRandomValues(array: Uint32Array): Uint32Array } = { getRandomValues: (array) => array.fill(0) };

/** The hand sizes `dealCards` gives; only the sizes, which no shuffle changes. */
function dealSizes(s: Situation): number[] {
  return dealCards(s.seats, s.firstSeat ?? 0, FIXED).hands.map((hand) => hand.length);
}

/**
 * Each seat's `holding`, then the rest of the deck in `createDeck` order, round-robin from
 * `firstSeat`, until every seat holds what `dealCards` would deal it.
 */
export function dealOf(s: Situation): Card[][] {
  const deck = createDeck();
  const byId = new Map(deck.map((card) => [card.id, card]));
  const sizes = dealSizes(s);
  for (const seat of Object.keys(s.holding)) {
    if (!(Number(seat) in sizes)) throw new Error(`${s.name}: no seat ${seat} at ${s.seats} seats`);
  }
  const placed = new Set<string>();
  const hands = sizes.map((size, seat) => {
    const held = ids(s.holding[seat]);
    if (held.length > size) throw new Error(`${s.name}: seat ${seat} holds ${held.length} cards of a ${size}-card hand`);
    return held.map((id) => {
      const card = byId.get(id);
      if (!card) throw new Error(`${s.name}: no card ${id} in the deck`);
      if (placed.has(id)) throw new Error(`${s.name}: ${id} is held by two seats`);
      placed.add(id);
      return card;
    });
  });
  let seat = s.firstSeat ?? 0;
  for (const card of deck.filter((c) => !placed.has(c.id))) {
    const open = sizes.findIndex((_, k) => hands[(seat + k) % s.seats].length < sizes[(seat + k) % s.seats]);
    if (open < 0) break;
    seat = (seat + open) % s.seats;
    hands[seat].push(card);
    seat = (seat + 1) % s.seats;
  }
  return hands;
}

function checkDeal(s: Situation, deal: Card[][]): void {
  const sizes = dealSizes(s);
  if (deal.length !== sizes.length || deal.some((hand, seat) => hand.length !== sizes[seat])) {
    throw new Error(`${s.name}: a deal of ${deal.map((h) => h.length).join("/")} is not the ${sizes.join("/")} one`);
  }
}

function moveOf(step: Step): Move {
  if ("play" in step) return { kind: "play", cardIds: ids(step.play) };
  if ("giveback" in step) return { kind: "giveback", cardId: step.giveback };
  return { kind: "pass" };
}

const SEATING = (seats: number): SeatSetup[] =>
  Array.from({ length: seats }, (_, seat) => ({ name: `Seat ${seat}`, type: seat === 0 ? "human" : "bot" }));

/** The opening state and the state after every step; a refused step throws. */
export function reachSteps(s: Situation, deal: Card[][] = dealOf(s)): GameState[] {
  checkDeal(s, deal);
  let state = startRound(SEATING(s.seats), s.mode, { opening: s.opening, dealt: deal });
  const states = [state];
  s.moves.forEach((step, i) => {
    const result = applyMove(state, step.seat, moveOf(step));
    if (!result.ok) {
      throw new Error(`${s.name}: step ${i}, seat ${step.seat}'s ${moveOf(step).kind}, is refused: ${result.code}`);
    }
    state = result.state;
    states.push(state);
  });
  return states;
}

export function reach(s: Situation): GameState {
  return reachSteps(s).at(-1)!;
}

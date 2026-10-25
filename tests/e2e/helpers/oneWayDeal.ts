// A round-over save whose next deal is rigged into a one-way exchange: the winner holds only Jokers, J to A and
// the 2s, so once the loser's 2♣ is taken the winner has nothing from 3 to 10 to give back (#1826).
import type { Page } from "@playwright/test";
import { createDeck, dealFirstSeatFor, type Card } from "../../../lib/game/gameEngine";
import type { OfflineSave } from "../../../lib/offlineSave";
import { offlineSave } from "./offlineSeed";

export const ONE_WAY_NAMES = ["Ana", "Luan", "Gent"];
const SEATS = 3;
const WINNER = 0;
const LOSER = 1;
export const TAKEN = "2_clubs";

const HIGH = new Set(["J", "Q", "K", "A", "joker_bw", "joker_colored"]);

/** The three hands as dealt, before the loser's highest card goes over. */
function dealtHands(): Card[][] {
  const deck = createDeck();
  const winner = deck.filter((c) => HIGH.has(c.rank));
  const loserHigh = deck.filter((c) => c.rank === "2");
  const low = deck.filter((c) => !HIGH.has(c.rank) && c.rank !== "2");
  return [winner, [...loserHigh, ...low.slice(0, 14)], low.slice(14)];
}

/** The `getRandomValues` draws that make the engine's shuffle lay `hands` out round-robin from `first`. */
function draws(hands: Card[][], first: number): number[] {
  const target: Card[] = [];
  for (let i = 0; i < 54; i++) target.push(hands[(first + i) % SEATS].shift()!);
  const work = createDeck();
  const out: number[] = [];
  for (let i = work.length - 1; i > 0; i--) {
    const j = work.findIndex((c) => c.id === target[i].id);
    out.push(j);
    [work[i], work[j]] = [work[j], work[i]];
  }
  return out;
}

export function oneWaySave(): OfflineSave {
  return offlineSave({
    seats: SEATS,
    names: ONE_WAY_NAMES,
    holding: [[], [], []],
    state: { roundOver: true, finishingOrder: ["player_0", "player_2", "player_1"] },
  });
}

/** Call once the home screen is up: the next deal draws from the queue. */
export async function rigTheDeal(page: Page): Promise<void> {
  const first = dealFirstSeatFor(false, 0, SEATS);
  const queue = draws(dealtHands(), first);
  await page.evaluate((values) => {
    const real = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(a: T) => {
      const buf = a as unknown as Uint32Array;
      if (buf instanceof Uint32Array && buf.length === 1 && values.length > 0) {
        buf[0] = values.shift()!;
        return a;
      }
      return real(a as never) as T;
    }) as Crypto["getRandomValues"];
  }, queue);
}

export { WINNER, LOSER };

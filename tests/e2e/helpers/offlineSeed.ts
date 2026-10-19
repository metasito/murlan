// Reaching a rendered table without playing to one.
//
// The lobby route — Offline, player count, mode, "Inizia Partita", then the deal
// — is four clicks and an animation before a spec can measure anything, and on
// a loaded runner it is where the whole test budget goes (#152). A spec that
// only needs a table on screen should not be paying for it.
//
// `lib/offlineSave.ts` is the app's own restore path, and AsyncStorage is plain
// localStorage on web, so a seeded table arrives through exactly the code a
// player's interrupted match does. Every save a spec seeds is built here and
// encoded by `encodeOfflineSave`, so a change to the stored shape fails `tsc` in
// this one file rather than in a hand-written copy per spec.
import type { Page } from "@playwright/test";
import { openApp } from "./navigation.ts";
import { stepUntil, takeOver } from "./virtualClock.ts";
import {
  buildCombination,
  createDeck,
  dealCards,
  targetsFor,
  type Card,
  type GameState,
  type MatchLength,
} from "../../../lib/game/gameEngine.ts";
import type { BotPersonalityId } from "../../../lib/game/botPersonalities.ts";
import { captureGameState, type CaptureState } from "../../../lib/captureStates.ts";
import { encodeOfflineSave, OFFLINE_SAVE_VERSION, type OfflineSave } from "../../../lib/offlineSave.ts";
import { E2E_SUSPEND_BOT_KEY, OFFLINE_SAVE_KEY, TUTORIAL_SEEN_KEY } from "../../../lib/storageKeys.ts";
import { state } from "../../support/game.ts";

/** Bot names and personalities as app/lobby.tsx fills empty seats. */
const BOTS = [
  { name: "Luan", personality: "luan" },
  { name: "Besnik", personality: "besnik" },
  { name: "Gent", personality: "gent" },
] as const;

/**
 * The biggest hand each seat count actually deals, taken from the engine
 * rather than restated: 54 does not divide by four, so two of the seats hold
 * one card more than the others, and a layout measured against the smaller of
 * the two is measured against a hand that never has to fit.
 */
export const DEAL_SIZE: Record<2 | 3 | 4, number> = {
  2: Math.max(...dealCards(2).hands.map((h) => h.length)),
  3: Math.max(...dealCards(3).hands.map((h) => h.length)),
  4: Math.max(...dealCards(4).hands.map((h) => h.length)),
};

const DECK = new Map(createDeck().map((c) => [c.id, c]));

/** The engine's own cards for `ids`, so a typo is a thrown error rather than a card drawn as undefined. */
export function cards(ids: string[]): Card[] {
  return ids.map((id) => {
    const c = DECK.get(id);
    if (!c) throw new Error(`no card ${id} in the deck`);
    return c;
  });
}

/**
 * `handSize` cards a seat, dealt round-robin from a full deck so no two seats
 * share one. A full hand matters: the side fans are deliberately wider than
 * their column, and a short hand would not reproduce the overflow this exists
 * to measure.
 */
function hands(seats: number, handSize: number): Card[][] {
  // The engine's own deck, unshuffled. Rebuilding a 52-card copy here left the
  // two jokers out, and 54 is what makes a four-player seat hold fourteen.
  const deck = createDeck();
  return Array.from({ length: seats }, (_, seat) =>
    deck.filter((_c, i) => i % seats === seat).slice(0, handSize)
  );
}

export interface SaveOptions {
  seats: 2 | 3 | 4;
  /** Cards a seat in the round-robin deal; ignored with `holding`. */
  hand?: number;
  /** Card ids per seat, in place of the round-robin deal. */
  holding?: string[][];
  /**
   * The seat on move. It defaults to the viewer's, and every capture this suite
   * ever took used that default — which is why the lamp was only ever
   * photographed at the bottom edge.
   */
  turn?: number;
  scores?: Record<string, number>;
  length?: MatchLength;
  target?: number;
  /** Seat names, viewer first; the lobby's own bot names by default. */
  names?: string[];
  /**
   * Bot personalities per seat. The lobby's own bots carry theirs; named seats
   * carry none unless given, so a spec's names never pick a strategy for it.
   */
  personalities?: (BotPersonalityId | undefined)[];
  /** A play already on the felt, built by the engine so its strength is the rules' own. */
  pile?: { cards: string[]; by: number };
  state?: Partial<GameState>;
}

/** A mid-hand offline save, viewer at seat 0, past the opening. */
export function offlineSave(o: SaveOptions): OfflineSave {
  const names = o.names ?? ["Ana", ...BOTS.map((b) => b.name)];
  const personalities = o.personalities ?? (o.names ? [] : [undefined, ...BOTS.map((b) => b.personality)]);
  const dealt = o.holding?.map(cards) ?? hands(o.seats, o.hand ?? 13);
  const gameState = state({
    players: Array.from({ length: o.seats }, (_, i) => ({
      id: `player_${i}`,
      name: names[i],
      hand: dealt[i],
      type: i === 0 ? "human" : "bot",
    })),
    currentTurnIndex: o.turn ?? 0,
    lastPlayedBy: -1,
    // Past the opening, so nothing is waiting on the 3 of spades and the
    // table renders as a round in progress rather than a first move.
    firstPlayMade: true,
    ...(o.pile && { lastPlayedCombination: buildCombination(cards(o.pile.cards)), lastPlayedBy: o.pile.by }),
    ...o.state,
  });
  return {
    version: OFFLINE_SAVE_VERSION,
    gameState,
    match: {
      length: o.length ?? "match",
      target: o.target ?? 21,
      scores: o.scores ?? {},
      rounds: [],
      // isResumable() refuses a finished match, and a refused save silently
      // leaves the home screen with no Resume button at all.
      over: false,
      winners: [],
      isDraw: false,
    },
    players: Array.from({ length: o.seats }, (_, i) =>
      i === 0
        ? { name: names[0], type: "human" as const }
        : { name: names[i], type: "bot" as const, personality: personalities[i] }
    ),
    gameMode: gameState.gameMode,
    dealFirstSeat: 0,
  };
}

/**
 * A round mid-exchange, `winner` choosing a giveback for `loser`, on move.
 * `cardFromLoser` defaults to the loser's first card, taken out of their hand so
 * it is not in two places.
 */
export function exchangeSave(o: SaveOptions & { winner: number; loser: number; cardFromLoser?: string }): OfflineSave {
  const save = offlineSave({ ...o, turn: o.turn ?? o.winner });
  const [cardFromLoser] = o.cardFromLoser
    ? cards([o.cardFromLoser])
    : save.gameState.players[o.loser].hand.splice(0, 1);
  save.gameState.exchangePhase = {
    active: true,
    winnerIdx: o.winner,
    loserIdx: o.loser,
    cardFromLoser,
    twoJokerException: false,
  };
  return save;
}

/**
 * The viewer on move holding only `last`, which ends the match when it lands:
 * every other seat holds one card, so a two-seat round closes on it, and a
 * `match` sits one point short of its first target.
 */
export function oneCardFromFinishing(o: { seats: 2 | 3 | 4; length: MatchLength; last: Card; pile?: Card[] }): OfflineSave {
  const used = new Set([o.last.id, ...(o.pile ?? []).map((c) => c.id)]);
  const rest = createDeck().filter((c) => !used.has(c.id));
  const target = targetsFor(o.seats)[0];
  return offlineSave({
    seats: o.seats,
    length: o.length,
    holding: [[o.last.id], ...rest.slice(0, o.seats - 1).map((c) => [c.id])],
    ...(o.pile && { pile: { cards: o.pile.map((c) => c.id), by: o.seats - 1 } }),
    ...(o.length === "match" && {
      target,
      scores: Object.fromEntries(Array.from({ length: o.seats }, (_, i) => [`player_${i}`, i === 0 ? target - 1 : 0])),
    }),
  });
}

export interface SeedOptions {
  /**
   * Holds whichever seat the save is on, before the bundle evaluates.
   * `EXPO_PUBLIC_E2E_FAST` takes the offline bot's own delay to zero, so a
   * seeded bot turn is over before a spec can measure it (`lib/e2eBotSuspend.ts`).
   */
  holdTurn?: boolean;
}

/**
 * Writes `save` before the first document runs, leaving the home screen to
 * offer it. The only writer of the save and the bot hold in `tests/e2e`.
 */
export async function seedSave(page: Page, save: OfflineSave, o: SeedOptions = {}): Promise<void> {
  const entries: [string, string][] = [[OFFLINE_SAVE_KEY, encodeOfflineSave(save)]];
  if (o.holdTurn) entries.push([E2E_SUSPEND_BOT_KEY, "1"]);
  await page.addInitScript((entries) => {
    for (const [k, v] of entries) window.localStorage.setItem(k, v);
  }, entries);
}

/**
 * Opens the app with a game already saved, and resumes it.
 *
 * `holdTurn` is opt-in rather than implied by a non-zero `turn`: a spec that
 * seeds a bot's turn may be there precisely to watch that bot play
 * (`seatFans.spec.ts`'s throw origins), and holding it would leave nothing to
 * measure.
 */
export async function openSeededGame(
  page: Page,
  baseURL: string,
  playerCount: 2 | 3 | 4,
  handSize?: number,
  turn: number = 0,
  holdTurn: boolean = false
): Promise<void> {
  await resumeSaved(page, baseURL, offlineSave({ seats: playerCount, hand: handSize, turn }), { holdTurn });
}

/**
 * The same table `app/capture.tsx` puts on an iOS device, in Chromium.
 *
 * `lib/captureStates.ts` is the list both walk. Seeding from it rather than
 * from a seat count and a turn is what keeps a Playwright run and a photograph
 * comparable: a state that carries a pile carries it on both, instead of the
 * web run quietly checking an empty felt under the same name.
 *
 * It also holds the seeded turn still (`lib/e2eBotSuspend.ts`).
 */
export async function openCaptureState(
  page: Page,
  baseURL: string,
  capture: CaptureState
): Promise<void> {
  const save = offlineSave({ seats: capture.playerCount, hand: DEAL_SIZE[capture.playerCount], turn: capture.turn });
  await resumeSaved(page, baseURL, { ...save, gameState: captureGameState(capture) }, { holdTurn: true });
}

/**
 * Writes `save` and resumes it, leaving a rendered table after **one** page
 * load.
 *
 * The save is injected with `addInitScript`, before the first document runs,
 * rather than written afterwards and reloaded. That distinction is the whole
 * point: a write-then-reload costs a second load of the bundle, which is about
 * what the lobby clicks cost, and saves nothing.
 */
export async function resumeSaved(page: Page, baseURL: string, save: OfflineSave, o: SeedOptions = {}): Promise<void> {
  await seedSave(page, save, o);
  await openApp(page, baseURL);
  // Waited for, not clicked at. `openApp` returns on networkidle, which is the
  // bundle arriving rather than the app becoming interactive — on a loaded
  // runner those are far apart, and a click with a short cap fails while the
  // home screen is still mounting. #152 is the record of it: every failure has
  // been a click on this screen, before this helper existed and after.
  const resume = page.getByRole("button", { name: "Riprendi partita" });
  await resume.waitFor({ state: "visible", timeout: 60_000 });
  await resume.click();
  await page.locator('[data-testid="game-table"]').waitFor({ timeout: 30_000 });
}

/**
 * `resumeSaved` on a page whose clock `installVirtualClock` already holds, every
 * seat held: the home screen is stepped to rather than waited for, and
 * `beforeResume` runs on it before the click.
 */
export async function resumeOnVirtualClock(
  page: Page,
  baseURL: string,
  save: OfflineSave,
  beforeResume?: () => Promise<void>
): Promise<void> {
  await seedSave(page, save, { holdTurn: true });
  await page.addInitScript((key) => window.localStorage.setItem(key, "1"), TUTORIAL_SEEN_KEY);
  await page.goto(baseURL);
  await takeOver(page);
  const resume = page.getByRole("button", { name: "Riprendi partita" });
  await stepUntil(page, () => resume.isVisible(), "the home screen");
  await beforeResume?.();
  await resume.click({ force: true });
}

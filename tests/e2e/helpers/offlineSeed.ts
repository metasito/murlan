// Reaching a rendered table without playing to one.
//
// The lobby route — Offline, player count, mode, Inizia Partita, then the deal
// — is four clicks and an animation before a spec can measure anything, and on
// a loaded runner it is where the whole test budget goes (#152). A spec that
// only needs a table on screen should not be paying for it.
//
// `lib/offlineSave.ts` is the app's own restore path, and AsyncStorage is plain
// localStorage on web, so a seeded table arrives through exactly the code a
// player's interrupted match does. `a11yOverlays.spec.ts` established the
// shape; this is it, generalised over the seat count.
import type { Page } from "@playwright/test";
import { openApp } from "./navigation";
import { createDeck, dealCards } from "../../../lib/gameEngine";
import { captureGameState, type CaptureState } from "../../../lib/captureStates";
import { E2E_SUSPEND_AI_KEY } from "../../../lib/e2eAiSuspend";

/** Bot names and personalities as app/lobby.tsx fills empty seats. */
const BOTS = [
  { name: "Luan", personality: "luan" },
  { name: "Drita", personality: "drita" },
  { name: "Besnik", personality: "besnik" },
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

/**
 * `handSize` cards a seat, dealt round-robin from a full deck so no two seats
 * share one. A full hand matters: the side fans are deliberately wider than
 * their column, and a short hand would not reproduce the overflow this exists
 * to measure.
 */
function hands(playerCount: number, handSize: number) {
  // The engine's own deck, unshuffled. Rebuilding a 52-card copy here left the
  // two jokers out, and 54 is what makes a four-player seat hold fourteen.
  const deck = createDeck();
  return Array.from({ length: playerCount }, (_, seat) =>
    deck.filter((_c, i) => i % playerCount === seat).slice(0, handSize)
  );
}

/**
 * A mid-hand offline save for `playerCount` seats, viewer at seat 0.
 *
 * `turn` is the seat on move. It defaults to the viewer's, and every capture
 * this suite ever took used that default — which is why the lamp was only ever
 * photographed at the bottom edge. The felt, the seats and the action buttons
 * all key off whose turn it is, so a seat count is only half a state.
 */
export function offlineGameSave(playerCount: 2 | 3 | 4, handSize: number = 13, turn: number = 0) {
  const dealt = hands(playerCount, handSize);
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `player_${i}`,
    name: i === 0 ? "Ana" : BOTS[i - 1].name,
    hand: dealt[i],
    type: i === 0 ? "human" : "ai",
  }));

  return {
    version: 2,
    gameState: {
      players,
      currentTurnIndex: turn,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      // Past the opening, so nothing is waiting on the 3 of spades and the
      // table renders as a hand in progress rather than a first move.
      firstPlayMade: true,
    },
    match: {
      length: "match",
      target: 21,
      scores: {},
      hands: [],
      // isResumable() refuses a finished match, and a refused save silently
      // leaves the home screen with no Resume button at all.
      over: false,
      winners: [],
      isDraw: false,
    },
    rematchAnswers: {},
    players: Array.from({ length: playerCount }, (_, i) =>
      i === 0
        ? { name: "Ana", type: "human" }
        : { name: BOTS[i - 1].name, type: "ai", personality: BOTS[i - 1].personality }
    ),
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
}

/** Opens the app with a game already saved, and resumes it. */
export async function openSeededGame(
  page: Page,
  baseURL: string,
  playerCount: 2 | 3 | 4,
  handSize?: number,
  turn?: number
): Promise<void> {
  await resumeSaved(page, baseURL, offlineGameSave(playerCount, handSize, turn));
}

/**
 * The same table `app/capture.tsx` puts on an iOS device, in Chromium.
 *
 * `lib/captureStates.ts` is the list both walk. Seeding from it rather than
 * from a seat count and a turn is what keeps a Playwright run and a photograph
 * comparable: a state that carries a pile carries it on both, instead of the
 * web run quietly checking an empty felt under the same name.
 *
 * `app/game.tsx` runs the AI turn loop regardless of how a save was reached,
 * so this also asks it to hold (`lib/e2eAiSuspend.ts`) — otherwise a state
 * seeded on a bot is a bot's turn for about a second, long enough to navigate
 * to and not to measure.
 */
export async function openCaptureState(
  page: Page,
  baseURL: string,
  state: CaptureState
): Promise<void> {
  const save = offlineGameSave(state.playerCount, DEAL_SIZE[state.playerCount], state.turn);
  await page.addInitScript(
    ({ key }) => window.localStorage.setItem(key, "1"),
    { key: E2E_SUSPEND_AI_KEY }
  );
  await resumeSaved(page, baseURL, { ...save, gameState: captureGameState(state) });
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
async function resumeSaved(page: Page, baseURL: string, save: object): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: "@murlan_offline_game", value: JSON.stringify(save) }
  );
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

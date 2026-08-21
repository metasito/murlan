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

const RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"] as const;
const SUITS = ["hearts", "diamonds", "clubs", "spades"] as const;

/** Bot names and personalities as app/lobby.tsx fills empty seats. */
const BOTS = [
  { name: "Luan", personality: "luan" },
  { name: "Drita", personality: "drita" },
  { name: "Besnik", personality: "besnik" },
] as const;

const card = (rank: string, suit: string) => ({
  id: `${rank}_${suit}`,
  rank,
  suit,
  isJoker: false,
});

/**
 * Thirteen cards a seat, dealt round-robin from a full deck so no two seats
 * share one. A full hand matters: the side fans are deliberately wider than
 * their column, and a short hand would not reproduce the overflow this exists
 * to measure.
 */
function hands(playerCount: number) {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => card(rank, suit)));
  return Array.from({ length: playerCount }, (_, seat) =>
    deck.filter((_c, i) => i % playerCount === seat).slice(0, 13)
  );
}

/** A mid-hand offline save for `playerCount` seats, viewer at seat 0. */
export function offlineGameSave(playerCount: 2 | 3 | 4) {
  const dealt = hands(playerCount);
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
      currentTurnIndex: 0,
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

/**
 * Opens the app with a game already saved, and resumes it — leaving a rendered
 * table after **one** page load.
 *
 * The save is injected with `addInitScript`, before the first document runs,
 * rather than written afterwards and reloaded. That distinction is the whole
 * point: a write-then-reload costs a second load of the bundle, which is about
 * what the lobby clicks cost, and saves nothing.
 */
export async function openSeededGame(
  page: Page,
  baseURL: string,
  playerCount: 2 | 3 | 4
): Promise<void> {
  await page.addInitScript(
    ({ key, save }) => window.localStorage.setItem(key, JSON.stringify(save)),
    { key: "@murlan_offline_game", save: offlineGameSave(playerCount) }
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

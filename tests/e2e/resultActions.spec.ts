// tests/e2e/resultActions.spec.ts — a partita ends on the felt (#1267): the score pill becomes the
// board, its actions sit as a pair inside it below the rows, Home then Nuova partita, and Nuova
// partita deals a new partita without leaving the table.
//
// Only a browser can answer it: `react-test-renderer` never runs flexbox, so a native test cannot
// say where the pair landed relative to the board. One single-manche partita is played, once,
// and the window is then resized through the list.
import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { driveGameToCompletion } from "./helpers/bot";
import { atRest } from "./helpers/settle";
import { seedRandomness } from "./helpers/seededRandomness";

const PRIMARY = "btn-nuova-partita";
const BOARD = '[data-testid="score-pill-layer"]';
/** Nothing here reads the hand, only the board after it; a fixed deal holds its length steady. */
const DEAL_SEED = 1;
/** Layout rounds; a sub-pixel overlap is not something anyone can see. */
const TOLERANCE = 1;

/** The game screens are landscape-locked: phone, small phone and tablet. */
const VIEWPORTS = [
  { name: "phone landscape", width: 844, height: 390 },
  { name: "small phone landscape", width: 667, height: 375 },
  { name: "iPad landscape", width: 1112, height: 834 },
];

type Rect = { x: number; y: number; width: number; height: number };

async function rects(page: import("@playwright/test").Page, ids: string[], width: number): Promise<Rect[]> {
  await page.waitForFunction(
    ({ ids, width }) =>
      window.innerWidth === width &&
      ids.every((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        return !!r && r.width > 0 && r.height > 0;
      }),
    { ids, width }
  );
  return page.evaluate(
    (ids) =>
      ids.map((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    ids
  );
}

test("the board's actions read as a pair inside it, below the rows, at every landscape size", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(5 * 60_000);
  await seedRandomness(page, DEAL_SEED);
  await openApp(page, baseURL!);
  await startOfflineGame(page, { playerCount: 2, gameMode: "free_for_all", format: "single" });
  await driveGameToCompletion(page, {
    isFinished: (p) => p.getByTestId("btn-home").isVisible(),
    log: (line) => test.info().annotations.push({ type: "move", description: line }),
  });
  await expect(page).toHaveURL(/\/game/);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await atRest(page, BOARD);
    const [board, winnerRow, home, primary] = await rects(
      page,
      ["score-pill-panel", "score-pill-winner-row", "btn-home", PRIMARY],
      vp.width
    );

    const inside = (r: Rect) =>
      r.x >= board.x - TOLERANCE &&
      r.y >= board.y - TOLERANCE &&
      r.x + r.width <= board.x + board.width + TOLERANCE &&
      r.y + r.height <= board.y + board.height + TOLERANCE;
    expect(inside(home), `at ${vp.name} Home sits outside the board`).toBe(true);
    expect(inside(primary), `at ${vp.name} Nuova partita sits outside the board`).toBe(true);
    expect(Math.abs(home.y - primary.y), `at ${vp.name} the actions are not on one line`).toBeLessThanOrEqual(TOLERANCE);
    expect(home.x + home.width, `at ${vp.name} Home does not lead Nuova partita`).toBeLessThanOrEqual(primary.x + TOLERANCE);
    expect(home.y, `at ${vp.name} the actions are not below the winner's row`).toBeGreaterThan(winnerRow.y + winnerRow.height);
    expect(
      board.x >= -TOLERANCE && board.x + board.width <= vp.width + TOLERANCE && board.y + board.height <= vp.height + TOLERANCE,
      `at ${vp.name} the board reaches past the window`
    ).toBe(true);
  }

  await page.getByTestId(PRIMARY).click();
  await expect(page.getByTestId("btn-home"), "Nuova partita left the board standing").toHaveCount(0, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/game/);
});

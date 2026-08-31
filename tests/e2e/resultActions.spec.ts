// tests/e2e/resultActions.spec.ts — the result screen's primary action sits
// where reading finishes, and pairs with Home rather than sitting beside a
// control of another shape (#588).
//
// Only a browser can answer any of it. `react-test-renderer` never runs
// flexbox, so a native test cannot say how tall either button ended up, nor
// where the pair landed relative to the rankings — which is the whole ticket.
//
// One hand is played, once, and the window is then resized through the
// ticket's list. Re-playing per viewport would cost five games to measure a
// layout that is a function of the window alone.
import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { driveGameToCompletion } from "./helpers/bot";
import { settled } from "./helpers/settle";

const RESULT_URL = /\/result/;

/** The ticket's own list — real devices, both orientations, phone and tablet. */
const VIEWPORTS = [
  { name: "iPhone SE portrait", width: 375, height: 667 },
  { name: "iPhone 12 portrait", width: 390, height: 844 },
  { name: "iPhone 14 Pro Max portrait", width: 430, height: 932 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "iPad landscape", width: 1112, height: 834 },
];

/**
 * All three boxes read in one frame, from the DOM rather than through
 * `boundingBox()`.
 *
 * In portrait the actions sit below the fold of react-native-web's scroll
 * container, and `boundingBox()` answers null for an element it considers not
 * visible — which is a fact about scroll position, not about the layout this
 * spec is measuring. `getBoundingClientRect` has no such opinion, and reading
 * all three together means they cannot be compared across two scroll states.
 */
async function boxes(
  page: import("@playwright/test").Page,
  testIds: string[],
  expectedWidth: number
) {
  const read = (ids: string[]) =>
    ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });

  // A resize swaps the whole tree: `app/result.tsx` branches on
  // `useWindowDimensions`, so portrait and landscape are different elements,
  // not the same ones moved. Waiting on any single locator can be satisfied by
  // the branch that is on its way out, which is how this spec first failed —
  // so the gate is the window reporting the new width *and* all three boxes
  // being laid out under it.
  await page.waitForFunction(
    ({ ids, width }) =>
      window.innerWidth === width &&
      ids.every((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }),
    { ids: testIds, width: expectedWidth }
  );

  const rects = await page.evaluate(read, testIds);
  return rects as { x: number; y: number; width: number; height: number }[];
}

test("the result screen's actions read as a pair, below the rankings, at every supported size", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(5 * 60_000);
  await openApp(page, baseURL!);
  // A match rather than a single hand: `continueAction` is null once a match is
  // over and nobody has asked for a rematch, and a spec measuring a button that
  // is not rendered would pass by finding nothing.
  await startOfflineGame(page, { playerCount: 2, gameMode: "free_for_all", format: "match" });
  await driveGameToCompletion(page, {
    isFinished: async (p) => RESULT_URL.test(p.url()),
    log: (line) => test.info().annotations.push({ type: "move", description: line }),
  });
  await expect(page).toHaveURL(RESULT_URL);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // The branch swap remounts `ScoreRow`, which enters from `translateX(30)`,
    // so every rank row is 30px past its resting right edge for the length of
    // its own staggered spring. Measuring through that reads the entrance as
    // overflow — the rows really are outside the window, just not for long.
    await settled(page, 3000, '[data-testid="result-rankings"]');

    const [home, primary, rankings] = await boxes(
      page,
      ["btn-home", "btn-prossima-manche", "result-rankings"],
      vp.width
    );

    // A pair, which is the defect: the two used to be a square icon and a
    // two-line label of different heights. 1px absorbs the browser's own
    // subpixel rounding, not a real difference.
    expect(
      Math.abs(home.height - primary.height),
      `at ${vp.name} Home (${home.height}px) and the primary (${primary.height}px) must be the same height`
    ).toBeLessThanOrEqual(1);

    // Side by side, so "the same height" above is about a pair rather than two
    // stacked buttons that trivially match.
    expect(
      Math.abs(home.y - primary.y),
      `at ${vp.name} the two actions must sit on the same row`
    ).toBeLessThanOrEqual(1);

    // Where reading finishes: under the rankings, and in their column rather
    // than diagonally opposite them.
    expect(
      primary.y,
      `at ${vp.name} the primary must sit below the rankings, not beside or above them`
    ).toBeGreaterThanOrEqual(rankings.y + rankings.height - 1);
    expect(
      primary.x + primary.width,
      `at ${vp.name} the primary must be in the rankings' column`
    ).toBeGreaterThan(rankings.x);

    // The label fits on one line without being cut. `numberOfLines={1}` stops
    // it wrapping, so the failure it can still have is an ellipsis — which the
    // ticket asks against just as much as a wrap does.
    const clipped = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="btn-prossima-manche"]');
      return [...(btn?.querySelectorAll("*") ?? [])]
        .filter((el) => (el.textContent ?? "").trim().length > 0)
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => ({
          text: (el.textContent ?? "").trim(),
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
        }));
    });
    expect(clipped, `at ${vp.name} the primary's label must not be cut off`).toEqual([]);

    // Nothing may reach past the window: the pair is a row now, and a row of
    // fixed-width plus flex is exactly the shape that overflows in React
    // Native, where `flexShrink` defaults to 0.
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("*")]
        .map((el) => ({
          right: el.getBoundingClientRect().right,
          text: (el.textContent ?? "").trim().slice(0, 40),
        }))
        .filter((n) => n.right > window.innerWidth + 1)
    );
    expect(overflowing, `nothing on /result may reach past ${vp.width}px`).toEqual([]);
  }
});

// tests/e2e/exchangeNoOverlap.spec.ts — the two traded cards never share the table, and the pile
// label that names each trade covers no card and stays on screen. Only a browser can say where
// transformed views and a label actually land (docs/agents/checks.md).
import { test, expect } from "./fixtures";
import { resumeSaved } from "./helpers/offlineSeed";
import { tap } from "./helpers/press";

const GIVEBACK_SPOKEN = "5 di Cuori";
const LEGS = ["exchange-flier-to-winner", "exchange-flier-to-loser"] as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Overlapping area, in px². Zero when the two only touch. */
function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const card = (id: string, rank: string, suit: string) => ({ id, rank, suit, isJoker: false });

/** The viewer has just won a manche and is about to choose what to hand back. */
function midExchangeSave() {
  return {
    version: 2,
    gameState: {
      players: [
        {
          id: "player_0",
          name: "Ana",
          hand: [card("5_hearts", "5", "hearts"), card("K_spades", "K", "spades")],
          type: "human",
        },
        {
          id: "player_1",
          name: "Bea",
          hand: [card("J_hearts", "J", "hearts"), card("Q_diamonds", "Q", "diamonds")],
          type: "ai",
        },
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
      exchangePhase: {
        active: true,
        winnerIdx: 0,
        loserIdx: 1,
        cardFromLoser: card("2_spades", "2", "spades"),
        bothJokersException: false,
      },
    },
    match: {
      length: "match",
      target: 21,
      scores: {},
      hands: [],
      over: false,
      winners: [],
      isDraw: false,
    },
    players: [
      { name: "Ana", type: "human" },
      { name: "Bea", type: "ai", personality: "luan" },
    ],
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
}

test("the give shows only once the receive has landed: never two cards in the air", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await resumeSaved(page, baseURL!, midExchangeSave());
  await page.evaluate((legs) => {
    const out: { t: number; shown: string[]; x: number; y: number }[] = [];
    (window as unknown as { __legs: typeof out }).__legs = out;
    const t0 = performance.now();
    const frame = () => {
      const shown = legs.filter((leg) => {
        const el = document.querySelector(`[data-testid="${leg}"]`);
        return el && Number(getComputedStyle(el).opacity) > 0;
      });
      const el = shown[0] ? document.querySelector(`[data-testid="${shown[0]}"]`) : null;
      const r = el?.getBoundingClientRect();
      out.push({ t: performance.now() - t0, shown, x: r?.x ?? 0, y: r?.y ?? 0 });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, LEGS);

  await expect(page.getByTestId("exchange-prompt")).toBeVisible({ timeout: 15_000 });
  await tap(page, page.getByRole("button", { name: GIVEBACK_SPOKEN, exact: true }));
  await tap(page, page.getByTestId("btn-gioca"));
  await expect(page.getByTestId("exchange-flier-to-loser")).toHaveCount(0, { timeout: 20_000 });

  const track = await page.evaluate(() => (window as unknown as { __legs: { t: number; shown: string[]; x: number; y: number }[] }).__legs);
  for (const leg of LEGS) {
    const own = track.filter((f) => f.shown.includes(leg) && f.shown.length === 1);
    expect(own.length, `${leg} was drawn`).toBeGreaterThan(10);
    const travel = Math.max(...own.map((f) => Math.hypot(f.x - own[0].x, f.y - own[0].y)));
    expect(travel, `${leg} has to cross the table`).toBeGreaterThan(20);
  }
  expect(track.filter((f) => f.shown.length > 1).map((f) => f.t.toFixed(0)), "both cards were in the air at once").toEqual([]);
});

test("the pile label covers no card and stays on screen", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  // A real phone in landscape: the window labels used to go off the bottom of.
  await page.setViewportSize({ width: 844, height: 390 });
  await resumeSaved(page, baseURL!, midExchangeSave());

  const label = page.getByTestId("exchange-pile-label");
  await expect(label).toBeVisible({ timeout: 15_000 });
  const box = (await label.boundingBox())!;
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="card-box"], [data-testid="card-box-back"]')]
      .filter((el) => {
        for (let n: Element | null = el; n; n = n.parentElement) if (Number(getComputedStyle(n).opacity) === 0) return false;
        return true;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })
      .filter((r) => r.width > 0 && r.height > 0)
  );
  expect(cards.length, "no card faces were measured at all").toBeGreaterThan(0);
  const on = cards.filter((c) => intersection(box, c) > 0);
  expect(on.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`), `the label sits on ${on.length} card(s)`).toEqual([]);

  const window = page.viewportSize()!;
  expect(
    [
      box.x < 0 && "past the left edge",
      box.y < 0 && "above the top edge",
      box.x + box.width > window.width && "past the right edge",
      box.y + box.height > window.height && "below the bottom edge",
    ].filter(Boolean),
    `the label is at ${Math.round(box.x)},${Math.round(box.y)} (${Math.round(box.width)}x${Math.round(box.height)})`
  ).toEqual([]);
});

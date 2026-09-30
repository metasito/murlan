// tests/e2e/cardRects.spec.ts — every card the registry holds is where the page draws it, within 1 pt,
// and it holds exactly the cards drawn: at rest, mid-throw, mid-deal and mid-exchange (#1259 plan 4, task 11).
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { offlineGameSave, resumeSaved } from "./helpers/offlineSeed";
import { settled } from "./helpers/settle";
import { tap } from "./helpers/press";
import { E2E_SUSPEND_AI_KEY } from "../../lib/storageKeys";
import { DESIGN } from "../../components/table/lampRig";

const VIEWPORT = { width: 844, height: 390 };
const TOLERANCE = 1;

interface Worst { frames: number; scopes: string[]; centre: number; size: number; counts: string[] }

/** Samples every frame for `ms`: each published rectangle against the drawn box nearest it, and the counts of both per scope. */
async function sample(page: Page, ms: number, until?: string): Promise<Worst> {
  return page.evaluate(
    ({ ms, until, design }) =>
      new Promise<Worst>((done) => {
        const OWNERS: Record<string, string> = {
          hand: '[data-testid^="hand-card-"]',
          fan: '[data-testid="seat-back"]',
          pile: '[data-testid="pile-area"]',
          deal: '[data-testid="dealt-back"]',
          leg: '[data-testid="exchange-announce"]',
        };
        const worst: Worst = { frames: 0, scopes: [], centre: 0, size: 0, counts: [] };
        const seen = new Set<string>();
        const shown = (el: Element) => {
          for (let n: Element | null = el; n; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.display === "none" || Number(s.opacity) === 0) return false;
          }
          return true;
        };
        const t0 = performance.now();
        const frame = () => {
          const rects = (globalThis as { murlanCardRects?: () => Record<string, { x: number; y: number; w: number; h: number; rot: number }> }).murlanCardRects?.() ?? {};
          const sx = innerWidth / design.width;
          const sy = innerHeight / design.height;
          for (const [scope, owner] of Object.entries(OWNERS)) {
            const drawn = [...document.querySelectorAll(`${owner} [data-testid="card-box"], ${owner} [data-testid="card-box-back"]`)]
              .filter(shown)
              .map((el) => el.getBoundingClientRect());
            const published = Object.entries(rects)
              .filter(([k]) => k.startsWith(`${scope}:`))
              .map(([, r]) => {
                const rad = (r.rot * Math.PI) / 180;
                const [w, h] = [r.w * sx, r.h * sy];
                return { cx: r.x * sx, cy: r.y * sy, w: w * Math.abs(Math.cos(rad)) + h * Math.abs(Math.sin(rad)), h: w * Math.abs(Math.sin(rad)) + h * Math.abs(Math.cos(rad)) };
              });
            if (drawn.length !== published.length) worst.counts.push(`${scope}: ${published.length} published, ${drawn.length} drawn`);
            if (published.length > 0) seen.add(scope);
            for (const p of published) {
              let best = { d: Infinity, size: Infinity };
              for (const b of drawn) {
                const d = Math.hypot(b.x + b.width / 2 - p.cx, b.y + b.height / 2 - p.cy);
                if (d < best.d) best = { d, size: Math.max(Math.abs(b.width - p.w), Math.abs(b.height - p.h)) };
              }
              worst.centre = Math.max(worst.centre, best.d);
              worst.size = Math.max(worst.size, best.size);
            }
          }
          worst.frames++;
          const over = performance.now() - t0 > ms || (until !== undefined && worst.frames > 1 && !document.querySelector(until));
          if (over) done({ ...worst, scopes: [...seen].sort(), counts: worst.counts.slice(0, 5) });
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { ms, until, design: DESIGN }
  );
}

function expectOnTheCards(w: Worst, scopes: string[]) {
  expect(w.counts, "the registry holds exactly the cards drawn").toEqual([]);
  expect(w.scopes, "every owner here published").toEqual(expect.arrayContaining(scopes));
  expect(w.centre, `centre off by ${w.centre.toFixed(2)}pt`).toBeLessThanOrEqual(TOLERANCE);
  expect(w.size, `size off by ${w.size.toFixed(2)}pt`).toBeLessThanOrEqual(TOLERANCE);
}

const card = (id: string, rank: string, suit: string) => ({ id, rank, suit, isJoker: false });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript((key) => window.localStorage.setItem(key, "1"), E2E_SUSPEND_AI_KEY);
});

test("at rest and through a throw, every hand card, back and played card is where it is drawn", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await resumeSaved(page, baseURL!, offlineGameSave(4, 8, 1));
  await settled(page, 3_000, '[data-testid="game-table"]');
  expectOnTheCards(await sample(page, 500), ["hand", "fan"]);

  await page.evaluate(() => (globalThis as unknown as { murlanBotMove: () => void }).murlanBotMove());
  await page.locator('[data-testid="flying-cards"]').waitFor({ state: "attached", timeout: 15_000 });
  expectOnTheCards(await sample(page, 3_000, '[data-testid="flying-cards"]'), ["hand", "fan", "pile"]);

  await settled(page, 3_000, '[data-testid="game-table"]');
  expectOnTheCards(await sample(page, 500), ["hand", "fan", "pile"]);
});

test("a picked card is where it is drawn through its lift, and publishes its lift and glow", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await resumeSaved(page, baseURL!, offlineGameSave(2, 9, 0));
  await settled(page, 3_000, '[data-testid="game-table"]');
  const picked = page.locator('[data-testid^="hand-card-"]').last();
  const id = (await picked.getAttribute("data-testid"))!.slice("hand-card-".length);
  const during = sample(page, 900);
  await tap(page, picked);
  expectOnTheCards(await during, ["hand", "fan"]);
  const rect = await page.evaluate((key) => (globalThis as { murlanCardRects?: () => Record<string, { lift: number; glow: number }> }).murlanCardRects?.()[key], `hand:${id}`);
  expect(rect?.lift, "lifted").toBeGreaterThan(0.95);
  expect(rect?.glow, "glowing").toBeGreaterThan(0.95);
});

test("mid-deal, every back in the air is where it is drawn", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const save = offlineGameSave(4);
  await resumeSaved(page, baseURL!, { ...save, gameState: { ...save.gameState, firstPlayMade: false } });
  const w = await sample(page, 4_000);
  expectOnTheCards(w, ["hand", "fan", "deal"]);
});

test("mid-exchange, both traded cards are where they are drawn", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const save = offlineGameSave(2);
  await resumeSaved(page, baseURL!, {
    ...save,
    gameState: {
      ...save.gameState,
      players: [
        { id: "player_0", name: "Ana", hand: [card("5_hearts", "5", "hearts"), card("K_spades", "K", "spades"), card("2_spades", "2", "spades")], type: "human" },
        { id: "player_1", name: "Bea", hand: [card("J_hearts", "J", "hearts"), card("Q_diamonds", "Q", "diamonds")], type: "ai" },
      ],
      exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card("2_spades", "2", "spades"), bothJokersException: false },
    },
  });
  expectOnTheCards(await sample(page, 4_000), ["hand", "fan", "leg"]);
});

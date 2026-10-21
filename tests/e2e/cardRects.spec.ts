// tests/e2e/cardRects.spec.ts — every card the registry holds is where the page draws that same card,
// within 1 pt and 1°, and it holds exactly the cards drawn: at rest, mid-throw, mid-deal, mid-exchange
// and through a bomb's kick, on a phone and on a 4:3 tablet (#1259 plan 4, task 11).
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { exchangeSave, offlineSave, resumeSaved } from "./helpers/offlineSeed";
import { settled } from "./helpers/settle";
import { tap, tapPoint } from "./helpers/press";
import { HAND_ZONE } from "./helpers/selectors.ts";

const VIEWPORTS = [
  { name: "phone", width: 844, height: 390 },
  { name: "4:3 tablet", width: 1024, height: 768 },
];
const TOLERANCE = 1;

interface Worst { frames: number; scopes: string[]; centre: number; size: number; rot: number; worstAt: string; badFrames: number; counts: string[]; moved: number }

/**
 * Samples every frame for `ms`: each published rectangle against the corners of its own card's
 * drawn box — `hand-card-<id>`, else the element whose id is `card-<key>` — and the drawn cards
 * against the published keys, per scope.
 */
async function sample(page: Page, ms: number, until?: string): Promise<Worst> {
  return page.evaluate(
    ({ ms, until }) =>
      new Promise<Worst>((done) => {
        type Rect = { x: number; y: number; w: number; h: number; rot: number };
        const g = globalThis as { murlanCardRects?: () => Record<string, Rect>; murlanCardFelt?: () => { sx: number; sy: number; s: number } };
        const worst: Worst = { frames: 0, scopes: [], centre: 0, size: 0, rot: 0, worstAt: "", badFrames: 0, counts: [], moved: 0 };
        const seen = new Set<string>();
        const restAt = new Map<string, { x: number; y: number }>();
        const shown = (el: Element) => {
          for (let n: Element | null = el; n; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.display === "none" || Number(s.opacity) === 0) return false;
          }
          return true;
        };
        const ownerOf = (key: string) =>
          (key.startsWith("hand:") && document.querySelector(`[data-testid="hand-card-${key.slice(5)}"]`)) || document.getElementById(`card-${key}`);
        const boxOf = (owner: Element) =>
          [...owner.querySelectorAll('[data-testid="card-box"], [data-testid="card-box-back"]')].find(shown) as HTMLElement | undefined;
        const corners = (box: HTMLElement) => {
          const b = box as HTMLElement & { probes?: HTMLElement[] };
          const s = getComputedStyle(b);
          const [bl, bt] = [s.borderLeftWidth, s.borderTopWidth];
          const [br, bb] = [s.borderRightWidth, s.borderBottomWidth];
          b.probes ??= [
            [`-${bl}`, `-${bt}`],
            [`calc(100% + ${br})`, `-${bt}`],
            [`-${bl}`, `calc(100% + ${bb})`],
            [`calc(100% + ${br})`, `calc(100% + ${bb})`],
          ].map(([left, top]) => {
            const p = document.createElement("div");
            p.style.cssText = `position:absolute;left:${left};top:${top};width:0;height:0;pointer-events:none`;
            b.appendChild(p);
            return p;
          });
          return b.probes.map((p) => {
            const r = p.getBoundingClientRect();
            return { x: r.left, y: r.top };
          });
        };
        const drawnKeys = () => {
          const keys = [...document.querySelectorAll('[data-testid^="hand-card-"]')]
            .filter(shown)
            .map((el) => `hand:${el.getAttribute("data-testid")!.slice("hand-card-".length)}`);
          for (const el of document.querySelectorAll('[id^="card-"]')) if (shown(el) && boxOf(el)) keys.push(el.id.slice(5));
          return new Set(keys);
        };
        const t0 = performance.now();
        const frame = () => {
          const rects = g.murlanCardRects?.() ?? {};
          const felt = g.murlanCardFelt?.() ?? { sx: 1, sy: 1, s: 1 };
          const drawn = drawnKeys();
          for (const key of Object.keys(rects)) seen.add(key.split(":")[0]);
          const missing = [...drawn].filter((k) => !(k in rects));
          const extra = Object.keys(rects).filter((k) => !drawn.has(k));
          if (missing.length + extra.length > 0) worst.counts.push(`missing ${missing.slice(0, 3)} extra ${extra.slice(0, 3)}`);
          let frameOff = 0;
          for (const [key, r] of Object.entries(rects)) {
            const owner = ownerOf(key);
            const box = owner && boxOf(owner);
            if (!box) continue;
            const [tl, tr, bl, br] = corners(box);
            const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            const [left, right, top, bottom] = [mid(tl, bl), mid(tr, br), mid(tl, tr), mid(bl, br)];
            const cx = (tl.x + tr.x + bl.x + br.x) / 4;
            const cy = (tl.y + tr.y + bl.y + br.y) / 4;
            const w = Math.hypot(right.x - left.x, right.y - left.y);
            const h = Math.hypot(bottom.x - top.x, bottom.y - top.y);
            const rot = (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI;
            if (key.startsWith("fan:")) {
              const rest = restAt.get(key) ?? { x: cx, y: cy };
              restAt.set(key, rest);
              worst.moved = Math.max(worst.moved, Math.hypot(cx - rest.x, cy - rest.y));
            }
            const off = [Math.hypot(cx - r.x * felt.sx, cy - r.y * felt.sy), Math.max(Math.abs(w - r.w * felt.s), Math.abs(h - r.h * felt.s)), Math.abs(((((rot - r.rot) % 360) + 540) % 360) - 180)];
            if (Math.max(off[0] - worst.centre, off[1] - worst.size, off[2] - worst.rot) > 0.5) worst.worstAt = `${key} at ${Math.round(performance.now() - t0)}ms: ${off.map((v) => v.toFixed(2)).join(" ")} dx ${(cx - r.x * felt.sx).toFixed(1)} dy ${(cy - r.y * felt.sy).toFixed(1)} drawn ${rot.toFixed(1)} published ${r.rot.toFixed(1)}`;
            frameOff = Math.max(frameOff, ...off);
            [worst.centre, worst.size, worst.rot] = [Math.max(worst.centre, off[0]), Math.max(worst.size, off[1]), Math.max(worst.rot, off[2])];
          }
          if (frameOff > 1) worst.badFrames++;
          worst.frames++;
          const over = performance.now() - t0 > ms || (until !== undefined && worst.frames > 1 && !document.querySelector(until));
          if (over) done({ ...worst, scopes: [...seen].sort(), counts: worst.counts.slice(0, 5) });
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { ms, until }
  );
}

function expectOnTheCards(w: Worst, scopes: string[]) {
  expect(w.counts, "the registry holds exactly the cards drawn").toEqual([]);
  expect(w.scopes, "every owner here published").toEqual(expect.arrayContaining(scopes));
  expect(w.centre, `centre off by ${w.centre.toFixed(2)}pt, worst ${w.worstAt}`).toBeLessThanOrEqual(TOLERANCE);
  expect(w.size, `size off by ${w.size.toFixed(2)}pt, worst ${w.worstAt}`).toBeLessThanOrEqual(TOLERANCE);
  expect(w.rot, `turn off by ${w.rot.toFixed(2)}° (${w.badFrames} of ${w.frames} frames), worst ${w.worstAt}`).toBeLessThanOrEqual(TOLERANCE);
}

const HELD = { holdTurn: true };

/** Four sevens over a single, three cards to spare so the play is a bomb and not the hand's last. */
const bombSave = () =>
  offlineSave({
    seats: 2,
    holding: [
      ["7_hearts", "7_diamonds", "7_clubs", "7_spades", "4_hearts", "5_diamonds", "6_clubs"],
      ["4_spades", "6_spades", "8_spades", "10_spades", "Q_spades"],
    ],
    pile: { cards: ["3_clubs"], by: 1 },
  });

for (const vp of VIEWPORTS) {
  test.describe(`on a ${vp.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "no-preference" });
    });

    test("at rest and through a throw, every hand card, back and played card is where it is drawn", async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      await resumeSaved(page, baseURL!, offlineSave({ seats: 4, hand: 8, turn: 1 }), HELD);
      await settled(page, 3_000, '[data-testid="game-table"]');
      expectOnTheCards(await sample(page, 500), ["fan", "hand"]);

      await page.evaluate(() => (globalThis as unknown as { murlanBotMove: () => void }).murlanBotMove());
      await page.locator('[data-testid="flying-cards"]').waitFor({ state: "attached", timeout: 15_000 });
      expectOnTheCards(await sample(page, 3_000, '[data-testid="flying-cards"]'), ["fan", "hand", "pile"]);

      await settled(page, 3_000, '[data-testid="game-table"]');
      expectOnTheCards(await sample(page, 500), ["fan", "hand", "pile"]);
    });

    test("through a bomb's kick and shake, every card is where it is drawn", async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      await resumeSaved(page, baseURL!, bombSave(), HELD);
      await settled(page, 3_000, '[data-testid="game-table"]');
      for (const c of ["7 di Cuori", "7 di Quadri", "7 di Fiori", "7 di Picche"]) {
        await tap(page, page.locator(HAND_ZONE).getByRole("button", { name: c, exact: true }));
      }
      const during = sample(page, 2_600);
      await tap(page, page.getByTestId("btn-gioca"));
      const w = await during;
      expect(w.moved, "the table moved while it was sampled").toBeGreaterThan(3);
      expectOnTheCards(w, ["fan", "hand", "pile"]);
    });

    test("a picked card is where it is drawn through its lift, and publishes its lift and glow", async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      await resumeSaved(page, baseURL!, offlineSave({ seats: 2, hand: 9 }), HELD);
      await settled(page, 3_000, '[data-testid="game-table"]');
      const picked = page.locator('[data-testid^="hand-card-"]').last();
      const id = (await picked.getAttribute("data-testid"))!.slice("hand-card-".length);
      const during = sample(page, 900);
      await tap(page, picked);
      expectOnTheCards(await during, ["fan", "hand"]);
      const rect = await page.evaluate((key) => (globalThis as { murlanCardRects?: () => Record<string, { lift: number; glow: number }> }).murlanCardRects?.()[key], `hand:${id}`);
      expect(rect?.lift, "lifted").toBeGreaterThan(0.95);
      expect(rect?.glow, "glowing").toBeGreaterThan(0.95);
    });

    test("mid-deal, every back in the air is where it is drawn", async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      await resumeSaved(page, baseURL!, offlineSave({ seats: 4, fresh: true }), HELD);
      expectOnTheCards(await sample(page, 4_000), ["deal", "fan", "hand"]);
    });

    test("mid-exchange, both exchanged cards are where they are drawn", async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      await resumeSaved(
        page,
        baseURL!,
        exchangeSave({
          seats: 2,
          winner: 0,
          loser: 1,
          cardFromLoser: "2_spades",
          holding: [["5_hearts", "K_spades", "2_spades"], ["J_hearts", "Q_diamonds"]],
        }),
        HELD
      );
      expectOnTheCards(await sample(page, 4_000), ["fan", "hand", "leg"]);
    });
  });
}

test("on a 4:3 tablet, Tab onto a card the scrolled hand clips pans the row to it, and its rect follows", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await resumeSaved(page, baseURL!, offlineSave({ seats: 2 }), HELD);
  await settled(page, 3_000, '[data-testid="game-table"]');
  // Measured about the centre at the unturned width: a tilted card's bounding box outgrows what the row can show.
  const hand = () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>('[data-testid^="hand-card-"]')];
      let win = cards[0]?.parentElement ?? null;
      while (win && getComputedStyle(win).overflowX !== "clip") win = win.parentElement;
      const w = win?.getBoundingClientRect();
      const out = (el: HTMLElement) => {
        const c = el.getBoundingClientRect();
        const [mid, half] = [(c.left + c.right) / 2, el.offsetWidth / 2];
        return w ? Math.max(0, w.left - (mid - half), mid + half - w.right) : 0;
      };
      const focused = document.activeElement?.closest<HTMLElement>('[data-testid^="hand-card-"]');
      return {
        clipped: cards.filter((el) => out(el) > 1).map((el) => el.getAttribute("data-testid")!),
        focused: focused?.getAttribute("data-testid") ?? null,
        focusedOut: focused ? out(focused) : 0,
      };
    });
  const before = (await hand()).clipped;
  expect(before.length, "a full hand overflows its window here").toBeGreaterThan(1);
  const reached: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const { focused } = await hand();
    if (!focused && reached.length > 0) break;
    if (!focused || !before.includes(focused) || reached.includes(focused)) continue;
    reached.push(focused);
    await expect.poll(async () => (await hand()).focusedOut, { message: `${focused} is still outside its window by`, timeout: 2_000 }).toBeLessThanOrEqual(1);
    expectOnTheCards(await sample(page, 200), ["fan", "hand"]);
  }
  expect(reached, "Tab reached every card the window hid, at both ends").toEqual(before);
});

test("on a 4:3 tablet, a mouse press on the scrolled hand's clipped edge card leaves the row where it is", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await resumeSaved(page, baseURL!, offlineSave({ seats: 2 }), HELD);
  await settled(page, 3_000, '[data-testid="game-table"]');
  const row = () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>('[data-testid^="hand-card-"]')];
      let win = cards[0]?.parentElement ?? null;
      while (win && getComputedStyle(win).overflowX !== "clip") win = win.parentElement;
      const edge = cards.at(-1)!.getBoundingClientRect();
      return {
        firstLeft: cards[0].offsetLeft + cards[0].parentElement!.getBoundingClientRect().left,
        winRight: win!.getBoundingClientRect().right,
        edgeRight: edge.right,
        edgeMidY: (edge.top + edge.bottom) / 2,
        focused: document.activeElement?.closest('[data-testid^="hand-card-"]')?.getAttribute("data-testid") ?? null,
      };
    });
  const before = await row();
  expect(before.edgeRight - before.winRight, "the edge card is clipped").toBeGreaterThan(10);
  await tapPoint(page, before.winRight - 8, before.edgeMidY);
  await expect.poll(async () => (await row()).focused, { message: "the press focused a hand card" }).not.toBeNull();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const after = await row();
  expect(Math.abs(after.firstLeft - before.firstLeft), "the row moved under a press").toBeLessThanOrEqual(0.5);
});

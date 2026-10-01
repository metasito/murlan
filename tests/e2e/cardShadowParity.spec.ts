// tests/e2e/cardShadowParity.spec.ts — the felt draws a card's shadow as the Lantern Table's `.card`
// would for the same card under the same light, and no card view keeps one of its own once Skia has
// drawn (#1259 plan 4, task 12). The same cards are laid on the mockup's stage, its `--shx`/`--shy`
// set from the app's lamp; each side's shadow is what turning it off gives back.
import { test, expect, type Page } from "@playwright/test";
import { CANVASKIT_ROUTE, FIXTURE, fitFrame, sideContext } from "./helpers/mockupParity";
import { SHADOW_PATHS } from "../../components/table/cardShadows";
import { openCaptureState } from "./helpers/offlineSeed";
import { feltPixels, skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import type { CardRect, CardRects, Felt } from "../../components/table/cardRects";
import { CAPTURE_STATES } from "../../lib/captureStates";
import { Colors } from "../../lib/tokens";
import type { TraceFrame } from "../../lib/e2eTrace";

const PILE_STATE = CAPTURE_STATES.find((s) => s.id === "pile-right")!;
const REACH = 16;
/** Past the mockup's lip, `0 1.5px 0`, which turning its shadow off takes with it. */
const LIP = 2;
const SHADED = 0.05;
const MEAN_GAP = 0.04;
/** Where the shadows are laid on each other; a centroid cannot, as CSS darkens the overlaps (below). */
const SHIFT = 4;
const STEP = 0.25;
/** Where two cards' shadows overlap: CSS stacks one per card, the felt draws each kind's union once. */
const WORST_GAP = 0.3;

type Point = { x: number; y: number };
type Shot = { width: number; height: number; data: Uint8Array | Buffer; perPt: number; origin: Point };

/** `--shx`/`--shy` as the mockup's own script sets them, for this pile and light in design points. */
function mockupFall(pile: Point, light: Point): Point {
  const line = fs.readFileSync(fileURLToPath(FIXTURE), "utf8").split("\n").find((l) => l.startsWith("  stage.style.setProperty('--shx'"))!;
  const [, shx, shy] = /'--shx',\((.+?)\)\.toFixed\(1\)\+'px'\);stage\.style\.setProperty\('--shy',\((.+?)\)\.toFixed/.exec(line)!;
  const run = (expr: string) => vm.runInNewContext(expr, { PILE: [pile.x, pile.y], lx: light.x, ly: light.y }) as number;
  return { x: run(shx), y: run(shy) };
}

function inside(p: Point, r: CardRect, felt: Felt, margin: number): boolean {
  const t = (-r.rot * Math.PI) / 180;
  const dx = p.x - r.x * felt.sx;
  const dy = p.y - r.y * felt.sy;
  return Math.abs(dx * Math.cos(t) - dy * Math.sin(t)) <= (r.w * felt.s) / 2 + margin && Math.abs(dx * Math.sin(t) + dy * Math.cos(t)) <= (r.h * felt.s) / 2 + margin;
}

/** The share of light a shadow takes at `p`, window points, over the 1-point square there. */
function taken(on: Shot, off: Shot, p: Point): number {
  let [lit, dark] = [0, 0];
  const k = on.perPt;
  for (let y = Math.floor((p.y - on.origin.y) * k); y < Math.floor((p.y - on.origin.y + 1) * k); y++) {
    for (let x = Math.floor((p.x - on.origin.x) * k); x < Math.floor((p.x - on.origin.x + 1) * k); x++) {
      const i = (y * on.width + x) * 4;
      for (let c = 0; c < 3; c++) [lit, dark] = [lit + off.data[i + c], dark + on.data[i + c]];
    }
  }
  return 1 - dark / lit;
}

async function pixelsOf(page: Page, selector: string): Promise<Shot> {
  const el = page.locator(selector);
  const box = (await el.boundingBox())!;
  const png = (await el.screenshot({ type: "png" })).toString("base64");
  const raw = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const bytes = ctx.getImageData(0, 0, img.width, img.height).data;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { width: img.width, height: img.height, b64: btoa(bin) };
  }, png);
  return { width: raw.width, height: raw.height, data: Buffer.from(raw.b64, "base64"), perPt: raw.width / box.width, origin: { x: 0, y: 0 } };
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function appShadows(page: Page) {
  const shot = async () => {
    const { pixels, perPt, origin } = await feltPixels(page);
    return { ...pixels, perPt, origin };
  };
  const on = await shot();
  await page.evaluate(() => (globalThis as unknown as { murlanCardShadows: (on: boolean) => void }).murlanCardShadows(false));
  await twoFrames(page);
  const off = await shot();
  return { on, off };
}

test("the felt's shadow round the pile is the mockup's, and no card view carries one", async ({ browser, baseURL }, info) => {
  test.setTimeout(5 * 60_000);
  const page = await (await sideContext(browser, baseURL)).newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await skiaOnSoftware(page);
  await openCaptureState(page, baseURL!, PILE_STATE);
  await untilSkiaFelt(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { murlanTrace: { frames: TraceFrame[] } }).murlanTrace.frames.at(-1)?.lamp?.level ?? 0)).toBeGreaterThan(0.99);
  const builds = () => page.evaluate(() => (globalThis as { murlanShadowBuilds?: number }).murlanShadowBuilds ?? 0);
  const rebuiltOverASecond = async () => {
    const from = await builds();
    // fixed wait on purpose: a count staying flat at rest is a claim about elapsed time.
    await page.waitForTimeout(1000);
    return (await builds()) - from;
  };
  expect(await builds(), "every shadow path built for the seeded table").toBeGreaterThanOrEqual(SHADOW_PATHS.length);
  expect(await rebuiltOverASecond(), "shadow paths rebuilt over a second at rest").toBe(0);
  const resting = await builds();
  const held = page.locator('[data-testid^="hand-card-"]').filter({ visible: true }).last();
  await held.click();
  await expect.poll(builds, { message: "a card that moves rebuilds the shadow paths" }).toBeGreaterThan(resting);
  await held.click();
  await expect.poll(rebuiltOverASecond, { message: "shadow paths rebuilt over a second once the cards rest again" }).toBe(0);

  const shadowed = await page.evaluate((glow) => {
    const scopes = document.querySelectorAll('[id^="card-"], [data-testid^="hand-card-"]');
    const views = new Set([...scopes].flatMap((r) => [r, ...r.querySelectorAll("*")]));
    const cast = [...views].map((v) => getComputedStyle(v).boxShadow).filter((s) => s !== "none");
    return { scopes: scopes.length, views: views.size, glows: cast.filter((s) => s.startsWith(glow)).length, cast: cast.filter((s) => !s.startsWith(glow)) };
  }, `rgba(${[1, 3, 5].map((i) => parseInt(Colors.gold.slice(i, i + 2), 16)).join(", ")}`);
  expect(shadowed.scopes).toBeGreaterThan(0);
  expect(shadowed.cast, `platform shadows among the ${shadowed.views} views of the table's cards, the ${shadowed.glows} gold glows aside (task 13's)`).toEqual([]);

  const [rects, felt, anchor] = await page.evaluate(() => {
    const e2e = globalThis as unknown as { murlanCardRects: () => CardRects; murlanCardFelt: () => Felt; murlanCardPile: () => Point };
    return [e2e.murlanCardRects(), e2e.murlanCardFelt(), e2e.murlanCardPile()] as const;
  });
  const pile = Object.entries(rects).filter(([k]) => k.startsWith("pile:")).map(([, r]) => r);
  expect(pile.length, "the seeded pile").toBeGreaterThan(0);
  const lamp = (await page.evaluate(() => (window as unknown as { murlanTrace: { frames: TraceFrame[] } }).murlanTrace.frames.at(-1)!.lamp))!;
  const fall = mockupFall({ x: anchor.x / felt.sx, y: anchor.y / felt.sy }, { x: lamp.x / felt.sx, y: lamp.y / felt.sy });
  const app = await appShadows(page);
  await page.context().close();

  const mock = await (await sideContext(browser)).newPage();
  await mock.goto(FIXTURE);
  await fitFrame(mock);
  await mock.evaluate(() => (window as unknown as { T: { go(c: string, t: number): void } }).T.go("rest", 0));
  await mock.addStyleTag({
    content: `#lit > *, #fly, #fx, #hud, #top, #dim, #flash { visibility: hidden !important; }
      #stage { --shx: ${fall.x}px !important; --shy: ${fall.y}px !important; }
      .probe.off { box-shadow: none !important; }`,
  });
  await mock.evaluate(
    ([pile, felt]) => {
      for (const r of pile) {
        const d = document.createElement("div");
        const [w, h] = [r.w, r.h];
        d.className = "card probe";
        Object.assign(d.style, { left: `${r.x * felt.sx - w / 2}px`, top: `${r.y * felt.sy - h / 2}px`, width: `${w}px`, height: `${h}px`, borderRadius: `${w * 0.05}px`, transform: `rotate(${r.rot}deg) scale(${felt.s})` });
        document.getElementById("world")!.insertBefore(d, document.getElementById("shade"));
      }
    },
    [pile, felt] as const
  );
  await twoFrames(mock);
  const mockOn = await pixelsOf(mock, "#frame");
  await mock.evaluate(() => document.querySelectorAll(".probe").forEach((p) => p.classList.add("off")));
  await twoFrames(mock);
  const mockOff = await pixelsOf(mock, "#frame");
  await mock.context().close();

  const xs = pile.flatMap((r) => [r.x * felt.sx - (r.w * felt.s) / 2, r.x * felt.sx + (r.w * felt.s) / 2]);
  const ys = pile.flatMap((r) => [r.y * felt.sy - (r.h * felt.s) / 2, r.y * felt.sy + (r.h * felt.s) / 2]);
  const [x0, y0] = [Math.min(...xs) - REACH, Math.min(...ys) - REACH];
  const gaps: { at: Point; i: number; j: number; app: number; mockup: number }[] = [];
  const mockAt = new Map<string, number>();
  for (let j = 0; y0 + j < Math.max(...ys) + REACH; j++) {
    for (let i = 0; x0 + i < Math.max(...xs) + REACH; i++) {
      const at = { x: x0 + i, y: y0 + j };
      if (pile.some((r) => inside(at, r, felt, LIP))) continue;
      const g = { at, i, j, app: taken(app.on, app.off, at), mockup: taken(mockOn, mockOff, at) };
      gaps.push(g);
      mockAt.set(`${i},${j}`, g.mockup);
    }
  }
  const mockupNear = (x: number, y: number) => {
    const [i, j] = [Math.floor(x), Math.floor(y)];
    const [u, v] = [x - i, y - j];
    const c = [mockAt.get(`${i},${j}`), mockAt.get(`${i + 1},${j}`), mockAt.get(`${i},${j + 1}`), mockAt.get(`${i + 1},${j + 1}`)];
    if (c.some((m) => m === undefined)) return undefined;
    const [a, b, d, e] = c as number[];
    return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
  };
  const castsOver = (p: Point) => pile.filter((r) => inside({ x: p.x - fall.x * felt.s, y: p.y - fall.y * felt.s }, r, felt, REACH)).length;
  const single = gaps.filter((g) => castsOver(g.at) === 1);
  const gapWhenShifted = (dx: number, dy: number) => {
    const d = single.flatMap((g) => {
      const m = mockupNear(g.i + dx, g.j + dy);
      return m === undefined || Math.max(g.app, m) <= SHADED ? [] : [Math.abs(g.app - m)];
    });
    return d.reduce((s, v) => s + v, 0) / d.length;
  };
  let best = { dx: 0, dy: 0, gap: Infinity };
  for (let dx = -SHIFT; dx <= SHIFT; dx += STEP) {
    for (let dy = -SHIFT; dy <= SHIFT; dy += STEP) {
      const gap = gapWhenShifted(dx, dy);
      if (gap < best.gap) best = { dx, dy, gap };
    }
  }
  const shaded = gaps.filter((g) => Math.max(g.app, g.mockup) > SHADED);
  const diffs = shaded.map((g) => Math.abs(g.app - g.mockup));
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const worst = shaded[diffs.indexOf(Math.max(...diffs))];
  await info.attach("card-shadow-parity.json", { body: JSON.stringify({ fall, pile, mean, worst, best, gaps }), contentType: "application/json" });
  console.log(`card shadow parity: ${shaded.length} shaded points, mean gap ${mean.toFixed(3)}, worst ${JSON.stringify(worst)}, best shift ${JSON.stringify(best)} over ${single.length} points under one card's cast`);
  expect(Math.max(...gaps.map((g) => g.mockup)), "the mockup's shadow reaches the sampled felt").toBeGreaterThan(0.2);
  expect(mean).toBeLessThanOrEqual(MEAN_GAP);
  expect(Math.abs(worst.app - worst.mockup)).toBeLessThanOrEqual(WORST_GAP);
  expect(Math.max(Math.abs(best.dx), Math.abs(best.dy)), "the shift that best lays the app's shadow on the mockup's, in points").toBeLessThanOrEqual(0.5);
});

test("before Skia has drawn, a card view keeps its own shadow, and drops it once Skia has", async ({ browser, baseURL }) => {
  test.setTimeout(5 * 60_000);
  const page = await (await sideContext(browser, baseURL)).newPage();
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(CANVASKIT_ROUTE, async (route) => {
    await held;
    await route.continue();
  });
  await skiaOnSoftware(page);
  await openCaptureState(page, baseURL!, PILE_STATE);
  const shadow = () => page.locator('[data-testid="card-box"]').first().evaluate((n) => getComputedStyle(n).boxShadow);
  await expect.poll(shadow).not.toBe("none");
  release();
  await untilSkiaFelt(page);
  await expect.poll(shadow).toBe("none");
  await page.context().close();
});

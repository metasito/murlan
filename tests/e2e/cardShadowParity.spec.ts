// tests/e2e/cardShadowParity.spec.ts — the felt draws a card's shadow as the Lantern Table's `.card`
// would for the same card under the same light, and no card view keeps one of its own once Skia has
// drawn (#1259 plan 4, task 12). The same cards are laid on the mockup's stage, its `--shx`/`--shy`
// set from the app's lamp; each side's shadow is what turning it off gives back.
import { test, expect, type Page } from "@playwright/test";
import { CANVASKIT_ROUTE, FIXTURE, fitFrame, sideContext } from "./helpers/mockupParity";
import { openCaptureState } from "./helpers/offlineSeed";
import { feltPixels, skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { castOffset } from "../../components/table/cardShadows";
import type { CardRect, CardRects, Felt } from "../../components/table/cardRects";
import { CAPTURE_STATES } from "../../lib/captureStates";
import type { TraceFrame } from "../../lib/e2eTrace";

const PILE_STATE = CAPTURE_STATES.find((s) => s.id === "pile-right")!;
const REACH = 16;
/** Past the mockup's lip, `0 1.5px 0`, which turning its shadow off takes with it. */
const LIP = 2;
const MEAN_GAP = 0.03;
/** Where two cards' shadows overlap: CSS stacks one per card, the felt draws each kind's union once. */
const WORST_GAP = 0.3;

type Point = { x: number; y: number };
type Shot = { width: number; height: number; data: Uint8Array | Buffer; perPt: number; origin: Point };

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

  const shadowed = await page.evaluate(() => {
    const roots = [
      ...[...document.querySelectorAll('[data-testid="card-box"]')].map((n) => n.parentElement!.parentElement!),
      ...[...document.querySelectorAll('[data-testid="card-box-back"]')].map((n) => n.parentElement!),
    ];
    const views = roots.flatMap((r) => [r, ...r.querySelectorAll("*")]);
    return { views: views.length, shadowed: views.filter((v) => getComputedStyle(v).boxShadow !== "none").length };
  });
  expect(shadowed.views).toBeGreaterThan(0);
  expect(shadowed.shadowed, "card views with a box-shadow of their own").toBe(0);

  const [rects, felt] = await page.evaluate(() => {
    const e2e = globalThis as unknown as { murlanCardRects: () => CardRects; murlanCardFelt: () => Felt };
    return [e2e.murlanCardRects(), e2e.murlanCardFelt()] as const;
  });
  const pile = Object.entries(rects).filter(([k]) => k.startsWith("pile:")).map(([, r]) => r);
  expect(pile.length, "the seeded pile").toBeGreaterThan(0);
  const lamp = (await page.evaluate(() => (window as unknown as { murlanTrace: { frames: TraceFrame[] } }).murlanTrace.frames.at(-1)!.lamp))!;
  const anchor = await page.getByTestId("pile-area").boundingBox();
  const fall = castOffset({ x: (anchor!.x + anchor!.width / 2) / felt.sx, y: (anchor!.y + anchor!.height / 2) / felt.sy }, { x: lamp.x / felt.sx, y: lamp.y / felt.sy });
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
        const [w, h] = [r.w * felt.s, r.h * felt.s];
        d.className = "card probe";
        Object.assign(d.style, { left: `${r.x * felt.sx - w / 2}px`, top: `${r.y * felt.sy - h / 2}px`, width: `${w}px`, height: `${h}px`, borderRadius: `${w * 0.05}px`, transform: `rotate(${r.rot}deg)` });
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
  const gaps: { at: Point; app: number; mockup: number }[] = [];
  for (let y = Math.min(...ys) - REACH; y < Math.max(...ys) + REACH; y += 2) {
    for (let x = Math.min(...xs) - REACH; x < Math.max(...xs) + REACH; x += 2) {
      const at = { x, y };
      if (pile.some((r) => inside(at, r, felt, LIP))) continue;
      gaps.push({ at, app: taken(app.on, app.off, at), mockup: taken(mockOn, mockOff, at) });
    }
  }
  const diffs = gaps.map((g) => Math.abs(g.app - g.mockup));
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const worst = gaps[diffs.indexOf(Math.max(...diffs))];
  await info.attach("card-shadow-parity.json", { body: JSON.stringify({ fall, mean, worst, gaps }), contentType: "application/json" });
  console.log(`card shadow parity: ${gaps.length} points, mean gap ${mean.toFixed(3)}, worst ${JSON.stringify(worst)}`);
  expect(Math.max(...gaps.map((g) => g.mockup)), "the mockup's shadow reaches the sampled felt").toBeGreaterThan(0.2);
  expect(mean).toBeLessThanOrEqual(MEAN_GAP);
  expect(Math.abs(worst.app - worst.mockup)).toBeLessThanOrEqual(WORST_GAP);
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

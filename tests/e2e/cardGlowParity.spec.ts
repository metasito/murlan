// tests/e2e/cardGlowParity.spec.ts — the felt glows gold under a selected hand card as design gate G1's
// mockup glows under the same card (#1259 plan 4, task 13). The card is laid on the mockup's stage
// where the app drew it; each side's glow is what turning it off gives back, the card shadows off.
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fitFrame, sideContext } from "./helpers/mockupParity";
import { TABLE } from "./helpers/parityRegions";
import { openCaptureState } from "./helpers/offlineSeed";
import { tap } from "./helpers/press";
import { feltPixels, rgbaOf, skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import type { CardRect, CardRects, Felt } from "../../components/table/cardRects";
import { CAPTURE_STATES } from "../../lib/captureStates";
import { CardGlow } from "../../lib/tokens";
import type { TraceFrame } from "../../lib/e2eTrace";

const FIXTURE = pathToFileURL(path.resolve(__dirname, "fixtures", "card-glow", "index.html")).href;
const PILE_STATE = CAPTURE_STATES.find((s) => s.id === "pile-right")!;
const REACH = 30;
const LIT = 0.03;
/** Measured 0.007 and 0.021 here. */
const MEAN_GAP = 0.02;
const WORST_GAP = 0.08;
const PEAK = 0.5;

type Point = { x: number; y: number };
type Shot = { width: number; height: number; data: Uint8Array | Buffer; perPt: number; origin: Point };
const GOLD = [1, 3, 5].map((i) => parseInt(CardGlow.color.slice(i, i + 2), 16));

/** How much of the way to the glow's gold the light at `p` went, over the 1-point square there. */
function lit(on: Shot, off: Shot, p: Point): number {
  let [gave, room] = [0, 0];
  const k = on.perPt;
  for (let y = Math.floor((p.y - on.origin.y) * k); y < Math.floor((p.y - on.origin.y + 1) * k); y++) {
    for (let x = Math.floor((p.x - on.origin.x) * k); x < Math.floor((p.x - on.origin.x + 1) * k); x++) {
      const i = (y * on.width + x) * 4;
      for (let c = 0; c < 3; c++) [gave, room] = [gave + on.data[i + c] - off.data[i + c], room + GOLD[c] - off.data[i + c]];
    }
  }
  return gave / room;
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const rectsOf = (page: Page) => page.evaluate(() => (globalThis as unknown as { murlanCardRects: () => CardRects }).murlanCardRects());

async function frameShot(page: Page): Promise<Shot> {
  const frame = page.locator("#frame");
  const box = (await frame.boundingBox())!;
  const raw = await rgbaOf(page, await frame.screenshot({ type: "png" }));
  return { ...raw, perPt: raw.width / box.width, origin: { x: 0, y: 0 } };
}

test("the felt's gold glow under a selected card is G1's", async ({ browser, baseURL }, info) => {
  test.setTimeout(5 * 60_000);
  const page = await (await sideContext(browser, baseURL)).newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await skiaOnSoftware(page);
  await openCaptureState(page, baseURL!, PILE_STATE);
  await untilSkiaFelt(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { murlanTrace: { frames: TraceFrame[] } }).murlanTrace.frames.at(-1)?.lamp?.level ?? 0)).toBeGreaterThan(0.99);
  const hand = page.locator('[data-testid^="hand-card-"]').filter({ visible: true });
  await tap(page, hand.nth(Math.floor((await hand.count()) / 2)).getByRole("button"));
  const glowing = async () => Object.entries(await rectsOf(page)).filter(([k, r]) => k.startsWith("hand:") && r.glow > 0);
  await expect.poll(async () => (await glowing()).map(([, r]) => r.glow), { message: "one card selected, its glow faded in" }).toEqual([1]);
  const [[key, card]] = await glowing();
  expect(card.seen, `${key} whole, inside the row's window`).toBe(1);
  const felt = await page.evaluate(() => (globalThis as unknown as { murlanCardFelt: () => Felt }).murlanCardFelt());

  const e2e = (on: boolean, which: "murlanCardShadows" | "murlanCardGlow") => page.evaluate(([on, which]) => (globalThis as unknown as Record<string, (on: boolean) => void>)[which](on), [on, which] as const);
  await e2e(false, "murlanCardShadows");
  await twoFrames(page);
  const shot = async () => {
    const { pixels, perPt, origin } = await feltPixels(page);
    return { ...pixels, perPt, origin };
  };
  const appOn = await shot();
  await e2e(false, "murlanCardGlow");
  await twoFrames(page);
  const appOff = await shot();
  await page.context().close();

  const mock = await (await sideContext(browser)).newPage();
  await mock.goto(FIXTURE);
  await fitFrame(mock);
  await mock.evaluate(() => (window as unknown as { T: { go(c: string, t: number): void } }).T.go("glow", 0));
  await mock.addStyleTag({
    content: `#lit > *, #fly, #fx, #hud, #top, #dim, #flash { visibility: hidden !important; }
      .probe { translate: none !important; }
      .glow-off #glow { visibility: hidden; }`,
  });
  const placed = await mock.evaluate(
    ([r, felt]: readonly [CardRect, Felt]) => {
      document.querySelectorAll("#pile .card, #hand .card").forEach((c) => c.remove());
      const [w, h] = [r.w * felt.s, r.h * felt.s];
      const probe = Object.assign(document.createElement("div"), { className: "card probe", _w: w, _h: h });
      Object.assign(probe.style, { position: "fixed", left: `${r.x * felt.sx - w / 2}px`, top: `${r.y * felt.sy - h / 2}px`, width: `${w}px`, height: `${h}px`, transform: `rotate(${r.rot}deg)` });
      document.getElementById("pile")!.appendChild(probe);
      const [b, f] = [probe.getBoundingClientRect(), document.getElementById("stage")!.getBoundingClientRect()];
      return { x: b.left + b.width / 2 - f.left, y: b.top + b.height / 2 - f.top };
    },
    [card, felt] as const
  );
  expect(Math.abs(placed.x - card.x * felt.sx) + Math.abs(placed.y - card.y * felt.sy), "the probe's centre on the app's card").toBeLessThan(0.5);
  // The paused chapter's frame loop was seen not to redraw the glow canvas; the mockup's own drawGlow does.
  await mock.evaluate(() => (window as unknown as { drawGlow(dt: number): void }).drawGlow(0));
  const mockOn = await frameShot(mock);
  await mock.evaluate(() => document.body.classList.add("glow-off"));
  await twoFrames(mock);
  const mockOff = await frameShot(mock);
  await mock.context().close();

  const half = Math.hypot(card.w, card.h) * felt.s / 2 + REACH;
  const [cx, cy] = [card.x * felt.sx, card.y * felt.sy];
  const points: { at: Point; app: number; mockup: number }[] = [];
  for (let y = Math.max(0, Math.floor(cy - half)); y < Math.min(TABLE.height, cy + half); y++) {
    for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(TABLE.width, cx + half); x++) {
      const at = { x, y };
      points.push({ at, app: lit(appOn, appOff, at), mockup: lit(mockOn, mockOff, at) });
    }
  }
  const glowed = points.filter((p) => Math.max(p.app, p.mockup) > LIT);
  const gaps = glowed.map((p) => Math.abs(p.app - p.mockup));
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const worst = glowed[gaps.indexOf(Math.max(...gaps))];
  const peak = (k: "app" | "mockup") => Math.max(...points.map((p) => p[k]));
  await info.attach("card-glow-parity.json", { body: JSON.stringify({ card, felt, mean, worst, points }), contentType: "application/json" });
  console.log(`card glow parity: ${glowed.length} lit points, mean gap ${mean.toFixed(3)}, worst ${JSON.stringify(worst)}, peaks app ${peak("app").toFixed(3)} mockup ${peak("mockup").toFixed(3)}, felt ${JSON.stringify(felt)}`);
  expect(peak("mockup"), "the mockup's glow under the card").toBeGreaterThan(PEAK);
  expect(mean).toBeLessThanOrEqual(MEAN_GAP);
  expect(Math.abs(worst.app - worst.mockup)).toBeLessThanOrEqual(WORST_GAP);
});

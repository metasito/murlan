// tests/e2e/glideLight.spec.ts — while the lamp glides the Skia felt shades no cloth: the light is the pool layer the
// compositor moves (components/table/glideLight.ts), so no on-screen draw runs a program that lights the cloth.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { botMove, heldTurnTable, playLowest } from "./helpers/mockupParity";
import { installVirtualClock, stepThen, stepUntil } from "./helpers/virtualClock";
import { STEP_MS } from "./helpers/traceDiff";
import { HAND_CARD_BOXES } from "./helpers/selectors";

const VIEWPORT = { width: 874, height: 402 };
const SEED = 1255;
const WINDOW = 240;
const BOT_MOVES = [60, 120, 180];
/** Every program that lights the cloth from the lamp declares the pool's radius (`feltShader.ts`, UNIFORMS). */
const LIGHTS_CLOTH = "uPoolR";
/** Frames of the window the pool layer must show in: three glides, each a second or more; fewer and the check saw no glide. */
const SHOWN_FLOOR = 60;

interface Frame {
  relit: number;
  pool: boolean;
}

/** Before the first navigation: counts draws to the felt's own framebuffer with a program that lights the cloth. */
async function countRelights(page: Page, marker: string): Promise<void> {
  await page.addInitScript((marker: string) => {
    const sources = new WeakMap<object, string>();
    const lit = new WeakSet<object>();
    const using = new WeakMap<object, object | null>();
    const offscreen = new WeakMap<object, boolean>();
    const w = window as unknown as { murlanRelights: { programs: number; draws: number } };
    w.murlanRelights = { programs: 0, draws: 0 };
    type Gl = WebGLRenderingContext & { canvas: HTMLCanvasElement | OffscreenCanvas };
    const wrap = (proto: object | undefined, name: string, before: (self: Gl, args: unknown[]) => void) => {
      if (!proto) return;
      const original = (proto as Record<string, (...args: unknown[]) => unknown>)[name];
      if (typeof original !== "function") return;
      (proto as Record<string, unknown>)[name] = function (this: Gl, ...args: unknown[]) {
        before(this, args);
        return original.apply(this, args);
      };
    };
    const draw = (self: Gl) => {
      const program = using.get(self);
      if (!program || !lit.has(program) || offscreen.get(self)) return;
      if (self.canvas instanceof HTMLCanvasElement && self.canvas.isConnected && self.canvas.closest('[data-testid="table-felt"]')) w.murlanRelights.draws++;
    };
    for (const gl of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
      const proto = gl?.prototype;
      wrap(proto, "shaderSource", (_, [shader, source]) => sources.set(shader as object, String(source)));
      wrap(proto, "attachShader", (_, [program, shader]) => {
        if (!sources.get(shader as object)?.includes(marker) || lit.has(program as object)) return;
        lit.add(program as object);
        w.murlanRelights.programs++;
      });
      wrap(proto, "useProgram", (self, [program]) => using.set(self, (program as object) ?? null));
      wrap(proto, "bindFramebuffer", (self, [, framebuffer]) => offscreen.set(self, framebuffer !== null));
      wrap(proto, "drawArrays", draw);
      wrap(proto, "drawElements", draw);
    }
  }, marker);
}

const TAKE = `(() => {
  const r = window.murlanRelights;
  const relit = r.draws;
  r.draws = 0;
  const layer = document.querySelector('[data-testid="felt-pool"]');
  const moved = layer && layer.firstElementChild;
  const pool = !!layer && getComputedStyle(layer).display !== "none" && !!moved && Number(getComputedStyle(moved).opacity) > 1 / 512;
  return { relit, pool };
})()`;

test("the gliding lamp's light is the pool layer: no on-screen draw relights the cloth while it shows", async ({ browser, baseURL }) => {
  test.setTimeout(4 * 60_000);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "it-IT", baseURL });
  const page = await context.newPage();
  await installVirtualClock(page, SEED);
  await countRelights(page, LIGHTS_CLOTH);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await heldTurnTable(page, baseURL!);
  await stepUntil(page, () => page.evaluate(() => ((globalThis as { murlanShadowBuilds?: number }).murlanShadowBuilds ?? 0) > 0), "the Skia felt's shadows");
  await stepUntil(page, () => page.locator(HAND_CARD_BOXES).first().isVisible(), "the viewer's hand");
  const programs = await page.evaluate(() => (window as unknown as { murlanRelights: { programs: number } }).murlanRelights.programs);
  expect(programs, `programs whose source names ${LIGHTS_CLOTH}: the marker no longer finds the lighting shader`).toBeGreaterThan(0);

  await playLowest(1)(page);
  await stepThen(page, null, TAKE);
  const frames: Frame[] = [];
  for (let i = 1; i <= WINDOW; i++) {
    frames.push(await stepThen<Frame>(page, STEP_MS, TAKE));
    if (BOT_MOVES.includes(i)) await botMove(page);
  }
  const shown = frames.filter((f) => f.pool);
  const relitWhileShown = shown.reduce((n, f) => n + f.relit, 0);
  console.log(`glide light: ${JSON.stringify({ programs, shown: shown.length, relitWhileShown, relitOutside: frames.reduce((n, f) => n + (f.pool ? 0 : f.relit), 0) })}`);
  expect(shown.length, "frames the pool layer showed while the lamp glided to each bot").toBeGreaterThanOrEqual(SHOWN_FLOOR);
  expect(relitWhileShown, "on-screen draws that lit the cloth while the pool layer showed").toBe(0);
  await context.close();
});

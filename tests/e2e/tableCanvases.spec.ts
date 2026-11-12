// tests/e2e/tableCanvases.spec.ts — the Skia table holds one WebGL context, the felt's: each one more is
// a full-viewport redraw a frame (#1988 item 8). No other canvas lies over the table to draw the cards'
// contacts, under any name or renderer; which view draws each contact is `cardContact.ts`'s `contactOnFelt`.
import { test, expect } from "./fixtures";
import { offlineSave, resumeSaved } from "./helpers/offlineSeed";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { legalGioca } from "./helpers/bot.ts";
import { tap } from "./helpers/press";
import { HAND_CARD_BOXES } from "./helpers/selectors.ts";

/** Every canvas in the document, named by the view it lies in: the felt, its end-B layer and the motes. */
const CANVASES = ["felt-end-b", "particles", "table-felt"];

type Live = { felt: number; elsewhere: string[]; opened: number; offscreen: number; canvases: string[] };

test("the Skia table draws on one WebGL context, the felt's, and a play in flight opens no other", async ({ page, baseURL }) => {
  test.setTimeout(3 * 60_000);
  await skiaOnSoftware(page);
  await page.addInitScript(() => {
    const gl = new Set<HTMLCanvasElement>();
    const contexts = new Set<unknown>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      const ctx = (getContext as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(this, id, ...rest);
      if (ctx && /^(webgl2?|experimental-webgl)$/.test(id)) {
        gl.add(this);
        contexts.add(ctx);
      }
      return ctx;
    } as typeof getContext;
    let offscreen = 0;
    if (typeof OffscreenCanvas !== "undefined") {
      const offscreenContext = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function (this: OffscreenCanvas, id: string, ...rest: unknown[]) {
        const ctx = (offscreenContext as (this: OffscreenCanvas, ...a: unknown[]) => unknown).call(this, id, ...rest);
        if (ctx && /^webgl2?$/.test(id)) offscreen++;
        return ctx;
      } as typeof offscreenContext;
    }
    (window as unknown as { murlanGlCanvases: () => Live }).murlanGlCanvases = () => {
      const inFelt = (c: HTMLCanvasElement) => !!c.closest('[data-testid="table-felt"]');
      const live = [...gl].filter((c) => c.isConnected);
      const name = (c: HTMLCanvasElement) => c.closest("[data-testid]")?.getAttribute("data-testid") ?? "(no testid)";
      const canvases = [...document.querySelectorAll("canvas")].map(name).sort();
      return { felt: live.filter(inFelt).length, elsewhere: live.filter((c) => !inFelt(c)).map(name), opened: contexts.size, offscreen, canvases };
    };
  });
  await resumeSaved(page, baseURL!, offlineSave({ seats: 2 }));
  await untilSkiaFelt(page);
  const live = () => page.evaluate(() => (window as unknown as { murlanGlCanvases: () => Live }).murlanGlCanvases());

  const rest = await live();
  expect({ felt: rest.felt, elsewhere: rest.elsewhere }).toEqual({ felt: 1, elsewhere: [] });
  expect(rest.canvases, "every canvas in the document, of any renderer").toEqual(CANVASES);
  await tap(page, page.locator(HAND_CARD_BOXES).last());
  await tap(page, legalGioca(page));
  await expect(page.getByTestId("flying-card").first()).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId("pile-card").first()).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId("flying-card")).toHaveCount(0, { timeout: 30_000 });
  expect(await live()).toEqual(rest);
});

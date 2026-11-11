// tests/e2e/tableCanvases.spec.ts — the Skia table holds one WebGL context, the felt's: each one more is
// a full-viewport redraw a frame (#1988 item 8), and the cards cast their contacts themselves.
import { test, expect } from "./fixtures";
import { offlineSave, resumeSaved } from "./helpers/offlineSeed";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { legalGioca } from "./helpers/bot.ts";
import { tap } from "./helpers/press";
import { HAND_CARD_BOXES } from "./helpers/selectors.ts";

type Live = { felt: number; elsewhere: string[] };

test("the Skia table draws on one WebGL context, the felt's, before and after a play", async ({ page, baseURL }) => {
  test.setTimeout(3 * 60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await skiaOnSoftware(page);
  await page.addInitScript(() => {
    const gl = new Set<HTMLCanvasElement>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      const ctx = (getContext as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(this, id, ...rest);
      if (ctx && /^(webgl2?|experimental-webgl)$/.test(id)) gl.add(this);
      return ctx;
    } as typeof getContext;
    (window as unknown as { murlanGlCanvases: () => Live }).murlanGlCanvases = () => {
      const live = [...gl].filter((c) => c.isConnected);
      const inFelt = (c: HTMLCanvasElement) => !!c.closest('[data-testid="table-felt"]');
      const name = (c: HTMLCanvasElement) => c.closest("[data-testid]")?.getAttribute("data-testid") ?? "(no testid)";
      return { felt: live.filter(inFelt).length, elsewhere: live.filter((c) => !inFelt(c)).map(name) };
    };
  });
  await resumeSaved(page, baseURL!, offlineSave({ seats: 2 }));
  await untilSkiaFelt(page);
  const live = () => page.evaluate(() => (window as unknown as { murlanGlCanvases: () => Live }).murlanGlCanvases());

  expect(await live()).toEqual({ felt: 1, elsewhere: [] });
  await tap(page, page.locator(HAND_CARD_BOXES).last());
  await tap(page, legalGioca(page));
  await expect(page.getByTestId("pile-card").first()).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId("flying-card")).toHaveCount(0, { timeout: 30_000 });
  expect(await live()).toEqual({ felt: 1, elsewhere: [] });
  await expect(page.getByTestId("card-shade")).toHaveCount(0);
});

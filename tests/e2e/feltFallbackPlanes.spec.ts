// tests/e2e/feltFallbackPlanes.spec.ts — the app's own fallback felt (feltFallback.tsx) on this
// software rasteriser: it bakes the weave's planes once, lights a later aim from them, frees them
// when the table goes, and a size whose bake is refused stays on the one-pass cloth, which the lit
// felt matches to one 8-bit level.
import { test, expect } from "./fixtures";
import type { Browser, Page } from "@playwright/test";
import { offlineSave, resumeSaved } from "./helpers/offlineSeed";
import { settled } from "./helpers/settle";
import { OFFLINE_SAVE_KEY } from "../../lib/storageKeys";

interface Counts {
  created: number;
  deleted: number;
  lit: number;
  shown: number;
}

const FELT = '[data-testid="felt-fallback"]';

function spy(refuse: boolean) {
  const counts = { created: 0, deleted: 0, lit: 0, shown: 0 };
  (window as unknown as { __felt: Counts }).__felt = counts;
  const P = WebGLRenderingContext.prototype;
  const bound = new WeakMap<WebGLRenderingContext, boolean>();
  const { bindFramebuffer, activeTexture, createTexture, deleteTexture, drawArrays, checkFramebufferStatus } = P;
  P.bindFramebuffer = function (target, fbo) {
    bound.set(this, fbo !== null);
    return bindFramebuffer.call(this, target, fbo);
  };
  P.activeTexture = function (unit) {
    if (unit === this.TEXTURE1) counts.lit++;
    return activeTexture.call(this, unit);
  };
  P.createTexture = function () {
    counts.created++;
    return createTexture.call(this);
  };
  P.deleteTexture = function (t) {
    counts.deleted++;
    return deleteTexture.call(this, t);
  };
  P.drawArrays = function (mode, first, count) {
    if (!bound.get(this)) counts.shown++;
    return drawArrays.call(this, mode, first, count);
  };
  P.checkFramebufferStatus = function (target) {
    return refuse ? 0 : checkFramebufferStatus.call(this, target);
  };
}

const counts = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __felt: Counts }).__felt }));

async function table(browser: Browser, baseURL: string, refuse: boolean) {
  const context = await browser.newContext({ viewport: { width: 874, height: 402 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.addInitScript(spy, refuse);
  await resumeSaved(page, baseURL, offlineSave({ seats: 4, hand: 8, turn: 1 }), { holdTurn: true });
  await settled(page, 3_000, '[data-testid="game-table"]');
  await expect.poll(async () => (await counts(page))[refuse ? "deleted" : "created"]).toBe(refuse ? 1 : 2);
  const before = await counts(page);
  await page.evaluate(() => (globalThis as unknown as { murlanBotMove: () => void }).murlanBotMove());
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).gameState.currentTurnIndex, OFFLINE_SAVE_KEY)).toBe(0);
  await expect.poll(async () => (await counts(page)).shown).toBeGreaterThan(before.shown);
  await settled(page, 3_000, '[data-testid="game-table"]');
  return { context, page, before, after: await counts(page) };
}

test("the fallback lights a later aim from planes baked once, frees them, and a refused bake keeps the matching cloth", async ({ browser, baseURL }) => {
  const lit = await table(browser, baseURL!, false);
  expect(lit.before.lit).toBe(0);
  expect(lit.after.lit).toBeGreaterThan(0);
  expect(lit.after).toMatchObject({ created: 2, deleted: 0 });
  const png = await lit.page.locator(FELT).evaluate((cv: HTMLCanvasElement) => cv.toDataURL("image/png"));

  await lit.page.getByRole("button", { name: "Impostazioni" }).click();
  await lit.page.getByRole("button", { name: "Esci dalla partita" }).click();
  await lit.page.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(lit.page.locator(FELT)).toHaveCount(0);
  expect(await counts(lit.page)).toMatchObject({ created: 2, deleted: 2 });
  await lit.context.close();

  const cloth = await table(browser, baseURL!, true);
  expect(cloth.after).toMatchObject({ created: 1, deleted: 1, lit: 0 });
  const diff = await cloth.page.locator(FELT).evaluate(async (cv: HTMLCanvasElement, png) => {
    const image = new Image();
    image.src = png;
    await image.decode();
    const other = document.createElement("canvas");
    other.width = image.width;
    other.height = image.height;
    const c = other.getContext("2d")!;
    c.drawImage(image, 0, 0);
    const a = c.getImageData(0, 0, other.width, other.height).data;
    const b = cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data;
    let max = 0;
    for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
    return { max, same: a.length === b.length, opaque: b[(cv.height >> 1) * cv.width * 4 + (cv.width >> 1) * 4 + 3] };
  }, png);
  expect(diff).toEqual({ max: expect.any(Number), same: true, opaque: 255 });
  expect(diff.max).toBeLessThanOrEqual(1);
  await cloth.context.close();
});

// tests/e2e/seatNameContrast.spec.ts — every bare seat name clears 4.5:1 over the brightest felt
// behind it, in every capture state at every phone (#1259 plan 5 task 13, Q9). Only the name's text
// is hidden to read that felt; the attachment carries every candidate ink's ratio, with and without
// a dark text shadow, which is what chose the ink in components/table/seats.tsx.
import { test, expect, type Page } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { PHONES } from "./helpers/phones";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { CAPTURE_STATES } from "../../lib/captureStates";
import { Colors } from "../../lib/tokens";
import type { TraceFrame } from "../../lib/e2eTrace";

const BODY_MIN = 4.5;
const LAMP_UP = 1 - 1 / 512;
const NAME = '[data-testid="seat-name"]';
const CANDIDATES = { textMuted: Colors.textMuted, textSecondary: Colors.textSecondary, text: Colors.text, textPrimary: Colors.textPrimary, goldLit: Colors.goldLit };
const SHADOW_BLUR = 3;
const SHADOW_ALPHAS = [0.5, 0.7, 0.9];

type Rgba = [number, number, number, number];
type Shot = { width: number; data: number[]; perPt: number; x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const parse = (css: string): Rgba => {
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const [r, g, b, a = 1] = css.match(/[\d.]+/g)!.map(Number);
  return [r, g, b, a];
};
const channel = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const over = ([r, g, b, a]: Rgba, bg: number[]) => [r, g, b].map((c, i) => c * a + bg[i] * (1 - a));
const ratio = (ink: Rgba, bg: number[]) => {
  const [hi, lo] = [luminance(over(ink, bg)), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

async function paint(page: Page, css: string): Promise<void> {
  await page.evaluate(([sel, css]) => {
    const tag = document.getElementById("name-paint") ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: "name-paint" }));
    tag.textContent = css ? `${sel} { ${css} }` : "";
  }, [NAME, css] as const);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function shoot(page: Page, clip: Rect): Promise<Shot> {
  const png = (await page.screenshot({ clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } })).toString("base64");
  const { width, data } = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return { width: img.width, data: [...ctx.getImageData(0, 0, img.width, img.height).data] };
  }, png);
  return { width, data, perPt: width / clip.w, x: clip.x, y: clip.y };
}

/** Each pixel of `rect` in `shot`, as RGB. */
function pixels(shot: Shot, rect: Rect): number[][] {
  const out: number[][] = [];
  const [x0, y0] = [Math.floor((rect.x - shot.x) * shot.perPt), Math.floor((rect.y - shot.y) * shot.perPt)];
  const [x1, y1] = [Math.ceil((rect.x + rect.w - shot.x) * shot.perPt), Math.ceil((rect.y + rect.h - shot.y) * shot.perPt)];
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < Math.min(shot.width, x1); x++) {
      const i = (y * shot.width + x) * 4;
      if (i + 2 < shot.data.length) out.push([shot.data[i], shot.data[i + 1], shot.data[i + 2]]);
    }
  }
  return out;
}

const brightest = (px: number[][]) => px.reduce((best, p) => (luminance(p) > luminance(best) ? p : best), [0, 0, 0]);

async function names(page: Page): Promise<{ box: Rect; ink: string; shadow: string }[]> {
  return page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, ink: cs.color, shadow: cs.textShadow };
    }).filter((n) => n.box.w > 0), NAME);
}

for (const phone of PHONES) {
  test(`${phone.name}: every seat name clears 4.5:1 over the brightest felt behind it`, async ({ page, baseURL }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await skiaOnSoftware(page);
    const report: object[] = [];
    const judged: { what: string; ratio: number }[] = [];
    for (const state of CAPTURE_STATES) {
      await openCaptureState(page, baseURL!, state);
      await expect(page.locator(NAME).first()).toBeVisible({ timeout: 30_000 });
      await untilSkiaFelt(page);
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { murlanTrace: { frames: TraceFrame[] } }).murlanTrace.frames.at(-1)?.lamp?.level ?? 0))
        .toBeGreaterThan(LAMP_UP);
      const shown = await names(page);
      expect(shown.length, `${state.id}: the three opponents are named`).toBe(3);
      const all = shown.map((n) => n.box);
      const pad = SHADOW_BLUR * 2;
      const x = Math.max(0, Math.min(...all.map((b) => b.x)) - pad);
      const y = Math.max(0, Math.min(...all.map((b) => b.y)) - pad);
      const clip = { x, y, w: Math.max(...all.map((b) => b.x + b.w)) + pad - x, h: Math.max(...all.map((b) => b.y + b.h)) + pad - y };

      await paint(page, "color: transparent !important; text-shadow: none !important;");
      const bare = await shoot(page, clip);
      await paint(page, "color: #FFFFFF !important; text-shadow: none !important;");
      const white = await shoot(page, clip);
      const shadowed: Record<number, Shot> = {};
      for (const alpha of SHADOW_ALPHAS) {
        await paint(page, `color: transparent !important; text-shadow: 0 0 ${SHADOW_BLUR}px rgba(0,0,0,${alpha}) !important;`);
        shadowed[alpha] = await shoot(page, clip);
      }
      await paint(page, "color: transparent !important;");
      const own = await shoot(page, clip);
      await paint(page, "");

      for (const name of shown) {
        const felt = pixels(bare, name.box);
        const glyph = pixels(white, name.box).map((p, i) => luminance(p) - luminance(felt[i]) >= 0.5 * (1 - luminance(felt[i])));
        const underGlyphs = (shot: Shot) => brightest(pixels(shot, name.box).filter((_, i) => glyph[i]));
        const behind = brightest(felt);
        report.push({
          state: state.id,
          name: name.box,
          ink: name.ink,
          behind,
          plain: Object.fromEntries(Object.entries(CANDIDATES).map(([token, c]) => [token, +ratio(parse(c), behind).toFixed(2)])),
          shadowed: Object.fromEntries(
            SHADOW_ALPHAS.map((a) => [a, Object.fromEntries(Object.entries(CANDIDATES).map(([token, c]) => [token, +ratio(parse(c), underGlyphs(shadowed[a])).toFixed(2)]))])
          ),
        });
        const backdrop = name.shadow === "none" ? behind : underGlyphs(own);
        judged.push({ what: `${state.id} ${JSON.stringify(name.box)}: ${name.ink} (shadow ${name.shadow}) over rgb(${backdrop})`, ratio: ratio(parse(name.ink), backdrop) });
      }
    }
    await info.attach(`seat-name-contrast-${phone.width}x${phone.height}.json`, { body: JSON.stringify(report, null, 1), contentType: "application/json" });
    console.log(`${phone.name} seat-name-contrast ${JSON.stringify(report)}`);
    expect(judged.length, "every state's three names judged").toBe(CAPTURE_STATES.length * 3);
    for (const { what, ratio } of judged) expect.soft(ratio, what).toBeGreaterThanOrEqual(BODY_MIN);
  });
}

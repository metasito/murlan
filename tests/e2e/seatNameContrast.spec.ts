// tests/e2e/seatNameContrast.spec.ts — every bare seat name clears 4.5:1 over the brightest and the
// darkest felt behind its glyphs, in every capture state at every phone (#1259 plan 5 task 13, Q9). The felt is
// read alone: every other element hidden (the seat's ring, arc and glow with it), the rail masked by
// `feltOnly`, under the glyphs grown by a pixel. The attachment carries every candidate ink's ratio.
import { test, expect, type Page } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { PHONES } from "./helpers/phones";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { feltOnly } from "../../components/table/legibilityRing";
import { CAPTURE_STATES } from "../../lib/captureStates";
import { Colors } from "../../lib/tokens";
import type { TraceFrame } from "../../lib/e2eTrace";

const BODY_MIN = 4.5;
const LAMP_UP = 1 - 1 / 512;
const NAME = '[data-testid="seat-name"]';
const CANDIDATES = { textMuted: Colors.textMuted, textSecondary: Colors.textSecondary, text: Colors.text, textPrimary: Colors.textPrimary, goldLit: Colors.goldLit };
const PAD = 8;

type Rgba = [number, number, number, number];
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
    tag.textContent = `${sel} { ${css} }`;
  }, [NAME, css] as const);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Decoded in the page and kept there under `key`: only the answers come back. */
async function grab(page: Page, key: string, clip: Rect): Promise<void> {
  const png = (await page.screenshot({ clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } })).toString("base64");
  await page.evaluate(async ([key, png]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const w = window as unknown as { shots?: Record<string, ImageData> };
    (w.shots ??= {})[key] = ctx.getImageData(0, 0, img.width, img.height);
  }, [key, png] as const);
}

/** Per name, the brightest and the darkest pixel of each shot under the glyphs (white against clear, grown a pixel) that is felt. */
function feltUnderGlyphs(page: Page, clip: Rect, boxes: Rect[], felt: number[], keys: string[]) {
  return page.evaluate(
    ([clip, boxes, felt, keys]) => {
      const shots = (window as unknown as { shots: Record<string, ImageData> }).shots;
      const { width, height } = shots.clear;
      const perPt = width / clip.w;
      const lum = (d: Uint8ClampedArray, i: number) =>
        [d[i], d[i + 1], d[i + 2]].reduce((sum, c, k) => {
          const v = c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
          return sum + [0.2126, 0.7152, 0.0722][k] * v;
        }, 0);
      return boxes.map((box) => {
        const [x0, y0] = [Math.floor((box.x - clip.x) * perPt), Math.floor((box.y - clip.y) * perPt)];
        const [x1, y1] = [Math.ceil((box.x + box.w - clip.x) * perPt), Math.ceil((box.y + box.h - clip.y) * perPt)];
        const glyph = new Set<number>();
        for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
          for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
            const i = (y * width + x) * 4;
            const bare = lum(shots.clear.data, i);
            if (lum(shots.white.data, i) - bare >= 0.5 * (1 - bare)) glyph.add(y * width + x);
          }
        }
        const grown = new Set<number>();
        for (const p of glyph) {
          const [x, y] = [p % width, Math.floor(p / width)];
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const [gx, gy] = [x + dx, y + dy];
              if (gx >= 0 && gy >= 0 && gx < width && gy < height && felt[gy * width + gx]) grown.add(gy * width + gx);
            }
          }
        }
        return {
          pixels: grown.size,
          ...(["brightest", "darkest"] as const).reduce((out, end) => {
            out[end] = Object.fromEntries(
              keys.map((key) => {
                const d = shots[key].data;
                let best = end === "brightest" ? -1 : 2;
                let rgb = [0, 0, 0];
                for (const p of grown) {
                  const l = lum(d, p * 4);
                  if (end === "brightest" ? l > best : l < best) [best, rgb] = [l, [d[p * 4], d[p * 4 + 1], d[p * 4 + 2]]];
                }
                return [key, rgb];
              })
            );
            return out;
          }, {} as Record<"brightest" | "darkest", Record<string, number[]>>),
        };
      });
    },
    [clip, boxes, felt, keys] as const
  );
}

async function names(page: Page): Promise<{ box: Rect; ink: string; shadow: string; lit: boolean }[]> {
  return page.evaluate((sel) =>
    [...document.querySelectorAll<HTMLElement>(sel)].map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { box: { x: r.left, y: r.top, w: r.width, h: r.height }, ink: cs.color, shadow: cs.textShadow, lit: el.dataset.lit === "true" };
    }).filter((n) => n.box.w > 0), NAME);
}

/** The felt's cloth within `clip`, 1 per pixel, the rail and the room 0 (`feltOnly`'s geometry). */
function clothIn(clip: Rect, felt: Rect, perPt: number): number[] {
  const [fw, fh] = [Math.round(felt.w * perPt), Math.round(felt.h * perPt)];
  const cloth = feltOnly({ width: fw, height: fh, data: new Uint8ClampedArray(fw * fh * 4).fill(255) }, perPt).data;
  const [cw, ch] = [Math.round(clip.w * perPt), Math.round(clip.h * perPt)];
  const out: number[] = [];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const [fx, fy] = [Math.floor(x + (clip.x - felt.x) * perPt), Math.floor(y + (clip.y - felt.y) * perPt)];
      out.push(fx >= 0 && fy >= 0 && fx < fw && fy < fh && cloth[(fy * fw + fx) * 4 + 3] > 0 ? 1 : 0);
    }
  }
  return out;
}

type Judged = { state: string; lit: boolean; pixels: number; ratios: { what: string; ratio: number }[] };

/** Every capture state's names on `phone`, each judged over the brightest and the darkest felt. */
async function measure(page: Page, baseURL: string, phone: (typeof PHONES)[number]): Promise<{ judged: Judged[]; report: object[] }> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: phone.width, height: phone.height });
  await skiaOnSoftware(page);
  const report: object[] = [];
  const judged: Judged[] = [];
  for (const state of CAPTURE_STATES) {
    await openCaptureState(page, baseURL, state);
    await expect(page.locator(NAME).first()).toBeVisible({ timeout: 30_000 });
    await untilSkiaFelt(page);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { murlanTrace: { frames: TraceFrame[] } }).murlanTrace.frames.at(-1)?.lamp?.level ?? 0))
      .toBeGreaterThan(LAMP_UP);
    const shown = await names(page);
    expect(shown.length, `${state.id}: the three opponents are named`).toBe(3);
    const all = shown.map((n) => n.box);
    const x = Math.max(0, Math.min(...all.map((b) => b.x)) - PAD);
    const y = Math.max(0, Math.min(...all.map((b) => b.y)) - PAD);
    const clip = { x, y, w: Math.min(phone.width, Math.ceil(Math.max(...all.map((b) => b.x + b.w)) + PAD)) - x, h: Math.min(phone.height, Math.ceil(Math.max(...all.map((b) => b.y + b.h)) + PAD)) - y };
    const feltBox = (await page.getByTestId("table-felt").boundingBox())!;

    await paint(page, "color: transparent !important; text-shadow: none !important;");
    await grab(page, "clear", clip);
    await paint(page, "color: #FFFFFF !important; text-shadow: none !important;");
    await grab(page, "white", clip);
    await page.getByTestId("table-felt").evaluate((f, sel) => {
      for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
        if (!f.contains(el) && !el.contains(f) && !el.matches(sel)) el.style.visibility = "hidden";
      }
    }, NAME);
    await paint(page, "visibility: visible !important; color: transparent !important; text-shadow: none !important;");
    await grab(page, "bare", clip);
    await paint(page, "visibility: visible !important; color: transparent !important;");
    await grab(page, "own", clip);

    const perPt = (await page.evaluate(() => (window as unknown as { shots: Record<string, ImageData> }).shots.clear.width)) / clip.w;
    const keys = ["bare", "own"];
    const measured = await feltUnderGlyphs(page, clip, all, clothIn(clip, { x: feltBox.x, y: feltBox.y, w: feltBox.width, h: feltBox.height }, perPt), keys);

    shown.forEach((name, i) => {
      const { pixels, brightest, darkest } = measured[i];
      const inks = Object.entries(CANDIDATES);
      report.push({
        phone: phone.name,
        state: state.id,
        lit: name.lit,
        bare: brightest.bare,
        plain: Object.fromEntries(inks.map(([t, c]) => [t, +ratio(parse(c), brightest.bare).toFixed(2)])),
      });
      const key = name.shadow === "none" ? "bare" : "own";
      judged.push({
        state: state.id,
        lit: name.lit,
        pixels,
        ratios: [brightest[key], darkest[key]].map((backdrop) => ({
          what: `${state.id} ${JSON.stringify(name.box)}: ${name.ink} (shadow ${name.shadow}) over rgb(${backdrop})`,
          ratio: ratio(parse(name.ink), backdrop),
        })),
      });
    });
  }
  return { judged, report };
}

const byPhone = new Map<string, Judged[]>();

for (const phone of PHONES) test.describe(phone.name, () => {
  // One measurement serves both tests: serial, so the lit test runs only after the first passed,
  // in the same worker, and a retry measures again from the first.
  test.describe.configure({ mode: "serial" });

  test(`${phone.name}: every unlit seat name clears 4.5:1 over the felt behind it, and each lamp state's lit name is measured`, async ({ page, baseURL }, info) => {
    test.setTimeout(300_000);
    const { judged, report } = await measure(page, baseURL!, phone);
    byPhone.set(phone.name, judged);
    await info.attach(`seat-name-contrast-${phone.width}x${phone.height}.json`, { body: JSON.stringify(report, null, 1), contentType: "application/json" });
    console.log(`${phone.name} seat-name-contrast ${JSON.stringify(report)}`);
    for (const name of judged) expect(name.pixels, `${name.state}: ${name.ratios[0].what} has felt under its glyphs`).toBeGreaterThan(0);
    for (const state of CAPTURE_STATES) {
      const lit = judged.filter((n) => n.state === state.id && n.lit).length;
      expect(lit, `${state.id}: the lamp's seat alone is lit`).toBe(state.side === "bottom" ? 0 : 1);
    }
    const unlit = judged.filter((n) => !n.lit).flatMap((n) => n.ratios);
    expect(unlit.length, "every unlit name judged twice").toBe((CAPTURE_STATES.length * 3 - CAPTURE_STATES.filter((s) => s.side !== "bottom").length) * 2);
    for (const { what, ratio } of unlit) expect.soft(ratio, what).toBeGreaterThanOrEqual(BODY_MIN);
  });

  test(`${phone.name}: the lit seat name clears 4.5:1 over the lamp's pool`, () => {
    // Known short: the lamp's pool is to dim under the name (plan 4's lamp task). This test turns red
    // when it does, which is the signal to remove `.fail`. The counts it relies on are asserted above.
    test.fail();
    for (const { what, ratio } of byPhone.get(phone.name)!.filter((n) => n.lit).flatMap((n) => n.ratios)) expect.soft(ratio, what).toBeGreaterThanOrEqual(BODY_MIN);
  });
});

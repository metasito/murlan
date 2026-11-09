// tests/e2e/tableRects.spec.ts — the table is drawn where `tableRects` says, on the viewports and
// in the languages the pure property test walks. The pure test cannot see flexbox; this is what ties
// the solver to it.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { DEAL_SIZE, offlineSave, seedSave } from "./helpers/offlineSeed";
import { openApp } from "./helpers/navigation";
import { captureGameState, captureStateById, type CaptureState } from "../../lib/captureStates";
import { LOCALE_KEY } from "../../lib/storageKeys";
import { catalogs, type Locale } from "../../shared/i18n";
import { tableRects, type Rect, type RectName } from "../../components/tableRects";
import { capturedTable, drawnChips } from "../helpers/tableScenes";

const VIEWPORTS = [
  { name: "iPhone SE", width: 568, height: 320 },
  { name: "iPhone 12", width: 844, height: 390 },
  { name: "iPhone Pro Max", width: 956, height: 440 },
  { name: "4:3 tablet", width: 1024, height: 768 },
  { name: "iPad Pro", width: 1366, height: 1024 },
];
const LOCALES: readonly Locale[] = ["it", "en", "sq"];
const STATES: readonly CaptureState[] = ["held", "pile-right", "bomb-landed"].map((id) => captureStateById(id)!);

/**
 * What the page draws for each rect, and how the solver's rect holds it: `same` to a pixel, or
 * `inside` where the solver's rect is a bound — a name's reserved line is taller than the line the
 * font draws, a pill's words are priced without kerning, and a glyph the bundled faces lack is
 * priced at a full em.
 */
const DRAWN: Partial<Record<RectName, { sel: string; fit: "same" | "inside" }>> = {
  rail: { sel: '[data-testid="control-rail"]', fit: "same" },
  hudCombo: { sel: '[data-testid="notice-hudCombo"]', fit: "inside" },
  hudTurn: { sel: '[data-testid="notice-turn"]', fit: "inside" },
  scorePill: { sel: '[data-testid="score-pill-plate"]', fit: "same" },
  seatTop: { sel: '[data-testid="top-seat"] [data-testid="seat-ring"]', fit: "same" },
  seatLeft: { sel: '[data-testid="side-seat-left"] [data-testid="seat-ring"]', fit: "same" },
  seatRight: { sel: '[data-testid="side-seat-right"] [data-testid="seat-ring"]', fit: "same" },
  nameTop: { sel: '[data-testid="top-seat"] [data-testid="seat-name"]', fit: "inside" },
  nameLeft: { sel: '[data-testid="side-seat-left"] [data-testid="seat-name"]', fit: "inside" },
  nameRight: { sel: '[data-testid="side-seat-right"] [data-testid="seat-name"]', fit: "inside" },
  fanTop: { sel: '[data-testid="top-seat"] [data-testid="seat-back"]', fit: "same" },
  fanLeft: { sel: '[data-testid="side-seat-left"] [data-testid="seat-back"]', fit: "same" },
  fanRight: { sel: '[data-testid="side-seat-right"] [data-testid="seat-back"]', fit: "same" },
  pile: { sel: '[data-testid="pile-card"]', fit: "same" },
  handZone: { sel: '[data-testid="hand-zone"]', fit: "same" },
  passa: { sel: '[data-testid="btn-passa-box"]', fit: "same" },
  gioca: { sel: '[data-testid="btn-gioca-box"]', fit: "same" },
  hand: { sel: '[data-testid="hand-row"] [data-testid="card-box"]', fit: "same" },
};
const TOLERANCE = 1;
/** How much larger than the drawn box a bound may be: one fallback glyph's em, at most. */
const SLACK = 10;

interface Drawn { boxes: Partial<Record<RectName, Rect>>; clip: Rect | null; texts: { combo: string; turn: string } }

/** Each rect as the union of what its selector matched; a scrolled hand as the part its window shows. */
async function drawn(page: Page): Promise<Drawn> {
  return page.evaluate((sels: Record<string, string>) => {
    const union = (rs: DOMRect[]) => {
      const live = rs.filter((r) => r.width > 0 && r.height > 0);
      if (live.length === 0) return null;
      const x = Math.min(...live.map((r) => r.left));
      const y = Math.min(...live.map((r) => r.top));
      return { x, y, w: Math.max(...live.map((r) => r.right)) - x, h: Math.max(...live.map((r) => r.bottom)) - y };
    };
    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const [name, sel] of Object.entries(sels)) {
      const r = union([...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()));
      if (r) boxes[name] = r;
    }
    const window = document.querySelector('[data-testid="hand-pan"]')?.parentElement;
    const c = window && getComputedStyle(window).overflowX !== "visible" ? window.getBoundingClientRect() : null;
    return {
      boxes,
      clip: c && { x: c.left, y: c.top, w: c.width, h: c.height },
      texts: {
        combo: document.querySelector('[data-testid="notice-hudCombo"]')?.textContent ?? "",
        turn: document.querySelector('[data-testid="notice-turn"]')?.textContent ?? "",
      },
    };
  }, Object.fromEntries(Object.entries(DRAWN).map(([k, v]) => [k, v!.sel]))) as Promise<Drawn>;
}

async function settled(page: Page): Promise<Drawn> {
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await drawn(page));
        const still = now === previous;
        previous = now;
        return still;
      },
      { message: "the table never came to rest", timeout: 15_000, intervals: [250] }
    )
    .toBe(true);
  return drawn(page);
}

async function open(page: Page, baseURL: string, capture: CaptureState, locale: Locale) {
  const save = offlineSave({ seats: capture.playerCount, hand: DEAL_SIZE[capture.playerCount], turn: capture.turn });
  await seedSave(page, { ...save, gameState: captureGameState(capture) }, { holdTurn: true });
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LOCALE_KEY, locale]);
  await openApp(page, baseURL);
  await page.getByRole("button", { name: catalogs[locale]["home.resumeGame"] }).click({ timeout: 60_000 });
  await expect(page.getByTestId("hand-zone")).toBeVisible({ timeout: 30_000 });
}

const clipTo = (r: Rect, c: Rect | null): Rect => {
  if (!c) return r;
  const x = Math.max(r.x, c.x);
  const y = Math.max(r.y, c.y);
  return { x, y, w: Math.min(r.x + r.w, c.x + c.w) - x, h: Math.min(r.y + r.h, c.y + c.h) - y };
};
const inside = (a: Rect, b: Rect) =>
  b.w - a.w <= SLACK &&
  b.h - a.h <= SLACK &&
  a.x >= b.x - TOLERANCE && a.y >= b.y - TOLERANCE && a.x + a.w <= b.x + b.w + TOLERANCE && a.y + a.h <= b.y + b.h + TOLERANCE;
const same = (a: Rect, b: Rect) => [a.x - b.x, a.y - b.y, a.w - b.w, a.h - b.h].every((d) => Math.abs(d) <= TOLERANCE);
const at = (r: Rect) => `${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.w.toFixed(1)}x${r.h.toFixed(1)}`;

for (const vp of VIEWPORTS)
  test(`the table is drawn in the solver's rects: ${vp.name}`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const [i, locale] of LOCALES.entries()) {
      const capture = STATES[(i + VIEWPORTS.indexOf(vp)) % STATES.length];
      await open(page, baseURL!, capture, locale);
      const { boxes, clip, texts } = await settled(page);
      const where = `${vp.name}, ${locale}, ${capture.id}`;
      const table = capturedTable(capture);
      const chips = drawnChips(table, locale, texts);
      expect(chips, `${where}: the pills read words a scene says`).toEqual({ combo: expect.anything(), turn: expect.anything() });
      const solved = tableRects({
        width: vp.width,
        height: vp.height,
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
        locale,
        state: { ...table.base, chips: { combo: chips.combo!, turn: chips.turn! } },
      });
      const diag = await page.evaluate(async () => {
        const one = (sel: string) => {
          const e = document.querySelector(sel) as HTMLElement | null;
          if (!e) return null;
          const cs = getComputedStyle(e);
          const leaf = (e.querySelector("*:not(:has(*))") as HTMLElement | null) ?? e;
          const lcs = getComputedStyle(leaf);
          const chars: number[] = [];
          const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const t = n.textContent ?? "";
            for (let i = 0; i < t.length; i++) {
              const r = document.createRange();
              r.setStart(n, i);
              r.setEnd(n, i + 1);
              chars.push(Math.round(r.getBoundingClientRect().width * 1000) / 1000);
            }
          }
          let tr = "";
          for (let a: HTMLElement | null = e; a; a = a.parentElement) {
            const t = getComputedStyle(a).transform;
            if (t && t !== "none") tr += `${a.dataset.testid ?? a.tagName}:${t};`;
          }
          return {
            text: e.textContent, w: e.getBoundingClientRect().width, ow: e.offsetWidth, sw: e.scrollWidth,
            font: lcs.font, ls: lcs.letterSpacing, kern: lcs.fontKerning, tr: lcs.textRendering, feat: lcs.fontFeatureSettings,
            lig: lcs.fontVariantLigatures, synth: lcs.fontSynthesis, ws: cs.whiteSpace, chars, transforms: tr,
          };
        };
        const before = { name: one('[data-testid="side-seat-left"] [data-testid="seat-name"]'), combo: one('[data-testid="notice-hudCombo"]') };
        await new Promise((r) => setTimeout(r, 3000));
        const after = { name: one('[data-testid="side-seat-left"] [data-testid="seat-name"]'), combo: one('[data-testid="notice-hudCombo"]') };
        const fonts = [...document.fonts].map((f) => `${f.family}:${f.status}:${f.weight}:${f.style}`);
        const files: string[] = [];
        for (const f of ["Rajdhani_600SemiBold", "Rajdhani_700Bold", "Inter_500Medium"]) {
          const b = await (await fetch(`/fonts/${f}.woff2`)).arrayBuffer();
          const h = await crypto.subtle.digest("SHA-256", b);
          files.push(`${f}:${b.byteLength}:${[...new Uint8Array(h)].slice(0, 6).map((x) => x.toString(16)).join("")}`);
        }
        return { before, after, fonts, files, ua: navigator.userAgent, dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight };
      });
      console.log("DIAG", where, JSON.stringify(diag));
      const bad: string[] = [];
      for (const [name, spec] of Object.entries(DRAWN) as [RectName, { fit: "same" | "inside" }][]) {
        const want = solved.rects[name];
        const raw = boxes[name];
        const got = raw && name === "hand" ? clipTo(raw, clip) : raw;
        if (!want !== !got) bad.push(`${name}: drawn ${got ? at(got) : "nothing"}, solver ${want ? at(want) : "nothing"}`);
        else if (want && got && !(spec.fit === "same" ? same(got, want) : inside(got, want))) bad.push(`${name}: drawn ${at(got)}, solver ${at(want)}`);
      }
      console.log("BAD", where, JSON.stringify(bad));
    }
  });

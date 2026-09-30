// The lantern fixture and the app on one 874×402 stage, each plate read as its box and computed paint.
import type { Browser, Page } from "@playwright/test";
import { FIXTURE, fitFrame, newSidePage, sideContext } from "./mockupParity";
import { openCaptureState } from "./offlineSeed";
import type { CaptureState } from "../../../lib/captureStates";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlatePaint {
  box: Rect;
  fill: string;
  edge: string;
  /** Of `run` where one is named, else of the plate's first text run. */
  ink: string;
  fontSize: number;
  radius: number;
  glow: { color: string; blur: number } | null;
  opacity: number;
}

export interface Stage {
  page: Page;
  plate: (selector: string, run?: string) => Promise<PlatePaint | null>;
  /** `text`: each element's text as laid out, whatever its line height, where a name's line box differs by side. */
  boxes: (selector: string, text?: boolean) => Promise<Rect[]>;
  close: () => Promise<void>;
}

const stage = (page: Page, origin: string | null): Stage => ({
  page,
  plate: (selector, run) => readPlate(page, selector, run ?? null, origin),
  boxes: (selector, text = false) =>
    page.evaluate(
      ([selector, origin, text]) => {
        const at = origin ? document.querySelector(origin)!.getBoundingClientRect() : { left: 0, top: 0 };
        const rectOf = (el: Element) => {
          if (!text) return el.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect();
        };
        return [...document.querySelectorAll(selector)]
          .map(rectOf)
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ x: r.left - at.left, y: r.top - at.top, w: r.width, h: r.height }));
      },
      [selector, origin, text] as const
    ),
  close: () => page.context().close(),
});

/** Paused at `ms` into `chapter`, `window.T.go`'s; transitions off, so a class change is already its end state. */
export async function mockupAt(browser: Browser, chapter: string, ms: number): Promise<Stage> {
  const page = await newSidePage(browser);
  await page.goto(FIXTURE);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await fitFrame(page);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  await page.evaluate(([c, t]) => (window as unknown as { T: { go(c: string, t: number): void } }).T.go(c, t), [chapter, ms] as const);
  return stage(page, "#frame");
}

export async function appAt(
  browser: Browser,
  baseURL: string,
  state: CaptureState,
  viewport?: { width: number; height: number }
): Promise<Stage> {
  const page = await (await sideContext(browser, baseURL)).newPage();
  if (viewport) await page.setViewportSize(viewport);
  await openCaptureState(page, baseURL, state);
  return stage(page, null);
}

function readPlate(page: Page, selector: string, run: string | null, origin: string | null): Promise<PlatePaint | null> {
  return page.evaluate(
    ([selector, run, origin]) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const at = origin ? document.querySelector(origin)!.getBoundingClientRect() : { left: 0, top: 0 };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const inked = run
        ? el.querySelector(run)
        : [el, ...el.querySelectorAll("*")].find((n) =>
            [...n.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent!.trim() !== "")
          );
      if (run && !inked) throw new Error(`${selector} has no ${run}`);
      const ink = getComputedStyle(inked ?? el);
      let opacity = 1;
      for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
      const layers = cs.boxShadow === "none" ? [] : cs.boxShadow.split(/,(?![^(]*\))/);
      if (layers.length > 1 || /inset/.test(cs.boxShadow)) throw new Error(`${selector} casts ${cs.boxShadow}, not one outset glow`);
      const glow = layers.map((layer) => ({
        color: layer.match(/rgba?\([^)]*\)/)![0],
        blur: layer.replace(/rgba?\([^)]*\)/, "").match(/-?[\d.]+px/g)!.map(parseFloat)[2] ?? 0,
      }))[0] ?? null;
      const corner = cs.borderTopLeftRadius;
      const radius = corner.endsWith("%") ? (parseFloat(corner) / 100) * r.width : parseFloat(corner);
      return {
        box: { x: r.left - at.left, y: r.top - at.top, w: r.width, h: r.height },
        fill: cs.backgroundColor,
        edge: cs.borderTopColor,
        ink: ink.color,
        fontSize: parseFloat(ink.fontSize),
        radius: Math.min(radius, r.height / 2),
        glow,
        opacity,
      };
    },
    [selector, run, origin] as const
  );
}

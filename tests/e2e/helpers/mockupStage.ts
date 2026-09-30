// The lantern fixture and the app on one 874×402 stage, each plate read as its box and computed paint.
import type { Browser, Page } from "@playwright/test";
import { FIXTURE, fitFrame, newSidePage, sideContext } from "./mockupParity";
import { openCaptureState } from "./offlineSeed";
import type { CaptureState } from "../../../lib/captureStates";

export interface PlatePaint {
  box: { x: number; y: number; w: number; h: number };
  fill: string;
  edge: string;
  ink: string;
  fontSize: number;
  radius: number;
  glow: { color: string; blur: number } | null;
  opacity: number;
}

export interface Stage {
  page: Page;
  plate: (selector: string) => Promise<PlatePaint | null>;
  close: () => Promise<void>;
}

const stage = (page: Page, origin: string | null): Stage => ({
  page,
  plate: (selector) => readPlate(page, selector, origin),
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

export async function appAt(browser: Browser, baseURL: string, state: CaptureState): Promise<Stage> {
  const page = await (await sideContext(browser, baseURL)).newPage();
  await openCaptureState(page, baseURL, state);
  return stage(page, null);
}

function readPlate(page: Page, selector: string, origin: string | null): Promise<PlatePaint | null> {
  return page.evaluate(
    ([selector, origin]) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const at = origin ? document.querySelector(origin)!.getBoundingClientRect() : { left: 0, top: 0 };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const inked = [el, ...el.querySelectorAll("*")].find((n) =>
        [...n.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent!.trim() !== "")
      );
      const ink = getComputedStyle(inked ?? el);
      let opacity = 1;
      for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
      const shadow = cs.boxShadow;
      const colour = shadow.match(/rgba?\([^)]*\)/)?.[0];
      const lengths = shadow.replace(/rgba?\([^)]*\)/, "").match(/-?[\d.]+px/g)?.map(parseFloat) ?? [];
      return {
        box: { x: r.left - at.left, y: r.top - at.top, w: r.width, h: r.height },
        fill: cs.backgroundColor,
        edge: cs.borderTopColor,
        ink: ink.color,
        fontSize: parseFloat(ink.fontSize),
        radius: Math.min(parseFloat(cs.borderTopLeftRadius), r.height / 2),
        glow: shadow === "none" || !colour ? null : { color: colour, blur: lengths[2] ?? 0 },
        opacity,
      };
    },
    [selector, origin] as const
  );
}

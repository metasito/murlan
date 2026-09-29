import type { Page } from "@playwright/test";
import type { TraceFrame } from "../../../lib/e2eTrace";
import type { FlyDirection } from "../../../components/seatLayout";
import { DESIGN } from "../../../components/table/lampRig";

type Recorder = { start(): void; frames: TraceFrame[] };
type Point = { x: number; y: number };

const RING_SEAT: Record<Exclude<FlyDirection, "bottom">, string> = { top: "top-seat", left: "side-seat-left", right: "side-seat-right" };

/**
 * Where the table laid a seat out, in window points: its ring's centre, the hand zone's before its
 * lift (its translations taken back off its box), or the pile's.
 */
export async function seatAnchor(page: Page, side: FlyDirection | "pile"): Promise<Point> {
  const selector =
    side === "bottom" ? '[data-testid="hand-zone"]' : side === "pile" ? '[data-testid="pile-area"]' : `[data-testid="${RING_SEAT[side]}"] [data-testid="seat-ring"]`;
  return page.evaluate(
    ({ selector, side }) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`the table has no ${side}: ${selector}`);
      const r = el.getBoundingClientRect();
      const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      if (side !== "bottom") return at;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const m = new DOMMatrix(getComputedStyle(n).transform);
        if (m.a !== 1 || m.b !== 0 || m.c !== 0 || m.d !== 1) throw new Error("the hand zone sits under a transform that is not a translation");
        at.x -= m.e;
        at.y -= m.f;
      }
      return at;
    },
    { selector, side }
  );
}

/**
 * Where the owner's G1 answers (docs/plans/2026-09-28-1259-3-layout-and-lamp.md § Decided) hang the
 * light over `side`, from the seats as laid out: 7 design points straight in per unit of reach,
 * reach 1 being 269 design points to the nearest other seat. In window points.
 */
export async function settledLight(page: Page, side: FlyDirection): Promise<Point> {
  const { width, height } = page.viewportSize()!;
  const [sx, sy] = [width / DESIGN.width, height / DESIGN.height];
  const [seat, top, bottom] = await Promise.all([seatAnchor(page, side), seatAnchor(page, "top"), seatAnchor(page, "bottom")]);
  const apart = (a: Point, b: Point) => Math.hypot((a.x - b.x) / sx, (a.y - b.y) / sy);
  const near = side === "top" || side === "bottom" ? apart(top, bottom) : Math.min(apart(seat, top), apart(seat, bottom));
  const inward = (7 * near) / 269;
  const [ix, iy] = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[side];
  return { x: seat.x + ix * inward * sx, y: seat.y + iy * inward * sy };
}

/** This browser draws WebGL on SwiftShader, where the table keeps its fallback felt: a spec of Skia's pixels asks for them. */
export async function skiaOnSoftware(page: Page): Promise<void> {
  await page.addInitScript(() => void ((window as unknown as { murlanSkiaOnSoftware: boolean }).murlanSkiaOnSoftware = true));
}

/** Starts the table's trace and waits until it has drawn the Skia felt, so a pixel read is of that felt. */
export async function untilSkiaFelt(page: Page, timeout = 60_000): Promise<void> {
  await page.evaluate(() => (window as unknown as { murlanTrace: Recorder }).murlanTrace.start());
  await page.waitForFunction(
    () => (window as unknown as { murlanTrace: Recorder }).murlanTrace.frames.at(-1)?.felt === "skia",
    undefined,
    { timeout }
  );
}

/** The lamp as the trace's latest frame drew it, in the felt box's own points. */
export async function tracedLamp(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(async () => {
    const trace = (window as unknown as { murlanTrace: Recorder }).murlanTrace;
    trace.start();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const lamp = trace.frames.at(-1)?.lamp;
    if (!lamp) throw new Error("the trace has no lamp");
    return lamp;
  });
}

import type { Page } from "@playwright/test";
import type { TraceFrame } from "../../../lib/e2eTrace";

type Recorder = { start(): void; frames: TraceFrame[] };

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

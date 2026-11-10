// tests/e2e/feltIdle.spec.ts — what the Skia felt costs a frame (#1257). Its one shader covers the
// whole table, so it draws only when the lamp moves, and never on a software rasteriser, where a
// swaying lamp took the main thread and the whole browser suite ran out of time.
import { test, expect } from "./fixtures";
import { openCaptureState } from "./helpers/offlineSeed";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { COUNTED, countRenders, END_B_SAMPLE, type EndBSample, startRenderCounts, swayShows, TAKE_RENDER_COUNTS, type RenderCounts } from "./helpers/renderCounters";
import { CAPTURE_STATES } from "../../lib/captureStates";
import type { TraceFrame } from "../../lib/e2eTrace";

const WINDOW_MS = 1_500;
const VIEWPORT = { width: 874, height: 402 };

for (const motion of ["reduce", "no-preference"] as const) {
  test(`the felt draws ${motion === "reduce" ? "nothing while the lamp rests" : "while the lamp sways"}`, async ({
    page,
    baseURL,
    consoleErrors,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: motion });
    await countRenders(page);
    await skiaOnSoftware(page);
    await page.setViewportSize(VIEWPORT);
    await openCaptureState(page, baseURL!, CAPTURE_STATES[0]);
    await untilSkiaFelt(page);
    await page.waitForTimeout(3_000);
    await startRenderCounts(page);

    // fixed wait on purpose: the window is the measurement
    const sway: (EndBSample | null)[] = [await page.evaluate<EndBSample | null>(END_B_SAMPLE)];
    for (let half = 0; half < 2; half++) {
      await page.waitForTimeout(WINDOW_MS / 2);
      sway.push(await page.evaluate<EndBSample | null>(END_B_SAMPLE));
    }
    const counts = await page.evaluate<RenderCounts>(TAKE_RENDER_COUNTS);
    const draws = counts.draws[COUNTED.felt] ?? 0;
    const feltFrames = counts.drewIn[COUNTED.felt] ?? 0;
    console.log(`felt (${motion}): ${draws} draws in ${feltFrames} of ${counts.frames} frames over ${WINDOW_MS} ms`);

    if (motion === "reduce") expect(draws, "the felt redrew a lamp that had not moved").toBe(0);
    else expect(draws > 10 || swayShows(sway), "the counter saw no Skia felt frame, and no end-B layer swayed, while the lamp swayed").toBe(true);
    expect(consoleErrors.entries, "the felt warned while it drew").toEqual([]);
  });
}

test("a software rasteriser keeps the fallback felt and never fetches CanvasKit", async ({ page, baseURL, consoleErrors }) => {
  test.setTimeout(120_000);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl")!;
    return String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")!.UNMASKED_RENDERER_WEBGL));
  });
  expect(renderer, "this spec's premise: the browser draws WebGL on SwiftShader").toContain("SwiftShader");

  const fetched: string[] = [];
  page.on("request", (r) => void (r.url().includes("canvaskit-wasm@") && fetched.push(r.url())));
  await page.setViewportSize(VIEWPORT);
  await openCaptureState(page, baseURL!, CAPTURE_STATES[0]);
  const felts = await page.evaluate(async () => {
    const trace = (window as unknown as { murlanTrace: { start(): void; frames: TraceFrame[] } }).murlanTrace;
    trace.start();
    await new Promise((r) => setTimeout(r, 3_000));
    return [...new Set(trace.frames.map((f) => f.felt))];
  });

  expect(felts, "the felt the table drew on a software rasteriser").toEqual(["fallback"]);
  expect(fetched, "CanvasKit was fetched for a felt that never draws").toEqual([]);
  expect(consoleErrors.entries).toEqual([]);
});

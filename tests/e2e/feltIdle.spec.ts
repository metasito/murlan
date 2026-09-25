// tests/e2e/feltIdle.spec.ts — what the Skia felt costs a frame (#1257). Its one shader covers the
// whole table, so it draws only when the lamp moves, and never on a software rasteriser, where a
// swaying lamp took the main thread and the whole browser suite ran out of time.
import { test, expect } from "./fixtures";
import { openCaptureState } from "./helpers/offlineSeed";
import { skiaOnSoftware, untilSkiaFelt } from "./helpers/tableTrace";
import { CAPTURE_STATES } from "../../lib/captureStates";
import type { TraceFrame } from "../../lib/e2eTrace";

const WINDOW_MS = 1_500;
const VIEWPORT = { width: 874, height: 402 };

function countDraws() {
  const counted = window as unknown as { glDraws: number };
  counted.glDraws = 0;
  for (const gl of [WebGLRenderingContext, WebGL2RenderingContext]) {
    for (const name of ["drawArrays", "drawElements"] as const) {
      const draw = gl.prototype[name] as (...args: unknown[]) => void;
      gl.prototype[name] = function (this: unknown, ...args: unknown[]) {
        counted.glDraws++;
        return draw.apply(this, args);
      } as never;
    }
  }
}

for (const motion of ["reduce", "no-preference"] as const) {
  test(`the felt draws ${motion === "reduce" ? "nothing while the lamp rests" : "every sway"}`, async ({
    page,
    baseURL,
    consoleErrors,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: motion });
    await page.addInitScript(countDraws);
    await skiaOnSoftware(page);
    await page.setViewportSize(VIEWPORT);
    await openCaptureState(page, baseURL!, CAPTURE_STATES[0]);
    await untilSkiaFelt(page);
    await page.waitForTimeout(3_000);

    const draws = await page.evaluate(async (ms) => {
      const counted = window as unknown as { glDraws: number };
      const from = counted.glDraws;
      await new Promise((r) => setTimeout(r, ms));
      return counted.glDraws - from;
    }, WINDOW_MS);

    if (motion === "reduce") expect(draws, "the felt redrew a lamp that had not moved").toBe(0);
    else expect(draws, "the counter saw no Skia frame while the lamp swayed").toBeGreaterThan(10);
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

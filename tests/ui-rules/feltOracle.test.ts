// Which mockup light each parity sample is held to: the felt that drew the app's frame decides (#1645).
import { test } from "node:test";
import assert from "node:assert/strict";
import { underAppFelt, type RegionSample, type TraceFrame } from "../e2e/helpers/traceDiff.ts";

const frame = (t: number, felt: TraceFrame["felt"]) => ({ t, felt }) as TraceFrame;
const sample = (t: number, rightBand: number): RegionSample => ({ t, regions: { rightBand } });

test("a Skia run's fallback frames are held to the light at rest, its Skia frames to the sway", () => {
  const app = [frame(240, "fallback"), frame(480, "fallback"), frame(656, "skia"), frame(1040, "skia")];
  const swaying = [sample(240, 70), sample(480, 71), sample(656, 72), sample(1040, 73)];
  const atRest = [sample(240, 60), sample(480, 61), sample(656, 62), sample(1040, 63)];
  assert.deepEqual(underAppFelt(app, swaying, atRest), [sample(240, 60), sample(480, 61), sample(656, 72), sample(1040, 73)]);
});

test("a fallback run is held to the light at rest throughout", () => {
  const app = [frame(1040, "fallback"), frame(2400, "fallback")];
  assert.deepEqual(underAppFelt(app, [sample(1040, 69), sample(2400, 64)], [sample(1040, 63), sample(2400, 58)]), [
    sample(1040, 63),
    sample(2400, 58),
  ]);
});

test("a sample with no app frame of its own is not taken as Skia's", () => {
  assert.deepEqual(underAppFelt([], [sample(16, 9)], [sample(16, 1)]), [sample(16, 1)]);
});

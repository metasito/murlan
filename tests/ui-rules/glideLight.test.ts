// tests/ui-rules/glideLight.test.ts — the felt while the lamp glides: each frame carries the light once, in an end's baked
// cloth or the pool layer, and arrives in the target's cloth as the rest draws it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lampControls, restingLamp, stepLamp, type Lamp, type Pool } from "../../components/table/lampRig.ts";
import { glideCloth, SETTLED_PT } from "../../components/table/glideLight.ts";
import { leanOf } from "../../components/table/restEnds.ts";

const DT = 1 / 60;
const FROM: Pool = [437, 300, 1];
const TO: Pool = [437 + 300, 150, 1];

function glide(from: Pool | null, to: Pool | null = TO): { s: Lamp; frames: ReturnType<typeof glideCloth>[] } {
  const s = restingLamp(FROM);
  for (let t = 0; t < 30; t += DT) stepLamp(s, DT, false);
  lampControls.setTarget(s, TO, false);
  const start = from && ([from[0], from[1]] as const);
  const end = to && ([to[0], to[1]] as const);
  const frames = [glideCloth(s, start, end)];
  for (let t = 0; t < 10; t += DT) {
    stepLamp(s, DT, false);
    frames.push(glideCloth(s, start, end));
    if (Math.hypot(s.x - s.tx, s.y - s.ty) < SETTLED_PT) break;
  }
  return { s, frames };
}

const shown = (f: ReturnType<typeof glideCloth>) => f.from.opacity + f.to.opacity + f.pool;

describe("glideCloth", () => {
  test("leaves in the cloth it rested in, with no pool laid over it", () => {
    const [first] = glide(FROM).frames;
    assert.ok(first.from.opacity > 0.999, `from ${first.from.opacity}`);
    assert.ok(first.pool < 0.001 && first.to.opacity === 0, `pool ${first.pool}, to ${first.to.opacity}`);
  });

  test("arrives in the target's cloth at the lean the rest draws it at, with no pool laid over it", () => {
    const { s, frames } = glide(FROM);
    const last = frames[frames.length - 1];
    assert.equal(last.to.opacity, 1);
    assert.equal(last.pool, 0);
    assert.equal(last.from.opacity, 0);
    assert.ok(Math.abs(last.to.lean - leanOf(s)) < 1e-9);
  });

  test("carries the light once on every frame: two ends never show together, and the layer gives over what an end takes, and carries what an end without its baked cloth cannot", () => {
    for (const [from, to] of [[FROM, TO], [null, TO], [FROM, null], [null, null]] as const) {
      for (const f of glide(from, to).frames) {
        assert.equal(f.from.opacity * f.to.opacity, 0);
        assert.ok(Math.abs(shown(f) - 1) < 1e-9, `${JSON.stringify(f)} shows the light ${shown(f)} times`);
      }
    }
  });
});

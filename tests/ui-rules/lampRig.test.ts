// tests/ui-rules/lampRig.test.ts — the one lamp (#1257): the rig steps as the mockup's own
// `lampStep` does, frame for frame, and nothing else in the app places a lamp.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  lampControls,
  lampMoved,
  lampPool,
  lampTarget,
  restingLamp,
  stepLamp,
  type Lamp,
  type LampTarget,
  type Pool,
} from "../../components/table/lampRig.ts";
import { seatDirection } from "../../components/seatLayout.ts";
import { fixtureBlock, fixtureLine, runFixture } from "../helpers/lanternFixture.ts";

const DT = 1 / 60;
const SEAT: Record<string, LampTarget> = { you: "bottom", luan: "right", besnik: "top", gent: "left" };

interface MockupLamp {
  lx: number;
  ly: number;
  L: number;
  f: number;
  flare: number;
  kick: number;
  freeze: number;
  lvlT: number;
  lvlRate: number;
}

function mockup() {
  const ctx = runFixture(
    [
      fixtureLine("const clamp="),
      fixtureLine("const POOL="),
      fixtureLine("function resetLamp"),
      fixtureLine("function lampTo"),
      fixtureBlock("function lampStep", "if(m.x>870)m.x=64;}}"),
    ],
    { lamp: { m: [] }, simT: 0, H: 402, R: () => 0 }
  );
  (ctx.resetLamp as () => void)();
  return {
    lamp: ctx.lamp as MockupLamp,
    step() {
      ctx.simT = (ctx.simT as number) + DT;
      (ctx.lampStep as (dt: number) => void)(DT);
    },
    to: (seat: string) => (ctx.lampTo as (k: string) => void)(seat),
  };
}

type Event = [frame: number, mock: (m: MockupLamp, to: (s: string) => void) => void, app: (s: Lamp) => void];

const SCRIPT: Event[] = [
  [30, (_, to) => to("luan"), (s) => lampControls.setTarget(s, lampPool("right"), false)],
  [90, (m) => ((m.flare = 1), (m.kick = 1)), (s) => (lampControls.flare(s, false), lampControls.kick(s, false))],
  [150, (m) => ((m.lvlT = 0.8), (m.lvlRate = 5)), (s) => lampControls.setLevel(s, 0.8, 5)],
  [200, (_, to) => to("besnik"), (s) => lampControls.setTarget(s, lampPool("top"), false)],
  [260, (m) => (m.freeze = 1), (s) => lampControls.freeze(s, 1)],
  [320, (m) => (m.freeze = 0), (s) => lampControls.freeze(s, 0)],
  [380, (_, to) => to("gent"), (s) => lampControls.setTarget(s, lampPool("left"), false)],
];

describe("the lamp rig", () => {
  test("steps as the mockup's lampStep does, through a glide, a flare and kick, a level change and a freeze", () => {
    const m = mockup();
    const app = restingLamp(lampPool("bottom"));
    for (let frame = 0; frame < 480; frame++) {
      for (const [at, mock, act] of SCRIPT) {
        if (at === frame) {
          mock(m.lamp, m.to);
          act(app);
        }
      }
      m.step();
      stepLamp(app, DT, false);
      for (const [a, b] of [
        [app.lx, m.lamp.lx],
        [app.ly, m.lamp.ly],
        [app.level, m.lamp.L],
        [app.f, m.lamp.f],
        [app.r, 1],
      ]) {
        assert.ok(Math.abs(a - b) < 1e-9, `frame ${frame}: ${a} against the mockup's ${b}`);
      }
    }
  });

  test("the pool targets are the mockup's POOL, by the direction the seat on move sits in", () => {
    const pool = runFixture([fixtureLine("const POOL=")]).POOL as Record<string, [number, number]>;
    for (const [seat, dir] of Object.entries(SEAT)) {
      assert.deepEqual([...lampTarget(dir)], [...pool[seat]], seat);
      assert.deepEqual([...lampPool(dir)], [...pool[seat], 1], `${seat}: the page he tuned, at reach 1`);
    }
    assert.equal(seatDirection(1, 0, 2), "top", "two players face each other");
    assert.deepEqual([1, 2].map((s) => seatDirection(s, 0, 3)).sort(), ["right", "top"], "three players sit right and top");
  });

  test("under reduced motion the pool jumps to the seat and nothing sways, kicks or flares", () => {
    const s = restingLamp(lampPool("bottom"));
    lampControls.setTarget(s, lampPool("right"), true);
    lampControls.flare(s, true);
    lampControls.kick(s, true);
    for (let i = 0; i < 90; i++) {
      stepLamp(s, DT, true);
      assert.deepEqual([s.lx, s.ly, s.f], [...lampTarget("right")].map((v, k) => v - (k ? 40 : 0)).concat(0));
    }
  });

  test("the level eases toward its target and never leaves 0..1", () => {
    const s = restingLamp(lampPool("bottom"), 0.75);
    lampControls.setLevel(s, 1.6, 2.2);
    for (let i = 0; i < 600; i++) stepLamp(s, DT, false);
    assert.ok(s.level > 0.99 && s.level <= 1, `level ${s.level}`);
  });

  test("a lamp that has come to rest asks for no frame, and a swaying one asks for every frame", () => {
    const still = restingLamp(lampPool("bottom"), 0.75);
    lampControls.setTarget(still, lampPool("right"), true);
    lampControls.setLevel(still, 1, 2.2);
    const asked: boolean[] = [];
    for (let i = 0; i < 600; i++) {
      stepLamp(still, DT, true);
      asked.push(lampMoved(still));
    }
    assert.ok(asked.slice(0, 5).every(Boolean), "the jump and the level's rise are drawn");
    assert.deepEqual(asked.slice(-300).filter(Boolean), [], "a resting lamp asked for a frame");

    const swaying = restingLamp(lampPool("bottom"));
    let frames = 0;
    for (let i = 0; i < 600; i++) {
      stepLamp(swaying, DT, false);
      if (lampMoved(swaying)) frames++;
    }
    assert.ok(frames > 570,`the sway asked for ${frames} of 600 frames`);
  });

  test("the reach glides with the light, and snaps under reduced motion", () => {
    const [x0] = lampPool("bottom");
    const [x1] = lampPool("right");
    const s = restingLamp(lampPool("bottom"));
    lampControls.setTarget(s, sized("right", 1.4), false);
    for (let i = 0; i < 120; i++) {
      stepLamp(s, DT, false);
      assert.ok(s.r > 1 && s.r < 1.4, `frame ${i}: a reach of ${s.r}, not on its way from 1 to 1.4`);
      const pool = (s.x - x0) / (x1 - x0);
      assert.ok(Math.abs((s.r - 1) / 0.4 - pool) < 1e-9, `frame ${i}: the reach ${(s.r - 1) / 0.4} of its way, the pool ${pool}`);
    }
    lampControls.setTarget(s, sized("left", 0.8), true);
    assert.equal(s.r, 0.8, "reduced motion: the reach jumps with the pool");
    for (let i = 0; i < 30; i++) {
      stepLamp(s, DT, true);
      assert.equal(s.r, 0.8, `reduced motion, frame ${i}`);
    }
  });

  test("a moving reach is not still", () => {
    const s = restingLamp(lampPool("bottom"));
    lampControls.freeze(s, 1);
    stepLamp(s, DT, false);
    assert.equal(lampMoved(s), false, "a frozen lamp over its pool is still");
    s.r += 0.01;
    assert.equal(lampMoved(s), true, "a reach that moved by 0.01 was counted still");
    assert.equal(s.drawn.r, s.r, "the drawn reach is recorded");
    assert.equal(lampMoved(s), false, "the same reach drawn twice");

    lampControls.setTarget(s, sized("bottom", s.r + 0.4), false);
    const asked: boolean[] = [];
    for (let i = 0; i < 600; i++) {
      stepLamp(s, DT, false);
      asked.push(lampMoved(s));
    }
    assert.ok(asked.slice(0, 120).every(Boolean), "a gliding reach went without its redraw");
    assert.deepEqual(asked.slice(-200).filter(Boolean), [], "a settled reach asked for a frame");
  });
});

function sized(target: LampTarget, reach: number): Pool {
  const [x, y] = lampPool(target);
  return [x, y, reach];
}

describe("one lamp", () => {
  const ROOTS = ["app", "components", "context", "lib"];
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : [];
    });

  test("no module but the rig computes where the lamp stands", () => {
    const offenders = ROOTS.flatMap((r) => files(r))
      .filter((f) => !f.endsWith(path.join("table", "lampRig.ts")))
      .filter((f) => /\blightPosition\b|\bLAMP_CENTRE\b|\b(457|712|202)\s*,\s*(292|196|116)\b/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(offenders, []);
  });
});

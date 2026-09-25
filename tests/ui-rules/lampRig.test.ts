// tests/ui-rules/lampRig.test.ts — the one lamp (#1257): the rig steps as the mockup's own
// `lampStep` does, frame for frame, and nothing else in the app places a lamp.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lampControls, lampTarget, restingLamp, stepLamp, type Lamp, type LampTarget } from "../../components/table/lampRig.ts";
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
  [30, (_, to) => to("luan"), (s) => lampControls.setTarget(s, "right", false)],
  [90, (m) => ((m.flare = 1), (m.kick = 1)), (s) => (lampControls.flare(s, false), lampControls.kick(s, false))],
  [150, (m) => ((m.lvlT = 0.8), (m.lvlRate = 5)), (s) => lampControls.setLevel(s, 0.8, 5)],
  [200, (_, to) => to("besnik"), (s) => lampControls.setTarget(s, "top", false)],
  [260, (m) => (m.freeze = 1), (s) => lampControls.freeze(s, 1)],
  [320, (m) => (m.freeze = 0), (s) => lampControls.freeze(s, 0)],
  [380, (_, to) => to("gent"), (s) => lampControls.setTarget(s, "left", false)],
];

describe("the lamp rig", () => {
  test("steps as the mockup's lampStep does, through a glide, a flare and kick, a level change and a freeze", () => {
    const m = mockup();
    const app = restingLamp("bottom");
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
      ]) {
        assert.ok(Math.abs(a - b) < 1e-9, `frame ${frame}: ${a} against the mockup's ${b}`);
      }
    }
  });

  test("the pool targets are the mockup's POOL, by the direction the seat on move sits in", () => {
    const pool = runFixture([fixtureLine("const POOL=")]).POOL as Record<string, [number, number]>;
    for (const [seat, dir] of Object.entries(SEAT)) assert.deepEqual([...lampTarget(dir)], [...pool[seat]], seat);
    assert.equal(seatDirection(1, 0, 2), "top", "two players face each other");
    assert.deepEqual([1, 2].map((s) => seatDirection(s, 0, 3)).sort(), ["right", "top"], "three players sit right and top");
  });

  test("under reduced motion the pool jumps to the seat and nothing sways, kicks or flares", () => {
    const s = restingLamp("bottom");
    lampControls.setTarget(s, "right", true);
    lampControls.flare(s, true);
    lampControls.kick(s, true);
    for (let i = 0; i < 90; i++) {
      stepLamp(s, DT, true);
      assert.deepEqual([s.lx, s.ly, s.f], [...lampTarget("right")].map((v, k) => v - (k ? 40 : 0)).concat(0));
    }
  });

  test("the level eases toward its target and never leaves 0..1", () => {
    const s = restingLamp("bottom", 0.75);
    lampControls.setLevel(s, 1.6, 2.2);
    for (let i = 0; i < 600; i++) stepLamp(s, DT, false);
    assert.ok(s.level > 0.99 && s.level <= 1, `level ${s.level}`);
  });
});

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

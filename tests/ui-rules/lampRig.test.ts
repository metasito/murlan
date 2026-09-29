// tests/ui-rules/lampRig.test.ts — the one lamp (#1257): the rig steps as the mockup's own
// `lampStep` does, frame for frame, and nothing else in the app places a lamp.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  LIGHT_ABOVE,
  designScale,
  lampControls,
  lampMoved,
  lampPools,
  restingLamp,
  stepLamp,
  type Lamp,
  type Pool,
} from "../../components/table/lampRig.ts";
import { seatDirection, type FlyDirection } from "../../components/seatLayout.ts";
import { anchorPoints } from "../../components/flightPhysics.ts";
import { PHONES } from "../e2e/helpers/phones.ts";
import { INSETS, NO_INSETS, phoneTable } from "../helpers/phoneTable.ts";
import { fixtureBlock, fixtureLine, runFixture } from "../helpers/lanternFixture.ts";

const DT = 1 / 60;
const SEAT: Record<string, FlyDirection> = { you: "bottom", luan: "right", besnik: "top", gent: "left" };
const MOCKUP_POOL = runFixture([fixtureLine("const POOL=")]).POOL as Record<string, [number, number]>;
const DIRECTIONS = ["bottom", "right", "top", "left"] as const;

/** The mockup's own point for a seat, at the size of light it was drawn with. */
function mockupPool(dir: FlyDirection, reach = 1): Pool {
  const seat = Object.keys(SEAT).find((k) => SEAT[k] === dir)!;
  return [...MOCKUP_POOL[seat], reach];
}

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
  [30, (_, to) => to("luan"), (s) => lampControls.setTarget(s, mockupPool("right"), false)],
  [90, (m) => ((m.flare = 1), (m.kick = 1)), (s) => (lampControls.flare(s, false), lampControls.kick(s, false))],
  [150, (m) => ((m.lvlT = 0.8), (m.lvlRate = 5)), (s) => lampControls.setLevel(s, 0.8, 5)],
  [200, (_, to) => to("besnik"), (s) => lampControls.setTarget(s, mockupPool("top"), false)],
  [260, (m) => (m.freeze = 1), (s) => lampControls.freeze(s, 1)],
  [320, (m) => (m.freeze = 0), (s) => lampControls.freeze(s, 0)],
  [380, (_, to) => to("gent"), (s) => lampControls.setTarget(s, mockupPool("left"), false)],
];

describe("the lamp rig", () => {
  test("steps as the mockup's lampStep does, through a glide, a flare and kick, a level change and a freeze", () => {
    const m = mockup();
    const app = restingLamp(mockupPool("bottom"));
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

  test("his page reproduces: your light 7 points inside the hand, at [443, 380] and reach 1", () => {
    const pools = lampPools(anchorPoints(phoneTable(874, 402, INSETS["62/21/62"])), 874, 402);
    const [x, y, reach] = pools.bottom;
    assert.deepEqual([Math.round(x), Math.round(y)], [443, 380], `the hand's pool at ${x}, ${y}`);
    assert.ok(Math.abs(reach - 1) < 1e-3, `the hand's reach ${reach}`);
    assert.deepEqual([...pools.centre], [465, 201, 1], "the announcement's light, over the rail ring's centre");
  });

  test("every seat's light sits the same way round it: straight in, the sides mirrored, as far in per unit of reach", () => {
    for (const { name: phone, width, height } of PHONES) {
      for (const [insets, edges] of Object.entries(INSETS)) {
        const at = `${phone} at ${insets}`;
        const { sx, sy } = designScale(width, height);
        const anchors = anchorPoints(phoneTable(width, height, edges));
        const pools = lampPools(anchors, width, height);
        const design = (dir: FlyDirection | "pile") => ({ x: anchors[dir].x / sx, y: anchors[dir].y / sy });
        const apart = (a: FlyDirection, b: FlyDirection) => Math.hypot(design(a).x - design(b).x, design(a).y - design(b).y);
        const pile = design("pile");
        const inPerReach = DIRECTIONS.map((dir) => {
          const seat = design(dir);
          const [x, y, reach] = pools[dir];
          const light = { x, y: y - LIGHT_ABOVE };
          const lean = dir === "top" || dir === "bottom" ? light.x - seat.x : light.y - seat.y;
          assert.ok(Math.abs(lean) < 1e-9, `${at}: the ${dir} light leans ${lean.toFixed(2)} off straight in`);
          const toPile = (p: { x: number; y: number }) => Math.hypot(pile.x - p.x, pile.y - p.y);
          assert.ok(toPile(light) < toPile(seat), `${at}: the ${dir} light is not inside its seat`);
          return Math.hypot(light.x - seat.x, light.y - seat.y) / reach;
        });
        DIRECTIONS.forEach((dir, k) =>
          assert.ok(Math.abs(inPerReach[k] - inPerReach[0]) < 1e-9, `${at}: the ${dir} light ${inPerReach[k]} in per reach, the hand's ${inPerReach[0]}`)
        );
        const mid = design("top").x;
        assert.ok(Math.abs(pools.left[0] - mid + (pools.right[0] - mid)) < 1e-9, `${at}: the side lights do not mirror in x`);
        for (const k of [1, 2]) assert.ok(Math.abs(pools.left[k] - pools.right[k]) < 1e-9, `${at}: the side lights differ in ${["height", "reach"][k - 1]}`);
        assert.ok(Math.abs(pools.top[2] - pools.bottom[2]) < 1e-9, `${at}: the top and the hand, each other's nearest, differ in reach`);
        const sideNear = Math.min(apart("left", "top"), apart("left", "bottom"));
        assert.ok(Math.abs(pools.left[2] / pools.top[2] - sideNear / apart("top", "bottom")) < 1e-9, `${at}: a side's reach is not its nearest seat's`);
      }
    }
  });

  test("a two- or three-player table aims at the seats it has: every table has a top seat and a hand", () => {
    assert.equal(seatDirection(1, 0, 2), "top", "two players face each other");
    assert.deepEqual([1, 2].map((s) => seatDirection(s, 0, 3)).sort(), ["right", "top"], "three players sit right and top");
    const anchors = anchorPoints(phoneTable(874, 402));
    const pools = lampPools(anchors, 874, 402);
    for (const players of [2, 3]) {
      for (let seat = 0; seat < players; seat++) {
        const dir = seatDirection(seat, 0, players);
        const [x, y] = pools[dir];
        const lean = dir === "top" || dir === "bottom" ? x - anchors[dir].x : y - LIGHT_ABOVE - anchors[dir].y;
        assert.ok(Math.abs(lean) < 1e-9, `${players} players: the ${dir} light leans ${lean.toFixed(2)} off its seat`);
      }
    }
  });

  test("the mockup's seats are within 1.2 points of where the app lays them out at its size", () => {
    const disc = runFixture([fixtureLine("const DISC=")]).DISC as Record<string, [number, number]>;
    const anchors = anchorPoints(phoneTable(874, 402, NO_INSETS));
    for (const [seat, dir] of Object.entries(SEAT).filter(([, d]) => d !== "bottom")) {
      for (const [k, axis] of (["x", "y"] as const).entries()) {
        const off = Math.abs(anchors[dir][axis] - disc[seat][k]);
        assert.ok(off <= 1.2, `${seat}'s disc is ${off.toFixed(2)} pt off the app's ${dir} ring in ${axis}`);
      }
    }
  });

  test("under reduced motion the pool jumps to the seat and nothing sways, kicks or flares", () => {
    const s = restingLamp(mockupPool("bottom"));
    const [x, y] = mockupPool("right");
    lampControls.setTarget(s, mockupPool("right"), true);
    lampControls.flare(s, true);
    lampControls.kick(s, true);
    for (let i = 0; i < 90; i++) {
      stepLamp(s, DT, true);
      assert.deepEqual([s.lx, s.ly, s.f], [x, y - LIGHT_ABOVE, 0]);
    }
  });

  test("the level eases toward its target and never leaves 0..1", () => {
    const s = restingLamp(mockupPool("bottom"), 0.75);
    lampControls.setLevel(s, 1.6, 2.2);
    for (let i = 0; i < 600; i++) stepLamp(s, DT, false);
    assert.ok(s.level > 0.99 && s.level <= 1, `level ${s.level}`);
  });

  test("a lamp that has come to rest asks for no frame, and a swaying one asks for every frame", () => {
    const still = restingLamp(mockupPool("bottom"), 0.75);
    lampControls.setTarget(still, mockupPool("right"), true);
    lampControls.setLevel(still, 1, 2.2);
    const asked: boolean[] = [];
    for (let i = 0; i < 600; i++) {
      stepLamp(still, DT, true);
      asked.push(lampMoved(still));
    }
    assert.ok(asked.slice(0, 5).every(Boolean), "the jump and the level's rise are drawn");
    assert.deepEqual(asked.slice(-300).filter(Boolean), [], "a resting lamp asked for a frame");

    const swaying = restingLamp(mockupPool("bottom"));
    let frames = 0;
    for (let i = 0; i < 600; i++) {
      stepLamp(swaying, DT, false);
      if (lampMoved(swaying)) frames++;
    }
    assert.ok(frames > 570,`the sway asked for ${frames} of 600 frames`);
  });

  test("the reach glides with the light, and snaps under reduced motion", () => {
    const [x0] = mockupPool("bottom");
    const [x1] = mockupPool("right");
    const s = restingLamp(mockupPool("bottom"));
    lampControls.setTarget(s, mockupPool("right", 1.4), false);
    for (let i = 0; i < 120; i++) {
      stepLamp(s, DT, false);
      assert.ok(s.r > 1 && s.r < 1.4, `frame ${i}: a reach of ${s.r}, not on its way from 1 to 1.4`);
      const pool = (s.x - x0) / (x1 - x0);
      assert.ok(Math.abs((s.r - 1) / 0.4 - pool) < 1e-9, `frame ${i}: the reach ${(s.r - 1) / 0.4} of its way, the pool ${pool}`);
    }
    lampControls.setTarget(s, mockupPool("left", 0.8), true);
    assert.equal(s.r, 0.8, "reduced motion: the reach jumps with the pool");
    for (let i = 0; i < 30; i++) {
      stepLamp(s, DT, true);
      assert.equal(s.r, 0.8, `reduced motion, frame ${i}`);
    }
  });

  test("a moving reach is not still", () => {
    const s = restingLamp(mockupPool("bottom"));
    lampControls.freeze(s, 1);
    stepLamp(s, DT, false);
    assert.equal(lampMoved(s), false, "a frozen lamp over its pool is still");
    s.r += 0.01;
    assert.equal(lampMoved(s), true, "a reach that moved by 0.01 was counted still");
    assert.equal(s.drawn.r, s.r, "the drawn reach is recorded");
    assert.equal(lampMoved(s), false, "the same reach drawn twice");

    lampControls.setTarget(s, mockupPool("bottom", s.r + 0.4), false);
    const asked: boolean[] = [];
    for (let i = 0; i < 600; i++) {
      stepLamp(s, DT, false);
      asked.push(lampMoved(s));
    }
    assert.ok(asked.slice(0, 120).every(Boolean), "a gliding reach went without its redraw");
    assert.deepEqual(asked.slice(-200).filter(Boolean), [], "a settled reach asked for a frame");
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

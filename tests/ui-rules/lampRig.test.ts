// tests/ui-rules/lampRig.test.ts — the one lamp (#1257): the rig steps as the mockup's own
// `lampStep` does, frame for frame, and nothing else in the app places a lamp.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESIGN,
  DWELL,
  GLIDE,
  LIGHT_ABOVE,
  lampOval,
  designScale,
  lampControls,
  lampMoved,
  lampSettled,
  lampPools,
  TABLE_CENTRE,
  restingLamp,
  resumeLamp,
  stepLamp,
  type Lamp,
  type LevelOwner,
  type Pool,
} from "../../components/table/lampRig.ts";
import { endsCarry, isRested } from "../../components/table/restEnds.ts";
import { seatDirection, type FlyDirection } from "../../components/seatLayout.ts";
import { PHONES } from "../e2e/helpers/phones.ts";
import { INSETS, NO_INSETS, phoneTable } from "../helpers/phoneTable.ts";
import { fixtureBlock, fixtureLine, runFixture } from "../helpers/lanternFixture.ts";
import { blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const DT = 1 / 60;
/** Design points the felt may draw its light behind the lamp's: the step the Skia captures were compared at, not lampRig's own constant, so a wider step fails here until it has been compared again. */
const DRAWN_BEHIND = 0.5;
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
      fixtureBlock("function lampAim", "else lamp.w=0;}"),
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
    to: (seat: string, waits: boolean) => (ctx.lampTo as (k: string, w: boolean) => void)(seat, waits),
  };
}

/** The mockup's oval, as `lampOval` takes the app's from its pools. */
const MOCKUP_OVAL = lampOval({ bottom: mockupPool("bottom"), right: mockupPool("right"), top: mockupPool("top"), left: mockupPool("left"), centre: [MOCKUP_POOL.besnik[0], DESIGN.height / 2, 1] });

type Event = [frame: number, mock: (m: MockupLamp, to: (s: string, waits: boolean) => void) => void, app: (s: Lamp) => void];

const aim = (dir: FlyDirection, waits: boolean) => (s: Lamp) => lampControls.setTarget(s, mockupPool(dir), false, { oval: MOCKUP_OVAL, waits });

const SCRIPT: Event[] = [
  [30, (_, to) => to("luan", true), aim("right", true)],
  [90, (m) => ((m.flare = 1), (m.kick = 1)), (s) => (lampControls.flare(s, false), lampControls.kick(s, false))],
  [150, (m) => ((m.lvlT = 0.8), (m.lvlRate = 5)), (s) => lampControls.hold(s, "lost", 0.8, 5)],
  [200, (_, to) => to("besnik", true), aim("top", true)],
  [210, (_, to) => to("gent", true), aim("left", true)],
  [260, (m) => (m.freeze = 1), (s) => lampControls.freeze(s, 1)],
  [320, (m) => (m.freeze = 0), (s) => lampControls.freeze(s, 0)],
  [380, (_, to) => to("you", false), aim("bottom", false)],
];

describe("the lamp rig", () => {
  test("steps as the mockup's lampStep does, through a dwell, a pass inside it, an orbit, a flare and kick, a level change and a freeze", () => {
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

  test("his page reproduces: your light 7 points inside the hand, at [437, 380] and reach 1", () => {
    const pools = lampPools(phoneTable(874, 402, INSETS["62/21/62"]).anchors, 874, 402);
    const [x, y, reach] = pools.bottom;
    assert.deepEqual([Math.round(x), Math.round(y)], [437, 380], `the hand's pool at ${x}, ${y}`);
    assert.ok(Math.abs(reach - 1) < 1e-3, `the hand's reach ${reach}`);
  });

  test("every seat's light sits the same way round it: straight in, the sides mirrored, as far in per unit of reach", () => {
    for (const { name: phone, width, height } of PHONES) {
      for (const [insets, edges] of Object.entries(INSETS)) {
        const at = `${phone} at ${insets}`;
        const { sx, sy } = designScale(width, height);
        const anchors = phoneTable(width, height, edges).anchors;
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

  test("the start announcement's light is over the table's middle, where its panel centres, under every inset", () => {
    for (const { name: phone, width, height } of PHONES) {
      for (const [insets, edges] of Object.entries(INSETS)) {
        const table = phoneTable(width, height, edges);
        const [x, y] = lampPools(table.anchors, width, height).centre;
        const { sx, sy } = designScale(width, height);
        const middle = (table.frame.tableLeft + width - table.frame.tableRight) / 2;
        assert.ok(Math.abs(x * sx - middle) < 1e-9, `${phone} at ${insets}: the light's x ${x * sx}, the table's middle ${middle}`);
        assert.ok(Math.abs(y * sy - height / 2) < 1e-9, `${phone} at ${insets}: the light's y ${y * sy}, the window's middle ${height / 2}`);
      }
    }
  });

  test("a two- or three-player table aims at the seats it has: every table has a top seat and a hand", () => {
    assert.equal(seatDirection(1, 0, 2), "top", "two players face each other");
    assert.deepEqual([1, 2].map((s) => seatDirection(s, 0, 3)).sort(), ["right", "top"], "three players sit right and top");
    const anchors = phoneTable(874, 402).anchors;
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
    const anchors = phoneTable(874, 402, NO_INSETS).anchors;
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

  test("the level is the lowest hold through every overlap of the lost round, the breath and the link", () => {
    const LEVEL: Record<LevelOwner, number> = { lost: 0.8, breath: 0.75, link: 0.55 };
    const RATE: Record<LevelOwner, number> = { lost: 5, breath: 2.2, link: 1 };
    const OWNERS = Object.keys(LEVEL) as LevelOwner[];
    const orders = (xs: LevelOwner[]): LevelOwner[][] =>
      xs.length === 0 ? [[]] : xs.flatMap((x) => orders(xs.filter((y) => y !== x)).map((rest) => [x, ...rest]));
    type Write = [owner: LevelOwner, held: boolean];
    const scripts = orders(OWNERS).flatMap((on) => orders(OWNERS).map((off): Write[] => [...on.map((o): Write => [o, true]), ...off.map((o): Write => [o, false])]));
    const interleaved = orders(OWNERS).map((o): Write[] => [[o[0], true], [o[1], true], [o[0], false], [o[2], true], [o[1], false], [o[2], false]]);
    for (const script of [...scripts, ...interleaved]) {
      const s = restingLamp(mockupPool("bottom"));
      const held = new Set<LevelOwner>();
      for (const [owner, on] of script) {
        const before = s.lvlT;
        const rateBefore = s.lvlRate;
        lampControls.hold(s, owner, on ? LEVEL[owner] : null, RATE[owner]);
        if (on) held.add(owner);
        else held.delete(owner);
        const want = Math.min(1, ...[...held].map((o) => LEVEL[o]));
        const at = script.map(([o, h]) => `${h ? "+" : "-"}${o}`).join(" ");
        assert.equal(s.lvlT, want, `${at}: level ${s.lvlT} after ${on ? "holding" : "releasing"} ${owner}`);
        assert.equal(s.lvlRate, want === before ? rateBefore : RATE[owner], `${at}: the rate of a write that ${want === before ? "left" : "moved"} the level`);
      }
    }
  });

  test("the level eases toward its target and never leaves 0..1", () => {
    const s = restingLamp(mockupPool("bottom"), 0.75);
    lampControls.hold(s, "breath", 1.6, 2.2);
    for (let i = 0; i < 600; i++) stepLamp(s, DT, false);
    assert.ok(s.level > 0.99 && s.level <= 1, `level ${s.level}`);
  });

  test("a lamp that has come to rest asks for no frame, and a swaying one only for the frames its light moved half a point in", () => {
    const still = restingLamp(mockupPool("bottom"), 0.75);
    lampControls.setTarget(still, mockupPool("right"), true);
    lampControls.hold(still, "breath", null, 2.2);
    const asked: boolean[] = [];
    for (let i = 0; i < 600; i++) {
      stepLamp(still, DT, true);
      asked.push(lampMoved(still));
    }
    assert.ok(asked.slice(0, 5).every(Boolean), "the jump and the level's rise are drawn");
    assert.deepEqual(asked.slice(-300).filter(Boolean), [], "a resting lamp asked for a frame");

    const swaying = restingLamp(mockupPool("bottom"));
    let frames = 0;
    let lag = 0;
    for (let i = 0; i < 600; i++) {
      stepLamp(swaying, DT, false);
      if (lampMoved(swaying)) frames++;
      lag = Math.max(lag, Math.abs(swaying.lx - swaying.drawn.lx));
    }
    assert.ok(frames >= 90 && frames <= 220, `the sway asked for ${frames} of 600 frames, outside 90..220`);
    assert.ok(lag <= DRAWN_BEHIND,`the felt drew a light ${lag} design points behind the lamp's`);
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
      const behind = Math.abs(s.r - s.drawn.r) * DESIGN.width;
      assert.ok(behind <= DRAWN_BEHIND,`frame ${i}: a point the reach scales drawn ${behind} design points behind`);
    }
    assert.ok(asked.slice(0, 60).every(Boolean), "a gliding reach went without its redraw");
    assert.deepEqual(asked.slice(-200).filter(Boolean), [], "a settled reach asked for a frame");
  });
});

describe("one lamp", () => {
  const RIG = "components/table/lampRig.ts";
  const placesALamp = (source: string) =>
    /\blightPosition\b|\bLAMP_CENTRE\b|\b(457|712|202)\s*,\s*(292|196|116)\b/.test(blankCommentsAndStrings(source));

  test("no module but the rig computes where the lamp stands", () => {
    const sources = sourcesUnder(repoRoot, ["app", "components", "context", "lib"]);
    assert.ok(sources.some(([f]) => f === RIG), `the walk never read ${RIG}: it is not reading the client`);
    const offenders = sources.filter(([f, text]) => f !== RIG && placesALamp(text)).map(([f]) => f);
    assert.deepEqual(offenders, []);
  });

  test("the scan sees a lamp placed in code beside a comment, and not a comment alone", () => {
    for (const code of ["const at = lightPosition(seat);", "/* lightPosition */ const c = LAMP_CENTRE;", "const pool = [457, 292];", "// LAMP_CENTRE\nconst p = [712,196];"])
      assert.ok(placesALamp(code), code);
    for (const code of ["// lightPosition moved to the rig\nconst p = lampPools(a, w, h);", 'const s = "LAMP_CENTRE at 457, 292";'])
      assert.ok(!placesALamp(code), code);
  });
});

describe("a lamp that has settled", () => {
  const framesToSettle = (s: Lamp, reduced: boolean, limit = 60 * 60) => {
    let n = 0;
    while (!lampSettled(s, reduced) && n < limit) {
      stepLamp(s, DT, reduced);
      n++;
    }
    return n;
  };

  test("is settled at rest under reduced motion, and never with the sway running", () => {
    assert.ok(lampSettled(restingLamp(TABLE_CENTRE), true));
    const s = restingLamp(TABLE_CENTRE);
    assert.equal(framesToSettle(s, false, 600), 600);
  });

  test("is not settled by a freeze alone: the mockup's clock runs through it", () => {
    const s = restingLamp(TABLE_CENTRE);
    lampControls.freeze(s, 1);
    assert.ok(!lampSettled(s, false));
  });

  test("settles after a glide, a dim, a flare and a kick, and wakes for each", () => {
    const s = restingLamp(TABLE_CENTRE);
    const steps: Record<string, (l: Lamp) => void> = {
      glide: (l) => lampControls.setTarget(l, [100, 100, 0.5], false),
      dim: (l) => lampControls.hold(l, "lost", 0.3, 2),
      flare: (l) => lampControls.flare(l, false),
      kick: (l) => lampControls.kick(l, false),
    };
    for (const [name, move] of Object.entries(steps)) {
      move(s);
      assert.ok(!lampSettled(s, true), `${name} leaves the lamp moving`);
      assert.ok(framesToSettle(s, true) < 60 * 60, `${name} settles`);
    }
  });

  test("stops within the felt's step of where it would have glided to", () => {
    const s = restingLamp(TABLE_CENTRE);
    lampControls.setTarget(s, [100, 100, 0.5], true);
    lampControls.hold(s, "lost", 0.3, 2);
    framesToSettle(s, true);
    assert.ok(Math.abs(s.level - 0.3) < 1e-3 && Math.abs(s.lx - 100) < DRAWN_BEHIND);
  });
});

describe("a lamp that waits at a turn and goes round", () => {
  const pools = lampPools(phoneTable(874, 402).anchors, 874, 402);
  const oval = lampOval(pools);
  const DWELL_FRAMES = Math.ceil(DWELL / DT);
  const steps = (s: Lamp, n: number, reduced = false) => {
    for (let i = 0; i < n; i++) stepLamp(s, DT, reduced);
  };
  const out = (s: Lamp) => Math.hypot((s.x - oval[0]) / oval[2], (s.y - oval[1]) / oval[3]);

  test("goes to a turn's seat only once it has held the turn DWELL seconds", () => {
    const s = restingLamp(pools.bottom);
    lampControls.setTarget(s, pools.right, false, { oval, waits: true });
    steps(s, DWELL_FRAMES - 1);
    assert.deepEqual([s.x, s.y], [pools.bottom[0], pools.bottom[1]], "the lamp moved before the seat had held the turn");
    steps(s, 2);
    assert.ok(s.x > pools.bottom[0], "the lamp did not go once the seat had held the turn");
  });

  test("its seat laid out again is no new turn: aimed at once, or waiting on the clock it had", () => {
    const moved: Pool = [pools.right[0] + 6, pools.right[1], pools.right[2]];
    const s = restingLamp(pools.right);
    lampControls.setTarget(s, pools.right, false, { oval, waits: true, seat: "right" });
    lampControls.setTarget(s, moved, false, { oval, waits: true, seat: "right" });
    assert.deepEqual([s.tx, s.next], [moved[0], null], "a resize of the seat on move waited");
    lampControls.setTarget(s, pools.top, false, { oval, waits: true, seat: "top" });
    steps(s, DWELL_FRAMES - 4);
    lampControls.setTarget(s, [pools.top[0], pools.top[1] + 6, pools.top[2]], false, { oval, waits: true, seat: "top" });
    steps(s, 5);
    assert.equal(s.ty, pools.top[1] + 6, "a resize while the turn waited restarted its wait");
  });

  test("passes quicker than DWELL leave the lamp where it is", () => {
    const s = restingLamp(pools.bottom);
    for (const dir of ["right", "top", "left"] as const) {
      lampControls.setTarget(s, pools[dir], false, { oval, waits: true });
      steps(s, DWELL_FRAMES - 2);
    }
    lampControls.setTarget(s, pools.bottom, false, { oval, waits: true });
    steps(s, 120);
    assert.deepEqual([s.x, s.y, s.next], [pools.bottom[0], pools.bottom[1], null]);
  });

  test("an aim that waits is neither settled, rested nor carried by the ends, under reduced motion too", () => {
    for (const reduced of [true, false]) {
      const s = restingLamp(pools.bottom);
      assert.ok(isRested(s) && (reduced ? lampSettled(s, true) : endsCarry(s, 1, false)), "the resting lamp is not at rest");
      lampControls.setTarget(s, pools.right, reduced, { oval, waits: true });
      assert.ok(!lampSettled(s, reduced), `reduced ${reduced}: a waiting aim counted settled`);
      assert.ok(!isRested(s), `reduced ${reduced}: a waiting aim counted rested`);
      assert.ok(!endsCarry(s, 1, reduced), `reduced ${reduced}: the ends carried a waiting aim`);
    }
    const s = restingLamp(pools.bottom);
    lampControls.setTarget(s, pools.right, true, { oval, waits: true });
    let n = 0;
    for (; !lampSettled(s, true) && n < 600; n++) stepLamp(s, DT, true);
    assert.equal(n, DWELL_FRAMES, "reduced motion: frames to land");
    assert.deepEqual([s.x, s.y], [pools.right[0], pools.right[1]]);
  });

  test("goes round the oval between seats, its reach in step with the angle, not across the felt", () => {
    const s = restingLamp(pools.bottom);
    lampControls.setTarget(s, [pools.right[0], pools.right[1], 1.4], false, { oval });
    const floor = Math.min(out(s), Math.hypot((pools.right[0] - oval[0]) / oval[2], (pools.right[1] - oval[1]) / oval[3]));
    for (let i = 0; i < 180; i++) {
      stepLamp(s, DT, false);
      assert.ok(out(s) >= floor - 1e-9, `frame ${i}: ${out(s)} out on the oval, under the ends' ${floor}: it cut across`);
      assert.ok(s.r >= 1 && s.r <= 1.4, `frame ${i}: reach ${s.r}`);
    }
    assert.ok(Math.hypot(s.x - pools.right[0], s.y - pools.right[1]) < 0.25, "did not arrive");
  });

  test("an aim to or from the centre glides straight", () => {
    const s = restingLamp(pools.centre);
    lampControls.setTarget(s, pools.right, false, { oval });
    const [x0, y0] = pools.centre;
    for (let i = 0; i < 60; i++) {
      stepLamp(s, DT, false);
      const cross = (s.x - x0) * (pools.right[1] - y0) - (s.y - y0) * (pools.right[0] - x0);
      assert.ok(Math.abs(cross) < 1e-6, `frame ${i}: off the straight line`);
    }
  });

  test("half way round is within 5% of the way inside LAMP_SETTLE_MS's three glide constants", () => {
    const s = restingLamp(pools.bottom);
    lampControls.setTarget(s, pools.top, false, { oval });
    const from = Math.hypot(pools.top[0] - s.x, pools.top[1] - s.y);
    steps(s, Math.floor((3 / GLIDE) / DT));
    assert.ok(Math.hypot(pools.top[0] - s.x, pools.top[1] - s.y) < 0.05 * from, "the orbit outlasts LAMP_SETTLE_MS");
  });

  test("a span carried at once lands where frames would", () => {
    const framed = restingLamp(pools.bottom);
    const carried = restingLamp(pools.bottom);
    for (const s of [framed, carried]) lampControls.setTarget(s, pools.left, false, { oval });
    steps(framed, 600);
    resumeLamp(carried, 10, false);
    assert.ok(Math.hypot(carried.x - framed.x, carried.y - framed.y) < 0.25, `carried ${carried.x}, ${carried.y}; framed ${framed.x}, ${framed.y}`);
  });
});

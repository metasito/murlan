import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as real from "../../components/flightPose.ts";
import type { CardFrom, CardSlot } from "../../components/flightPose.ts";

type Mod = typeof real;
const root = path.resolve(import.meta.dirname, "..", "..");

function sampledContact(m: Mod, n: number, from: CardFrom[], to: CardSlot[], catchUp: boolean): number {
  for (let t = 0; ; t++) {
    const all = from.every((f, i) => {
      const p = m.flightPose(t, i, n, f, to[i], catchUp);
      return Math.hypot(p.x - to[i].x, p.y - to[i].y) <= 1 && Math.abs(p.scale - 1) <= 0.01;
    });
    if (all) return t;
    assert.ok(t < 5000, "the pose never reaches its slots");
  }
}

const FANS: CardFrom[] = [
  { x: 0, y: -97.5, rot: 0, scale: 0.4 },
  { x: -328, y: -42, rot: 90, scale: 0.4 },
  { x: 328, y: -42, rot: -90, scale: 0.4 },
];
const handFrom = (i: number, n: number): CardFrom => ({ x: (i - (n - 1) / 2) * 40, y: 150, rot: (i - (n - 1) / 2) * 3, scale: 1.2 });

function cases() {
  const out: { name: string; n: number; from: CardFrom[]; catchUp: boolean }[] = [];
  for (let n = 1; n <= 6; n++) {
    for (const catchUp of [false, true]) {
      FANS.forEach((f, s) => out.push({ name: `fan ${s}, n=${n}, catchUp=${catchUp}`, n, from: Array(n).fill(f), catchUp }));
      out.push({ name: `hand, n=${n}, catchUp=${catchUp}`, n, from: Array.from({ length: n }, (_, i) => handFrom(i, n)), catchUp });
    }
  }
  return out;
}

describe("the throw's contact is sampled from its own pose", () => {
  for (const c of cases()) {
    test(c.name, () => {
      const to = real.pileSlots(c.n, 66, 600);
      const sampled = sampledContact(real, c.n, c.from, to, c.catchUp);
      assert.equal(real.contactMs(c.n, c.from, to, c.catchUp), sampled);
      c.from.forEach((f, i) => assert.deepEqual(real.flightPose(0, i, c.n, f, to[i], c.catchUp), f));
      const end = real.flightEndMs(c.n, c.catchUp);
      c.from.forEach((f, i) => {
        for (let t = sampled; t <= end; t++) {
          const p = real.flightPose(t, i, c.n, f, to[i], c.catchUp);
          assert.ok(Math.hypot(p.x - to[i].x, p.y - to[i].y) <= 1 && Math.abs(p.scale - 1) <= 0.01, `card ${i} leaves its slot at ${t} ms, after contact`);
        }
        const p = real.flightPose(end, i, c.n, f, to[i], c.catchUp);
        assert.ok(Math.hypot(p.x - to[i].x, p.y - to[i].y) < 0.01 && Math.abs(p.scale - 1) < 0.001, `card ${i} is not at rest when the flight ends`);
      });
    });
  }

  test("a single card from the top fan touches well before the mockup's 380 ms tween ends", () => {
    const to = real.pileSlots(1, 66, 600);
    const t = real.contactMs(1, [FANS[0]], to, false);
    assert.ok(t >= 290 && t <= 340, `contact at ${t} ms`);
  });

  test("the slots are the mockup's: 34, 28 and 24 apart at the mockup's card width, 1.2° per step", () => {
    const gap = (n: number) => { const s = real.pileSlots(n, 65.97, 1000); return s[1].x - s[0].x; };
    assert.deepEqual([gap(2), gap(4), gap(5)].map((g) => Math.round(g * 100) / 100), [34, 28, 24]);
    assert.deepEqual(real.pileSlots(3, 65.97, 1000).map((s) => s.rot), [-1.2, 0, 1.2]);
    const tight = real.pileSlots(6, 66, 150);
    assert.ok(tight[5].x - tight[0].x + 66 <= 150 + 1e-9, "the pile overflows its room");
  });
});

test("a planted ease moves contact, and contactMs follows it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "flight-pose-"));
  mkdirSync(path.join(dir, "components"));
  mkdirSync(path.join(dir, "lib"));
  writeFileSync(path.join(dir, "lib", "tokens.ts"), readFileSync(path.join(root, "lib", "tokens.ts")));
  const source = readFileSync(path.join(root, "components", "flightPose.ts"), "utf8");
  assert.equal(source.split("const EASE_POWER = 3;").length, 2, "flightPose.ts must declare `const EASE_POWER = 3;` once");
  writeFileSync(path.join(dir, "components", "flightPose.ts"), source.replace("const EASE_POWER = 3;", "const EASE_POWER = 2;"));
  const planted: Mod = await import(pathToFileURL(path.join(dir, "components", "flightPose.ts")).href);
  const to = real.pileSlots(2, 66, 600);
  const from = [FANS[0], FANS[0]];
  const before = sampledContact(real, 2, from, to, false);
  const after = sampledContact(planted, 2, from, to, false);
  assert.notEqual(after, before, "the planted ease did not move contact, so this test cannot see a guessed contact");
  assert.equal(planted.contactMs(2, from, to, false), after);
});

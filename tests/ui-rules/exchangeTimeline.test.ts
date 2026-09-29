import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEG,
  REDUCED_LEG,
  exchangeGiveDelayMs,
  legPose,
  legStage,
  restPoint,
  type LegPoints,
} from "../../lib/game/exchangeTimeline.ts";
import { DEAL_FLIGHT_MS, dealEndMs, dealFlightsMs } from "../../lib/game/dealTimeline.ts";
import { exchangeAnnounceMs } from "../../lib/exchangeCeremony.ts";
import { Hold, Motion } from "../../lib/tokens.ts";

const X = Motion.exchange;
const FAN = { x: -328, y: -42, rot: 90, scale: 0.37 };
const SLOT = { x: 40, y: 150, rot: 2, scale: 1.2 };
const TOP_FAN = { x: 0, y: -170, rot: 0, scale: 0.34 };
const PILE = restPoint();
const LEGS: { name: string; leg: LegPoints }[] = [
  { name: "fan to the viewer's hand", leg: { from: FAN, fromFace: false, rest: PILE, to: SLOT, toFace: true } },
  { name: "the viewer's hand into a fan", leg: { from: SLOT, fromFace: true, rest: PILE, to: FAN, toFace: false } },
  { name: "fan to fan", leg: { from: TOP_FAN, fromFace: false, rest: PILE, to: FAN, toFace: false } },
];

function sample(leg: LegPoints, reduced = false) {
  const out = [];
  for (let t = -50; t <= LEG.end + 50; t++) out.push({ t, ...legPose(t, leg, reduced) });
  return out;
}

for (const { name, leg } of LEGS) {
  test(`${name}: never jumps, no two adjacent 1 ms samples more than 4 pt apart while visible`, () => {
    const s = sample(leg);
    for (let i = 1; i < s.length; i++) {
      if (s[i].visible && s[i - 1].visible) assert.ok(Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) <= 4, `jump at ${s[i].t} ms`);
    }
    assert.equal(s.find((p) => p.visible)!.t, 0, "the first visible frame is the leg's zero");
    assert.equal(s.findLast((p) => p.visible)!.t, LEG.end - 1, "hidden from its landing on");
  });

  test(`${name}: rests still, face up, at a played card's size on the pile centre for Hold.reveal`, () => {
    const still = sample(leg).filter((p) => p.visible && p.face && p.flip === 1 && p.x === PILE.x && p.y === PILE.y && p.scale === 1);
    assert.ok(still.length >= Hold.reveal, `rests for ${still.length} ms`);
  });

  test(`${name}: turns face up at the lift's midpoint and to its back at the tuck's midpoint`, () => {
    const s = sample(leg).filter((p) => p.visible);
    const faceAt = s.find((p) => p.face)!.t;
    assert.equal(faceAt, leg.fromFace ? 0 : X.lift / 2);
    const backAt = s.find((p) => p.t > LEG.rest && !p.face)?.t;
    assert.equal(backAt, leg.toFace ? undefined : LEG.tuck + X.tuck / 2);
    const last = s.at(-1)!;
    assert.ok(Math.hypot(last.x - leg.to.x, last.y - leg.to.y) <= 1, "it tucks in where it is going");
  });

  test(`${name}: under reduced motion it appears at the pile, rests, and is gone, with no flight`, () => {
    const s = sample(leg, true).filter((p) => p.visible);
    assert.equal(s.length, Hold.reveal);
    assert.ok(s.every((p) => p.x === PILE.x && p.y === PILE.y && p.face), "only the rest is drawn");
  });
}

test("a leg's stages follow its pose: flying, at rest, leaving, landed", () => {
  assert.deepEqual(
    [-1, 0, LEG.rest - 1, LEG.rest, LEG.tuck - 1, LEG.tuck, LEG.end - 1, LEG.end].map((t) => legStage(t, LEG)),
    ["waiting", "flying", "flying", "rest", "rest", "tuck", "tuck", "landed"]
  );
  assert.equal(legStage(0, REDUCED_LEG), "rest");
});

test("the ceremony holds the table for the give's wait, the give and a read", () => {
  const landed = sample(LEGS[1].leg).findLast((p) => p.visible)!.t + 1;
  assert.equal(exchangeAnnounceMs(false), X.giveWait + landed + X.read);
  assert.equal(exchangeAnnounceMs(true), X.beat + landed + X.read);
});

test("the server's give floor is the client's own deal, receive and read, whatever the seats' distances", () => {
  const counts = [13, 13, 13, 13];
  const received = X.beat + sample(LEGS[0].leg).findLast((p) => p.visible)!.t + 1;
  const farthest = dealEndMs(counts, Motion.duration.reveal, counts.map(() => DEAL_FLIGHT_MS));
  assert.equal(exchangeGiveDelayMs(counts), farthest + received + X.read);
  for (const seats of [[{ dx: 0, dy: 100 }, { dx: -300, dy: 0 }, { dx: 300, dy: 0 }, { dx: 0, dy: -120 }], [{ dx: 0, dy: 10 }, { dx: 5, dy: 0 }, { dx: 0, dy: -400 }, { dx: 20, dy: 0 }]]) {
    const client = dealEndMs(counts, Motion.duration.reveal, dealFlightsMs(seats)) + received + X.read;
    assert.ok(client <= exchangeGiveDelayMs(counts), `the client's choice opens at ${client}, after the server's floor`);
  }
});

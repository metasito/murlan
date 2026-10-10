import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEG,
  REDUCED_LEG,
  ceremonyEndsAt,
  choiceOpensAt,
  exchangeGiveDelayMs,
  legPose,
  legShows,
  legStage,
  restPoint,
  type LegPoints,
} from "../../lib/game/exchangeTimeline.ts";
import { dealEndMs } from "../../lib/game/dealTimeline.ts";
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

/** When a leg shown at `show` has landed, from its drawn pose. */
const landedAt = (show: number, reduced = false) => show + sample(LEGS[0].leg, reduced).findLast((p) => p.visible)!.t + 1;

test("the choice opens on the clock the legs are drawn on: the receive landed and read", () => {
  for (const reduced of [false, true]) {
    assert.equal(choiceOpensAt(reduced), landedAt(legShows(null, reduced)[0], reduced) + X.read);
    assert.equal(legShows(null, reduced)[1], Infinity, "the give shows before the choice");
  }
});

test("the server's give floor is no earlier than the client's choice opening after the first deal", () => {
  for (const counts of [[13, 13, 13, 13], [14, 14, 13, 13], [18, 18, 17], [27, 27]]) {
    const client = dealEndMs(counts, Motion.duration.reveal) + choiceOpensAt(false);
    assert.equal(exchangeGiveDelayMs(counts), client);
  }
});

test("the server's give floor is within one read after the client's choice opening, on a fresh table or a standing one", () => {
  for (const dealt of [[27, 27], [18, 18, 18], [14, 14, 13, 13]]) {
    for (let winner = 0; winner < dealt.length; winner++) {
      for (let loser = 0; loser < dealt.length; loser++) {
        if (winner === loser) continue;
        const counts = dealt.map((n, i) => n + Number(i === winner) - Number(i === loser));
        for (const offset of [0, Motion.duration.reveal]) {
          const late = exchangeGiveDelayMs(counts) - (dealEndMs(counts, offset) + choiceOpensAt(false));
          assert.ok(late >= 0 && late <= X.read, `${counts} dealt at ${offset}: the floor is ${late} ms after the choice opens`);
        }
      }
    }
  }
});

test("a choice made once it opens has its give landed and read by the server's re-arm; one made before would not", () => {
  for (const reduced of [false, true]) {
    for (const choice of [choiceOpensAt(reduced), choiceOpensAt(reduced) + 1, choiceOpensAt(reduced) + 5000]) {
      const shows = legShows(choice, reduced);
      const read = landedAt(shows[1], reduced) + X.read;
      assert.ok(read <= choice + exchangeAnnounceMs(false), `a choice at ${choice} is read at ${read}`);
      assert.equal(ceremonyEndsAt(shows, reduced, false), read);
    }
  }
  assert.equal(landedAt(legShows(choiceOpensAt(false), false)[1]) + X.read, choiceOpensAt(false) + exchangeAnnounceMs(false));
  assert.ok(landedAt(legShows(0, false)[1]) + X.read > exchangeAnnounceMs(false), "an early give is held back past the re-arm");
});

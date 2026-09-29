import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GIVE_MS,
  RECEIVE_MS,
  exchangeGiveDelayMs,
  givePose,
  receivePose,
  receiveSoundMs,
  restPoint,
  type LegPoints,
} from "../../lib/game/exchangeTimeline.ts";
import { DEAL_FLIGHT_MS, dealEndMs, dealFlightsMs } from "../../lib/game/dealTimeline.ts";
import { exchangeAnnounceMs } from "../../lib/exchangeCeremony.ts";
import { Hold, Motion, Reading } from "../../lib/tokens.ts";

const FAN = { x: -328, y: -42, rot: 90, scale: 0.37 };
const SLOT = { x: 40, y: 150, rot: 2, scale: 1.2 };
const TOP_FAN = { x: 0, y: -170, rot: 0, scale: 0.34 };
const RECEIVE: LegPoints = { from: FAN, fromFace: false, rest: restPoint(SLOT), to: SLOT, toFace: true };
const GIVE_TO_FAN: LegPoints = { from: SLOT, fromFace: true, rest: restPoint(FAN), to: FAN, toFace: false };
const BYSTANDER_GIVE: LegPoints = { from: TOP_FAN, fromFace: false, rest: restPoint(FAN), to: FAN, toFace: false };
const LEGS = [
  { name: "receive", pose: (t: number) => receivePose(t, RECEIVE), end: RECEIVE_MS, leg: RECEIVE },
  { name: "give into a fan", pose: (t: number) => givePose(t, GIVE_TO_FAN), end: GIVE_MS, leg: GIVE_TO_FAN },
  { name: "give, fan to fan", pose: (t: number) => givePose(t, BYSTANDER_GIVE), end: GIVE_MS, leg: BYSTANDER_GIVE },
];

function sample(pose: (t: number) => { x: number; y: number; scale: number; visible: boolean; face: boolean; flip: number }, end: number) {
  const out = [];
  for (let t = 0; t <= end + 50; t++) out.push({ t, ...pose(t) });
  return out;
}

for (const { name, pose, end, leg } of LEGS) {
  test(`${name}: the card never jumps, no two adjacent 1 ms samples more than 4 pt apart while it is visible`, () => {
    const s = sample(pose, end);
    for (let i = 1; i < s.length; i++) {
      if (s[i].visible && s[i - 1].visible) assert.ok(Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) <= 4, `jump at ${s[i].t} ms`);
    }
    assert.ok(s[0].visible === false && s[s.length - 1].visible === false, "hidden before the lead and after it has tucked in");
  });

  test(`${name}: the face rests still, face up, beside the receiver for at least Hold.reveal`, () => {
    const s = sample(pose, end);
    const still = s.filter((p) => p.visible && p.face && p.flip > 0.5 && Math.hypot(p.x - leg.rest.x, p.y - leg.rest.y) < 0.5 && Math.abs(p.scale - leg.rest.scale) < 0.01);
    assert.ok(still.length >= Hold.reveal, `the face rests for ${still.length} ms`);
    assert.ok(Hold.reveal >= 600, "the #1259 reading floor");
  });

  test(`${name}: face up to every seat from the lift to the tuck (D5, revised)`, () => {
    const s = sample(pose, end).filter((p) => p.visible);
    const firstFace = s.findIndex((p) => p.face);
    const lastFace = s.findLastIndex((p) => p.face);
    assert.ok(firstFace >= 0 && s.slice(firstFace, lastFace + 1).every((p) => p.face), "the face never turns away mid-leg");
    const last = s.at(-1)!;
    assert.ok(Math.hypot(last.x - leg.to.x, last.y - leg.to.y) <= 1, "it tucks in where it is going");
    assert.equal(last.face, leg.toFace, "a card tucked into a fan joins it as a back");
  });
}

test("the receive sound is on the frame the back leaves the fan", () => {
  const s = sample((t) => receivePose(t, RECEIVE), RECEIVE_MS);
  const leaves = s.find((p) => p.visible)!.t;
  assert.equal(receiveSoundMs, leaves);
});

test("the ceremony holds the table for the give and then a notice's reading", () => {
  const s = sample((t) => givePose(t, GIVE_TO_FAN), GIVE_MS);
  const lastVisible = s.filter((p) => p.visible).at(-1)!.t;
  assert.equal(exchangeAnnounceMs(false), lastVisible + 1 + Reading.notice);
  assert.equal(exchangeAnnounceMs(true), Reading.notice);
});

test("the server's give floor is the client's own deal and receive, whatever the seats' distances", () => {
  const counts = [13, 13, 13, 13];
  const s = sample((t) => receivePose(t, RECEIVE), RECEIVE_MS);
  const received = s.filter((p) => p.visible).at(-1)!.t + 1;
  const farthest = dealEndMs(counts, Motion.duration.reveal, counts.map(() => DEAL_FLIGHT_MS));
  assert.equal(exchangeGiveDelayMs(counts), farthest + received);
  for (const seats of [[{ dx: 0, dy: 100 }, { dx: -300, dy: 0 }, { dx: 300, dy: 0 }, { dx: 0, dy: -120 }], [{ dx: 0, dy: 10 }, { dx: 5, dy: 0 }, { dx: 0, dy: -400 }, { dx: 20, dy: 0 }]]) {
    const client = dealEndMs(counts, Motion.duration.reveal, dealFlightsMs(seats)) + received;
    assert.ok(client <= exchangeGiveDelayMs(counts), `the client's receive ends at ${client}, after the server's floor`);
  }
});

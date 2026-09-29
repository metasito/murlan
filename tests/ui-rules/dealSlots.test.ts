// The deal's pool of views: as many as legs are ever in the air at once, each carrying one at a time (#1259).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dealCards, type Player } from "../../lib/game/gameEngine.ts";
import { arrangeOpponents } from "../../components/seatLayout.ts";
import type { SeatGeometry } from "../../components/flightPhysics.ts";
import { dealFlightsFor, dealLegs, dealSlots, legAt, type DealLeg } from "../../components/table/dealSlots.ts";

const geometryOf = (seats: number): SeatGeometry => {
  const players: Player[] = dealCards(seats).hands.map((hand, i) => ({ id: `p${i}`, name: `P${i}`, hand, type: "human" }));
  return {
    viewerSeat: 0,
    players,
    opponents: arrangeOpponents(players, 0),
    scale: 1,
    windowWidth: 844,
    windowHeight: 390,
    tableLeft: 20,
    tableRight: 20,
    tableTop: 12,
    surplus: 0,
    bottomPad: 8,
    handCardH: 90,
  };
};

const legsAt = (seats: number) => {
  const geometry = geometryOf(seats);
  const counts = geometry.players.map((p) => ("hand" in p ? p.hand.length : 0));
  return dealLegs(geometry, { key: 1, offsetMs: 300, counts, flightsMs: dealFlightsFor(geometry) });
};

const inAir = (leg: DealLeg, t: number) => leg.leaveMs < t && t < leg.leaveMs + leg.flightMs;

function busiest(legs: readonly DealLeg[]): number {
  const edges = [...new Set(legs.flatMap((l) => [l.leaveMs, l.leaveMs + l.flightMs]))].sort((a, b) => a - b);
  let most = 0;
  for (let i = 1; i < edges.length; i++) {
    const t = (edges[i - 1] + edges[i]) / 2;
    most = Math.max(most, legs.filter((l) => inAir(l, t)).length);
  }
  return most;
}

describe("the deal's pool of views", () => {
  for (const [seats, legCount] of [[2, 14], [3, 36], [4, 40]] as const) {
    test(`${seats} players: one view per leg in the air at the busiest instant, at most half the legs`, () => {
      const legs = legsAt(seats);
      const slots = dealSlots(legs);
      assert.equal(legs.length, legCount);
      assert.equal(slots.length, busiest(legs));
      assert.ok(slots.length * 2 <= legs.length);
    });

    test(`${seats} players: every leg flies once, and no view carries two at once`, () => {
      const legs = legsAt(seats);
      const slots = dealSlots(legs);
      assert.deepEqual(slots.flat().map((l) => l.key).sort(), legs.map((l) => l.key).sort());
      for (const slot of slots) {
        for (let i = 1; i < slot.length; i++) assert.ok(slot[i].leaveMs >= slot[i - 1].leaveMs + slot[i - 1].flightMs);
      }
    });

    test(`${seats} players: at every instant each leg in the air is the one its view poses`, () => {
      const legs = legsAt(seats);
      const slots = dealSlots(legs);
      const end = Math.max(...legs.map((l) => l.leaveMs + l.flightMs));
      for (let t = 0; t <= end + 16; t += 1) {
        const posed = slots.map((slot) => legAt(slot, t)).filter((l) => inAir(l, t));
        assert.deepEqual(posed.map((l) => l.key).sort(), legs.filter((l) => inAir(l, t)).map((l) => l.key).sort(), `t=${t}`);
      }
    });
  }
});

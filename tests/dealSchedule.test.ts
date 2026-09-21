// When each dealt card leaves the pile and lands at its seat (#1102).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Motion } from "../lib/tokens.ts";
import { DEAL_FLIGHT_MS, dealArrivalsMs, dealLeaveMs } from "../components/flightPhysics.ts";

describe("the round-robin deal", () => {
  test("hands out one card per seat per round, in seat order, never two at once", () => {
    for (const seats of [3, 4]) {
      const order: number[] = [];
      for (let round = 0; round < 18; round++) {
        for (let seat = 0; seat < seats; seat++) order.push(dealLeaveMs(round, seat, seats));
      }
      for (let k = 1; k < order.length; k++) assert.ok(order[k] > order[k - 1], `card ${k} at ${seats} seats`);
    }
  });

  test("keeps each seat's own cards a deal stagger apart — the spacing the viewer's hand already deals at", () => {
    for (let seat = 0; seat < 4; seat++) {
      assert.equal(dealLeaveMs(5, seat, 4) - dealLeaveMs(4, seat, 4), Motion.stagger.deal);
    }
  });

  test("lands every card of a seat's actual count, a flight after it leaves, from the offset", () => {
    const counts = [14, 14, 13, 13];
    counts.forEach((count, seat) => {
      const arrivals = dealArrivalsMs(count, seat, 4, 600);
      assert.equal(arrivals.length, count);
      assert.equal(arrivals[count - 1], 600 + dealLeaveMs(count - 1, seat, 4) + DEAL_FLIGHT_MS);
    });
  });
});

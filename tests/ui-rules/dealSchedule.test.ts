// When each dealt card leaves the pile and lands, against the lantern mockup's `dealRun` (#1262).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dealArrivalsMs, dealEndMs, dealLeaveMs } from "../../lib/game/dealTimeline.ts";
import { dealSlotOf } from "../../components/table/dealSlots.ts";

describe("the deal's schedule", () => {
  for (const players of [2, 3, 4]) {
    test(`${players} players, 13 cards: the viewer's card i leaves at 40 + 42i, slot j's at 40 + 42i + 10 + 10j, each lands 260 ms later`, () => {
      for (let seat = 0; seat < players; seat++) {
        const slot = dealSlotOf(seat, 0, players);
        const lag = slot === null ? 0 : 10 + 10 * slot;
        const leave = Array.from({ length: 13 }, (_, i) => dealLeaveMs(i, slot));
        assert.deepEqual(leave, Array.from({ length: 13 }, (_, i) => 40 + 42 * i + lag), `seat ${seat}`);
        assert.deepEqual(dealArrivalsMs(13, 600, slot), leave.map((ms) => 600 + ms + 260), `seat ${seat}`);
      }
    });
  }

  test("slots run top, left, right whichever seat the viewer holds", () => {
    assert.deepEqual([0, 1, 2, 3].map((seat) => dealSlotOf(seat, 0, 4)), [null, 2, 0, 1]);
    assert.deepEqual([0, 1, 2, 3].map((seat) => dealSlotOf(seat, 2, 4)), [0, 1, null, 2]);
    assert.deepEqual([0, 1].map((seat) => dealSlotOf(seat, 1, 2)), [0, null]);
    assert.deepEqual([0, 1, 2].map((seat) => dealSlotOf(seat, 0, 3)), [null, 2, 0]);
  });

  test("ends 40 + n·42 + 320 after its offset, n the largest hand: 906 ms for 13", () => {
    assert.equal(dealEndMs([13, 13, 13, 13], 0), 906);
    assert.equal(dealEndMs([14, 13, 13, 14], 600), 600 + 40 + 14 * 42 + 320);
    assert.equal(dealEndMs([], 0), 0);
  });

  test("ends after every seat's last card has landed", () => {
    for (const players of [2, 3, 4]) {
      const counts = Array(players).fill(13);
      const lastLanding = Math.max(...counts.map((n, seat) => dealArrivalsMs(n, 0, dealSlotOf(seat, 0, players)).at(-1)!));
      assert.ok(dealEndMs(counts, 0) >= lastLanding, `${players} players`);
    }
  });
});

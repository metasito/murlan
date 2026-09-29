// The seats' own geometry: where each one sits, which way it faces, and how its fan is counted.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  handVisibleH,
  handRowHeadroom,
  exchangeArrivalRise,
  getOpponentPosition,
  seatDirection,
  arrangeOpponents,
  fanCounts,
  viewerOwnsSeat,
} from "../../components/seatLayout.ts";
import { handCountOf, vacatedOf } from "../../shared/protocol.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");


describe("getOpponentPosition", () => {
  test("a lone opponent always sits opposite", () => {
    assert.equal(getOpponentPosition(1, 1), "top");
  });

  test("with two opponents the next seat is on the right, the other opposite", () => {
    assert.equal(getOpponentPosition(1, 2), "right");
    assert.equal(getOpponentPosition(2, 2), "top");
  });

  test("with three opponents the seats read clockwise: right, top, left", () => {
    assert.equal(getOpponentPosition(1, 3), "right");
    assert.equal(getOpponentPosition(2, 3), "top");
    assert.equal(getOpponentPosition(3, 3), "left");
  });
});

describe("seatDirection", () => {
  test("the viewer is always at the bottom, whatever their seat", () => {
    assert.equal(seatDirection(0, 0, 4), "bottom");
    assert.equal(seatDirection(3, 3, 4), "bottom");
    assert.equal(seatDirection(1, 1, 2), "bottom");
  });

  test("rotation wraps around the table", () => {
    // Viewer in seat 3 of 4: seat 0 is one step clockwise, so it is on the right.
    assert.equal(seatDirection(0, 3, 4), "right");
    assert.equal(seatDirection(1, 3, 4), "top");
    assert.equal(seatDirection(2, 3, 4), "left");
  });

  test("every non-viewer seat lands on exactly one distinct side", () => {
    for (let count = 2; count <= 4; count++) {
      for (let viewer = 0; viewer < count; viewer++) {
        const sides = [];
        for (let seat = 0; seat < count; seat++) {
          if (seat === viewer) continue;
          sides.push(seatDirection(seat, viewer, count));
        }
        assert.equal(sides.length, count - 1);
        assert.equal(new Set(sides).size, count - 1, `viewer ${viewer} of ${count}`);
        assert.ok(!sides.includes("bottom"));
      }
    }
  });

  test("a degenerate player count never throws", () => {
    assert.equal(seatDirection(0, 0, 0), "bottom");
  });
});

describe("arrangeOpponents", () => {
  const players = ["A", "B", "C", "D"];

  test("four players: the viewer is excluded and the other three are placed", () => {
    const seats = arrangeOpponents(players, 0);
    assert.deepEqual(seats.right, { player: "B", seat: 1 });
    assert.deepEqual(seats.top, { player: "C", seat: 2 });
    assert.deepEqual(seats.left, { player: "D", seat: 3 });
  });

  test("three players fill top and right only", () => {
    const seats = arrangeOpponents(["A", "B", "C"], 0);
    assert.deepEqual(seats.right, { player: "B", seat: 1 });
    assert.deepEqual(seats.top, { player: "C", seat: 2 });
    assert.equal(seats.left, null);
  });

  test("two players put the opponent opposite", () => {
    const seats = arrangeOpponents(["A", "B"], 1);
    assert.deepEqual(seats.top, { player: "A", seat: 0 });
    assert.equal(seats.left, null);
    assert.equal(seats.right, null);
  });

  test("the arrangement rotates with the viewer's seat", () => {
    const seats = arrangeOpponents(players, 2);
    assert.deepEqual(seats.right, { player: "D", seat: 3 });
    assert.deepEqual(seats.top, { player: "A", seat: 0 });
    assert.deepEqual(seats.left, { player: "B", seat: 1 });
  });

  test("no player is ever placed twice", () => {
    const seats = arrangeOpponents(players, 1);
    const placed = [seats.top, seats.left, seats.right]
      .filter((s) => s !== null)
      .map((s) => s!.seat);
    assert.equal(new Set(placed).size, placed.length);
    assert.ok(!placed.includes(1));
  });
});

describe("handCountOf", () => {
  test("offline: the hand itself is the count", () => {
    assert.equal(handCountOf({ hand: [{}, {}, {}] } as any), 3);
  });

  test("online: the server-supplied handCount wins over a blanked hand", () => {
    // This is the whole reason opponents' cards are hidden online — the hand
    // arrives empty and only the count is shipped.
    assert.equal(handCountOf({ hand: [], handCount: 11 } as any), 11);
  });

  test("a handCount of zero is honoured, not treated as missing", () => {
    assert.equal(handCountOf({ hand: [{}, {}], handCount: 0 } as any), 0);
  });
});

describe("vacatedOf (#850 clause 2)", () => {
  test("offline: a player never carries the field, and reads as not vacated", () => {
    assert.equal(vacatedOf({ hand: [] } as any), false);
  });

  test("online: the sanitizer's boolean travels through as-is", () => {
    assert.equal(vacatedOf({ hand: [], vacated: true } as any), true);
    assert.equal(vacatedOf({ hand: [], vacated: false } as any), false);
  });
});

describe("fanCounts", () => {
  test("a fan never draws more backs than its cap", () => {
    assert.equal(fanCounts(10, 5), 5);
  });
});


describe("viewerOwnsSeat", () => {
  test("a seated player owns the seat they are drawn from", () => {
    assert.equal(viewerOwnsSeat(2, 2, false), true);
    assert.equal(viewerOwnsSeat(1, 2, false), false);
  });

  test("a watcher owns none of them", () => {
    for (const seat of [0, 1, 2, 3]) {
      assert.equal(viewerOwnsSeat(seat, seat, true), false, `seat ${seat} was owned`);
    }
  });
});

// `viewerOwnsSeat` is the only place identity is decided. `readExchange` takes
// `spectating` as a required argument, so tsc names any caller that forgets it;
// these are the screens, where the question would otherwise be asked by hand.
//
// `===` only: `seat !== viewerSeat` is "everyone else", which is how the
// opponent list and the seat ring are built and is right for a watcher too.
test("no screen asks whether a seat is the viewer's by hand", () => {
  const IDENTITY = new RegExp(
    String.raw`(?:===\s*(?:viewerSeat|mySeatIndex)\b)|(?:\b(?:viewerSeat|mySeatIndex)\s*===)`
  );
  const asked: string[] = [];
  for (const rel of ["components/GameTable.tsx", "app/(online)/game.tsx", "app/(online)/replay.tsx"]) {
    readFileSync(path.join(repoRoot, rel), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (IDENTITY.test(line)) asked.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }

  assert.deepEqual(
    asked,
    [],
    `a watcher's seat answers yes to these: ${asked.join(" | ")}. ` +
      `Use viewerOwnsSeat(seat, viewerSeat, spectating) from components/seatLayout.`
  );
});

describe("exchangeArrivalRise", () => {
  test("is the hand zone's own centre, restated against the row's baseline", () => {
    // flightOrigin's "bottom" case lands the flying card at handZoneH / 2
    // above the table floor; the row's own baseline sits bottomPad above that
    // floor plus the lift handCenter gives it. Restated here from the pieces
    // rather than imported whole, so a change to either formula shows up as
    // disagreement.
    const cardH = 90;
    const bottomPad = 34;
    const rowRise = 7;
    const handZoneH = handVisibleH(cardH) + bottomPad + handRowHeadroom(cardH);
    assert.equal(
      exchangeArrivalRise(cardH, bottomPad, rowRise),
      handZoneH / 2 - bottomPad - rowRise
    );
  });

  test("rises with a taller card, and falls with a deeper safe area", () => {
    assert.ok(exchangeArrivalRise(120, 20, 0) > exchangeArrivalRise(90, 20, 0));
    assert.ok(exchangeArrivalRise(90, 40, 0) < exchangeArrivalRise(90, 0, 0));
  });

  // The row is lifted off the zone's padded floor by half the arc's own climb,
  // and a rise that ignored it would hand the card over that far from where
  // the flier stopped — the seam this function exists to close.
  test("comes down by the row's own lift", () => {
    assert.equal(
      exchangeArrivalRise(90, 34, 0) - exchangeArrivalRise(90, 34, 9),
      9
    );
  });
});

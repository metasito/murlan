import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  NO_CATCH_UP,
  NO_LINK,
  catchingUp,
  observeCatchUp,
  observeLink,
  ownLinkAt,
  nextLinkChangeIn,
  type LinkEdges,
  type OwnLink,
} from "../../lib/ownLink.ts";

const dropAt = (t: number): LinkEdges => observeLink(observeLink(NO_LINK, true, 0), false, t);

describe("the viewer's own connection, as the table holds it", () => {
  test("a socket that was never up is not a drop: unknown never greys the table", () => {
    const never = observeLink(NO_LINK, false, 1000);
    assert.equal(ownLinkAt(never, 60_000), "up");
    assert.equal(nextLinkChangeIn(never, 60_000), null);
  });

  test("the drop greys at once, and the pill says so at 500 ms", () => {
    const e = dropAt(10_000);
    assert.equal(ownLinkAt(e, 10_000), "dropped");
    assert.equal(ownLinkAt(e, 10_499), "dropped");
    assert.equal(ownLinkAt(e, 10_500), "reconnecting");
    assert.equal(nextLinkChangeIn(e, 10_200), 300);
  });

  test("still down at 15 s, it gives up", () => {
    const e = dropAt(0);
    assert.equal(ownLinkAt(e, 14_999), "reconnecting");
    assert.equal(ownLinkAt(e, 15_000), "lost");
    assert.equal(nextLinkChangeIn(e, 14_000), 1000);
    assert.equal(nextLinkChangeIn(e, 20_000), null);
  });

  test("coming back reads as back for 1.3 s, then the table is plainly up", () => {
    const e = observeLink(dropAt(0), true, 20_000);
    assert.equal(ownLinkAt(e, 20_000), "back");
    assert.equal(ownLinkAt(e, 21_299), "back");
    assert.equal(ownLinkAt(e, 21_300), "up");
    assert.equal(nextLinkChangeIn(e, 21_000), 300);
  });

  test("a repeated report of the same state moves no edge", () => {
    const e = dropAt(0);
    assert.equal(observeLink(e, false, 5000), e);
    const up = observeLink(NO_LINK, true, 0);
    assert.equal(observeLink(up, true, 9000), up);
  });

  test("a second drop restarts the count from its own edge", () => {
    const again = observeLink(observeLink(dropAt(0), true, 2000), false, 3000);
    assert.equal(ownLinkAt(again, 3400), "dropped");
    assert.equal(ownLinkAt(again, 17_999), "reconnecting");
    assert.equal(ownLinkAt(again, 18_000), "lost");
  });
});

describe("catching up on the way back", () => {
  const walk = (steps: [OwnLink, object][]) => {
    let c = NO_CATCH_UP;
    return steps.map(([link, state]) => {
      c = observeCatchUp(c, link, state);
      return catchingUp(c, state);
    });
  };
  const [before, missed, next] = [{}, {}, {}];

  test("lasts from the drop through the first state after the link is back, however late it lands", () => {
    assert.deepEqual(
      walk([
        ["up", before],
        ["dropped", before],
        ["back", before],
        ["up", before],
        ["up", missed],
        ["up", missed],
        ["up", next],
      ]),
      [false, true, true, true, true, true, false]
    );
  });

  test("a state arriving while the link is up and never dropped is live", () => {
    assert.deepEqual(walk([["up", before], ["up", next]]), [false, false]);
  });
});

// Where the Lantern mockup (tests/e2e/fixtures/lantern-table/index.html) is made to do what the app
// does instead of what it drew, so a parity run compares like with like (plan 3 L5).
import { anchorPoints } from "../../../components/flightPhysics";
import { DESIGN, LIGHT_ABOVE, lampPools, type LampTarget, type Pool } from "../../../components/table/lampRig";
import { phoneTable } from "../../helpers/phoneTable";

/** The mockup's names for the seats, by the direction each sits in. */
export const MOCKUP_SEAT = { bottom: "you", right: "luan", top: "besnik", left: "gent" } as const;

/**
 * The app's pools at the mockup's own size and seating. `tests/ui-rules/lampRig.test.ts` holds its
 * discs within 1.2 pt of these anchors; its hand has no disc, and runs off the bottom edge.
 */
export const MOCKUP_POOLS: Record<LampTarget, Pool> = lampPools(
  anchorPoints(phoneTable(DESIGN.width, DESIGN.height)),
  DESIGN.width,
  DESIGN.height
);

/** Run in the mockup before `start`: its lamp aims the app's way, and rests where the app's does. */
export const DEPART_SCRIPT = `(() => {
  const seats = ${JSON.stringify(Object.entries(MOCKUP_SEAT).map(([dir, k]) => [k, MOCKUP_POOLS[dir as LampTarget].slice(0, 2)]))};
  if (Object.keys(POOL).sort().join() !== seats.map(([k]) => k).sort().join()) throw new Error("the mockup's POOL names other seats: " + Object.keys(POOL));
  for (const [k, at] of seats) POOL[k] = at;
  const reset = resetLamp;
  resetLamp = () => {
    reset();
    [lamp.tx, lamp.ty] = POOL.you;
    [lamp.x, lamp.y] = POOL.you;
    lamp.lx = lamp.x;
    lamp.ly = lamp.y - ${LIGHT_ABOVE};
  };
})();`;

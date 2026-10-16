import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_WATCHDOG_MS } from "../../lib/game/gateWatchdog.ts";
import { dealEndMs } from "../../lib/game/dealTimeline.ts";
import { GIVE_MS, ceremonyEndsAt, choiceOpensAt, legShows } from "../../lib/game/exchangeTimeline.ts";
import { Motion } from "../../lib/tokens.ts";

const MARGIN = 1.5;

const healthy: Record<string, number> = {
  "deal, 2 seats, with the entry beat": dealEndMs([27, 27], Motion.duration.reveal),
  "exchange ready, from go": choiceOpensAt(false),
  "exchange done, from the choice": GIVE_MS + Motion.exchange.read,
  "exchange done, both Jokers, from go": ceremonyEndsAt(legShows(null, false), false, true),
};

for (const [gate, ms] of Object.entries(healthy)) {
  test(`the gate watchdog sits well past the healthy ${gate} (${ms} ms)`, () => {
    assert.ok(GATE_WATCHDOG_MS >= MARGIN * ms, `GATE_WATCHDOG_MS ${GATE_WATCHDOG_MS} < ${MARGIN} × ${ms}`);
  });
}

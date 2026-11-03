// The round-result backlog gauges (D17): what a scrape reports follows the results tables hold.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "@prometheus-io/client";
import "../../server/shared/metrics.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { installClock, realClock } from "../../server/http/clock.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import type { PendingResult } from "../../shared/persistedEnvelope.ts";

afterEach(() => activeGames.clear());

async function scraped(name: string): Promise<number> {
  const { values } = await register.getSingleMetric(name)!.get();
  return values[0]!.value;
}

const result = (finishedAt: number) => ({ round: finishedAt, finishedAt }) as PendingResult;

test("a pending result raises the count, and the age of the oldest grows with the clock", async (t) => {
  let at = 1_000_000;
  t.after(installClock({ ...realClock, now: () => at }));
  assert.equal(await scraped("round_results_pending"), 0);
  assert.equal(await scraped("round_results_pending_age_seconds"), 0);

  activeGames.set("a", onlineTable({ roomId: "a", pendingResults: [result(at - 5_000), result(at - 1_000)] }));
  activeGames.set("b", onlineTable({ roomId: "b", pendingResults: [result(at - 2_000)] }));
  assert.equal(await scraped("round_results_pending"), 3);
  assert.equal(await scraped("round_results_pending_age_seconds"), 5);

  at += 60_000;
  assert.equal(await scraped("round_results_pending_age_seconds"), 65);

  activeGames.get("a")!.pendingResults.length = 0;
  assert.equal(await scraped("round_results_pending"), 1);
  assert.equal(await scraped("round_results_pending_age_seconds"), 62);
});

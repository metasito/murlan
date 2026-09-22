import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { LADDER_KEY, ladderKey } from "../../lib/ladderQuery.ts";

test("invalidating the ladder after a rated hand reaches every scope's board", async () => {
  const qc = new QueryClient();
  for (const scope of ["global", "friends"] as const) qc.setQueryData(ladderKey(scope), []);

  await qc.invalidateQueries({ queryKey: LADDER_KEY });

  for (const scope of ["global", "friends"] as const) {
    assert.equal(qc.getQueryState(ladderKey(scope))?.isInvalidated, true, `the ${scope} board stayed stale`);
  }
});

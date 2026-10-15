// The third deal on one table, on the motion path a player's build ships. A seeded round 1 the
// viewer ends on its next play stands in for `motionMatch.spec.ts`'s, so rounds 2 and 3 fit one
// file: two deals on one mount, the viewer giving in round 2's exchange.

import { test } from "./fixtures";
import { resumeSaved, offlineGameSave } from "./helpers/offlineSeed";
import { onShippedMotion, playRounds } from "./helpers/motionPath";

test("offline vs bots, with motion — the second and third deals animate in, and each exchange closes itself", async ({
  page,
  baseURL,
  consoleErrors: _consoleErrors,
}) => {
  test.setTimeout(2 * 60_000);
  await onShippedMotion(page);
  await resumeSaved(page, baseURL!, offlineGameSave(2, undefined, 0, {}, [["4_clubs"], ["5_hearts", "9_spades"]]));
  await playRounds(page, 2, 3);
});

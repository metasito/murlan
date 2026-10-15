// A fresh offline match on the motion path a player's build ships, rounds 1 and 2: the second deal
// on one table is where a reused deal clock stuck the exchange (#1612). Round 3 is
// `motionThirdDeal.spec.ts`, its own file because the three rounds together run past one shard's
// unmeasured price (`UNMEASURED_SECONDS`, `tools/ci/e2e-shard.mjs`).

import { test } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { onShippedMotion, playRounds } from "./helpers/motionPath";

test("offline vs bots, with motion — the first two deals animate in, and the exchange closes itself", async ({
  page,
  baseURL,
  consoleErrors: _consoleErrors,
}) => {
  test.setTimeout(2 * 60_000);
  await onShippedMotion(page);
  await openApp(page, baseURL!);
  await startOfflineGame(page, { playerCount: 2, gameMode: "free_for_all", format: "match" });
  await playRounds(page, 1, 2);
});

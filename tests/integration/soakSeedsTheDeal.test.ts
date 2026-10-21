// tests/integration/soakSeedsTheDeal.test.ts — a soak seed deals the same first round.
//
// The deal is drawn by the server, in the soak's process, from
// `globalThis.crypto`; `seedDeals` puts `rng(seed).source` behind it for the run.
// What it buys is the first round only: every later draw waits on wall clock (#597).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { runSoak, type SoakLogEntry } from "../soak/soak.ts";

const GRACES = ["MURLAN_DISCONNECT_GRACE_MS", "MURLAN_LOBBY_GRACE_MS"] as const;

describe("a soak seed reproduces the first deal", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
  let server: TestServer;
  const prior: (string | undefined)[] = [];
  before(async () => {
    // Teardown waits out the seat graces; a long one is minutes of this file.
    for (const name of GRACES) {
      prior.push(process.env[name]);
      process.env[name] = "1000";
    }
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
    GRACES.forEach((name, i) => {
      if (prior[i] === undefined) delete process.env[name];
      else process.env[name] = prior[i];
    });
  });

  const firstDeal = async (seed: number) => {
    const { moveLog } = await runSoak({ seats: 4, minutes: 0.05, seed, chaos: 0 }, () => {}, server);
    const deal = moveLog[0];
    assert.equal(deal?.kind, "deal", `seed ${seed}'s run logged no deal: ${JSON.stringify(moveLog.slice(0, 3))}`);
    return (deal as Extract<SoakLogEntry, { kind: "deal" }>).hands;
  };

  test("two runs of one seed deal the same hands, and another seed does not", { timeout: 90_000 }, async () => {
    const first = await firstDeal(1816);
    assert.equal(first.flat().length, 54, "a four-handed deal places the whole deck");
    assert.deepEqual(await firstDeal(1816), first);
    assert.notDeepEqual(await firstDeal(1817), first, "the seed is not reaching the deal");
  });
});

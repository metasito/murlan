// tests/claimTicket.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claimBody, wonTheClaim } from "../lib/ticketPipeline/claim.ts";

const at = (s: string) => `2026-08-25T12:${s}:00Z`;
const comment = (branch: string, mm: string) => ({ body: claimBody(branch), createdAt: at(mm) });

describe("deciding who won a claim", () => {
  test("the only claim on the issue wins", () => {
    assert.equal(wonTheClaim([comment("agent/5-a", "10")], "agent/5-a").won, true);
  });

  test("an older claim by someone else takes the ticket", () => {
    const r = wonTheClaim([comment("agent/5-other", "09"), comment("agent/5-a", "10")], "agent/5-a");
    assert.equal(r.won, false);
    assert.match(r.reason, /agent\/5-other/);
  });

  test("a newer claim by someone else does not", () => {
    assert.equal(wonTheClaim([comment("agent/5-a", "09"), comment("agent/5-other", "10")], "agent/5-a").won, true);
  });

  // Two sessions a second apart can stamp the same time. Taking the ticket on a tie is how both
  // push the same branch, so a tie stands down.
  test("a tie stands down", () => {
    const r = wonTheClaim([comment("agent/5-other", "10"), comment("agent/5-a", "10")], "agent/5-a");
    assert.equal(r.won, false);
  });

  // The floor: with no claim of ours present the write did not land, and reporting a win there
  // would hand the ticket to a session that never claimed it.
  test("no claim of ours means we did not win", () => {
    assert.equal(wonTheClaim([], "agent/5-a").won, false);
    assert.equal(wonTheClaim([comment("agent/5-other", "09")], "agent/5-a").won, false);
  });

  test("ordinary comments are not read as claims", () => {
    const chatter = [
      { body: "This looks related to #12.", createdAt: at("01") },
      comment("agent/5-a", "10"),
    ];
    assert.equal(wonTheClaim(chatter, "agent/5-a").won, true);
  });
});

describe("a claim whose branch never reached origin", () => {
  const CRASHED = [
    { body: "Claimed by `agent/278-first`.", createdAt: "2026-08-26T04:38:04Z" },
    { body: "Claimed by `agent/278-second`.", createdAt: "2026-08-26T05:40:07Z" },
    { body: "Claimed by `agent/278-ours`.", createdAt: "2026-08-26T08:43:29Z" },
  ];

  // #278 carried three, from three runs that died before pushing. Read as claims they took the
  // ticket out of the queue for good: the router offered it, and the claimer refused it, for ever.
  test("is residue, not a claim", () => {
    const result = wonTheClaim(CRASHED, "agent/278-ours", () => false);
    assert.equal(result.won, true, result.reason);
  });

  test("but a live branch still wins the race", () => {
    const result = wonTheClaim(CRASHED, "agent/278-ours", (b) => b === "agent/278-first");
    assert.equal(result.won, false);
    assert.match(result.reason, /agent\/278-first/);
  });

  // Standing down costs a run; two sessions on one branch costs more. Silence means stand down.
  test("a branch nobody can ask about counts as live", () => {
    assert.equal(wonTheClaim(CRASHED, "agent/278-ours").won, false);
  });
});

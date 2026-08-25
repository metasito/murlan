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

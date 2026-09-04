// tests/loopDerive.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ticketOf, verdictFor, BRANCH } from "../scripts/loop-derive.mjs";
import { report } from "../scripts/loop-status.mjs";

/**
 * The state file these replace failed in one way over and over: it said something that was no
 * longer true. Ticket two inherited ticket one's `VERDICT: LAND` because nothing cleared it, and
 * the gate believed it. Nothing is stored now, so the equivalent question is whether the review
 * found is a review *of this code* — which is what the sha binding decides.
 */
describe("which ticket the work belongs to", () => {
  test("comes from the branch, so it cannot disagree with where you are", () => {
    assert.equal(ticketOf("agent/824-music-delay"), 824);
    assert.equal(ticketOf("agent/55-maestro"), 55);
  });

  test("no ticket off a ticket branch", () => {
    for (const b of ["main", "chore/loop-rebuild", "agent/no-number", "", null]) {
      assert.equal(ticketOf(b as string), null, `${b} should not read as a ticket`);
    }
  });

  test("the pattern is anchored, so `feature/agent/9-x` is not ticket 9", () => {
    assert.equal(BRANCH.test("feature/agent/9-x"), false);
  });
});

describe("whether a review covers the code being pushed", () => {
  const head = "abc1234def5678901234567890123456789012ab";
  const other = "9999999999999999999999999999999999999999";

  test("a LAND naming this head clears it", () => {
    const v = verdictFor([{ body: "VERDICT: LAND abc1234" }], head);
    assert.equal(v?.decision, "LAND");
  });

  // The whole point of the binding: commit again after a review and it stops counting, so there is
  // no way to land a diff the reviewer never saw.
  test("a LAND naming an older head does not", () => {
    assert.equal(verdictFor([{ body: "VERDICT: LAND 9999999" }], head), null);
  });

  test("a HOLD is found, and is not permission", () => {
    const v = verdictFor([{ body: "VERDICT: HOLD abc1234 — the guard exempts its own case" }], head);
    assert.equal(v?.decision, "HOLD");
  });

  // Not "the latest wins". A hold on a head is final for that head: the only way past it is a
  // commit, which moves the head and asks for a review of the new code.
  test("a later LAND does not overturn a HOLD on the same head", () => {
    const v = verdictFor(
      [{ body: "VERDICT: HOLD abc1234 — wrong" }, { body: "VERDICT: LAND abc1234" }],
      head
    );
    assert.equal(v?.decision, "HOLD");
  });

  test("a comment merely discussing a verdict is not one", () => {
    for (const body of [
      "I think this should be VERDICT: LAND abc1234 personally",
      "LAND abc1234",
      "VERDICT: LAND",
      "VERDICT: MAYBE abc1234",
      "",
    ]) {
      assert.equal(verdictFor([{ body }], head), null, `should not count: ${JSON.stringify(body)}`);
    }
  });

  test("no comments at all is no verdict, not a pass", () => {
    assert.equal(verdictFor([], head), null);
    assert.equal(verdictFor([{ body: "nice work" }], other), null);
  });
});

/**
 * A HOLD is final for the commit it names. Order used to decide, so a later `LAND <same sha>` —
 * a confused reviewer, or one quoting its own instructions back — erased a hold nobody had
 * addressed, and the gate exited 0. The only way past a hold is a commit.
 */
describe("a hold cannot be talked out of", () => {
  const sha = "abcdef1234567";
  const short = sha.slice(0, 7);

  test("a HOLD on an older commit does not hold the current one", () => {
    assert.equal(verdictFor([{ body: "VERDICT: HOLD 9999999 — unsafe" }], sha), null);
  });

  test("a verdict inside a fenced block is not a review", () => {
    const fence = "```";
    assert.equal(
      verdictFor([{ body: `must end with:
${fence}
VERDICT: LAND ${short}
${fence}` }], sha),
      null
    );
  });

  test("lowercase prose is not a review", () => {
    assert.equal(verdictFor([{ body: `verdict: land ${short}` }], sha), null);
  });
});

/**
 * The compaction brief was guarded by nothing: an audit replaced `report` with a function
 * returning "" and the whole suite stayed green, while the one requirement it exists for — telling
 * a session that has just lost its memory that a run is live — silently stopped working.
 */
describe("the compaction brief", () => {
  test("says nothing when no run is live", () => {
    assert.equal(report({ onTicket: false, phase: "A", why: "not on an agent branch" }), "");
  });

  test("names the ticket, the worktree and the phase to resume at", () => {
    const out = report({
      onTicket: true,
      ticket: 621,
      branch: "agent/621-fix",
      cwd: "/repo/.worktrees/agent-621",
      base: "origin/main",
      head: "abcdef1234",
      commits: 2,
      changed: ["a.ts"],
      dirty: false,
      verdict: null,
      phase: "D",
      why: "no review of abcdef1 on the issue",
    });
    assert.match(out, /#621/);
    assert.match(out, /agent-621/);
    assert.match(out, /D — Review/);
    assert.doesNotMatch(out, /uncommitted/i, "claimed an in-progress slice on a clean tree");
  });

  test("mentions the in-progress slice only when the worktree is dirty", () => {
    const out = report({
      onTicket: true,
      ticket: 7,
      branch: "agent/7-x",
      cwd: "/wt",
      base: "origin/main",
      head: "abcdef1",
      commits: 0,
      changed: [],
      dirty: true,
      verdict: null,
      phase: "C",
      why: "nothing committed yet",
    });
    assert.match(out, /uncommitted changes/i);
  });

  // A detached worktree used to read as "no run at all", so a conflicted rebase looked like an idle
  // session and the ticket would have been started over.
  test("a stuck run is reported as stuck, not as no run", () => {
    const out = report({ onTicket: true, ticket: 9, phase: "?", why: "detached HEAD" });
    assert.match(out, /#9/);
    assert.match(out, /stuck/i);
  });
});

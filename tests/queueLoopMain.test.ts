// tests/queueLoopMain.test.ts
//
// runOnce is the composition eight of the ten headline defects lived in, and it was the one part
// with no test: every export was unit-tested and the way they were put together was not.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runOnce, afterSession } from "../scripts/queue-loop.mjs";

const io = (over: Record<string, unknown> = {}) => ({
  stopFile: () => false,
  syncCheckout: () => true,
  queuePre: () => 0,
  pick: () => ({
    skill: "implement",
    number: 42,
    title: "t",
    size: "size:S",
    queue: { implement: 1, triage: 0, wayfinder: 0 },
  }),
  spawn: async () => ({
    status: 0,
    blocked: false,
    result: { cost: 1, turns: 9 },
    ms: 1000,
    log: "l",
    phase: "F",
    declared: { ticket: 42, branch: "agent/42-x", pr: 984, phase: "F", stoodDown: false, why: null },
  }),
  standing: () => ({
    ticket: 42,
    branch: "agent/42-x",
    cwd: ".worktrees/agent-42",
    head: "a",
    commits: 1,
    changed: [],
    dirty: false,
    phase: "E",
  }),
  pushedPr: () => ({ number: 984, state: "OPEN", head: "agent/42-x" }),
  settle: async () => ({ action: "merged", why: "merged" }),
  park: () => {},
  bell: () => {},
  record: () => {},
  releaseClaim: () => {},
  sharedCheckoutDirty: () => "",
  log: () => {},
  ...over,
});

describe("runOnce", () => {
  test("a ticket that pushes and merges is landed, in one pass", async () => {
    const r = await runOnce(io());
    assert.equal(r.outcome, "landed");
    assert.equal(r.ticket, 42);
  });

  // The whole point of serialising: settle() runs before the pass returns, so there is no slot to
  // orphan when the process dies and no second ticket in flight to confuse derive().
  test("settle runs before the pass returns", async () => {
    const order: string[] = [];
    await runOnce(
      io({
        spawn: async () => {
          order.push("spawn");
          return { status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "F", declared: null };
        },
        settle: async () => {
          order.push("settle");
          return { action: "merged", why: "" };
        },
      }),
    );
    assert.deepEqual(order, ["spawn", "settle"]);
  });

  test("a settle that does not merge counts as a failure and parks nothing", async () => {
    const parked: number[] = [];
    const r = await runOnce(
      io({
        settle: async () => ({ action: "park", why: "update-branch did not settle in 3 rounds" }),
        park: (n: number) => parked.push(n),
      }),
    );
    assert.equal(r.outcome, "stalled");
    assert.deepEqual(parked, [], "a mechanical failure is the loop's, not the owner's");
  });

  // Three full sessions on a ticket that kept going red produced three sessions and zero rows: no
  // cost, no turns, no count of how often the cap is reached — in the file kept to answer exactly
  // that. `main` is what bounds the rounds; the pass's job is to hand the same ticket back.
  test("a red verdict hands the ticket back, and still writes its row", async () => {
    const rows: any[] = [];
    const r = await runOnce(
      io({ settle: async () => ({ action: "fix", why: "CI failed at Lint" }), record: (x: unknown) => rows.push(x) }),
    );
    assert.equal(r.outcome, "retry");
    assert.equal(r.ticket, 42);
    assert.equal(rows.length, 1, "a session that ran and cost money is a row");
    assert.equal(rows[0].outcome, "retry");
    assert.equal(rows[0].merged, false);
  });

  test("a session that pushed nothing parks the ticket", async () => {
    const parked: number[] = [];
    const r = await runOnce(io({ pushedPr: () => null, park: (n: number) => parked.push(n) }));
    assert.equal(r.outcome, "parked");
    assert.deepEqual(parked, [42]);
    assert.match(String(r.why), /pushed no pull request/);
  });

  // The case that cost $36.38 and froze #891 for good. Phase F tears the worktree down, so
  // derive() finds nothing — which is not the same as the session having done nothing. The pull
  // request is asked for by ticket number, which survives the teardown; the fixture has one to
  // find, which the version pinning the old answer did not.
  test("a torn-down worktree with a pull request open is settled, not parked", async () => {
    const parked: number[] = [];
    const r = await runOnce(io({ standing: () => null, park: (n: number) => parked.push(n) }));
    assert.equal(r.outcome, "landed");
    assert.deepEqual(parked, [], "the claim must not be released on a branch that is about to merge");
  });

  test("a torn-down worktree with no pull request anywhere still parks", async () => {
    const parked: number[] = [];
    const r = await runOnce(
      io({
        standing: () => null,
        spawn: async () => ({ status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: null, declared: null }),
        pushedPr: () => null,
        park: (n: number) => parked.push(n),
      }),
    );
    assert.equal(r.outcome, "parked");
    assert.deepEqual(parked, [42], "rule 26: release the claim whenever you stop without landing");
  });

  // A peer, an auto-merge or the owner between the session's exit and this read. `--state open`
  // answered "pushed nothing" and false-parked a ticket that had landed.
  test("a pull request already merged is a landing, and the claim comes off", async () => {
    const released: number[] = [];
    const settled: number[] = [];
    const r = await runOnce(
      io({
        pushedPr: () => ({ number: 984, state: "MERGED", head: "agent/42-x" }),
        releaseClaim: (n: number) => released.push(n),
        settle: async () => settled.push(1) as never,
      }),
    );
    assert.equal(r.outcome, "landed");
    assert.deepEqual(released, [42]);
    assert.deepEqual(settled, [], "there is nothing left to settle");
  });

  test("a pull request closed without merging is the owner's", async () => {
    const r = await runOnce(io({ pushedPr: () => ({ number: 984, state: "CLOSED", head: "agent/42-x" }) }));
    assert.equal(r.outcome, "parked");
    assert.match(String(r.why), /#984 is closed/);
  });

  test("a session that worked a different ticket stops the pass", async () => {
    const r = await runOnce(
      io({
        standing: () => ({ ticket: 955, branch: "agent/955-x", changed: [] }),
        spawn: async () => ({ status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "C", declared: null }),
      }),
    );
    assert.equal(r.outcome, "parked");
    assert.match(String(r.why), /worked #955, not #42/);
  });

  // The session says so itself now, rather than the supervisor inferring it from a claim the
  // session already took back off the issue.
  test("a declared stand-down parks on the session's own reason", async () => {
    const r = await runOnce(
      io({
        spawn: async () => ({
          status: 0,
          blocked: false,
          result: {},
          ms: 1,
          log: "l",
          phase: "A",
          declared: { ticket: 42, branch: null, pr: null, phase: "A", stoodDown: true, why: "an older claim won" },
        }),
        pushedPr: () => null,
      }),
    );
    assert.equal(r.outcome, "parked");
    assert.match(String(r.why), /older claim won/);
  });

  test("an ambiguous pick stops rather than taking a third ticket", async () => {
    const r = await runOnce(io({ pick: () => ({ skill: "ambiguous", title: "2 live worktrees" }) }));
    assert.equal(r.outcome, "stop");
  });

  test("a handoff route stops", async () => {
    const r = await runOnce(io({ pick: () => ({ skill: "handoff", title: "nothing agent-takeable" }) }));
    assert.equal(r.outcome, "stop");
  });

  test("the stop file stops before anything is picked", async () => {
    const picks: number[] = [];
    const r = await runOnce(io({ stopFile: () => true, pick: () => picks.push(1) as never }));
    assert.equal(r.outcome, "stop");
    assert.deepEqual(picks, []);
  });

  // The loop's own merges move package-lock.json, and preflight refuses to start on an install
  // that has drifted from it. Read as "stop", the first such ticket ended the night.
  test("queue-pre exit 2 holds; anything else still stops", async () => {
    assert.equal((await runOnce(io({ queuePre: () => 2 }))).outcome, "hold");
    assert.equal((await runOnce(io({ queuePre: () => 1 }))).outcome, "stop");
  });

  test("a pinned ticket is what the picker is asked for", async () => {
    const asked: unknown[] = [];
    await runOnce(
      io({
        pick: (n: number) => {
          asked.push(n);
          return { skill: "implement", number: 42, title: "t", size: "size:S", queue: null };
        },
      }),
      42,
    );
    assert.deepEqual(asked, [42]);
  });

  // A refusal is the account, not the ticket: main() waits it out rather than ending the night.
  test("a refused session is neither landed nor parked", async () => {
    const parked: number[] = [];
    const r = await runOnce(
      io({
        spawn: async () => ({
          status: 1,
          blocked: true,
          blockedUntil: 1789000000000,
          result: {},
          ms: 1,
          log: "l",
          declared: null,
        }),
        pushedPr: () => null,
        park: (n: number) => parked.push(n),
      }),
    );
    assert.equal(r.outcome, "refused");
    assert.equal(r.until, 1789000000000);
    assert.deepEqual(parked, []);
  });

  // `blocked` was checked before anything else and never cleared, so a session refused at minute 2
  // that recovered and pushed at minute 40 was reported refused — the pull request never looked
  // for, the claim never released, and the loop then slept out the window for nothing.
  test("a refused session that recovered and pushed is settled, not refused", async () => {
    const r = await runOnce(
      io({
        spawn: async () => ({
          status: 0,
          blocked: true,
          blockedUntil: 1789000000000,
          result: {},
          ms: 1,
          log: "l",
          phase: "F",
          declared: { ticket: 42, branch: "agent/42-x", pr: 984, phase: "F", stoodDown: false, why: null },
        }),
      }),
    );
    assert.equal(r.outcome, "landed");
  });

  // A bell on every ticket is a bell nobody hears. A park is the only outcome runOnce reaches
  // that is a decision for the owner.
  test("a park rings once and a landing does not", async () => {
    let rings = 0;
    const ring = () => { rings += 1; };
    await runOnce(io({ bell: ring }));
    assert.equal(rings, 0, "a landed ticket needs nobody");
    await runOnce(io({ bell: ring, settle: async () => ({ action: "fix", why: "CI failed" }) }));
    assert.equal(rings, 0, "a red verdict is the next session's, not a person's");
    await runOnce(io({ bell: ring, settle: async () => ({ action: "park", why: "no settle" }) }));
    assert.equal(rings, 0, "a mechanical failure is the loop's");
    await runOnce(io({ bell: ring, pushedPr: () => null }));
    assert.equal(rings, 1);
  });

  test("a dirtied shared checkout is named, not fatal", async () => {
    const said: string[] = [];
    const r = await runOnce(
      io({ sharedCheckoutDirty: () => " M scripts/x.mjs", log: (m: string) => said.push(m) }),
    );
    assert.equal(r.outcome, "landed", "naming it must not strand a pushed pull request");
    assert.match(said.join("\n"), /scripts\/x\.mjs/);
  });
});

describe("afterSession", () => {
  const run = (declared: unknown, phase: string | null = "F") => ({ declared, phase }) as never;
  /** Every case below has one of the two sources, so the null branch is the test above's. */
  const of = (declared: unknown, phase: string | null, derive: unknown) =>
    afterSession(run(declared, phase), derive as never)!;
  const derived = {
    ticket: 42,
    branch: "agent/42-x",
    cwd: ".worktrees/agent-42",
    dirty: true,
    changed: ["a.ts"],
    phase: "E",
  };

  test("nothing said and nothing derived is nothing", () => {
    assert.equal(afterSession(run(null, null), null), null);
  });

  // Phase F's teardown removes the worktree, so derive() has nothing left to read. Everything the
  // supervisor needs the session already knew at the moment it finished.
  test("the declaration alone is enough once the worktree is gone", () => {
    const a = of({ ticket: 42, branch: "agent/42-x", pr: 9, phase: "F" }, "F", null);
    assert.equal(a.ticket, 42);
    assert.equal(a.branch, "agent/42-x");
    assert.equal(a.cwd, null, "there is no worktree left to point at");
  });

  test("derive alone still answers, for a session that declared nothing", () => {
    const a = of(null, null, derived);
    assert.equal(a.ticket, 42);
    assert.equal(a.cwd, ".worktrees/agent-42");
    assert.equal(a.dirty, true);
  });

  // derive computes a phase from commit count and verdict, so it answers C, D, E or ? and never
  // A, B or F. A park comment saying "phase E" of a session that died in B is the record
  // contradicting the reason printed next to it.
  test("the phase is the session's own, not the one derive computed", () => {
    assert.equal(of({ ticket: 42, phase: "B" }, "F", derived).phase, "B");
    assert.equal(of(null, "B", derived).phase, "B");
    assert.equal(of(null, null, derived).phase, "E");
  });

  test("the worktree's own readings are never taken from the declaration", () => {
    const a = of({ ticket: 42, branch: "agent/42-x" }, "F", derived);
    assert.deepEqual(a.changed, ["a.ts"], "what changed is git's answer, not the session's");
  });
});

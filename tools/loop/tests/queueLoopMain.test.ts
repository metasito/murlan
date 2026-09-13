// tools/loop/tests/queueLoopMain.test.ts
//
// runOnce is the composition eight of the ten headline defects lived in, and it was the one part
// with no test: every export was unit-tested and the way they were put together was not.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runOnce, afterSession, main } from "../queue-loop.mjs";

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
  settle: async () => ({ action: "merge", reason: "merged" }),
  park: () => {},
  teardown: () => {},
  bell: () => {},
  record: () => {},

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
          return { action: "merge", reason: "" };
        },
      }),
    );
    assert.deepEqual(order, ["spawn", "settle"]);
  });

  // #1001, exactly: the settle ended in a verdict nothing recognised, `runOnce` wrote its row, tore
  // the worktree down and returned — without calling park. `in-progress` stayed on the issue, and
  // classify() skips those for good, so the ticket became unpickable and needed a hand rescue.
  test("a settle only a person can move parks the ticket rather than dropping it", async () => {
    const parked: number[] = [];
    const r = await runOnce(
      io({
        settle: async () => ({ action: "owner", reason: "update-branch did not settle in 3 rounds" }),
        park: (n: number) => parked.push(n),
      }),
    );
    assert.equal(r.outcome, "parked");
    assert.deepEqual(parked, [42], "no exit path may tear the worktree down and keep the claim");
    assert.match(String(r.why), /did not settle/);
  });

  test("an unrecognised settle action parks too, rather than returning silently", async () => {
    const parked: number[] = [];
    const r = await runOnce(
      io({ settle: async () => ({ action: "something-new", reason: "?" }), park: (n: number) => parked.push(n) }),
    );
    assert.equal(r.outcome, "parked");
    assert.deepEqual(parked, [42]);
  });

  // Three full sessions on a ticket that kept going red produced three sessions and zero rows: no
  // cost, no turns, no count of how often the cap is reached — in the file kept to answer exactly
  // that. `main` is what bounds the rounds; the pass's job is to hand the same ticket back.
  test("a red verdict hands the ticket back, and still writes its row", async () => {
    const rows: any[] = [];
    const r = await runOnce(
      io({ settle: async () => ({ action: "hand-back", reason: "CI failed at Lint" }), record: (x: unknown) => rows.push(x) }),
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
    const released: (number | undefined)[] = [];
    const settled: number[] = [];
    const r = await runOnce(
      io({
        pushedPr: () => ({ number: 984, state: "MERGED", head: "agent/42-x" }),
        teardown: (_cwd: string | null, n: number) => released.push(n),
        settle: async () => settled.push(1) as never,
      }),
    );
    assert.equal(r.outcome, "landed");
    assert.deepEqual(released, [42]);
    assert.deepEqual(settled, [], "there is nothing left to settle");
  });

  // Releasing the claim beside each teardown call let an exit path take one without the other, and
  // one did. Tied to the teardown, no path can tear down and keep the claim.
  test("every teardown is told which ticket's claim it is releasing", async () => {
    for (const over of [
      { pushedPr: () => ({ number: 984, state: "MERGED", head: "agent/42-x" }) },
      { settle: async () => ({ action: "merge", reason: "merged" }) },
    ]) {
      const torn: unknown[][] = [];
      await runOnce(io({ ...over, teardown: (...args: unknown[]) => torn.push(args) }));
      assert.deepEqual(torn, [[".worktrees/agent-42", 42]], JSON.stringify(Object.keys(over)));
    }
  });

  // Phase F removes its own worktree, but every path that skips phase F leaves one standing, and
  // a standing worktree is a run derive() resumes on every iteration after. `park` removes its own,
  // so a parked ticket is checked through park's arguments rather than through teardown's.
  test("no terminal outcome leaves the worktree standing", async () => {
    for (const over of [
      { pushedPr: () => ({ number: 984, state: "MERGED", head: "agent/42-x" }) },
      { settle: async () => ({ action: "merge", reason: "merged" }) },
    ]) {
      const gone: (string | null)[] = [];
      await runOnce(io({ ...over, teardown: (cwd: string | null) => gone.push(cwd) }));
      assert.deepEqual(gone, [".worktrees/agent-42"], JSON.stringify(Object.keys(over)));
    }

    const handed: (string | null)[] = [];
    await runOnce(
      io({
        settle: async () => ({ action: "owner", reason: "no settle" }),
        park: (_n: number, ctx: { cwd: string | null }) => handed.push(ctx.cwd),
      }),
    );
    assert.deepEqual(handed, [".worktrees/agent-42"]);
  });

  // The same worktree is what the next round works in, so this is the one outcome that keeps it.
  test("a CI fix round keeps the worktree, and hands it back", async () => {
    const gone: (string | null)[] = [];
    const r = await runOnce(
      io({
        settle: async () => ({ action: "hand-back", reason: "CI failed at Lint" }),
        teardown: (cwd: string | null) => gone.push(cwd),
      }),
    );
    assert.equal(r.outcome, "retry");
    assert.equal(r.cwd, ".worktrees/agent-42");
    assert.ok(r.run, "main records the park when the rounds run out, and needs the session's cost");
    assert.deepEqual(gone, []);
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
    await runOnce(io({ bell: ring, settle: async () => ({ action: "hand-back", reason: "CI failed" }) }));
    assert.equal(rings, 0, "a red verdict is the next session's, not a person's");
    await runOnce(io({ bell: ring, pushedPr: () => null }));
    assert.equal(rings, 1);
    // A settle that ends in `owner` now goes to the tracker with `ready-for-human` on it, so it is
    // a hand-off like any other. Left silent, it was a ticket dropped without anyone being told.
    await runOnce(io({ bell: ring, settle: async () => ({ action: "owner", reason: "no settle" }) }));
    assert.equal(rings, 2);
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

// `main` carried five locals mutated across six branches and was module-private, so the breaker,
// the fix-round ceiling and the refusal ceiling — the three things that decide whether an
// unattended night ends well — appeared in no test at all.
describe("main", () => {
  const book = () => {
    const rows: any[] = [];
    return {
      rows,
      totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 },
      record: (s: any) => rows.push(s),
      close: () => {},
    };
  };
  const screen = () => ({ say: () => {}, warn: () => {}, stop: () => {} });

  test("three tickets in a row that do not land stop the night", async () => {
    let calls = 0;
    const spy = {
      ...(io() as any),
      pick: () => {
        calls += 1;
        return { skill: "implement", number: calls, title: "t", size: null, queue: null };
      },
      spawn: async () => ({ status: 1, blocked: false, result: {}, ms: 1, log: "l", phase: "C", declared: null }),
      pushedPr: () => null,
      standing: () => null,
    };
    const code = await main({ io: spy, book: book(), screen: screen(), install: () => {}, runId: "t" });
    assert.equal(code, 1, "the breaker ends the run rather than burning the night");
    assert.equal(calls, 3, "three, not two and not four");
  });

  test("a stop file ends the night cleanly, before anything is picked", async () => {
    let picked = 0;
    const code = await main({
      io: { ...(io() as any), stopFile: () => true, pick: () => (picked += 1) as never },
      book: book(),
      screen: screen(),
      install: () => {},
      runId: "t",
    });
    assert.equal(code, 0);
    assert.equal(picked, 0);
  });

  test("a landing clears the breaker, so a bad ticket between good ones is not fatal", async () => {
    let n = 0;
    const outcomes = [1, 0, 1, 0, 1, 0, 1];
    const code = await main({
      io: {
        ...(io() as any),
        pick: () => {
          n += 1;
          if (n > outcomes.length) return { skill: "handoff", number: 0, title: "queue empty" };
          return { skill: "implement", number: n, title: "t", size: null, queue: null };
        },
        spawn: async () => ({
          status: outcomes[n - 1],
          blocked: false,
          result: {},
          ms: 1,
          log: "l",
          phase: "C",
          declared: null,
        }),
        pushedPr: () => (outcomes[n - 1] === 0 ? { number: 9, state: "MERGED", head: "agent/1-x" } : null),
        standing: () => null,
      },
      book: book(),
      screen: screen(),
      install: () => {},
      runId: "t",
    });
    assert.equal(code, 0, "alternating park and land never reaches three in a row");
    assert.equal(n, outcomes.length + 1);
  });
});

/**
 * Every decision `runOnce` reaches goes through `park`, so no ticket loses its claim — but a throw
 * reaches no decision at all. `io.sharedCheckoutDirty` is a bare `git status` on the *shared*
 * index, which a peer's worktree can hold, and it runs after the session has already added
 * `in-progress`. Left on, that label makes the ticket permanently unpickable (#1001's mechanism).
 */
describe("a throw mid-iteration", () => {
  const book = () => ({
    totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 },
    record: () => {},
    close: () => {},
  });
  const screen = () => ({ say: () => {}, warn: () => {}, stop: () => {} });

  test("releases the claim on the ticket it was holding", async () => {
    const parked: number[] = [];
    let picked = 0;
    const spy = {
      ...(io() as any),
      pick: () => ({ skill: "implement", number: 4200 + ++picked, title: "t", size: null, queue: null }),
      spawn: async () => ({ status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "C", declared: null }),
      sharedCheckoutDirty: () => {
        throw new Error("fatal: Unable to create '.git/index.lock': File exists.");
      },
      park: (n: number) => parked.push(n),
    };
    const code = await main({ io: spy, book: book(), screen: screen(), install: () => {}, runId: "t" });
    assert.equal(code, 1, "the breaker still ends the night");
    assert.deepEqual(parked, [4201, 4202, 4203], "a claimed ticket was left claimed");
  });

  test("a throw before anything is claimed parks nothing", async () => {
    const parked: number[] = [];
    const spy = {
      ...(io() as any),
      queuePre: () => {
        throw new Error("queue-pre blew up");
      },
      park: (n: number) => parked.push(n),
    };
    await main({ io: spy, book: book(), screen: screen(), install: () => {}, runId: "t" });
    assert.deepEqual(parked, [], "parked a ticket nobody had picked");
  });

  test("a park that itself throws is reported, not raised", async () => {
    let picked = 0;
    const said: string[] = [];
    const spy = {
      ...(io() as any),
      pick: () => ({ skill: "implement", number: 4300 + ++picked, title: "t", size: null, queue: null }),
      spawn: async () => {
        throw new Error("the session could not start");
      },
      park: () => {
        throw new Error("gh is unreachable");
      },
    };
    const code = await main({
      io: spy,
      book: book(),
      screen: { say: () => {}, warn: (m: string) => said.push(m), stop: () => {} },
      install: () => {},
      runId: "t",
    });
    assert.equal(code, 1);
    assert.match(said.join("\n"), /#4301 is still claimed/, "a ticket nobody can release must be named");
  });
});

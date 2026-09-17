// tools/loop/tests/queueLoopMain.test.ts
//
// runOnce is the composition eight of the ten headline defects lived in, and it was the one part
// with no test: every export was unit-tested and the way they were put together was not.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  runOnce,
  afterSession,
  main,
  nextRoute,
  park,
  blockOnShared,
  refreshWorktree,
  removeLanded,
  removeWorktree,
  MAX_HANDOFFS,
  USD_BY_SIZE,
} from "../queue-loop.mjs";
import { ticketTally } from "../loop-logs.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const rowOf = (x: any) => ({
  n: x.number,
  outcome: x.outcome,
  cost: x.run?.result?.cost ?? 0,
  park_reason: x.outcome === "landed" || x.outcome === "retry" ? null : (x.why ?? null),
  head: x.head ?? null,
});

const io = (over: Record<string, unknown> = {}, ledger: any[] = []) => ({
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
  record: (x: unknown) => ledger.push(rowOf(x)),
  tally: (n: number) => ({ ...ticketTally(n, ledger), ciRounds: 0 }),
  sharedCheckoutDirty: () => "",
  log: () => {},
  buildPassed: () => true,
  announce: () => {},
  block: () => {},
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

  // The case that cost $36.38 and froze #891 for good. With no worktree left to read, derive()
  // finds nothing — which is not the same as the session having done nothing. The pull request
  // is asked for by ticket number, which survives a missing worktree; the fixture has one to
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

  // Phase F leaves the worktree standing, and only the supervisor removes it; a worktree left
  // behind is a run derive() resumes on every iteration after. `park` removes its own,
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

  test("a G route settles without spawning", async () => {
    const rows: any[] = [];
    const torn: unknown[] = [];
    let spawns = 0;
    const r = await runOnce(
      io({
        pick: () => ({ skill: "implement", number: 42, title: "t", size: "size:S", queue: null, resuming: true, phase: "G" }),
        spawn: async () => (spawns += 1) as never,
        pushedPr: (_b: unknown, _n: unknown, _d: unknown, since: number) =>
          since === 0 ? { number: 984, state: "OPEN", head: "agent/42-x" } : null,
        record: (x: unknown) => rows.push(x),
        teardown: (cwd: string | null) => torn.push(cwd),
      }),
    );
    assert.equal(spawns, 0);
    assert.equal(r.outcome, "landed");
    assert.deepEqual(torn, [".worktrees/agent-42"]);
    assert.deepEqual(
      rows.map((x) => [x.outcome, x.run.result, x.run.declared]),
      [["landed", null, null]],
    );
  });

  test("a G route announces itself before it settles", async () => {
    const order: string[] = [];
    await runOnce(
      io({
        pick: () => ({ skill: "implement", number: 42, title: "t", size: null, queue: null, resuming: true, phase: "G" }),
        announce: (r: { number: number; phase: string }) => order.push(`announce ${r.number} ${r.phase}`),
        settle: async () => (order.push("settle"), { action: "merge", reason: "merged" }),
      }),
    );
    assert.deepEqual(order, ["announce 42 G", "settle"]);
  });

  const handingOff = (from: string, to: string) => async () => ({
    status: 0,
    blocked: false,
    result: { cost: 1 },
    ms: 1,
    log: "l",
    phase: from,
    declared: { ticket: 42, phase: from, handoff: to, stoodDown: false },
  });

  test("a D handoff without a --build pass re-routes to C, recorded as a C handoff", async () => {
    const ledger: any[] = [];
    const checked: unknown[] = [];
    const said: string[] = [];
    const r = await runOnce(
      io(
        {
          spawn: handingOff("C", "D"),
          buildPassed: (cwd: string) => (checked.push(cwd), false),
          log: (m: string) => said.push(m),
        },
        ledger,
      ),
    );
    assert.deepEqual([r.outcome, r.phase, checked], ["handoff", "C", [".worktrees/agent-42"]]);
    assert.equal(ticketTally(42, ledger).lastHandoff, "C");
    assert.match(said.join("\n"), /no local pass/);

    const passed = await runOnce(io({ spawn: handingOff("C", "D") }, []));
    assert.equal(passed.phase, "D");
  });

  test("a session on the wrong model parks with the reason", async () => {
    const parked: string[] = [];
    const r = await runOnce(
      io({
        spawn: async () => ({
          status: 1,
          blocked: false,
          result: null,
          ms: 1,
          log: "l",
          phase: null,
          declared: null,
          wrongModel: "the session started on claude-opus-5, but phase E runs on sonnet",
        }),
        park: (_n: number, c: { why: string }) => parked.push(c.why),
      }),
    );
    assert.equal(r.outcome, "parked");
    assert.deepEqual(parked, ["the session started on claude-opus-5, but phase E runs on sonnet"]);
  });

  test("the prune in queue-pre runs before the pick", async () => {
    const order: string[] = [];
    await runOnce(
      io({
        queuePre: () => (order.push("pre"), 0),
        pick: () => (order.push("pick"), { skill: "implement", number: 42, title: "t", size: null, queue: null }),
      }),
    );
    assert.deepEqual(order, ["pre", "pick"]);
  });

  test("a red settle leaves the worktree standing and the next pass spawns C with the fix", async () => {
    const torn: unknown[] = [];
    const parked: number[] = [];
    const red = await runOnce(
      io({
        settle: async () => ({ action: "hand-back", reason: "CI failed at Lint" }),
        teardown: (cwd: string | null) => torn.push(cwd),
        park: (n: number) => parked.push(n),
      }),
    );
    assert.equal(red.outcome, "retry");
    assert.deepEqual([torn, parked], [[], []]);

    const asked: unknown[] = [];
    const route: any = nextRoute(42, null, {
      read: (o: unknown) => {
        asked.push(o);
        return { onTicket: true, ticket: 42, branch: "agent/42-x", cwd: red.cwd, dirty: false, phase: "C", fix: true };
      },
      facts: () => ({ title: "t", url: "", size: "size:S", labels: ["in-progress"], reviewRounds: 1, ciRounds: 1 }),
      ledger: () => [{ n: 42, outcome: "handoff", cost: 0, park_reason: "phase E next", head: null }],
    } as never);
    assert.deepEqual(asked, [{ ci: true }]);
    assert.deepEqual([route.phase, route.fix, route.cwd, route.branch], ["C", true, red.cwd, "agent/42-x"]);

    const order: string[] = [];
    await runOnce(
      io({
        pick: () => route,
        refreshWorktree: (cwd: string, branch: string) => order.push(`refresh ${cwd} ${branch}`),
        spawn: async (r: { phase: string }) => {
          order.push(`spawn ${r.phase}`);
          return { status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "F", declared: null };
        },
      }),
      42,
    );
    assert.deepEqual(order, [`refresh ${red.cwd} agent/42-x`, "spawn C"]);
  });

  test("nextRoute: a derived G outranks a stale handoff, and a pinned ticket with no worktree rebuilds at A", () => {
    const facts = () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const ledger = () => [{ n: 42, outcome: "handoff", cost: 0, park_reason: "phase E next", head: null }];
    const g = nextRoute(null, null, {
      read: () => ({ onTicket: true, ticket: 42, branch: "agent/42-x", cwd: "w", phase: "G", fix: false, ci: { pushed: true } }),
      facts,
      ledger,
    } as never);
    assert.equal(g.phase, "G");
    const stranded = nextRoute(42, null, { read: () => ({ onTicket: false, phase: "A" }), facts, ledger } as never);
    assert.deepEqual([stranded.phase, stranded.resuming], ["A", true]);
  });

  test("an ff failure before a fix parks", async () => {
    const parked: { n: number; why: string }[] = [];
    let spawns = 0;
    const r = await runOnce(
      io({
        pick: () => ({
          skill: "implement",
          number: 42,
          title: "t",
          size: null,
          queue: null,
          resuming: true,
          phase: "C",
          fix: true,
          cwd: ".worktrees/agent-42",
          branch: "agent/42-x",
        }),
        refreshWorktree: () => {
          throw Object.assign(new Error("Command failed: git merge"), {
            stderr: "fatal: Not possible to fast-forward, aborting.\nhint: x",
          });
        },
        spawn: async () => (spawns += 1) as never,
        park: (n: number, c: { why: string }) => parked.push({ n, why: c.why }),
      }),
    );
    assert.equal(spawns, 0);
    assert.equal(r.outcome, "parked");
    assert.equal(parked.length, 1);
    assert.match(parked[0].why, /Not possible to fast-forward, aborting\.$/);
  });

  test("refreshWorktree fetches the branch and fast-forwards onto it", () => {
    const calls: unknown[] = [];
    refreshWorktree("w", "agent/42-x", (file: string, args: string[]) => String(calls.push([file, ...args])));
    assert.deepEqual(calls, [
      ["git", "-C", "w", "fetch", "--quiet", "origin", "agent/42-x"],
      ["git", "-C", "w", "merge", "--ff-only", "origin/agent/42-x"],
    ]);
  });

  test("a landed or parked ticket removes the worktree from the main checkout", () => {
    const calls: [string, string[], { cwd?: string } | undefined][] = [];
    const run = (file: string, args: string[], opts?: { cwd?: string }) => {
      calls.push([file, args, opts]);
      return "";
    };
    removeWorktree("w", run);
    park(42, { phase: "E", why: "x", log: "l", cwd: "w", branch: "b", dirty: false, run, write: () => {} });
    const removals = calls.filter(([, args]) => args.includes("worktrees:remove"));
    assert.equal(removals.length, 2);
    for (const [file, args, opts] of removals) {
      assert.deepEqual([file, args, path.resolve(opts?.cwd ?? "")], ["npm", ["run", "worktrees:remove", "--", "w"], ROOT]);
    }
  });

  test("an unreadable CI read on a head not known pushed is not a no-spawn G", () => {
    const route: any = nextRoute(null, null, {
      read: () => ({
        onTicket: true,
        ticket: 42,
        branch: "agent/42-x",
        cwd: "w",
        phase: "G",
        fix: false,
        ci: { state: "unreadable", pushed: false, pr: 5 },
      }),
      facts: () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 }),
      ledger: () => [],
    } as never);
    assert.equal(route.phase, "E");
  });

  test("a handed phase wins over a derived fix; only a pushed G outranks it", () => {
    const status = { onTicket: true, ticket: 42, branch: "agent/42-x", cwd: "w", fix: true };
    const deps = (s: object) =>
      ({
        read: () => s,
        facts: () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 }),
        ledger: () => [],
      }) as never;
    const handed: any = nextRoute(42, "D" as never, deps({ ...status, phase: "C", ci: { pushed: true, state: "red" } }));
    assert.deepEqual([handed.phase, handed.fix], ["D", true]);
    const settling: any = nextRoute(42, "D" as never, deps({ ...status, fix: false, phase: "G", ci: { pushed: true } }));
    assert.equal(settling.phase, "G");
  });

  const fixRoute = (head: string) => ({
    skill: "implement",
    number: 42,
    title: "t",
    size: null,
    queue: null,
    resuming: true,
    phase: "C",
    fix: true,
    head,
    cwd: ".worktrees/agent-42",
    branch: "agent/42-x",
  });
  const retryRow = (head: string) => ({ n: 42, outcome: "retry", cost: 1, park_reason: null, head });

  test("a red round nobody recorded counts toward the cap, and the last one parks before the refresh", async () => {
    const ledger: any[] = [retryRow("h1"), retryRow("h2")];
    const order: string[] = [];
    const r = await runOnce(
      io(
        {
          pick: () => fixRoute("h3"),
          refreshWorktree: () => order.push("refresh"),
          spawn: async () => order.push("spawn") as never,
          park: (_n: number, c: { why: string }) => order.push(c.why),
        },
        ledger,
      ),
      42,
    );
    assert.equal(r.outcome, "parked");
    assert.equal(order.length, 1);
    assert.match(order[0], /3 CI rounds/);
    assert.deepEqual(ledger.filter((x) => x.outcome === "parked").length, 1);
  });

  test("a CI-RED already posted for the unrecorded head counts that round once, not twice", async () => {
    const pass = async (rows: any[], ciRounds: number, red: boolean) => {
      const ledger = [...rows];
      const spawned: number[] = [];
      const r = await runOnce(
        io(
          {
            pick: () => fixRoute("h2"),
            refreshWorktree: () => {},
            tally: (n: number) => ({ ...ticketTally(n, ledger), ciRounds }),
            spawn: async (s: { retryCount: number }) => {
              spawned.push(s.retryCount);
              return { status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "F", declared: null };
            },
            settle: async () => (red ? { action: "hand-back", reason: "CI failed" } : { action: "merge", reason: "" }),
          },
          ledger,
        ),
        42,
      );
      return [r.outcome, spawned[0] ?? null];
    };
    assert.deepEqual(await pass([retryRow("h1")], 2, false), ["landed", 2]);
    assert.deepEqual(await pass([retryRow("h1")], 2, true), ["parked", 2]);
    assert.deepEqual(await pass([], 2, false), ["landed", 2]);
    assert.deepEqual(await pass([], 2, true), ["parked", 2]);
    assert.deepEqual(await pass([], 3, false), ["parked", null]);
    assert.deepEqual(await pass([retryRow("h1")], 1, false), ["landed", 2]);
    assert.deepEqual(await pass([retryRow("h1")], 1, true), ["parked", 2]);
  });

  test("a red round nobody recorded is written down before the fix round; a recorded one is not", async () => {
    const spawn = async () => ({ status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "F", declared: null });
    const unrecorded: any[] = [retryRow("h1")];
    await runOnce(io({ pick: () => fixRoute("h2"), refreshWorktree: () => {}, spawn }, unrecorded), 42);
    assert.deepEqual(unrecorded.map((x) => [x.outcome, x.head, x.cost]), [
      ["retry", "h1", 1],
      ["retry", "h2", 0],
      ["landed", null, 0],
    ]);
    const recorded: any[] = [retryRow("h1")];
    await runOnce(io({ pick: () => fixRoute("h1"), refreshWorktree: () => {}, spawn }, recorded), 42);
    assert.deepEqual(recorded.map((x) => x.outcome), ["retry", "landed"]);
  });

  test("a fix round's spawn carries the rounds already spent", async () => {
    const seen: unknown[] = [];
    const spawn = async (r: { fix: boolean; retryCount: number }) => {
      seen.push([r.fix, r.retryCount]);
      return { status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "F", declared: null };
    };
    await runOnce(io({ pick: () => fixRoute("h2"), refreshWorktree: () => {}, spawn }, [retryRow("h1")]), 42);
    assert.deepEqual(seen, [[true, 2]]);
  });

  test("known with the fix not on main removes the worktree and records blocked_by", async () => {
    const blocked: unknown[] = [];
    const parked: number[] = [];
    const rows: any[] = [];
    const r = await runOnce(
      io({
        settle: async () => ({ action: "hand-back", reason: "CI failed at Lint", head: "h1", blockedBy: 900 }),
        block: (n: number, blocker: number, cwd: string | null) => blocked.push([n, blocker, cwd]),
        park: (n: number) => parked.push(n),
        record: (x: unknown) => rows.push(rowOf(x)),
      }),
    );
    assert.deepEqual([r.outcome, blocked, parked], ["blocked", [[42, 900, ".worktrees/agent-42"]], []]);
    assert.deepEqual(rows.map((x) => [x.outcome, x.head]), [["blocked", "h1"]]);

    const calls: string[][] = [];
    blockOnShared(42, 900, "w", (file: string, args: string[]) => {
      calls.push([file, ...args]);
      return args.includes(".id") ? "123456\n" : "";
    });
    assert.deepEqual(calls, [
      ["gh", "api", "repos/metasito/murlan/issues/900", "--jq", ".id"],
      ["gh", "api", "-X", "POST", "repos/metasito/murlan/issues/42/dependencies/blocked_by", "-F", "issue_id=123456"],
      ["npm", "run", "worktrees:remove", "--", "w"],
    ]);
  });

  test("a block that cannot be recorded parks instead", async () => {
    const parked: string[] = [];
    const r = await runOnce(
      io({
        settle: async () => ({ action: "hand-back", reason: "CI failed at Lint", blockedBy: 900 }),
        block: () => {
          throw new Error("HTTP 404");
        },
        park: (_n: number, c: { why: string }) => parked.push(c.why),
      }),
    );
    assert.equal(r.outcome, "parked");
    assert.match(parked[0], /#900.*HTTP 404/);
  });

  test("a G pass with no open pull request says so", async () => {
    const parked: string[] = [];
    await runOnce(
      io({
        pick: () => ({ skill: "implement", number: 42, title: "t", size: null, queue: null, resuming: true, phase: "G" }),
        pushedPr: () => null,
        park: (_n: number, c: { why: string }) => parked.push(c.why),
      }),
    );
    assert.deepEqual(parked, ["phase G found no open pull request for the pushed head"]);
  });

  test("the retry row carries the head CI judged, not the one before update-branch", async () => {
    const rows: any[] = [];
    const r = await runOnce(
      io({
        pushedPr: () => ({ number: 984, state: "OPEN", head: "agent/42-x", sha: "before" }),
        settle: async () => ({ action: "hand-back", reason: "CI failed at Lint", head: "judged" }),
        record: (x: unknown) => rows.push(x),
      }),
    );
    assert.deepEqual([rows[0].head, (r as { sha?: string }).sha], ["judged", "judged"]);
  });

  const landedRun = (dirty: string, failWrite = false) => {
    const calls: [string, string[], { cwd?: string; encoding?: string } | undefined][] = [];
    const written: string[] = [];
    const said: string[] = [];
    removeLanded(".worktrees/agent-42", 42, {
      run: (file: string, args: string[], opts?: { cwd?: string; encoding?: string }) => {
        calls.push([file, args, opts]);
        if (args.includes("--porcelain")) return dirty;
        return args.includes("--binary") ? Buffer.from("PATCH") : "";
      },
      write: (file: string, body: Buffer) => {
        if (failWrite) throw new Error("EACCES");
        written.push(`${file}=${body}`);
      },
      say: (m: string) => said.push(m),
    } as never);
    const removals = calls.filter(([, args]) => args.includes("worktrees:remove"));
    return { calls, written, said, removals };
  };

  test("a landed worktree with leftovers is saved as a binary patch, then force-removed", () => {
    const { calls, written, said, removals } = landedRun("?? stray.png\n");
    assert.ok(calls.some(([, a]) => a.join(" ") === "-C .worktrees/agent-42 add -A"));
    const diff = calls.find(([, a]) => a.includes("--binary"));
    assert.deepEqual(diff?.[1], ["-C", ".worktrees/agent-42", "diff", "--cached", "--binary", "HEAD"]);
    assert.equal(diff?.[2]?.encoding, "buffer");
    assert.equal(written.length, 1);
    assert.match(written[0], /leftover-42\.patch=PATCH$/);
    assert.match(said.join("\n"), /leftover-42\.patch/);
    assert.deepEqual(removals.map(([, a, o]) => [a, path.resolve(o?.cwd ?? "")]), [
      [["run", "worktrees:remove", "--", ".worktrees/agent-42", "--force"], ROOT],
    ]);
  });

  test("a leftover patch that cannot be written keeps the worktree", () => {
    const { removals, said } = landedRun("?? stray.png\n", true);
    assert.deepEqual(removals, []);
    assert.match(said.join("\n"), /EACCES/);
  });

  test("a clean landed worktree is removed without --force", () => {
    const { removals, written } = landedRun("");
    assert.deepEqual(written, []);
    assert.deepEqual(removals.map(([, a]) => a), [["run", "worktrees:remove", "--", ".worktrees/agent-42"]]);
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
  const screen = () => ({ say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} });

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
  const screen = () => ({ say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} });

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

  test("a standing() that throws still releases the claim", async () => {
    const parked: number[] = [];
    let picked = 0;
    const spy = {
      ...(io() as any),
      pick: () => ({ skill: "implement", number: 4400 + ++picked, title: "t", size: null, queue: null }),
      spawn: async () => {
        throw new Error("the session could not start");
      },
      standing: () => {
        throw new Error("git worktree list failed");
      },
      park: (n: number) => parked.push(n),
    };
    await main({ io: spy, book: book(), screen: screen(), install: () => {}, runId: "t" });
    assert.deepEqual(parked, [4401, 4402, 4403]);
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
      screen: {
        say: () => {},
        warn: (m: string) => said.push(m),
        notice: (_l: string, m: string) => said.push(m),
        stop: () => {},
      },
      install: () => {},
      runId: "t",
    });
    assert.equal(code, 1);
    assert.match(said.join("\n"), /#4301 is still claimed/, "a ticket nobody can release must be named");
  });
});

describe("a handoff", () => {
  const book = () => ({ totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, record: () => {}, close: () => {} });
  const screen = () => ({ say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} });

  // The phase reaching the picker is the whole of task 1: without it the next process asks derive(),
  // which can only ever answer C, D, E or ?, and every handoff restarts at a phase it already ran.
  test("starts the next process at the phase the session named", async () => {
    const at: (string | null)[] = [];
    let n = 0;
    const spy = {
      ...(io() as any),
      pick: (_pinned: number | null, phase: string | null) => {
        at.push(phase);
        return { skill: "implement", number: 41, title: "t", size: "size:S", queue: null };
      },
      spawn: async () => ({
        status: 0,
        blocked: false,
        result: { cost: 1, turns: 2 },
        ms: 1,
        log: "l",
        phase: "C",
        size: "size:S",
        declared: n++ === 0 ? { ticket: 41, phase: "C", handoff: "D", stoodDown: false } : null,
      }),
      pushedPr: () => null,
      standing: () => null,
    };
    await main({ io: spy, book: book(), screen: screen(), install: () => {}, runId: "t" });
    assert.deepEqual(at.slice(0, 2), [null, "D"], "the second pick must be told which phase to start");
  });
});

describe("a fix round that changed nothing", () => {
  const book = () => ({ totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, record: () => {}, close: () => {} });
  const screen = () => ({ say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} });

  // #1028's rounds 2 and 3 were byte-identical no-ops — five turns of phase A and a close, twice —
  // and each counted against the three the ticket gets.
  test("does not spend the next one, because CI would answer the same", async () => {
    const parked: string[] = [];
    let spawns = 0;
    const spy = {
      ...(io() as any),
      spawn: async () => {
        spawns += 1;
        return { status: 0, blocked: false, result: { cost: 1 }, ms: 1, log: "l", phase: "F", declared: null };
      },
      pushedPr: () => ({ number: 984, state: "OPEN", head: "agent/42-x", sha: "aaa111", changedFiles: 2 }),
      settle: async () => ({ action: "hand-back", reason: "CI failed at Native tests" }),
      park: (_n: number, note: { why: string }) => parked.push(note.why),
    };
    await main({ io: spy, book: book(), screen: screen(), install: () => {}, runId: "t" });
    // Three tickets before the breaker ends the night, and two rounds each — never the third that
    // `CI_ROUNDS` would otherwise allow, because the second one moved nothing.
    assert.equal(parked.length, 3);
    assert.equal(spawns, 6, "two rounds per ticket; a third would be nine");
    assert.match(parked[0] ?? "", /pushed no commit/);
  });
});

describe("what a ticket's clock covers", () => {
  // The land is the longest stretch of a ticket and the session that built it has already exited.
  test("the recorded time carries the land, not just the session", async () => {
    const rows: any[] = [];
    await runOnce(
      io({
        settle: async () => {
          await new Promise((r) => setTimeout(r, 30));
          return { action: "merge", reason: "merged" };
        },
        record: (x: unknown) => rows.push(x),
      }),
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0].run.ms > 1000, `the row's clock is still the session's ${rows[0].run.ms}ms`);
  });
});

describe("a ticket's tally comes from the ledger, not from memory", () => {
  const book = () => ({ totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, record: () => {}, close: () => {} });
  const screen = () => ({ say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} });
  const go = (spy: unknown) => main({ io: spy as never, book: book(), screen: screen(), install: () => {}, runId: "t" });
  const ticket = { skill: "implement", number: 42, title: "t", size: "size:S", queue: null };
  const done = { skill: "handoff", number: 0, title: "queue empty" };
  const once = (route: object) => {
    let n = 0;
    return () => (n++ === 0 ? route : done);
  };
  const red = (sha: string) => ({
    pushedPr: () => ({ number: 984, state: "OPEN", head: "agent/42-x", sha }),
    settle: async () => ({ action: "hand-back", reason: "CI failed at Lint" }),
  });
  const session = (cost: number, handoff: string | null) => ({
    status: 0,
    blocked: false,
    result: { cost },
    ms: 1,
    log: "l",
    phase: "C",
    declared: handoff ? { ticket: 42, phase: "C", handoff, stoodDown: false } : null,
  });
  const retryRow = (head: string) => ({ n: 42, outcome: "retry", cost: 1, park_reason: null, head });
  const handoffRow = () => ({ n: 42, outcome: "handoff", cost: 0, park_reason: "phase D next", head: null });
  const plan = (sessions: object[]) => {
    let s = 0;
    return {
      pick: (_p: number | null, at: string | null) => (s < sessions.length ? { ...ticket, at } : done),
      spawn: async () => sessions[s++],
    };
  };

  test("a restart mid fix round keeps the round count: the third red run parks", async () => {
    const why: string[] = [];
    const ledger = [retryRow("h1"), retryRow("h2")];
    await go(io({ pick: once(ticket), ...red("h3"), park: (_n: number, c: { why: string }) => why.push(c.why) }, ledger));
    assert.equal(why.length, 1);
    assert.match(why[0], /3 CI rounds/);
  });

  test("a retry resets handoffsThisRound and the handed phase", async () => {
    const at: (string | null)[] = [];
    const parked: string[] = [];
    const sessions = [...Array(MAX_HANDOFFS - 1).fill(0).map(() => session(1, "D")), session(1, null), session(1, "E")];
    const p = plan(sessions);
    await go(
      io({
        ...p,
        pick: (pin: number | null, phase: string | null) => {
          at.push(phase);
          return p.pick(pin, phase);
        },
        ...red("h1"),
        park: (_n: number, c: { why: string }) => parked.push(c.why),
      }),
    );
    assert.deepEqual(parked, []);
    assert.deepEqual(at, [null, ...Array(MAX_HANDOFFS - 1).fill("D"), null, "E"]);
  });

  test("the retry session's cost counts toward the spend ceiling", async () => {
    const parked: string[] = [];
    const ceiling = USD_BY_SIZE["size:S"];
    await go(
      io({
        ...plan([session(ceiling - 1, null), session(2, "D")]),
        ...red("h1"),
        park: (_n: number, c: { why: string }) => parked.push(c.why),
      }),
    );
    assert.equal(parked.length, 1);
    assert.match(parked[0], /over this ticket's ceiling/);
  });

  test("a fix round whose head equals lastRedHead parks even after a restart", async () => {
    const why: string[] = [];
    await go(
      io({ pick: once(ticket), ...red("aaa111"), park: (_n: number, c: { why: string }) => why.push(c.why) }, [
        retryRow("aaa111"),
      ]),
    );
    assert.equal(why.length, 1);
    assert.match(why[0], /pushed no commit/);
  });

  test("overSpend, overHandoffs, the no-commit park and a thrown iteration each write exactly one parked row", async () => {
    const cases: Record<string, [Record<string, unknown>, object[]]> = {
      overSpend: [{ ...plan([session(1000, "D")]) }, []],
      overHandoffs: [{ ...plan([session(0, "D")]) }, Array(MAX_HANDOFFS - 1).fill(0).map(handoffRow)],
      noCommit: [{ pick: once(ticket), ...red("aaa111") }, [retryRow("aaa111")]],
      thrown: [
        {
          pick: once(ticket),
          sharedCheckoutDirty: () => {
            throw new Error("index.lock");
          },
        },
        [],
      ],
    };
    for (const [name, [over, seed]] of Object.entries(cases)) {
      const ledger: any[] = [...seed];
      await go(io(over, ledger));
      assert.equal(ledger.filter((r) => r.outcome === "parked").length, 1, name);
    }
  });

  test("a blocked ticket is let go: the next pick is unpinned, and the night is not failing", async () => {
    const pins: (number | null)[] = [];
    let n = 0;
    const code = await go(
      io({
        pick: (p: number | null) => (pins.push(p), n++ < 3 ? ticket : done),
        settle: async () => ({ action: "hand-back", reason: "CI failed at Lint", blockedBy: 900 }),
      }),
    );
    assert.deepEqual([code, pins], [0, [null, null, null, null]]);
  });

  test("blocked twice then unblocked: the next red is round 1, not round 3", async () => {
    const parked: string[] = [];
    const blockedRow = (head: string) => ({ n: 42, outcome: "blocked", cost: 1, park_reason: "blocked by #900", head });
    const ledger: any[] = [blockedRow("h1"), blockedRow("h2")];
    await go(io({ pick: once(ticket), ...red("h3"), park: (_n: number, c: { why: string }) => parked.push(c.why) }, ledger));
    assert.deepEqual(parked, []);
    assert.equal(ticketTally(42, ledger).retries, 1);
  });

  test("a throw during a resumed run parks with standing().cwd", async () => {
    const cwds: (string | null)[] = [];
    await go(
      io({
        pick: once({ ...ticket, resuming: true, phase: "C" }),
        sharedCheckoutDirty: () => {
          throw new Error("index.lock");
        },
        park: (_n: number, c: { cwd: string | null }) => cwds.push(c.cwd),
      }),
    );
    assert.deepEqual(cwds, [".worktrees/agent-42"]);
  });
});

// tools/loop/tests/queueLoopMain.test.ts
//
// runOnce is the composition eight of the ten headline defects lived in, and it was the one part
// with no test: every export was unit-tested and the way they were put together was not.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  parkAsked,
  runOnce,
  afterSession,
  main,
  nextRoute,
  park,
  refreshWorktree,
  publishForReview,
  removeLanded,
  removeWorktree,
  MAX_HANDOFFS,
  USD_BY_SIZE,
  WAIT,
} from "../queue-loop.mjs";
import { readLine } from "../loop-stream.mjs";
import { failingTestIds } from "../ciVerdict.ts";
import { parkReasonOf, ticketTally } from "../loop-logs.mjs";
import { PLAIN } from "../loop-render.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const rowOf = (x: any) => ({
  n: x.number,
  outcome: x.outcome,
  cost: x.run?.result?.cost ?? 0,
  park_reason: parkReasonOf(x.outcome, x.why),
  head: x.head ?? null,
  handoff: x.handoff ?? null,
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
  publish: () => {},
  announce: () => {},
  diagnose: async () => ({ ok: false, error: "no diagnosis here", run: { result: null, ms: 0, log: "l", phases: {} } }),
  rerun: () => {},
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
    assert.deepEqual(
      rows.map((x) => [x.outcome, x.run.result?.cost ?? 0, x.merged ?? false]),
      [
        ["pushed", 1, false],
        ["retry", 0, false],
      ],
    );
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

    const published: unknown[][] = [];
    const passed = await runOnce(io({ spawn: handingOff("C", "D"), publish: (...a: unknown[]) => published.push(a) }, []));
    assert.equal(passed.phase, "D");
    assert.deepEqual(published, [[42, "agent/42-x", ".worktrees/agent-42"]], "a head handed to review is pushed for CI");
  });

  test("a HOLD fix handed back to D needs the local pass too, and is pushed only with it", async () => {
    for (const passes of [false, true]) {
      const published: unknown[] = [];
      const r = await runOnce(
        io({ spawn: handingOff("D", "D"), buildPassed: () => passes, publish: (n: unknown) => published.push(n) }, []),
      );
      assert.deepEqual([r.phase, published.length], passes ? ["D", 1] : ["C", 0]);
    }
  });

  test("a handoff anywhere but D pushes nothing", async () => {
    const published: unknown[] = [];
    await runOnce(io({ spawn: handingOff("E", "C"), publish: (n: unknown) => published.push(n) }, []));
    assert.deepEqual(published, []);
  });

  test("a C handoff out of a refused D or a red E carries its reason to the next C session only", async () => {
    const next = async (ledger: any[], phase: string) => {
      const seen: unknown[] = [];
      const pick = () => ({ skill: "implement", number: 42, title: "t", size: null, queue: null, resuming: true, phase });
      await runOnce(io({ pick, spawn: async (s: { reason?: string | null }) => (seen.push(s.reason), handingOff(phase, "F")()) }, ledger), 42, phase);
      return seen[0];
    };
    const cases: [string, string, boolean, string, RegExp | null][] = [
      ["C", "D", false, "C", /no local pass or no full DOD-CHECK on HEAD/],
      ["E", "C", true, "C", /phase E's agent:check was red/],
      ["C", "D", true, "D", null],
    ];
    for (const [from, to, passes, phase, reason] of cases) {
      const ledger: any[] = [];
      await runOnce(io({ spawn: handingOff(from, to), buildPassed: () => passes }, ledger));
      const got = await next(ledger, phase);
      if (reason) assert.match(String(got), reason);
      else assert.equal(got ?? null, null);
    }
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

  test("a stray plugin stops the run instead of parking the ticket it happened to meet", async () => {
    const parked: string[] = [];
    const ledger: any[] = [];
    const r = await runOnce(
      io(
        {
          spawn: async () => ({ status: 1, blocked: false, result: null, ms: 1, log: "l", phase: null, declared: null, strayPlugin: "the session loaded ponytail@ponytail" }),
          park: (_n: number, c: { why: string }) => parked.push(c.why),
        },
        ledger,
      ),
    );
    assert.deepEqual([r.outcome, parked], ["stop", []]);
    assert.match(String(r.why), /ponytail/);
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

  test("nextRoute replays 2026-09-21/22: every session starts where the ledger before it pointed", () => {
    const rows = readFileSync(path.join(import.meta.dirname, "fixtures", "ledger-2026-09-21.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const facts = () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const settle = { phase: "G", ci: { pushed: true } };
    const status = { handoff: { phase: "C" }, pushed: settle, retry: { phase: "C", fix: true } };
    let replayed = 0;
    rows.forEach((row, i) => {
      const next = rows.slice(i + 1).find((r) => r.n === row.n);
      if (!next || !(row.outcome in status)) return;
      // A next row with no phases is a settle: derive() read a pushed head, which outranks a handoff.
      const derived = Object.keys(next.phases).length ? status[row.outcome as keyof typeof status] : settle;
      const route = nextRoute(null, null, {
        read: () => ({ onTicket: true, ticket: row.n, branch: "b", cwd: "w", fix: false, ...derived }),
        facts,
        ledger: () => rows.slice(0, i + 1),
      } as never);
      assert.equal(route.phase, Object.keys(next.phases)[0] ?? "G", `#${row.n} after its ${row.outcome} row at ${row.started}`);
      replayed += 1;
    });
    assert.equal(replayed, 86);
  });

  test("nextRoute: a pinned ticket with no worktree rebuilds at A", () => {
    const facts = () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const ledger = () => [{ n: 42, outcome: "handoff", cost: 0, park_reason: "phase E next", head: null }];
    const stranded = nextRoute(42, null, { read: () => ({ onTicket: false, phase: "A" }), facts, ledger } as never);
    assert.deepEqual([stranded.phase, stranded.resuming], ["A", true]);
  });

  test("nextRoute: a LAND on the head outranks a handoff to review, and nothing else does", () => {
    const facts = () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const toReview = () => [{ n: 42, outcome: "handoff", cost: 0, park_reason: "phase D next", head: null }];
    const at = (phase: string, pinned: string | null = null) =>
      nextRoute(42, pinned as never, {
        read: () => ({ onTicket: true, ticket: 42, branch: "agent/42-x", cwd: "w", phase, fix: false }),
        facts,
        ledger: toReview,
      } as never).phase;
    assert.deepEqual([at("E"), at("E", "D"), at("D"), at("C")], ["E", "E", "D", "D"]);
  });

  test("a closed ticket whose worktree still stands is torn down and the queue picked again, with no spawn on it", async () => {
    const facts = (state: string, labels: string[]) => () =>
      ({ title: "t", url: "", size: null, labels, reviewRounds: 1, ciRounds: 0, state }) as never;
    const status = { onTicket: true, ticket: 7, branch: "agent/7-x", cwd: "w7", phase: "C", fix: false };
    for (const labels of [["in-progress"], []]) {
      const route: any = nextRoute(null, null, { read: () => status, facts: facts("CLOSED", labels), ledger: () => [] } as never);
      assert.deepEqual([route.skill, route.number, route.cwd], ["closed", 7, "w7"]);
    }
    const open: any = nextRoute(null, null, { read: () => status, facts: facts("OPEN", ["in-progress"]), ledger: () => [] } as never);
    assert.equal(open.skill, "implement");

    const picks: unknown[] = [];
    const torn: unknown[] = [];
    const spawned: number[] = [];
    const routes = [{ skill: "closed", number: 7, title: "t", cwd: "w7", queue: null, resuming: false }, undefined];
    const r = await runOnce(
      io({
        pick: (p: unknown, at: unknown) => {
          picks.push([p, at]);
          return routes.shift() ?? io().pick();
        },
        teardown: (cwd: string | null, n: number) => torn.push([cwd, n]),
        spawn: async (s: { number: number }) => {
          spawned.push(s.number);
          return io().spawn();
        },
      }),
      7,
      "C",
    );
    assert.deepEqual([torn[0], spawned, picks, r.ticket], [["w7", 7], [42], [[7, "C"], [null, null]], 42]);
  });

  test("a closed ticket unrelated to the pinned one keeps the pin, and its phase, on re-pick", async () => {
    const picks: unknown[] = [];
    const routes = [{ skill: "closed", number: 7, title: "t", cwd: "w7", queue: null, resuming: false }, undefined];
    await runOnce(
      io({
        pick: (p: unknown, at: unknown) => {
          picks.push([p, at]);
          return routes.shift() ?? io().pick();
        },
        teardown: () => {},
      }),
      99,
      "D",
    );
    assert.deepEqual(picks, [[99, "D"], [99, "D"]]);
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
    const timeouts: unknown[] = [];
    refreshWorktree("w", "agent/42-x", (file: string, args: string[], o?: { timeout?: number }) => {
      timeouts.push(o?.timeout);
      return String(calls.push([file, ...args]));
    });
    assert.ok(timeouts.every((t) => typeof t === "number" && t > 0), `unbounded: ${timeouts.join(", ")}`);
    assert.deepEqual(calls, [
      ["git", "-C", "w", "fetch", "--quiet", "origin", "agent/42-x"],
      ["git", "-C", "w", "merge", "--ff-only", "origin/agent/42-x"],
    ]);
  });

  test("publishForReview pushes, then opens a draft only when no pull request is open", () => {
    for (const open of [[], [{ number: 7 }]]) {
      const calls: string[][] = [];
      const timeouts: unknown[] = [];
      publishForReview(42, "agent/42-x", "w", "the title", (file: string, args: string[], o?: { timeout?: number }) => {
        calls.push([file, ...args]);
        timeouts.push(o?.timeout);
        return args[1] === "list" ? JSON.stringify(open) : "";
      });
      assert.ok(timeouts.every((t) => typeof t === "number" && t > 0));
      assert.deepEqual(calls[0], ["git", "-C", "w", "push", "--quiet", "-u", "origin", "agent/42-x"]);
      const create = calls.find((c) => c[2] === "create");
      if (open.length) {
        assert.equal(create, undefined);
        continue;
      }
      assert.ok(create?.includes("--draft"));
      assert.match(String(create?.[create.indexOf("--body") + 1]), /^Closes #42\n/);
      assert.equal(create?.[create.indexOf("--head") + 1], "agent/42-x");
    }
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
      ["pushed", null, 0],
      ["landed", null, 0],
    ]);
    const recorded: any[] = [retryRow("h1")];
    await runOnce(io({ pick: () => fixRoute("h1"), refreshWorktree: () => {}, spawn }, recorded), 42);
    assert.deepEqual(recorded.map((x) => x.outcome), ["retry", "pushed", "landed"]);
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
    assert.deepEqual([rows.map((x) => x.head), (r as { sha?: string }).sha], [["before", "judged"], "judged"]);
  });

  const landedRun = (dirty: string, failWrite = false, unmerged = false) => {
    const calls: [string, string[], { cwd?: string; encoding?: string } | undefined][] = [];
    const written: string[] = [];
    const said: string[] = [];
    removeLanded(".worktrees/agent-42", 42, {
      run: (file: string, args: string[], opts?: { cwd?: string; encoding?: string }) => {
        calls.push([file, args, opts]);
        if (args.includes("--porcelain")) return dirty;
        if (args.includes("--show-current")) return "agent/42-x\n";
        if (unmerged && args[1] === "-d") throw new Error("error: the branch 'agent/42-x' is not fully merged");
        return args.includes("--binary") ? Buffer.from("PATCH") : "";
      },
      write: (file: string, body: Buffer) => {
        if (failWrite) throw new Error("EACCES");
        written.push(`${file}=${body}`);
      },
      say: (m: string) => said.push(m),
    } as never);
    const removals = calls.filter(([, args]) => args.includes("worktrees:remove"));
    const deletes = calls.filter(([, args]) => args[0] === "branch" && args[1] === "-d");
    return { calls, written, said, removals, deletes };
  };

  test("landing deletes the branch after the worktree, from the shared checkout", () => {
    const { calls, deletes } = landedRun("");
    assert.deepEqual(deletes.map(([, a, o]) => [a, path.resolve(o?.cwd ?? "")]), [[["branch", "-d", "agent/42-x"], ROOT]]);
    assert.ok(calls.findIndex(([, a]) => a.includes("worktrees:remove")) < calls.indexOf(deletes[0]));
  });

  test("a branch -d refuses is said, and the land still returns", () => {
    const { said, removals } = landedRun("", false, true);
    assert.equal(removals.length, 1);
    assert.match(said.join("\n"), /agent\/42-x was kept — error: the branch 'agent\/42-x' is not fully merged/);
  });

  test("a worktree kept for its unwritten leftovers keeps its branch too", () => {
    assert.deepEqual(landedRun("?? stray.png\n", true).deletes, []);
  });

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
      tickets: [],
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

  test("boot names the session the last supervisor died with", async () => {
    const said: string[] = [];
    const killed = { n: 1094, phase: "D", started: "2026-09-21T08:05:45Z", ms: 12 * 60_000, trailing: true };
    await main({
      io: { ...(io() as any), stopFile: () => true, killed: () => killed },
      book: book(),
      screen: { ...screen(), notice: (_l: string, m: string) => said.push(m) },
      install: () => {},
      runId: "t",
    });
    assert.ok(said.some((m) => /#1094's phase D session .* killed after 12 min/.test(m)), said.join("\n"));
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

  test("the run file says why the run stopped, not only its total", async () => {
    const closed: string[] = [];
    await main({
      io: { ...(io() as any), stopFile: () => true },
      book: { ...book(), close: (_id: string, line: string) => closed.push(line) },
      screen: screen(),
      install: () => {},
      runId: "t",
    });
    assert.match(closed.join("\n"), /stopped: \.loop-stop/);
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
    tickets: [],
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

describe("the run recap", () => {
  test("counts a wait still running as waiting, not working", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    let recap = (_t: unknown): string[] => [];
    let shown = "";
    let passes = 0;
    const board = {
      say: () => {},
      warn: () => {},
      notice: () => {},
      stop: () => {},
      close: () => {},
      board: (f: { recap?: typeof recap }) => void (f.recap && (recap = f.recap)),
      wait: () => {
        t.mock.timers.tick(3_600_000);
        shown = recap(PLAIN()).join("\n");
        return { woken: Promise.resolve(), say: null };
      },
    };
    const book = { totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} };
    const spy = { ...(io() as any), stopFile: () => passes++ > 0, queuePre: () => 2 };
    await main({ io: spy, book, screen: board as never, install: () => {}, runId: "t" });
    assert.match(shown, /working 0:00 · CI 0:00 · waiting 1:00:00/);
  });
});

describe("a handoff", () => {
  const book = () => ({ totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} });
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

describe("a park asked from the board", () => {
  const book = () => ({ totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} });
  const screen = () => ({ say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} });

  test("parks the ticket once its session exits, and forgets the request", async () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(path.join(tmpdir(), "park-"));
    const parked: { why: string; cwd: string | null; dirty: boolean }[] = [];
    const picks: (number | null)[] = [];
    let n = 0;
    const spy = {
      ...(io() as any),
      pick: (pinned: number | null) => {
        picks.push(pinned);
        if (picks.length > 2) return null;
        return { skill: "implement", number: 41, title: "t", size: "size:S", queue: null };
      },
      spawn: async () => ({
        status: 0,
        blocked: false,
        result: { cost: 1, turns: 2 },
        ms: 1,
        log: "l",
        phase: "C",
        declared: n++ === 0 ? { ticket: 41, phase: "C", handoff: "D", stoodDown: false } : null,
      }),
      park: (_n: number, { why, cwd, dirty }: { why: string; cwd: string | null; dirty: boolean }) => parked.push({ why, cwd, dirty }),
      pushedPr: () => null,
      standing: () => (n >= 1 ? { ticket: 41, branch: "agent/41-x", cwd: ".worktrees/agent-41", dirty: true, phase: "D" } : null),
    };
    try {
      process.chdir(dir);
      writeFileSync(".loop-park", "41\n");
      await main({ io: spy, book: book(), screen: screen(), install: () => {}, runId: "t" });
      assert.deepEqual(parked[0], { why: "parked by owner", cwd: ".worktrees/agent-41", dirty: true }, "the worktree's edits are kept");
      assert.equal(picks[1], null, "a parked ticket is not pinned for the next pass");
      assert.equal(existsSync(".loop-park"), false);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a red CI round parks in the phase git reports, with its worktree", async () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(path.join(tmpdir(), "park-"));
    const parked: { why: string; phase: string; cwd: string | null }[] = [];
    const spy = {
      ...(io() as any),
      spawn: async () => ({ status: 0, blocked: false, result: { cost: 1 }, ms: 1, log: "l", phase: "F", declared: null }),
      pushedPr: () => ({ number: 984, state: "OPEN", head: "agent/42-x", sha: "aaa111", changedFiles: 2 }),
      settle: async () => ({ action: "hand-back", reason: "CI failed at Native tests" }),
      park: (_n: number, { why, phase, cwd }: { why: string; phase: string; cwd: string | null }) => parked.push({ why, phase, cwd }),
    };
    try {
      process.chdir(dir);
      writeFileSync(".loop-park", "42\n");
      await main({ io: spy, book: book(), screen: screen(), install: () => {}, runId: "t" });
      assert.deepEqual(parked[0], { why: "parked by owner", phase: "E", cwd: ".worktrees/agent-42" });
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a ticket that lands before the park can act says the request was dropped", async () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(path.join(tmpdir(), "park-"));
    const said: string[] = [];
    const board = { ...screen(), notice: (kind: string, m: string) => said.push(`${kind}: ${m}`) };
    let picks = 0;
    try {
      process.chdir(dir);
      writeFileSync(".loop-park", "42\n");
      await main({ io: io({ pick: () => (picks++ ? null : (io() as any).pick()) }), book: book(), screen: board, install: () => {}, runId: "t" });
      assert.ok(said.some((m) => /^park: #42 landed before the park could act/.test(m)), JSON.stringify(said));
      assert.equal(existsSync(".loop-park"), false);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a request naming another ticket parks nothing", () => {
    assert.equal(parkAsked(41, () => "41\n"), true);
    assert.equal(parkAsked(42, () => "41\n"), false);
    assert.equal(parkAsked(null, () => "41\n"), false);
  });
});

describe("a fix round that changed nothing", () => {
  const book = () => ({ totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} });
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

describe("a session's cost is in the ledger before CI is waited on", () => {
  test("a supervisor that dies in the CI wait still counts the session, and the restarted G pass adds nothing", async () => {
    const ledger: any[] = [];
    const died = runOnce(io({ settle: () => Promise.reject(new Error("killed")) }, ledger));
    await assert.rejects(died, /killed/);
    assert.equal(ticketTally(42, ledger).spend, 1);

    const g = { skill: "implement", number: 42, title: "t", size: null, queue: null, resuming: true, phase: "G" };
    const r = await runOnce(io({ pick: () => g }, ledger));
    assert.equal(r.outcome, "landed");
    assert.equal(ledger.reduce((a, x) => a + x.cost, 0), 1);
  });

  for (const [name, verdict] of Object.entries({
    merged: { action: "merge", reason: "merged" },
    red: { action: "hand-back", reason: "CI failed" },
    owner: { action: "owner", reason: "no settle" },
  })) {
    test(`${name}: the session is counted once, and the tally reads as before`, async () => {
      const ledger: any[] = [];
      await runOnce(io({ settle: async () => verdict }, ledger));
      assert.equal(ledger.reduce((a, x) => a + x.cost, 0), 1);
      const t = ticketTally(42, ledger);
      assert.deepEqual([t.handoffsThisRound, t.lastHandoff, t.retries], [0, null, name === "red" ? 1 : 0]);
    });
  }
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
    assert.deepEqual(rows.map((x) => x.outcome), ["pushed", "landed"]);
    assert.equal(rows[0].run.ms, 1000);
    assert.ok(rows[1].run.ms >= 25, `the land's row has no clock of its own: ${rows[1].run.ms}ms`);
  });
});

describe("a ticket's tally comes from the ledger, not from memory", () => {
  const book = () => ({ totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} });
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

describe("a session the API failed", () => {
  const fixture = readFileSync(path.join(import.meta.dirname, "fixtures", "api-529.jsonl"), "utf8").trim().split("\n");
  const overloaded: object = fixture.map(readLine).find((f: any) => f?.kind === "result")!;
  const died = (result: object | null) => async () =>
    ({ status: 1, blocked: false, result, ms: 1, log: "l", phase: "E", declared: null });
  const ticket = { skill: "implement", number: 42, title: "t", size: "size:S", phase: "E", queue: null };
  const book = () => ({ totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} });
  const board = (notices: string[]) => ({
    say: () => {},
    warn: () => {},
    stop: () => {},
    close: () => {},
    notice: (_k: string, m: string) => notices.push(m),
    wait: () => ({ woken: Promise.resolve(), say: null }),
  });
  const night = (over: Record<string, unknown>, ledger: any[] = [], notices: string[] = []) =>
    main({ io: io({ pushedPr: () => null, ...over }, ledger) as any, book: book(), screen: board(notices) as never, install: () => {}, runId: "t" });

  for (const [name, result, outcome] of [
    ["the 529 #1156 parked on", overloaded, "overloaded"],
    ["a 429", { isError: true, apiStatus: 429 }, "overloaded"],
    ["an error naming no status", { isError: true, apiStatus: null }, "parked"],
    ["a non-zero exit with no result line", null, "parked"],
  ] as const) {
    test(`${name} is ${outcome}`, async () => {
      const r = await runOnce(io({ spawn: died(result), pushedPr: () => null }));
      assert.equal(r.outcome, outcome);
    });
  }

  test("a 429 from a spent usage window (#1074's) is a refusal, waited out to its reset", async () => {
    const spent = async () => ({ ...(await died({ isError: true, apiStatus: 429 })()), blocked: true, blockedUntil: 1789000000000 });
    const r = await runOnce(io({ spawn: spent, pushedPr: () => null }));
    assert.deepEqual([r.outcome, r.until], ["refused", 1789000000000]);
  });

  test("in phase E, with a pull request open, E is spawned again rather than the head settled", async () => {
    const picked: [number | null, string | null][] = [];
    const phases: string[] = [];
    let settled = 0;
    await night({
      stopFile: () => phases.length >= 2,
      pick: (p: number | null, at: string | null) => (picked.push([p, at]), ticket),
      spawn: async (route: { phase: string }) => (phases.push(route.phase), died(overloaded)()),
      pushedPr: () => ({ number: 984, state: "OPEN", head: "agent/42-x" }),
      settle: async () => (settled++, { action: "merge" }),
    });
    assert.equal(settled, 0);
    assert.deepEqual(phases, ["E", "E"]);
    assert.deepEqual(picked, [[null, null], [42, null]]);
  });

  test(`${WAIT.TRIES} in a row end the run and say why; a served session in between resets the count`, async () => {
    const notices: string[] = [];
    let spawns = 0;
    const code = await night({ spawn: async () => (spawns++, died(overloaded)()), pick: () => ticket }, [], notices);
    assert.equal(code, 1);
    assert.equal(spawns, WAIT.TRIES);
    assert.match(notices[0], new RegExp(`^#42 paused: the API answered 529 — trying again at .+ \\(1 of ${WAIT.TRIES}\\)$`));
    assert.equal(notices.at(-1), `the API answered 529, ${WAIT.TRIES} sessions in a row`);
    assert.doesNotMatch(notices.join("\n"), /usage/);

    spawns = 0;
    const served = WAIT.TRIES - 1;
    const handoff = { status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "C", declared: { ticket: 42, handoff: "C" } };
    const reset = await night({
      stopFile: () => spawns >= 2 * served + 1,
      pick: () => ticket,
      spawn: async () => (spawns++ === served ? handoff : died(overloaded)()),
    });
    assert.equal(reset, 0);
  });

  test("a hold is not a handoff: the ticket's handoff count stays where it was", async () => {
    const ledger: any[] = [];
    let spawns = 0;
    await night({ stopFile: () => spawns >= 3, pick: () => ticket, spawn: async () => (spawns++, died(overloaded)()) }, ledger);
    assert.deepEqual(ledger.map((r) => r.outcome), ["overloaded", "overloaded", "overloaded"]);
    assert.equal(ticketTally(42, ledger).handoffsThisRound, 0);
  });
});

describe("an unrecognised stop is diagnosed, once per head", () => {
  const RUN = 35661862241;
  const ciLog = readFileSync(path.join(import.meta.dirname, "fixtures", "ci-red-1100.txt"), "utf8");
  const answer = (d: object) => async () => ({ ok: true, ...d, run: { result: { cost: 0.2, turns: 6 }, ms: 1, log: "l", phases: {} } });
  const silent = async () => ({ status: 0, blocked: false, result: { cost: 1 }, ms: 1, log: "l", phase: "C", declared: null });
  const redAt1100 = async () => ({
    action: "hand-back",
    reason: "CI failed at Browser test report",
    head: "2f2a885",
    runId: RUN,
    unnamed: failingTestIds(ciLog).length === 0,
  });

  test("#1100's report-upload red is rerun, not handed to a fix round", async () => {
    const ledger: any[] = [];
    const reran: number[] = [];
    const asked: any[] = [];
    const r = await runOnce(
      io(
        {
          settle: redAt1100,
          diagnose: async (stop: any) => (asked.push(stop), answer({ action: "rerun", cause: "the artifact store answered 403" })()),
          rerun: (id: number) => reran.push(id),
        },
        ledger,
      ),
    );
    assert.deepEqual([r.outcome, r.phase], ["handoff", "G"]);
    assert.deepEqual(reran, [RUN]);
    assert.equal(asked[0].runId, RUN);
    assert.deepEqual(ledger.map((x) => x.outcome), ["pushed", "diagnosed", "handoff"]);
    assert.match(ledger[2].park_reason, /^phase G next — diagnosis: rerun of 35661862241: the artifact store/);
  });

  test("a session that exits without a LOOP-RESULT is diagnosed, and resumed where it says", async () => {
    const ledger: any[] = [];
    const whys: string[] = [];
    const r = await runOnce(
      io(
        {
          spawn: silent,
          pushedPr: () => null,
          diagnose: async (stop: any) => (whys.push(stop.why), answer({ action: "resume", phase: "C", cause: "tsc is red" })()),
        },
        ledger,
      ),
    );
    assert.deepEqual(whys, ["the session exited without a LOOP-RESULT"]);
    assert.deepEqual([r.outcome, r.phase], ["handoff", "C"]);
    assert.equal(ticketTally(42, ledger).handoffsThisRound, 1, "a resume counts toward MAX_HANDOFFS");
    assert.equal(ticketTally(42, ledger).handoffWhy, "diagnosis: tsc is red");
  });

  test("a park the diagnosis asks for carries its cause, not the exit", async () => {
    const whys: string[] = [];
    await runOnce(
      io({
        spawn: silent,
        pushedPr: () => null,
        diagnose: answer({ action: "park", cause: "the ticket's premise is gone: #900 removed the file" }),
        park: (_n: number, c: { why: string }) => whys.push(c.why),
      }),
    );
    assert.deepEqual(whys, ["the ticket's premise is gone: #900 removed the file"]);
  });

  test("a second stop on the same head parks without a second diagnosis", async () => {
    const ledger: any[] = [{ n: 42, outcome: "diagnosed", cost: 0.2, park_reason: "resume C — x", head: "a" }];
    let diagnoses = 0;
    const whys: string[] = [];
    const r = await runOnce(
      io(
        {
          spawn: silent,
          pushedPr: () => null,
          diagnose: async () => (diagnoses++, answer({ action: "resume", phase: "C", cause: "x" })()),
          park: (_n: number, c: { why: string }) => whys.push(c.why),
        },
        ledger,
      ),
    );
    assert.equal(r.outcome, "parked");
    assert.equal(diagnoses, 0);
    assert.deepEqual(whys, ["the session exited without a LOOP-RESULT"]);
  });

  test("a failed diagnosis parks with the original reason", async () => {
    const ledger: any[] = [];
    const whys: string[] = [];
    await runOnce(
      io({ settle: async () => ({ action: "owner", reason: "the branch conflicts with main" }), park: (_n: number, c: { why: string }) => whys.push(c.why) }, ledger),
    );
    assert.deepEqual(whys, ["the branch conflicts with main"]);
    assert.match(ledger.find((x) => x.outcome === "diagnosed").park_reason, /^the diagnosis failed: /);
  });

  test("an API 5xx never reaches diagnosis", async () => {
    const overloaded = readFileSync(path.join(import.meta.dirname, "fixtures", "api-529.jsonl"), "utf8").trim().split("\n").map(readLine).find((f: any) => f?.kind === "result");
    let diagnoses = 0;
    const r = await runOnce(
      io({
        spawn: async () => ({ status: 1, blocked: false, result: overloaded, ms: 1, log: "l", phase: "E", declared: null }),
        pushedPr: () => null,
        diagnose: async () => (diagnoses++, answer({ action: "park", cause: "x" })()),
      }),
    );
    assert.equal(r.outcome, "overloaded");
    assert.equal(diagnoses, 0);
  });

  test("a CI red naming its failing tests is a fix round, with no diagnosis", async () => {
    let diagnoses = 0;
    const r = await runOnce(io({ settle: async () => ({ ...(await redAt1100()), unnamed: false }), diagnose: async () => (diagnoses++, answer({ action: "park", cause: "x" })()) }));
    assert.deepEqual([r.outcome, diagnoses], ["retry", 0]);
  });

  test("nextRoute: a diagnosis handoff outranks the pushed head until a session has run on it", () => {
    const facts = () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const row = (outcome: string, park_reason: string | null = null) => ({ n: 42, outcome, cost: 0, park_reason, head: "a" });
    const route = (rows: object[], derived = "G", fix = false): any =>
      nextRoute(42, ticketTally(42, rows as never).lastHandoff as never, {
        read: () => ({ onTicket: true, ticket: 42, branch: "agent/42-x", cwd: "w", phase: derived, fix, ci: { pushed: true } }),
        facts,
        ledger: () => rows,
      } as never);
    const toC = [row("diagnosed", "resume C — conflicts with main"), row("handoff", "phase C next — diagnosis: conflicts with main")];
    assert.equal(route(toC).phase, "C");
    assert.equal(route([...toC, row("pushed")]).phase, "G", "the resumed session pushed, so its head settles");
    assert.equal(route([row("handoff", "phase C next — a declared one")]).phase, "G");
    const toD = [row("diagnosed", "resume D — no LAND"), row("handoff", "phase D next — diagnosis: no LAND")];
    assert.deepEqual([route(toD, "C", true).phase, route(toD, "C", true).fix], ["D", false], "a red head does not turn it into a fix round");
    assert.equal(route(toD, "E").phase, "D");
    const rerun = [row("diagnosed", "rerun — 403"), row("handoff", "phase G next — diagnosis: rerun of 1: 403")];
    assert.deepEqual([route(rerun, "C", true).phase, route(rerun, "C", true).fix], ["G", false]);
  });

  test("a resume C on an unnamed red is a counted fix round, and the next session gets the cause", async () => {
    const ledger: any[] = [];
    const cause = "the report step found no report: a shard died before writing one";
    const r = await runOnce(
      io({ settle: redAt1100, diagnose: answer({ action: "resume", phase: "C", cause }) }, ledger),
    );
    assert.equal(r.outcome, "retry");
    assert.deepEqual(ledger.map((x) => x.outcome), ["pushed", "diagnosed", "retry"]);
    const reasons: (string | null)[] = [];
    await runOnce(
      io({ spawn: async (route: any) => (reasons.push(route.reason), silent()), pushedPr: () => null }, ledger),
    );
    assert.deepEqual(reasons, [cause]);
  });
});

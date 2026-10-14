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
  landOne,
  runOnce,
  main,
  nextRoute,
  park,
  refreshWorktree,
  publishForReview,
  removeLanded,
  removeWorktree,
  MAX_HANDOFFS,
  RESTART,
  loopMoved,
  USD_BY_SIZE,
} from "../queue-loop.mjs";
import { afterSession, WAIT } from "../decide.mjs";
import { readLine } from "../loop-stream.mjs";
import { parkReasonOf, ticketTally } from "../loop-logs.mjs";
import { PLAIN } from "../loop-render.mjs";
import { ledgerFixture } from "./helpers/ledgerFixture.ts";
import { parkAsked } from "../loop-screen.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const rowOf = (x: any) => ({
  n: x.number,
  outcome: x.outcome,
  cost: x.run?.result?.cost ?? 0,
  park_reason: parkReasonOf(x.outcome, x.why),
  head: x.head ?? null,
  handoff: x.handoff ?? null,
  park_failed: x.parkFailed ?? null,
  flake: x.flake ?? null,
});

/** A visit whose read is `landing`, routed by the real `decide` as `landOne` routes it. */
const lands =
  (landing: object = MERGED, order?: string[]) =>
  async (_p: unknown, decideAt: (l: object) => any) => (order?.push("land"), decideAt({ n: 42, pr: 984, head: "judged", armed: false, ci: RED_CI, ...landing }));
const MERGED = { action: "already-merged", reason: "merged" };
const HAND_BACK = { action: "hand-back", reason: "CI failed at Lint" };
const RED_CI = { output: "✖ x", runId: 1, attempt: 2, failedStep: "Lint" };

const io = (over: Record<string, unknown> = {}, ledger: any[] = []) => ({
  stopFile: () => false,
  syncCheckout: () => true,
  housekeeping: () => ({ verdict: "ok", rows: [] }),
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
  land: lands(),
  inFlight: () => [],
  live: () => [],
  rebuild: () => {},
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
  issueState: () => ({ state: "OPEN", stateReason: null }),
  facts: () => ({ title: "t", size: "size:S", reviewRounds: null }),
  ledgerRows: () => ledger,
  repark: () => ({ failed: [], why: null }),
  ...over,
});

describe("runOnce", () => {
  test("a ticket that pushes and merges is landed, in one pass", async () => {
    const r = await runOnce(io());
    assert.equal(r.outcome, "landed");
    assert.equal(r.ticket, 42);
  });

  // The pushed head is visited before the pass returns: a head already merged or already red is
  // dealt with at once, and anything else is in the ledger for the next pass's sweep.
  test("the pushed head is visited before the pass returns", async () => {
    const order: string[] = [];
    await runOnce(
      io({
        spawn: async () => {
          order.push("spawn");
          return { status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "F", declared: null };
        },
        land: lands(MERGED, order),
      }),
    );
    assert.deepEqual(order, ["spawn", "land"]);
  });

  // #1001: a verdict that tore the worktree down and returned without calling park left
  // `in-progress` on the issue, and classify() skips those for good.
  test("a landing only a person can move parks the ticket rather than dropping it", async () => {
    const parked: number[] = [];
    const r = await runOnce(
      io({
        land: lands({ action: "owner", reason: "the branch conflicts with main" }),
        park: (n: number) => parked.push(n),
      }),
    );
    assert.equal(r.outcome, "parked");
    assert.deepEqual(parked, [42], "no exit path may tear the worktree down and keep the claim");
    assert.match(String(r.why), /conflicts with main/);
  });

  // Three full sessions on a ticket that kept going red produced three sessions and zero rows: no
  // cost, no turns, no count of how often the cap is reached — in the file kept to answer exactly
  // that. `main` is what bounds the rounds; the pass's job is to hand the same ticket back.
  test("a red verdict hands the ticket back, and still writes its row", async () => {
    const rows: any[] = [];
    const r = await runOnce(
      io({ land: lands(HAND_BACK), record: (x: unknown) => rows.push(x) }),
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

  test("a red whose CI-RED could not be posted is held in flight: no park, the claim kept, and no round spent until it is posted", async () => {
    const parked: number[] = [];
    const rows: any[] = [];
    const torn: unknown[][] = [];
    const r = await runOnce(
      io({
        land: lands({ error: "CI-RED for abc could not be posted" }),
        park: (n: number) => parked.push(n),
        record: (x: unknown) => rows.push(x),
        teardown: (...args: unknown[]) => torn.push(args),
      }),
    );
    assert.equal(r.outcome, "landing");
    assert.equal(r.ticket, 42);
    assert.match(String(r.why), /could not be posted/);
    assert.deepEqual(parked, []);
    assert.deepEqual(torn, [[".worktrees/agent-42", 42, false]]);
    assert.equal(r.loop.held[42], 1);
    assert.deepEqual(rows.map((x) => x.outcome), ["pushed"], "the pushed row keeps it in flight for the next pass");
  });

  test("a landing a rerun won writes the flake on its row", async () => {
    const rows: any[] = [];
    const flake = { runId: 7, tests: ["tests/e2e/x.spec.ts › y"], step: "Test" };
    const ledger: any[] = [{ n: 42, outcome: "armed", cost: 0, head: "judged", flake }];
    await runOnce(io({ record: (x: unknown) => rows.push(x) }, ledger));
    assert.deepEqual(rows.find((x) => x.outcome === "landed")?.flake, { ...flake, head: "judged" });
  });

  test("a visit's note is an armed row naming its head and any flake", async () => {
    const flake = { runId: 7, tests: ["t"], step: "Test" };
    const rows: any[] = [];
    await runOnce(
      io({
        land: async (_p: unknown, decideAt: (l: object) => any, note: (h: string, f: object | null) => void) => {
          note("h2", flake);
          return decideAt({ n: 42, pr: 984, head: "h2", ...MERGED });
        },
        record: (x: any) => rows.push(x),
      }),
    );
    const armed = rows.find((x) => x.outcome === "armed");
    assert.deepEqual([armed?.flake, armed?.head, armed?.pr, armed?.run.result], [flake, "h2", 984, null]);
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
        land: async () => settled.push(1) as never,
      }),
    );
    assert.equal(r.outcome, "landed");
    assert.deepEqual(released, [42]);
    assert.deepEqual(settled, [], "there is nothing left to visit");
  });

  // Releasing the claim beside each teardown call let an exit path take one without the other, and
  // one did. Tied to the teardown, no path can tear down and keep the claim.
  test("every teardown is told which ticket's claim it is releasing", async () => {
    for (const over of [
      { pushedPr: () => ({ number: 984, state: "MERGED", head: "agent/42-x" }) },
      { land: lands() },
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
      { land: lands() },
    ]) {
      const gone: (string | null)[] = [];
      await runOnce(io({ ...over, teardown: (cwd: string | null) => gone.push(cwd) }));
      assert.deepEqual(gone, [".worktrees/agent-42"], JSON.stringify(Object.keys(over)));
    }

    const handed: (string | null)[] = [];
    await runOnce(
      io({
        land: lands({ action: "owner", reason: "the pull request was closed without merging" }),
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
        land: lands(HAND_BACK),
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

  // The loop's own merges move package-lock.json, and housekeeping refuses to start on an install
  // that has drifted from it. Read as "stop", the first such ticket ended the night.
  test("a housekeeping hold holds, saying why; a stop still stops", async () => {
    const held = await runOnce(io({ housekeeping: () => ({ verdict: "hold", why: "node_modules has drifted", rows: [] }) }));
    assert.deepEqual([held.outcome, held.why], ["hold", "node_modules has drifted"]);
    assert.equal((await runOnce(io({ housekeeping: () => ({ verdict: "stop", why: "…", rows: [] }) }))).outcome, "stop");
  });

  test("a refusal carries housekeeping's reason into why", async () => {
    const out = await runOnce(io({ housekeeping: () => ({ verdict: "stop", why: "worktrees: 1 not made by the loop — remove to start", rows: [] }) }));
    assert.equal(out.outcome, "stop");
    assert.match(String(out.why), /1 not made by the loop/);
  });

  test("housekeeping is asked about the pinned ticket, and waited for", async () => {
    const asked: unknown[] = [];
    const later = (verdict: string) => async (pinned: unknown) => (asked.push(pinned), { verdict, rows: [] });
    assert.equal((await runOnce(io({ housekeeping: later("ok") }), 42)).outcome, "landed");
    assert.equal((await runOnce(io({ housekeeping: later("hold") }))).outcome, "hold");
    assert.deepEqual(asked, [42, null]);
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

  // The standing worktree is what keeps a held ticket's uncommitted work: a park commits it before
  // the removal, the sweep never forces, and a landed tree's leftovers go to a patch first.
  test("a refused session's dirty worktree is left standing as it is, with no copy taken", async () => {
    const touched: string[] = [];
    const r = await runOnce(
      io({
        spawn: async () => ({ status: 1, blocked: true, blockedUntil: 1789000000000, result: {}, ms: 1, log: "l", declared: null }),
        pushedPr: () => null,
        standing: () => ({ ticket: 42, branch: "agent/42-x", cwd: ".worktrees/agent-42", head: "a", commits: 1, changed: ["a.ts"], dirty: true, phase: "C" }),
        snapshotWip: () => touched.push("snapshot"),
        teardown: () => touched.push("teardown"),
        park: () => touched.push("park"),
      }),
    );
    assert.equal(r.outcome, "refused");
    assert.deepEqual(touched, []);
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
    await runOnce(io({ bell: ring, land: lands(HAND_BACK) }));
    assert.equal(rings, 0, "a red verdict is the next session's, not a person's");
    await runOnce(io({ bell: ring, pushedPr: () => null }));
    assert.equal(rings, 1);
    // A landing that ends in `owner` goes to the tracker with `ready-for-human` on it, so it is
    // a hand-off like any other. Left silent, it was a ticket dropped without anyone being told.
    await runOnce(io({ bell: ring, land: lands({ action: "owner", reason: "the branch conflicts with main" }) }));
    assert.equal(rings, 2);
  });

  test("a G route lands without spawning", async () => {
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
    // Its `pushed` row too, at no cost: a supervisor that died before writing one leaves nothing in flight.
    assert.deepEqual(
      rows.map((x) => [x.outcome, x.run.result, x.run.ms]),
      [["pushed", null, 0], ["landed", null, 0]],
    );
  });

  test("a G route announces itself before it lands", async () => {
    const order: string[] = [];
    await runOnce(
      io({
        pick: () => ({ skill: "implement", number: 42, title: "t", size: null, queue: null, resuming: true, phase: "G" }),
        announce: (r: { number: number; phase: string }) => order.push(`announce ${r.number} ${r.phase}`),
        land: lands(MERGED, order),
      }),
    );
    assert.deepEqual(order, ["announce 42 G", "land"]);
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

  test("a moved tools/loop restarts the supervisor before any ticket is picked", async () => {
    const r = await runOnce(io({ loopMoved: () => "abc1234", pick: () => { throw new Error("picked"); } }));
    assert.deepEqual([r.outcome, /abc1234/.test(String(r.why))], ["restart", true]);
  });
  test("loopMoved answers a diff, not an error", () => {
    const fail = (status: number) => (...a: string[]) => {
      if (a[0] === "diff") throw Object.assign(new Error("x"), { status });
      return "abc1234\n";
    };
    assert.equal(loopMoved("s", fail(1)), "abc1234");
    assert.equal(loopMoved("s", fail(128)), null);
    assert.equal(loopMoved(null, fail(1)), null);
  });

  test("a handoff the supervisor makes for a cut-off session says why", async () => {
    const ledger: any[] = [];
    await runOnce(
      io(
        {
          spawn: async () => ({
            status: 0, blocked: false, ms: 1, log: "l", phase: "C", declared: null,
            result: { subtype: "error_max_turns", isError: true, cost: 1, turns: 9 },
          }),
          standing: () => ({ ticket: 42, branch: "agent/42-x", cwd: ".worktrees/agent-42", head: "a", commits: 1, changed: [], dirty: true, phase: "C" }),
          pushedPr: () => null,
        },
        ledger,
      ),
    );
    const h = ledger.find((r) => r.outcome === "handoff")?.handoff;
    assert.ok(h, "a handoff row");
    assert.equal(h.why, "the session ran out of turns");
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
    const ledger: any[] = [];
    const told = async () => ({ ...(await handingOff("D", "D")()), declared: { ticket: 42, phase: "D", handoff: "D", stoodDown: false, why: "round 1 HOLD: model the Modal root" } });
    await runOnce(io({ spawn: told }, ledger));
    assert.equal(await next(ledger, "D"), "round 1 HOLD: model the Modal root", "a session's own handoff why is the next process's brief");
  });

  test("a session on the wrong model parks with the reason", async () => {
    const parked: string[] = [];
    const why = "the session started on claude-opus-5, but phase E runs on sonnet";
    const r = await runOnce(
      io({
        spawn: async () => ({ status: 1, blocked: false, result: null, ms: 1, log: "l", phase: null, declared: null, wrongModel: why }),
        park: (_n: number, c: { why: string }) => parked.push(c.why),
      }),
    );
    assert.equal(r.outcome, "parked");
    assert.deepEqual(parked, [why]);
  });

  test("an expired login stops the run, and does not park the ticket it met", async () => {
    const parked: string[] = [];
    const ledger: any[] = [];
    const r = await runOnce(
      io(
        {
          spawn: async () => ({
            status: 1, blocked: false, ms: 1, log: "l", phase: null, declared: null,
            result: { isError: true, subtype: "success", terminalReason: "api_error", apiStatus: null },
            accountError: "authentication_failed: Failed to authenticate: OAuth session expired and could not be refreshed",
          }),
          pushedPr: () => null,
          park: (_n: number, c: { why: string }) => parked.push(c.why),
        },
        ledger,
      ),
    );
    assert.deepEqual([r.outcome, parked, ledger.map((x) => x.outcome)], ["stop", [], ["halted"]]);
    assert.match(String(r.why), /log in/);
  });

  test("the sweep in housekeeping runs before the pick", async () => {
    const order: string[] = [];
    await runOnce(
      io({
        housekeeping: () => (order.push("pre"), { verdict: "ok", rows: [] }),
        pick: () => (order.push("pick"), { skill: "implement", number: 42, title: "t", size: null, queue: null }),
      }),
    );
    assert.deepEqual(order, ["pre", "pick"]);
  });

  test("a red landing leaves the worktree standing and the next pass spawns C with the fix", async () => {
    const torn: unknown[] = [];
    const parked: number[] = [];
    const red = await runOnce(
      io({
        land: lands(HAND_BACK),
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
      ledger: () => [{ n: 42, outcome: "handoff", cost: 0, handoff: { phase: "E" }, head: null }],
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
    const rows = ledgerFixture("ledger-2026-09-21.jsonl");
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

  test("a row names the route's title and size and the review rounds read after the session, with no tracker read of its own", async () => {
    const rows: any[] = [];
    await runOnce(io({ standing: () => ({ ...(io() as any).standing(), reviewRounds: 2 }), record: (x: unknown) => rows.push(x) }));
    assert.deepEqual(rows.map((x) => [x.outcome, x.title, x.size, x.reviewRounds]), [["pushed", "t", "size:S", 2], ["landed", "t", "size:S", 2]]);
  });

  test("a derive off the ticket, or with no count, is not the ticket's review rounds; the tracker's are", async () => {
    const facts = (n: number) => ({ title: "t", size: "size:S", reviewRounds: n === 42 ? 1 : 7 });
    for (const standing of [() => ({ ...(io() as any).standing(), ticket: 99, reviewRounds: 5 }), () => null, () => (io() as any).standing()]) {
      const rows: any[] = [];
      await runOnce(io({ standing, facts, record: (x: unknown) => rows.push(x) }));
      assert.ok(rows.length);
      assert.deepEqual([...new Set(rows.map((x) => x.reviewRounds))], [1]);
    }
  });

  test("a row main writes names its ticket as the tracker does: a repark, and the park after a throw", async () => {
    const facts = (n: number) => ({ title: `issue ${n}`, size: "size:M", reviewRounds: null });
    const book = { totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} };
    const screen = { say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} };
    const empty = { skill: "handoff", number: 0, title: "queue empty" };
    const rows: any[] = [];
    let picks = 0;
    await main({
      io: io({
        facts,
        record: (x: unknown) => rows.push(x),
        ledgerRows: () => (picks ? [] : [{ n: 41, outcome: "parked", park_failed: ["label"] }]),
        pick: () => (picks++ === 0 ? { skill: "implement", number: 43, title: "issue 43", size: "size:M", queue: null } : empty),
        standing: () => {
          throw new Error("git worktree list failed");
        },
      }) as never,
      book: book as never,
      screen: screen as never,
      install: () => {},
      runId: "t",
    });
    assert.deepEqual(rows.map((x) => [x.number, x.outcome, x.title, x.size]), [
      [41, "reparked", "issue 41", "size:M"],
      [43, "parked", "issue 43", "size:M"],
    ]);
  });

  test("nextRoute: a resumed ticket carries its issue's title and review rounds, not its branch name", () => {
    const facts = () => ({ title: "Fix the card fan!", url: "", size: "size:S", labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const read = () => ({ onTicket: true, ticket: 42, branch: "agent/42-fix-the-card-fan", cwd: "w", phase: "D", reviewRounds: 3 });
    const route: any = nextRoute(null, null, { read, facts, ledger: () => [] } as never);
    assert.deepEqual([route.title, route.reviewRounds], ["Fix the card fan!", 3]);
  });

  test("nextRoute: a pinned ticket with no worktree rebuilds at A", () => {
    const facts = () => ({ title: "Fix the card fan!", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const ledger = () => [{ n: 42, outcome: "handoff", cost: 0, handoff: { phase: "E" }, head: null }];
    const stranded: any = nextRoute(42, null, { read: () => ({ onTicket: false, phase: "A" }), facts, ledger } as never);
    assert.deepEqual([stranded.phase, stranded.resuming], ["A", true]);
    assert.equal(stranded.branch, "agent/42-fix-the-card-fan", "no claim runs on a resume, so the route names the branch the claim would");
  });

  test("nextRoute: a pinned ticket the tracker no longer shows as ours goes back to the picker", () => {
    const ledger = () => [{ n: 42, outcome: "handoff", cost: 0, handoff: { phase: "E" }, head: null }];
    const picked: number[] = [];
    const picker = () => {
      picked.push(1);
      return { skill: "implement", number: 77, title: "other", size: "size:S", queue: { implement: 3, triage: 0, wayfinder: 0, owner: 1, launch: 0 } };
    };
    const route = (labels: string[] | null) =>
      nextRoute(42, null, {
        read: () => ({ onTicket: false, phase: "A" }),
        facts: () => ({ title: "t", url: "", size: "size:S", labels, reviewRounds: 1, ciRounds: 0 }),
        ledger,
        picker,
      } as never);
    for (const labels of [["in-progress", "ready-for-human"], ["size:S"], ["in-progress", "deferred"]]) {
      const r: any = route(labels);
      assert.deepEqual([r.skill, r.number, r.resuming], ["implement", 77, false], labels.join(","));
    }
    assert.equal(picked.length, 3);
    const unread: any = route(null);
    assert.deepEqual([unread.number, unread.resuming, unread.phase], [42, true, "A"], "an unreadable tracker keeps resuming");
    // An overloaded hold of a session the API failed before its phase-A claim: still ours, and its
    // kept worktree is waiting for it.
    const unclaimed: any = route(["ready-for-agent", "size:S"]);
    assert.deepEqual([unclaimed.number, unclaimed.resuming, unclaimed.phase], [42, true, "A"], "a pre-claim hold keeps resuming");
    assert.equal(picked.length, 3);
  });

  test("nextRoute: a LAND on the head outranks a handoff to review, and nothing else does", () => {
    const facts = () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const toReview = () => [{ n: 42, outcome: "handoff", cost: 0, handoff: { phase: "D" }, head: null }];
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

  test("publishForReview pushes, then opens it ready only when no pull request is open", () => {
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
      assert.ok(create && !create.includes("--draft"));
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
            land: lands(red ? { ...HAND_BACK, head: "h9" } : MERGED),
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

  // The session's own derive reads a red only from CI-RED, so a held red's fix round must find one.
  describe("a held red is posted before its fix round spawns", () => {
    const facts = () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const held = { onTicket: true, ticket: 42, branch: "agent/42-x", cwd: "w", phase: "G", fix: false, ci: { pushed: true, pr: 5, state: "settling", sha: "h1" } };
    const posted = { ...held, phase: "C", fix: true, ci: { ...held.ci, state: "red", step: "Test" } };

    test("a post that still fails holds, and spawns nothing", async () => {
      const ledger: any[] = [];
      const order: string[] = [];
      const r = await runOnce(
        io(
          {
            pick: () => nextRoute(null, null, { read: () => held, facts, ledger: () => ledger } as never),
            pushedPr: () => ({ number: 5, state: "OPEN", head: "agent/42-x", sha: "h1" }),
            land: lands({ error: "CI-RED for h1 could not be posted", head: "h1" }, order),
            spawn: async () => order.push("spawn") as never,
          },
          ledger,
        ),
        42,
      );
      assert.equal(r.outcome, "landing");
      assert.deepEqual(order, ["land"]);
    });

    // From the visit that could not post, through every pass, to the fix round: the session spawns
    // onto exactly one CI-RED for its head and one round spent.
    test("a red whose CI-RED a visit could not post reaches its fix round with exactly one posted", async () => {
      const comments: string[] = [];
      const ledger: any[] = [];
      const spawned: { fix: boolean; retryCount: number }[] = [];
      let settles = 0;
      const read = () => (comments.length ? posted : held);
      const post = () => {
        if (!comments.includes("CI-RED h1")) comments.push("CI-RED h1");
        return true;
      };
      const fake = io(
        {
          pick: () => nextRoute(null, null, { read, facts, ledger: () => ledger } as never),
          pushedPr: () => ({ number: 5, state: "OPEN", head: "agent/42-x", sha: "h1" }),
          refreshWorktree: () => {},
          land: (p: unknown, decideAt: (l: object) => any) =>
            lands(settles++ === 0 ? { error: "CI-RED for h1 could not be posted", head: "h1" } : (post(), { action: "hand-back", reason: "CI failed at Test", head: "h1" }))(p, decideAt),
          spawn: async (s: { fix: boolean; retryCount: number }) => {
            spawned.push({ fix: s.fix, retryCount: s.retryCount });
            return { status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "F", declared: null };
          },
        },
        ledger,
      );
      let loop: any = undefined;
      for (let i = 0; i < 4 && spawned.length === 0; i++) loop = (await runOnce(fake, loop?.pinned ?? null, null, loop)).loop;
      assert.deepEqual(spawned, [{ fix: true, retryCount: 1 }]);
      assert.deepEqual(comments, ["CI-RED h1"]);
    });
  });

  test("a red round nobody recorded is written down before the fix round; a recorded one is not", async () => {
    const spawn = async () => ({ status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "F", declared: null });
    const unrecorded: any[] = [retryRow("h1")];
    await runOnce(io({ pick: () => fixRoute("h2"), refreshWorktree: () => {}, spawn }, unrecorded), 42);
    assert.deepEqual(unrecorded.map((x) => [x.outcome, x.head, x.cost]), [
      ["retry", "h1", 1],
      ["retry", "h2", 0],
      ["pushed", null, 0],
      ["landed", "judged", 0],
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
        land: lands(HAND_BACK),
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
    assert.equal(a.commits, null, "no worktree read is not a count of zero commits");
  });

  test("derive alone still answers, for a session that declared nothing", () => {
    const a = of(null, null, derived);
    assert.equal(a.ticket, 42);
    assert.equal(a.cwd, ".worktrees/agent-42");
    assert.equal(a.dirty, true);
    assert.equal(of(null, null, { ...derived, commits: 0 }).commits, 0);
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

const closedIo = (over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const fake = io({
    pushedPr: () => null,
    standing: () => ({ ticket: 42, branch: "agent/42-x", cwd: ".worktrees/agent-42", head: "a", commits: 0, changed: [], dirty: false, phase: "F" }),
    spawn: async () => ({ status: 0, blocked: false, result: { cost: 1, turns: 9 }, ms: 1000, log: "l", phase: "F",
      declared: { ticket: 42, branch: "agent/42-x", pr: null, phase: "F", stoodDown: false, why: null } }),
    issueState: () => ({ state: "CLOSED", stateReason: "COMPLETED" }),
    park: () => calls.push("park"),
    ...over,
  });
  return { fake, calls };
};

describe("a ticket closed as done with no diff", () => {
  test("is recorded closed, with no park", async () => {
    const ledger: any[] = [];
    const { fake, calls } = closedIo({ record: (x: unknown) => ledger.push(rowOf(x)) });
    assert.equal((await runOnce(fake)).outcome, "closed");
    assert.deepEqual(calls, []);
    assert.deepEqual(ledger.map((r) => r.outcome), ["closed"]);
  });
  test("with commits of its own it still parks", async () => {
    const { fake, calls } = closedIo({ standing: () => ({ ticket: 42, branch: "agent/42-x", cwd: ".worktrees/agent-42", head: "a", commits: 2, changed: ["a.ts"], dirty: false, phase: "F" }) });
    assert.notEqual((await runOnce(fake)).outcome, "closed");
    assert.ok(calls.includes("park"));
  });
  test("closed as not planned still parks", async () => {
    const { fake, calls } = closedIo({ issueState: () => ({ state: "CLOSED", stateReason: "NOT_PLANNED" }) });
    assert.notEqual((await runOnce(fake)).outcome, "closed");
    assert.ok(calls.includes("park"));
  });
  test("a stood-down session is never asked about the issue", async () => {
    let asked = 0;
    const { fake } = closedIo({
      issueState: () => (asked++, { state: "CLOSED", stateReason: "COMPLETED" }),
      spawn: async () => ({ status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "F",
        declared: { ticket: 42, branch: "agent/42-x", pr: null, phase: "F", stoodDown: true, why: "lost the race" } }),
    });
    assert.equal((await runOnce(fake)).outcome, "parked");
    assert.equal(asked, 0);
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

  test("a moved tools/loop ends main with the restart code, before anything is picked", async () => {
    let picked = 0;
    const code = await main({
      io: { ...(io() as any), loopMoved: () => "abc1234", pick: () => (picked += 1) as never },
      book: book(),
      screen: screen(),
      install: () => {},
      runId: "t",
    });
    assert.deepEqual([code, picked], [RESTART, 0]);
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

  test("a restart's run file says restarting, not stopped", async () => {
    const closed: string[] = [];
    await main({
      io: { ...(io() as any), loopMoved: () => "abc1234" },
      book: { ...book(), close: (_id: string, line: string) => closed.push(line) },
      screen: screen(),
      install: () => {},
      runId: "t",
    });
    assert.match(closed.join("\n"), /restarting: tools\/loop moved/);
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

  test("a ticket closed as done clears the breaker as a landing does", async () => {
    let n = 0;
    const done = () => n % 2 === 0;
    const { fake } = closedIo({
      pick: () => {
        n += 1;
        if (n > 7) return { skill: "handoff", number: 0, title: "queue empty" };
        return { skill: "implement", number: n, title: "t", size: null, queue: null };
      },
      spawn: async () => ({ status: done() ? 0 : 1, blocked: false, result: {}, ms: 1, log: "l", phase: "F",
        declared: done() ? { ticket: n, branch: `agent/${n}-x`, pr: null, phase: "F", stoodDown: false, why: null } : null }),
      standing: () => (done() ? { ticket: n, branch: `agent/${n}-x`, cwd: null, head: "a", commits: 0, changed: [], dirty: false, phase: "F" } : null),
    });
    const code = await main({ io: fake, book: book(), screen: screen(), install: () => {}, runId: "t" });
    assert.equal(code, 0, "alternating park and close never reaches three in a row");
    assert.equal(n, 8);
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
      housekeeping: () => {
        throw new Error("housekeeping blew up");
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
    const spy = { ...(io() as any), stopFile: () => passes++ > 0, housekeeping: () => ({ verdict: "hold", why: "drift", rows: [] }) };
    await main({ io: spy, book, screen: board as never, install: () => {}, runId: "t" });
    assert.match(shown, /working 0:00 · CI 0:00 · waiting 1:00:00/);
  });

  // A held red whose post keeps failing is the same ticket's problem, and stopping the whole night
  // on it is not. The literal, not the module's constant: ten passes outlast a short GitHub outage,
  // and a test reading the value it pins moves with it.
  const TICKET_HOLDS = 10;
  const heldRoute = { skill: "implement", number: 42, title: "t", size: null, queue: null, resuming: true, phase: "G", cwd: "w", branch: "agent/42-x" };
  const unposted = lands({ error: "CI-RED for h1 could not be posted", head: "h1" });
  const heldNight = async (stopAfter: number, preflights = 0) => {
    const parked: number[] = [];
    let passes = 0;
    let checks = 0;
    const board = {
      say: () => {},
      warn: () => {},
      notice: () => {},
      stop: () => {},
      close: () => {},
      board: () => {},
      wait: () => ({ woken: Promise.resolve(), say: null }),
    };
    const book = { totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} };
    const spy = {
      ...(io() as any),
      stopFile: () => passes++ >= stopAfter,
      housekeeping: () => (checks++ < preflights ? { verdict: "hold", why: "drift", rows: [] } : { verdict: "ok", rows: [] }),
      pick: () => heldRoute,
      land: unposted,
      park: (n: number) => parked.push(n),
    };
    await main({ io: spy, book, screen: board as never, install: () => {}, runId: "t" });
    return parked;
  };

  test("pre-flight holds spend nothing of a ticket's hold bound", async () => {
    assert.deepEqual(await heldNight(3 + 1, 3), []);
  });

  test("a ticket parks at its own bound of holds, not before", async () => {
    assert.deepEqual(await heldNight(TICKET_HOLDS), []);
    assert.deepEqual(await heldNight(TICKET_HOLDS + 1), [42]);
  });

  test("a ticket held past its bound is parked for the owner, and the loop carries on", async () => {
    const parked: { n: number; why: string }[] = [];
    const notes: string[] = [];
    let passes = 0;
    const board = {
      say: () => {},
      warn: () => {},
      notice: (_k: string, m: string) => notes.push(m),
      stop: () => {},
      close: () => {},
      board: () => {},
      wait: () => ({ woken: Promise.resolve(), say: null }),
    };
    const book = { totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} };
    const spy = {
      ...(io() as any),
      stopFile: () => passes++ > TICKET_HOLDS + 1,
      pick: () => heldRoute,
      land: unposted,
      park: (n: number, c: { why: string }) => parked.push({ n, why: c.why }),
    };
    const code = await main({ io: spy, book, screen: board as never, install: () => {}, runId: "t" });
    assert.notEqual(code, 1, notes.join("\n"));
    assert.ok(parked.length >= 1 && parked[0].n === 42, JSON.stringify(parked));
    assert.match(parked[0].why, /could not be posted/);
  });

  // Only `Date` is mocked: main's own tick stays real, as it does across a standby.
  test("books a standby as asleep, not working", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const TICK = 10;
    let recap = "";
    let passes = 0;
    const book = {
      totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 },
      tickets: [],
      record: () => {},
      close: (_id: string, _line: string, text: string) => void (recap = text),
    };
    const spy = {
      ...(io() as any),
      stopFile: () => passes++ > 0,
      spawn: async () => {
        t.mock.timers.setTime(Date.now() + 2 * 3_600_000 + TICK);
        await new Promise((r) => setTimeout(r, 5 * TICK));
        return (io() as any).spawn();
      },
    };
    const screen = { say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} };
    await main({ io: spy, book, screen: screen as never, install: () => {}, runId: "t", tick: TICK } as never);
    assert.match(recap, /working 0:00 · CI 0:00 · waiting 0:00\n.*asleep 2:00:00/);
  });

  test("says so when the picker read no open Launch tickets", async () => {
    const recapFor = async (launch: number) => {
      let text = "";
      let passes = 0;
      const book = {
        totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 },
        tickets: [],
        record: () => {},
        close: (_id: string, _line: string, t: string) => void (text = t),
      };
      const pick = () => ({ ...(io() as any).pick(), queue: { implement: 1, triage: 0, wayfinder: 0, launch } });
      const spy = { ...(io() as any), stopFile: () => passes++ > 0, pick };
      const screen = { say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} };
      await main({ io: spy, book, screen: screen as never, install: () => {}, runId: "t" } as never);
      return text;
    };
    assert.match(await recapFor(0), /no open Launch tickets/);
    assert.doesNotMatch(await recapFor(2), /Launch/);
  });

  test("names a size this run's busiest process left short of turn headroom", async () => {
    let text = "";
    let passes = 0;
    const book = {
      rows: [{ n: 1, size: "size:S", turns: 300, outcome: "handoff" }],
      totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 },
      tickets: [],
      record: () => {},
      close: (_id: string, _line: string, t: string) => void (text = t),
    };
    const spy = { ...(io() as any), stopFile: () => passes++ > 0 };
    const screen = { say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} };
    await main({ io: spy, book, screen: screen as never, install: () => {}, runId: "t" } as never);
    assert.match(text, /turn cap under 2× the busiest process: size:S busiest 300/);
  });

  test("names a red nightly parity run, read once per pass", async () => {
    let text = "";
    let passes = 0;
    let reads = 0;
    const book = {
      totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 },
      tickets: [],
      record: () => {},
      close: (_id: string, _line: string, t: string) => void (text = t),
    };
    const parity = () => (reads++, { number: 1544, since: "2026-10-12T11:40:08Z" });
    const spy = { ...(io() as any), stopFile: () => passes++ > 0, parity };
    const screen = { say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} };
    await main({ io: spy, book, screen: screen as never, install: () => {}, runId: "t" } as never);
    assert.match(text, /parity nightly red since 2026-10-12 \(#1544\)/);
    assert.equal(reads, passes);
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
      land: lands({ action: "hand-back", reason: "CI failed at Native tests", head: "aaa111" }),
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
      land: lands({ action: "hand-back", reason: "CI failed at Native tests", head: "aaa111" }),
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
    const died = runOnce(io({ land: () => Promise.reject(new Error("killed")) }, ledger));
    await assert.rejects(died, /killed/);
    assert.equal(ticketTally(42, ledger).spend, 1);

    const g = { skill: "implement", number: 42, title: "t", size: null, queue: null, resuming: true, phase: "G" };
    const r = await runOnce(io({ pick: () => g }, ledger));
    assert.equal(r.outcome, "landed");
    assert.equal(ledger.reduce((a, x) => a + x.cost, 0), 1);
  });

  for (const [name, verdict] of Object.entries({
    merged: MERGED,
    red: HAND_BACK,
    owner: { action: "owner", reason: "the branch conflicts with main" },
  })) {
    test(`${name}: the session is counted once, and the tally reads as before`, async () => {
      const ledger: any[] = [];
      await runOnce(io({ land: lands(verdict) }, ledger));
      assert.equal(ledger.reduce((a, x) => a + x.cost, 0), 1);
      const t = ticketTally(42, ledger);
      assert.deepEqual([t.handoffsThisRound, t.lastHandoff, t.retries], [0, null, name === "red" ? 1 : 0]);
    });
  }
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
    land: lands({ ...HAND_BACK, head: sha }),
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
  const handoffRow = () => ({ n: 42, outcome: "handoff", cost: 0, handoff: { phase: "D" }, head: null });
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

  test("a session stalled mid-retry is overloaded", async () => {
    const stalled = async () => ({ ...(await died(null)()), status: "stalled", lastFact: "api_retry" });
    const r = await runOnce(io({ spawn: stalled, pushedPr: () => null }));
    assert.equal(r.outcome, "overloaded");
  });

  test("a 429 from a spent usage window (#1074's) is a refusal, waited out to its reset", async () => {
    const spent = async () => ({ ...(await died({ isError: true, apiStatus: 429 })()), blocked: true, blockedUntil: 1789000000000 });
    const r = await runOnce(io({ spawn: spent, pushedPr: () => null }));
    assert.deepEqual([r.outcome, r.until], ["refused", 1789000000000]);
  });

  test("in phase E, with a pull request open, E is spawned again rather than the head landed", async () => {
    const picked: [number | null, string | null][] = [];
    const phases: string[] = [];
    let settled = 0;
    await night({
      stopFile: () => phases.length >= 2,
      pick: (p: number | null, at: string | null) => (picked.push([p, at]), ticket),
      spawn: async (route: { phase: string }) => (phases.push(route.phase), died(overloaded)()),
      pushedPr: () => ({ number: 984, state: "OPEN", head: "agent/42-x" }),
      land: async () => (settled++, { kind: "landed" }),
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

// #1465's park ran 30 s after a wake with no network: the ledger said parked, the issue kept its
// claim, and nothing ever tried again (F6).
describe("a park that never reached the tracker", () => {
  const book = () => ({ totals: { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 }, tickets: [], record: () => {}, close: () => {} });
  const screen = () => ({ say: () => {}, warn: () => {}, notice: () => {}, stop: () => {} });
  const died = async () => ({ status: 1, blocked: false, result: null, ms: 1, log: "l", phase: "C", declared: null });
  const labelDown = () => ({ ok: false, failed: ["label"] });

  test("is recorded with the steps that failed", async () => {
    const ledger: any[] = [];
    await runOnce(io({ spawn: died, pushedPr: () => null, park: labelDown }, ledger));
    assert.deepEqual(ledger.filter((r) => r.outcome === "parked").map((r) => r.park_failed), [["label"]]);
  });

  test("is applied again at the start of the next pass, once, and a restart does not repeat it", async () => {
    const ledger: any[] = [];
    const reparked: [number, string[]][] = [];
    let picks = 0;
    const night = () =>
      main({
        io: io(
          {
            pick: () => (picks++ === 0 ? (io() as any).pick() : { skill: "handoff", number: 0, title: "queue empty" }),
            spawn: died,
            pushedPr: () => null,
            park: labelDown,
            repark: (n: number, steps: string[]) => (reparked.push([n, steps]), { failed: [], why: null }),
          },
          ledger,
        ) as never,
        book: book(),
        screen: screen(),
        install: () => {},
        runId: "t",
      });
    await night();
    assert.deepEqual(reparked, [[42, ["label"]]]);
    await night();
    assert.deepEqual(reparked, [[42, ["label"]]], "a park the tracker received is not applied again");
  });
});

describe("a stop no rule names parks; a red was rerun before it came back", () => {
  const RUN = 35661862241;
  const silent = async () => ({ status: 0, blocked: false, result: { cost: 1 }, ms: 1, log: "l", phase: "C", declared: null });
  const redAt1100 = lands({
    action: "hand-back",
    reason: "CI failed at Browser test report",
    head: "2f2a885",
    ci: { ...RED_CI, runId: RUN, attempt: 2 },
  });

  test("#1100's report-upload red, back from its one rerun, is a fix round", async () => {
    const ledger: any[] = [];
    const r = await runOnce(io({ land: redAt1100 }, ledger));
    assert.equal(r.outcome, "retry");
    assert.deepEqual(ledger.map((x) => x.outcome), ["pushed", "retry"]);
  });

  test("a session that exits without a LOOP-RESULT parks with that reason", async () => {
    const ledger: any[] = [];
    const whys: string[] = [];
    const r = await runOnce(io({ spawn: silent, pushedPr: () => null, park: (_n: number, c: { why: string }) => whys.push(c.why) }, ledger));
    assert.equal(r.outcome, "parked");
    assert.deepEqual(whys, ["the session exited without a LOOP-RESULT"]);
  });

  test("a landing that is the owner's parks with its own reason", async () => {
    const whys: string[] = [];
    await runOnce(io({ land: lands({ action: "owner", reason: "the branch conflicts with main" }), park: (_n: number, c: { why: string }) => whys.push(c.why) }));
    assert.deepEqual(whys, ["the branch conflicts with main"]);
  });

  test("a red on an armed pull request is disarmed before any fix round is spawned", async () => {
    const calls: string[][] = [];
    const red = {
      pr: { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", headRefOid: "a", armed: true },
      ci: { pass: false, runId: RUN, head: "a", attempt: 2, failedStep: "Typecheck and tests", testIds: ["x.test.ts › y"], output: "✖ y", reason: "CI failed at Typecheck and tests" },
    };
    const run = (_file: string, args: string[]) => (calls.push(args), args[0] === "issue" && args[1] === "view" ? JSON.stringify({ comments: [] }) : "");
    const land = (p: any, decideAt: any, note: any) => landOne(p, decideAt, { run, stateOf: () => red, write: () => {}, mkdir: () => {}, mainFailures: () => null, note, log: () => {} });
    const r = await runOnce(
      io({
        pick: () => ({ skill: "implement", number: 42, title: "t", size: "size:S", queue: null, resuming: true, phase: "G" }),
        spawn: async () => (calls.push(["spawn"]), null) as never,
        land,
      }),
    );
    assert.equal(r.outcome, "retry");
    const disarm = calls.findIndex((a) => a.includes("--disable-auto"));
    const spawn = calls.findIndex((a) => a[0] === "spawn");
    const posted = calls.findIndex((a) => a[0] === "issue" && a[1] === "comment");
    assert.ok(disarm !== -1 && (spawn === -1 || disarm < spawn) && disarm < posted, JSON.stringify(calls));
  });

  test("an API 5xx holds the ticket rather than parking it", async () => {
    const overloaded = readFileSync(path.join(import.meta.dirname, "fixtures", "api-529.jsonl"), "utf8").trim().split("\n").map(readLine).find((f: any) => f?.kind === "result");
    const r = await runOnce(
      io({
        spawn: async () => ({ status: 1, blocked: false, result: overloaded, ms: 1, log: "l", phase: "E", declared: null }),
        pushedPr: () => null,
      }),
    );
    assert.equal(r.outcome, "overloaded");
  });

  test("nextRoute: a pushed head settles ahead of a handoff the ledger holds from before the push", () => {
    const facts = () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const rows = [{ n: 42, outcome: "handoff", cost: 0, handoff: { phase: "C", why: "a declared one" }, head: "a" }];
    const route: any = nextRoute(42, ticketTally(42, rows as never).lastHandoff as never, {
      read: () => ({ onTicket: true, ticket: 42, branch: "agent/42-x", cwd: "w", phase: "G", fix: false, ci: { pushed: true } }),
      facts,
      ledger: () => rows,
    } as never);
    assert.equal(route.phase, "G");
  });

  describe("nextRoute: a red no CI-RED names", () => {
    const facts = () => ({ title: "t", url: "", size: null, labels: ["in-progress"], reviewRounds: 1, ciRounds: 0 });
    const status = { onTicket: true, ticket: 42, branch: "agent/42-x", cwd: "w", phase: "G", fix: false, ci: { pushed: true, state: "settling", sha: "abc" } };
    const route = (rows: object[]): any => nextRoute(null, null, { read: () => status, facts, ledger: () => rows } as never);

    test("is G, so landOne posts its CI-RED, whether the supervisor held it or stopped mid-visit", () => {
      const held = [{ n: 42, outcome: "hold", head: "abc", cost: 0 }];
      const earlier = [{ n: 42, outcome: "retry", head: "old", cost: 0 }];
      assert.deepEqual([route(held), route([]), route(earlier)].map((r) => [r.phase, r.fix]), [["G", false], ["G", false], ["G", false]]);
    });
  });
});

describe("each pass visits every pull request in flight, once, before the pick", () => {
  const ticket = { skill: "implement", number: 42, title: "t", size: "size:S", queue: null };
  /** Ticket 7's visit reads `seven`; the pass's own ticket lands. */
  const visits = (seven: object, order: string[] = []) => async (p: { n: number; pr: number }, decideAt: (l: object) => any) => {
    order.push(`land ${p.n}`);
    return decideAt({ n: p.n, pr: p.pr, head: "h7", armed: false, ci: RED_CI, ...(p.n === 7 ? seven : MERGED) });
  };

  test("one that merged is recorded and released before the pick, and a live worktree's is not visited", async () => {
    const order: string[] = [];
    const rows: any[] = [];
    const torn: unknown[][] = [];
    await runOnce(
      io({
        inFlight: () => [{ n: 7, pr: 70 }, { n: 8, pr: 80 }],
        live: () => [8],
        land: visits(MERGED, order),
        pick: () => (order.push("pick"), ticket),
        record: (x: unknown) => rows.push(x),
        teardown: (...a: unknown[]) => torn.push(a),
      }),
    );
    assert.deepEqual(order, ["land 7", "pick", "land 42"]);
    assert.deepEqual(rows.filter((x) => x.number === 7).map((x) => [x.outcome, x.pr, x.run.ms]), [["landed", 70, 0]]);
    assert.deepEqual(torn[0], [null, 7]);
  });

  test("a red is rebuilt from its branch and pinned when no worktree stands, so the pick is its fix round", async () => {
    const rebuilt: unknown[][] = [];
    const picks: unknown[][] = [];
    const rows: any[] = [];
    await runOnce(
      io({
        inFlight: () => [{ n: 7, pr: 70 }],
        land: visits(HAND_BACK),
        rebuild: (...a: unknown[]) => rebuilt.push(a),
        pick: (...a: unknown[]) => (picks.push(a), ticket),
        record: (x: unknown) => rows.push(x),
      }),
    );
    assert.deepEqual(rebuilt, [[7, 70]]);
    assert.deepEqual(picks[0], [7, null]);
    assert.deepEqual(rows.filter((x) => x.number === 7).map((x) => [x.outcome, x.head]), [["retry", "h7"]]);
  });

  test("a red waits for the slot while another ticket's worktree stands", async () => {
    const rebuilt: unknown[][] = [];
    const picks: unknown[][] = [];
    await runOnce(
      io({
        inFlight: () => [{ n: 7, pr: 70 }],
        live: () => [42],
        land: visits(HAND_BACK),
        rebuild: (...a: unknown[]) => rebuilt.push(a),
        pick: (...a: unknown[]) => (picks.push(a), ticket),
      }),
    );
    assert.deepEqual(rebuilt, []);
    assert.deepEqual(picks[0], [null, null]);
  });

  test("one only a person can move is parked from the ledger, with no worktree to carry", async () => {
    const parked: [number, { cwd: string | null; why: string }][] = [];
    await runOnce(
      io({
        inFlight: () => [{ n: 7, pr: 70 }],
        land: visits({ action: "owner", reason: "the branch conflicts with main" }),
        park: (n: number, c: { cwd: string | null; why: string }) => parked.push([n, c]),
      }),
    );
    assert.deepEqual(parked.map(([n, c]) => [n, c.cwd, c.why]), [[7, null, "the branch conflicts with main"]]);
  });

  test("an empty queue holds while pull requests are landing, rather than ending the night", async () => {
    const armed = [{ n: 7, outcome: "armed", head: "h7" }];
    const r = await runOnce(
      io({
        inFlight: () => [{ n: 7, pr: 70 }],
        land: visits({ action: "recheck", reason: "the run has not finished", armed: true, ci: { waiting: true } }),
        tally: (n: number) => ({ ...ticketTally(n, armed), ciRounds: 0 }),
        pick: () => ({ skill: "handoff", number: 0, title: "queue empty" }),
      }),
    );
    assert.equal(r.outcome, "hold");
    assert.match(String(r.why), /^queue empty; 1 pull request\(s\) landing$/);
    const stopped = await runOnce(io({ pick: () => ({ skill: "handoff", number: 0, title: "queue empty" }) }));
    assert.equal(stopped.outcome, "stop");
  });

  test("a head armed at its push comes down to its branch with the claim kept, and the slot is the next pick's", async () => {
    const torn: unknown[][] = [];
    const r = await runOnce(
      io({ land: lands({ action: "recheck", reason: "the run has not finished", cleared: { ok: true, why: null } }), teardown: (...a: unknown[]) => torn.push(a) }),
      42,
      null,
      { failures: 0, holds: 0, waits: 0, overloads: 0, pinned: 42, held: {} },
    );
    assert.equal(r.outcome, "landing");
    assert.deepEqual(torn, [[".worktrees/agent-42", 42, false]]);
    assert.equal(r.loop.pinned, null);
  });
});

// tests/queueLoopMain.test.ts
//
// runOnce is the composition eight of the ten headline defects lived in, and it was the one part
// with no test: every export was unit-tested and the way they were put together was not.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runOnce } from "../scripts/queue-loop.mjs";

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
  spawn: async () => ({ status: 0, blocked: false, result: { cost: 1, turns: 9 }, ms: 1000, log: "l", phase: "E" }),
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
  pushedPr: () => 984,
  settle: async () => ({ action: "merged", why: "merged" }),
  park: () => {},
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
          return { status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "E" };
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

  test("a red verdict hands the ticket back without recording an outcome", async () => {
    const rows: unknown[] = [];
    const r = await runOnce(
      io({ settle: async () => ({ action: "fix", why: "CI failed at Lint" }), record: (x: unknown) => rows.push(x) }),
    );
    assert.equal(r.outcome, "retry");
    assert.deepEqual(rows, [], "the session that fixes it writes the row");
  });

  test("a session that pushed nothing parks the ticket", async () => {
    const parked: number[] = [];
    const r = await runOnce(io({ pushedPr: () => null, park: (n: number) => parked.push(n) }));
    assert.equal(r.outcome, "parked");
    assert.deepEqual(parked, [42]);
    assert.match(String(r.why), /pushed no pull request/);
  });

  // derive() returning nothing has three causes and all three used to read as a landing.
  test("no live ticket at all is not a landing", async () => {
    const r = await runOnce(io({ standing: () => null }));
    assert.equal(r.outcome, "parked");
  });

  test("a session that worked a different ticket stops the pass", async () => {
    const r = await runOnce(io({ standing: () => ({ ticket: 955, branch: "agent/955-x", changed: [] }) }));
    assert.equal(r.outcome, "parked");
    assert.match(String(r.why), /worked #955, not #42/);
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

  // A refusal is the account, not the ticket: main() waits it out rather than ending the night.
  test("a refused session is neither landed nor parked", async () => {
    const parked: number[] = [];
    const r = await runOnce(
      io({
        spawn: async () => ({ status: 1, blocked: true, blockedUntil: 1789000000000, result: {}, ms: 1, log: "l" }),
        park: (n: number) => parked.push(n),
      }),
    );
    assert.equal(r.outcome, "refused");
    assert.equal(r.until, 1789000000000);
    assert.deepEqual(parked, []);
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

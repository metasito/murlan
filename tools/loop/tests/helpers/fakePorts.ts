// tools/loop/tests/helpers/fakePorts.ts
//
// One fake per port `runOnce` and `main` are driven through, each carrying every member the real
// port does (`queueLoopMain.test.ts`'s port-contract test holds them to it), quiet and landing
// ticket 42. A test changes a member by name and the member's own port takes it.
import { parkReasonOf, ticketTally } from "../../loop-logs.mjs";
import { worktreeOf } from "../../workspace.mjs";

export type Port = Record<string, any>;
export type Fake = { ports: Record<"tracker" | "workspace" | "session" | "ledger", Port>; events: Port };

/** A ledger row as the record keeps it, from what `runOnce` hands `ledger.record`. */
export const rowOf = (x: any) => ({
  n: x.number,
  outcome: x.outcome,
  cost: x.run?.result?.cost ?? 0,
  park_reason: parkReasonOf(x.outcome, x.why),
  head: x.head ?? null,
  handoff: x.handoff ?? null,
  park_failed: x.parkFailed ?? null,
  flake: x.flake ?? null,
});

export const fakeTrackerPort = (): Port => ({
  pick: () => ({ skill: "implement", number: 42, title: "t", size: "size:S", queue: { implement: 1, triage: 0, wayfinder: 0 } }),
  queue: () => null,
  facts: () => ({ title: "t", size: "size:S", reviewRounds: null }),
  issueState: () => ({ state: "OPEN", stateReason: null }),
  publish: () => {},
  pushedPr: () => ({ number: 984, state: "OPEN", head: "agent/42-x" }),
  settle: async () => ({ action: "already-merged", reason: "merged" }),
  park: () => {},
  conflict: () => true,
  repark: () => ({ failed: [], why: null }),
  release: () => {},
});

export const fakeWorkspacePort = (): Port => ({
  stopFile: () => false,
  parkAsked: () => false,
  clearParkAsk: () => {},
  ciLog: () => null,
  worktreeOf(this: Port, n: number) {
    return worktreeOf(() => this.standing(), n);
  },
  loopMoved: () => null,
  syncCheckout: () => true,
  housekeeping: () => ({ verdict: "ok", rows: [] }),
  parity: () => null,
  standing: () => ({ ticket: 42, branch: "agent/42-x", cwd: ".worktrees/agent-42", head: "a", commits: 1, changed: [], dirty: false, phase: "E" }),
  derive: () => ({ onTicket: false, phase: "A", why: "not on an agent branch", ambiguous: false }),
  refreshWorktree: () => {},
  sharedCheckoutDirty: () => "",
  remove: () => {},
  buildPassed: () => true,
});

export const fakeSessionPort = (): Port => ({
  spawn: async () => ({
    status: 0,
    blocked: false,
    result: { cost: 1, turns: 9 },
    ms: 1000,
    log: "l",
    phase: "F",
    declared: { ticket: 42, branch: "agent/42-x", pr: 984, phase: "F", stoodDown: false, why: null },
  }),
});

/** Backed by `rows`, which `record` appends to as the real ledger would. */
export const fakeLedgerPort = (rows: any[] = []): Port => ({
  tally: (n: number) => ticketTally(n, rows),
  rows: () => rows,
  record: (x: unknown) => rows.push(rowOf(x)),
  killed: () => null,
  journal: () => {},
  prune: () => {},
});

/** A copy of `fake` with each override, a member by name, on the port or the events that carry it. */
export const withMembers = (fake: Fake, over: Record<string, unknown>): Fake => {
  const ports = Object.fromEntries(Object.entries(fake.ports).map(([name, port]) => [name, { ...port }])) as Fake["ports"];
  const events = { ...fake.events };
  for (const [member, value] of Object.entries(over)) {
    const home = member in events ? events : Object.values(ports).find((p) => member in p);
    if (!home) throw new Error(`no port carries ${member}`);
    home[member] = value;
  }
  return { ports, events };
};

/** `runOnce`'s ports and events, with `over` placed and the ledger backed by `rows`. */
export const fakePorts = (over: Record<string, unknown> = {}, rows: any[] = []): Fake =>
  withMembers(
    {
      ports: { tracker: fakeTrackerPort(), workspace: fakeWorkspacePort(), session: fakeSessionPort(), ledger: fakeLedgerPort(rows) },
      events: { announce: () => {}, log: () => {}, bell: () => {}, picked: () => {} },
    },
    over,
  );

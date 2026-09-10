// tests/queueLoop.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, shouldStop, queueLoopArgs, liveRoute, syncProtocol } from "../scripts/queue-loop.mjs";

describe("parseRoute", () => {
  test("reads the ROUTE line next-ticket.mjs prints", () => {
    const stdout = "ROUTE\timplement\t824\tFix the lamp swing\nSTATUS\timplement:3\ttriage:1\n";
    assert.deepEqual(parseRoute(stdout), { skill: "implement", number: 824, title: "Fix the lamp swing" });
  });

  test("handles the handoff route, which carries no ticket", () => {
    const stdout = "ROUTE\thandoff\t0\tnothing agent-takeable\n";
    assert.deepEqual(parseRoute(stdout), { skill: "handoff", number: 0, title: "nothing agent-takeable" });
  });

  test("throws on output with no ROUTE line, rather than silently looping forever", () => {
    assert.throws(() => parseRoute("some unrelated error\n"), /no ROUTE line/);
  });
});

describe("queueLoopArgs", () => {
  test("runs /queue unattended, with no MCP tools an empty run could stall waiting on", () => {
    assert.deepEqual(queueLoopArgs(), [
      "-p",
      "/queue",
      "--permission-mode",
      "auto",
      "--strict-mcp-config",
    ]);
  });
});

describe("liveRoute", () => {
  test("no route when no ticket is live — the picker should run", () => {
    assert.equal(liveRoute({ onTicket: false }), null);
  });

  test("resumes the live ticket instead of asking the picker for a new one", () => {
    assert.deepEqual(liveRoute({ onTicket: true, ticket: 911, branch: "agent/911-x" }), {
      skill: "implement",
      number: 911,
      title: "agent/911-x",
      resuming: true,
    });
  });

  test("falls back to a bare ticket label when derive() found no branch (the stuck/'?' case)", () => {
    assert.deepEqual(liveRoute({ onTicket: true, ticket: 911, branch: null }), {
      skill: "implement",
      number: 911,
      title: "ticket #911",
      resuming: true,
    });
  });
});

describe("shouldStop", () => {
  test("stops on handoff", () => {
    assert.equal(shouldStop({ skill: "handoff" }), true);
  });

  for (const skill of ["implement", "triage", "wayfinder"]) {
    test(`keeps going on ${skill}`, () => {
      assert.equal(shouldStop({ skill }), false);
    });
  }
});

describe("syncProtocol", () => {
  /** @param drifts one entry per `git diff` call, in order. */
  const fakeGit = (drifts: string[], fails?: string) => {
    const calls: string[][] = [];
    const git = (...args: string[]) => {
      calls.push(args);
      if (fails && args[0] === fails) throw new Error(`fatal: ${fails} refused`);
      return args[0] === "diff" ? (drifts.shift() ?? "") : "";
    };
    return { git, calls };
  };
  const ran = (calls: string[][], verb: string) => calls.some((c) => c[0] === verb);

  test("fetches, and goes straight through when nothing drifted", () => {
    const { git, calls } = fakeGit([""]);
    assert.equal(syncProtocol(git, () => {}), true);
    assert.ok(ran(calls, "fetch"));
    assert.equal(ran(calls, "checkout"), false);
  });

  test("moves the checkout back to main when the protocol drifted", () => {
    const { git, calls } = fakeGit([".claude/commands/queue.md", ".claude/commands/queue.md", ""]);
    assert.equal(syncProtocol(git, () => {}), true);
    assert.deepEqual(
      calls.filter((c) => c[0] !== "diff" && c[0] !== "fetch"),
      [
        ["checkout", "main"],
        ["merge", "--ff-only", "origin/main"],
      ]
    );
  });

  test("stops when git refuses the checkout, rather than running a stale protocol", () => {
    const { git } = fakeGit(["CLAUDE.md", "CLAUDE.md"], "checkout");
    const said: string[] = [];
    assert.equal(syncProtocol(git, (m: string) => said.push(m)), false);
    assert.match(said.join("\n"), /cannot restore main/);
  });

  // The floor: without this, a repair that left the tree still drifted would report success and
  // the loop would run the very protocol this guard exists to catch.
  test("stops when the drift survives the repair", () => {
    const { git } = fakeGit(["CLAUDE.md", "CLAUDE.md", "CLAUDE.md"]);
    assert.equal(syncProtocol(git, () => {}), false);
  });
});

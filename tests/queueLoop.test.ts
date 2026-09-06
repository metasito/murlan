// tests/queueLoop.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, shouldStop, queueLoopArgs, liveRoute } from "../scripts/queue-loop.mjs";

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

// tests/queueLoop.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, shouldStop, queueLoopArgs } from "../scripts/queue-loop.mjs";

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

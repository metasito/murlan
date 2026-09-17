// tools/loop/tests/loopStatus.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { report } from "../loop-status.mjs";

const live = {
  onTicket: true,
  ticket: 42,
  branch: "agent/42-x",
  cwd: ".worktrees/agent-42",
  base: "origin/main",
  head: "abc1234",
  commits: 2,
  changed: ["a.ts"],
  dirty: false,
  phase: "C",
  why: "the supervisor handed this session phase C",
};

test("a reason the supervisor handed is printed under the phase", () => {
  const out = report(live, "phase E's agent:check was red");
  assert.match(out, /^ {2}resume at {2}C — Build\.[^\n]*\n {2}handed {5}phase E's agent:check was red$/m);
});

test("no reason, no line", () => {
  assert.doesNotMatch(report(live, undefined), /handed {5}/);
});

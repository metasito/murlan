import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { brief } from "../brief.mjs";

const SCRIPT = fileURLToPath(new URL("../guard-agent-model.mjs", import.meta.url));

function run(payload: object | string, loop = true): string {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const env = { ...process.env, LOOP_TURNS: loop ? "40" : undefined } as NodeJS.ProcessEnv;
  return execFileSync(process.execPath, [SCRIPT], { input, encoding: "utf8", env });
}

const dispatch = (tool_name: string, tool_input: object) => ({ tool_name, tool_input });

describe("a loop dispatch names its model", () => {
  for (const tool of ["Agent", "Task"]) {
    test(`${tool} without a model is denied, citing rule 29`, () => {
      const out = JSON.parse(run(dispatch(tool, { description: "x", prompt: "y" })));
      assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
      assert.match(out.hookSpecificOutput.permissionDecisionReason, /rule 29 of docs\/agents\/RULES\.md/);
    });

    test(`${tool} with a model is allowed`, () => {
      assert.equal(run(dispatch(tool, { prompt: "y", model: "sonnet" })), "");
    });
  }

  test("an empty model is no model", () => {
    assert.match(run(dispatch("Agent", { prompt: "y", model: "" })), /"deny"/);
  });

  test("outside the loop a dispatch without a model is allowed", () => {
    assert.equal(run(dispatch("Agent", { prompt: "y" }), false), "");
  });

  test("another tool is allowed", () => {
    assert.equal(run(dispatch("Bash", { command: "ls" })), "");
  });
});

const WT = "C:/Users/roton/murlan/.worktrees/agent-42";
const agent = (description: string, prompt: string, extra: object = {}) =>
  ({ tool_name: "Agent", tool_input: { description, prompt, model: "sonnet" }, ...extra });

describe("a loop dispatch of a brief passes it verbatim", () => {
  const exact = brief("completeness", { n: 42, worktree: WT });

  test("the exact brief is allowed", () => {
    assert.equal(run(agent("Completeness check #42", exact)), "");
  });

  test("the exact brief with material appended is allowed", () => {
    assert.equal(run(agent("Refute findings", brief("refute", { n: 42, worktree: WT }) + "\n## Standards\n- x")), "");
  });

  test("an edited brief is denied", () => {
    const edited = exact.replace("env var, ", "");
    assert.match(run(agent("Completeness check #42", edited)), /brief was edited/);
  });

  test("a named review dispatch with no brief header is denied", () => {
    for (const d of ["Completeness check 1103", "Standards review #1102", "Spec review round 2", "Refute review findings", "Scope issue 1103"]) {
      assert.match(run(agent(d, "You are the reviewer. Read the diff.")), /must start with its brief/, d);
    }
  });

  test("an unrelated dispatch is allowed", () => {
    assert.equal(run(agent("Read the CI log", "Summarise the failures in .loop-logs/ci-42.log")), "");
  });

  test("a subagent's own dispatch and a session outside the loop are not judged", () => {
    assert.equal(run(agent("Spec review", "free text", { agent_id: "a1" })), "");
    assert.equal(run(agent("Spec review", "free text"), false), "");
  });
});

describe("never disturbs a tool call", () => {
  for (const payload of ["", "not json", "{}", "null"]) {
    test(`exits 0 and says nothing on: ${payload || "(empty)"}`, () => {
      assert.equal(run(payload), "");
    });
  }
});

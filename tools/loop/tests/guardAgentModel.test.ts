import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

describe("never disturbs a tool call", () => {
  for (const payload of ["", "not json", "{}", "null"]) {
    test(`exits 0 and says nothing on: ${payload || "(empty)"}`, () => {
      assert.equal(run(payload), "");
    });
  }
});

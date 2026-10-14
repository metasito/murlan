import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brief, KINDS, MODEL_BY_KIND } from "../brief.mjs";

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

    test(`${tool} with a model and an effort is allowed`, () => {
      assert.equal(run(dispatch(tool, { prompt: "y", model: "sonnet", effort: "medium" })), "");
    });
  }

  test(`a dispatch without an effort is denied, naming it`, () => {
    const out = run(dispatch("Agent", { prompt: "y", model: "opus" }));
    assert.match(out, /"deny"/);
    assert.match(out, /effort/);
  });

  test("an empty model is no model", () => {
    assert.match(run(dispatch("Agent", { prompt: "y", model: "" })), /"deny"/);
  });

  test("judged with no LOOP_TURNS too: only the loop's own settings load this hook", () => {
    assert.match(run(dispatch("Agent", { prompt: "y" }), false), /"deny"/);
  });

  test("another tool is allowed", () => {
    assert.equal(run(dispatch("Bash", { command: "ls" })), "");
  });
});

const WT = "C:/Users/roton/murlan/.worktrees/agent-42";
const agent = (description: string, prompt: string, extra: object = {}) =>
  ({ tool_name: "Agent", tool_input: { description, prompt, model: "sonnet", effort: "medium" }, ...extra });

describe("a review, scope or completeness check runs only as its loop agent", () => {
  const exact = brief("completeness", { n: 42, worktree: WT });

  test("a brief dispatched to any other agent is denied, whatever its model", () => {
    assert.match(run(agent("Completeness check #42", exact)), /runs as its loop agent.*`loop-completeness`/);
    const review = agent("Code review", brief("review", { n: 42, worktree: WT }));
    assert.match(run({ ...review, tool_input: { ...review.tool_input, model: "claude-opus-5-5" } }), /runs as its loop agent/);
  });

  test("a named review dispatch with no brief header is denied", () => {
    for (const d of ["Completeness check 1103", "Fix review #1102", "Review #1102 round 2", "Spec review round 2", "Refute review findings", "Scope issue 1103"]) {
      assert.match(run(agent(d, "You are the reviewer. Read the diff.")), /runs as its loop agent/, d);
    }
  });

  test("a review dispatch worded any other way still runs as its loop agent", () => {
    for (const d of ["Review: Standards axis", "spec compliance review", "refute the findings"]) {
      assert.match(run(agent(d, "Review the diff")), /runs as its loop agent/, d);
    }
    for (const d of ["Implement the settings sheet", "Check spec coverage of the socket layer", "Fix the scope issue in Card.tsx",
      "Address review round 2 findings", "Trace callers for the code review fix", "Check ticket review comments"]) {
      assert.equal(run(agent(d, "anything")), "", d);
    }
  });

  test("a builder's own dispatch that merely says spec, scope or standards is allowed", () => {
    for (const d of ["Write e2e spec for table moments", "Scope out follow-up tickets", "Standards-compliant CSS cleanup"]) {
      assert.equal(run(agent(d, "Write tests/e2e/tableMoments.spec.ts")), "", d);
    }
  });

  test("an unrelated dispatch is allowed", () => {
    assert.equal(run(agent("Read the CI log", "Summarise the failures in .loop-logs/ci-42.log")), "");
  });

  test("a subagent's own dispatch is not judged", () => {
    assert.equal(run(agent("Spec review", "free text", { agent_id: "a1" })), "");
    assert.match(run(agent("Spec review", "free text"), false), /"deny"/);
  });
});

describe("a named loop agent carries its own model and effort", () => {
  const named = (subagent_type: string, prompt: string, extra: object = {}) =>
    ({ tool_name: "Agent", tool_input: { subagent_type, description: "Review #42 round 1", prompt, ...extra } });
  const review = brief("review", { n: 42, worktree: WT }) + "\nDefinition-of-done boxes ticked n/a: none\n";

  test("its brief, with no per-call model or effort, is allowed", () => {
    assert.equal(run(named("loop-review", review)), "");
    assert.equal(run(named("loop-scope", brief("scope", { n: 42, worktree: WT }))), "");
  });

  test("its brief with a later round's findings appended, or with CRLF line endings, is allowed", () => {
    assert.equal(run(named("loop-review", brief("review", { n: 42, worktree: WT, base: "abc1234" }) + "\n## Blocking\n- x")), "");
    assert.equal(run(named("loop-review", review.replace(/\n/g, "\r\n"))), "");
  });

  test("a per-call model or effort is an override, and is denied", () => {
    for (const extra of [{ model: "haiku" }, { effort: "low" }, { model: "opus", effort: "medium" }]) {
      assert.match(run(named("loop-review", review, extra)), /override/, JSON.stringify(extra));
    }
  });

  test("it runs only its own kind's brief", () => {
    assert.match(run(named("loop-review", "Review the diff")), /loop-review.*review brief/);
    assert.match(run(named("loop-scope", review)), /loop-scope.*scope brief/);
  });

  test("a loop agent that does not exist is denied, naming the ones that do", () => {
    assert.match(run(named("loop-builder", review)), /no loop agent `loop-builder`.*loop-review/);
  });

  test("each kind's agent file names the model rule 29 gives that kind, at medium effort", () => {
    for (const kind of KINDS) {
      const file = fileURLToPath(new URL(`../../../.claude/agents/loop-${kind}.md`, import.meta.url));
      const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
      const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(head)?.[1].trim();
      assert.equal(field("name"), `loop-${kind}`, file);
      assert.equal(field("model"), MODEL_BY_KIND[kind as keyof typeof MODEL_BY_KIND], file);
      assert.equal(field("effort"), "medium", file);
    }
  });
});

describe("never disturbs a tool call", () => {
  for (const payload of ["", "not json", "{}", "null"]) {
    test(`exits 0 and says nothing on: ${payload || "(empty)"}`, () => {
      assert.equal(run(payload), "");
    });
  }
});

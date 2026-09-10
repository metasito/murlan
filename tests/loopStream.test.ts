// tests/loopStream.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readLine, phaseOf, toPattern, PHASE_MARKERS, REDERIVE } from "../scripts/loop-stream.mjs";

describe("readLine", () => {
  test("returns null for a line that is not JSON, rather than throwing", () => {
    assert.equal(readLine("not json at all"), null);
    assert.equal(readLine(""), null);
  });

  test("reads the session id and version off system/init", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "abc-123",
      claude_code_version: "2.1.251",
    });
    assert.deepEqual(readLine(line), { kind: "init", sessionId: "abc-123", version: "2.1.251" });
  });

  test("reads a rate limit event and its reset time", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "throttled", resetsAt: "2026-09-11T04:10:00Z" },
    });
    assert.deepEqual(readLine(line), { kind: "rate_limit", resetsAt: "2026-09-11T04:10:00Z" });
  });

  test("reads every tool_use block out of one assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "thinking", thinking: "..." },
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "git commit -m x" } },
          { type: "tool_use", id: "t2", name: "Read", input: { file_path: "a.ts" } },
        ],
      },
    });
    assert.deepEqual(readLine(line), {
      kind: "tool",
      calls: [
        { name: "Bash", command: "git commit -m x", parent: null },
        { name: "Read", command: "", parent: null },
      ],
    });
  });

  test("carries parent_tool_use_id, which is how subagent work is told from the session's own", () => {
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "toolu_parent",
      message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
    });
    assert.equal(readLine(line)?.calls[0].parent, "toolu_parent");
  });

  test("an assistant message with no tool_use is not a fact", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    assert.equal(readLine(line), null);
  });

  test("reads the whole final result event", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 1.82,
      num_turns: 41,
      duration_ms: 1_420_000,
      terminal_reason: null,
      modelUsage: { "claude-opus-5": { costUSD: 1.6 }, "claude-sonnet-5": { costUSD: 0.22 } },
      subagent_stats: { spawned: 3, failed: 0 },
      usage: { cache_creation_input_tokens: 26069, cache_read_input_tokens: 15320 },
    });
    assert.deepEqual(readLine(line), {
      kind: "result",
      isError: false,
      subtype: "success",
      terminalReason: null,
      cost: 1.82,
      turns: 41,
      durationMs: 1_420_000,
      models: { "claude-opus-5": { costUSD: 1.6 }, "claude-sonnet-5": { costUSD: 0.22 } },
      subagents: { spawned: 3, failed: 0 },
      cache: { created: 26069, read: 15320 },
    });
  });

  test("a result missing usage and cost reads as zeroes, not as undefined", () => {
    const fact = readLine(
      JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true })
    );
    assert.equal(fact?.cost, 0);
    assert.equal(fact?.turns, 0);
    assert.deepEqual(fact?.cache, { created: 0, read: 0 });
    assert.equal(fact?.isError, true);
  });
});

describe("toPattern", () => {
  test("turns a queue.md placeholder into a wildcard and escapes the rest", () => {
    const re = toPattern("gh issue edit <n> --add-label in-progress");
    assert.ok(re.test("gh issue edit 953 --add-label in-progress"));
    assert.ok(!re.test("gh issue edit 953 --add-label ready-for-human"));
  });

  test("a regex metacharacter in the doc string is matched literally", () => {
    const re = toPattern("npm run worktrees:remove -- .worktrees/agent-<n>");
    assert.ok(re.test("npm run worktrees:remove -- .worktrees/agent-953"));
    assert.ok(!re.test("npm run worktreesXremove -- Yworktrees/agent-953"));
  });
});

describe("phaseOf", () => {
  test("the claim write marks phase A", () => {
    assert.equal(phaseOf({ name: "Bash", command: "gh issue edit 953 --add-label in-progress" }), "A");
  });

  test("a Task dispatch marks phase B whatever it says", () => {
    assert.equal(phaseOf({ name: "Task", command: "" }), "B");
  });

  test("the push marks phase E", () => {
    assert.equal(phaseOf({ name: "Bash", command: "git push -u origin agent/953-rate-limiter" }), "E");
  });

  test("an unrelated command marks nothing", () => {
    assert.equal(phaseOf({ name: "Bash", command: "ls -la" }), null);
    assert.equal(phaseOf({ name: "Read", command: "" }), null);
  });

  test("every marker names a tool and every Bash marker carries a doc string", () => {
    for (const m of PHASE_MARKERS) {
      assert.ok(m.tool, `marker for phase ${m.phase} names no tool`);
      if (m.tool === "Bash") assert.ok(m.doc, `Bash marker for phase ${m.phase} has no doc string to pin`);
    }
  });
});

describe("REDERIVE", () => {
  test("a commit and a verdict comment are both worth re-deriving after", () => {
    assert.ok(REDERIVE.test("git commit -m 'feat: x'"));
    assert.ok(REDERIVE.test("gh issue comment 953 --body-file /tmp/v.md"));
  });

  test("reading a file is not", () => {
    assert.ok(!REDERIVE.test("cat package.json"));
  });
});

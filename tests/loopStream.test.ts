// tests/loopStream.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readLine } from "../scripts/loop-stream.mjs";

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

  // Captured from a real run's `.loop-logs/962.jsonl`, not invented: the shape is the claim.
  test("reads a rate limit event: its status, its window, and its reset", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        resetsAt: 1789134000,
        rateLimitType: "five_hour",
        unifiedWindows: { five_hour: { utilization: 0.28, resetsAt: 1789134000 } },
      },
    });
    assert.deepEqual(readLine(line), {
      kind: "rate_limit",
      status: "allowed",
      blocked: false,
      warning: false,
      resetsAt: 1789134000,
      resetsAtMs: 1789134000000,
      window: "five_hour",
      used: 0.28,
      errorCode: null,
    });
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
      origin: null,
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




/** A healthy session emits this several times a minute; only "rejected" is work refused. */
describe("rate_limit_event is a usage meter, not an alarm", () => {
  const read = (line: string) => {
    const fact = readLine(line);
    assert.ok(fact, "the event was not read at all");
    return fact as any;
  };

  const event = (status: string, utilization = 0.3) =>
    JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status,
        resetsAt: 1789134000,
        rateLimitType: "five_hour",
        unifiedWindows: { five_hour: { utilization, resetsAt: 1789134000 } },
      },
    });

  test("an allowed window is not a block", () => {
    const fact = read(event("allowed"));
    assert.equal(fact.kind, "rate_limit");
    assert.equal(fact.blocked, false, "a session at 30% of its window is not rate limited");
    assert.equal(fact.used, 0.3);
  });

  test("a refusal is", () => {
    assert.equal(read(event("rejected")).blocked, true);
  });

  test("a warning is a session still being served, not a refusal", () => {
    assert.equal(read(event("allowed_warning")).blocked, false);
  });

  test("seconds and milliseconds both come out as milliseconds", () => {
    assert.equal(read(event("rejected")).resetsAtMs, 1789134000000);
  });

  test("it carries the window and the reset, so the wait can be stated", () => {
    const fact = read(event("rejected"));
    assert.equal(fact.window, "five_hour");
    assert.equal(fact.resetsAt, 1789134000);
  });

  test("an event with no info at all is not read as a block", () => {
    assert.equal(read(JSON.stringify({ type: "rate_limit_event" })).blocked, false);
  });
});

// The session is the only thing that knows what phase it is in.
describe("a PHASE line from the session", () => {
  const said = (text: string) =>
    readLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }));

  test("on its own, it is a fact", () => {
    assert.deepEqual(said("PHASE D"), { kind: "phase", letter: "D" });
  });

  test("surrounding whitespace does not stop it being one", () => {
    assert.deepEqual(said("  PHASE E\n"), { kind: "phase", letter: "E" });
  });

  test("prose mentioning a phase is not a fact", () => {
    assert.notEqual(said("now in PHASE D of six")?.kind, "phase");
  });

  test("a letter outside A-F is not a phase", () => {
    assert.notEqual(said("PHASE Z")?.kind, "phase");
  });
});

// A background task's wake-up is a turn and emits a result of its own; the real one carries
// `origin: null`. Last-wins across all of them reported a 144-turn session as one turn.
describe("a result's origin", () => {
  const result = (over: object) =>
    readLine(JSON.stringify({ type: "result", subtype: "success", num_turns: 41, ...over })) as any;

  test("the session's own result carries none", () => {
    assert.equal(result({}).origin, null);
  });

  test("a task notification's is carried through, so the reader can skip it", () => {
    assert.deepEqual(result({ origin: { kind: "task-notification" } }).origin, { kind: "task-notification" });
  });
});

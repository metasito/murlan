// tools/loop/tests/loopStream.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readLine } from "../loop-stream.mjs";

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
      kind: "assistant",
      letter: null,
      declared: null,
      text: "",
      // Whole, not just the command: what names a call best differs by tool, and choosing between
      // a path, a pattern and a description is the renderer's job rather than this one's.
      calls: [
        { name: "Bash", command: "git commit -m x", input: { command: "git commit -m x" }, parent: null },
        { name: "Read", command: "", input: { file_path: "a.ts" }, parent: null },
      ],
    });
  });

  test("carries parent_tool_use_id, which is how subagent work is told from the session's own", () => {
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "toolu_parent",
      message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
    });
    assert.equal((readLine(line) as any)?.calls[0].parent, "toolu_parent");
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
    ) as any;
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
  const said = (text: string, extra: object[] = []) =>
    readLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }, ...extra] } }),
    ) as any;

  test("on its own, it is a fact", () => {
    assert.equal(said("PHASE D").letter, "D");
  });

  test("surrounding whitespace does not stop it being one", () => {
    assert.equal(said("  PHASE E\n").letter, "E");
  });

  test("prose mentioning a phase is not a fact", () => {
    assert.equal(said("now in PHASE D of six"), null);
  });

  test("a letter outside A-F is not a phase", () => {
    assert.equal(said("PHASE Z"), null);
  });

  // A marker that has to be the whole of a message is a marker that ends the session: in print
  // mode a turn with text and no tool call is the final answer. Run 1 of #942 died on `PHASE A`,
  // seven seconds and one turn in; run 2 emitted the identical text and lived only because the
  // model happened to attach a tool call to it. The marker and the command must share a turn.
  test("it is still a fact in the same message as that phase's first command", () => {
    const fact = said("PHASE C\nStarting the build.", [
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "git status" } },
    ]);
    assert.equal(fact.letter, "C");
    assert.deepEqual(fact.calls, [
      { name: "Bash", command: "git status", input: { command: "git status" }, parent: null },
    ]);
    // The prose around the marker, which the board shows as the session's own account of itself.
    // Two markers were parsed out of this text and the rest of it was dropped.
    assert.equal(fact.text, "PHASE C\nStarting the build.");
  });

  test("a line of prose above it does not hide it", () => {
    assert.equal(said("Worktree is ready.\nPHASE B").letter, "B");
  });

  // Which of the two the session sends is not stable: the same model, from the same fenced line in
  // queue.md, sent it bare in four runs of eight, fenced in three, and both ways inside one.
  test("the fenced form is the same fact as the bare one", () => {
    assert.equal(said("`PHASE A`").letter, "A");
    assert.equal(said("Worktree ready, claim confirmed.\n\n`PHASE B`").letter, "B");
  });

  test("a fence does not turn prose into a fact", () => {
    assert.equal(said("`PHASE E` is next"), null);
  });
});

// Nine of the ten channels the supervisor reads a finished session through are inferences about a
// process that has already exited, and phase F deletes five of them. This one is a statement.
describe("the session's closing declaration", () => {
  const said = (text: string) =>
    readLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })) as any;

  test("carries the ticket, the branch, the pull request and the phase", () => {
    const fact = said(
      'LOOP-RESULT {"ticket":891,"branch":"agent/891-x","pr":1003,"phase":"F","stoodDown":false}',
    );
    assert.deepEqual(fact.declared, {
      ticket: 891,
      branch: "agent/891-x",
      pr: 1003,
      phase: "F",
      handoff: null,
      stoodDown: false,
      why: null,
    });
  });

  test("a stand-down says why, which is what releases the claim", () => {
    const fact = said('LOOP-RESULT {"ticket":42,"stoodDown":true,"why":"an older claim won the race"}');
    assert.equal(fact.declared.stoodDown, true);
    assert.match(fact.declared.why, /older claim/);
    assert.equal(fact.declared.pr, null);
  });

  test("it rides in the same message as the teardown command", () => {
    const fact = readLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: 'LOOP-RESULT {"ticket":7,"pr":9}' },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "git worktree list" } },
          ],
        },
      }),
    ) as any;
    assert.equal(fact.declared.pr, 9);
    assert.equal(fact.calls.length, 1);
  });

  // Half a line, a truncated write, a model that decided to pretty-print it. The supervisor falls
  // back to deriving; what it must not do is take a broken declaration as a good one.
  test("a declaration that is not JSON is no declaration, not a throw", () => {
    assert.equal(said("LOOP-RESULT {ticket: 891"), null);
  });

  test("prose about the marker is not a declaration", () => {
    assert.equal(said("I will now emit LOOP-RESULT {\"ticket\":1} when done"), null);
  });

  test("a declaration carries the phase it hands off at", () => {
    assert.equal(said('LOOP-RESULT {"ticket":7,"phase":"C","handoff":"D"}').declared.handoff, "D");
  });

  test("a settle declaration keeps its phase", () => {
    const fact = said('LOOP-RESULT {"ticket":7,"phase":"G"}');
    assert.equal(fact.declared.phase, "G");
    assert.equal(fact.declared.handoff, null);
  });

  test("a handoff that is not a phase letter is dropped", () => {
    assert.equal(said('LOOP-RESULT {"ticket":7,"handoff":"done"}').declared.handoff, null);
  });
});

// Captured from real runs' .loop-logs/999.jsonl and .loop-logs/1001.jsonl — a foreground subagent
// is the one caller of readLine() that never emits an `assistant` fact, so this is the only sign
// of life during the phase it runs in.
describe("a task fact", () => {
  test("task_started opens a plain shell task", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "task_started",
      task_id: "bvw1rp99g",
      tool_use_id: "toolu_014oEfToXemWeN4h5trWhVML",
      description: "Inspect ticket 999",
      is_backgrounded: false,
      task_type: "local_bash",
    });
    assert.deepEqual(readLine(line), {
      kind: "task",
      event: "started",
      id: "bvw1rp99g",
      of: "toolu_014oEfToXemWeN4h5trWhVML",
      what: "Inspect ticket 999",
      agent: null,
      tool: null,
      status: null,
      background: false,
      tokens: 0,
      toolUses: 0,
      ms: 0,
    });
  });

  test("task_started opens a dispatched subagent, carrying its type", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "task_started",
      task_id: "a2af3ea13c26088cb",
      tool_use_id: "toolu_019v9u2HmKQQphG5STUL2LaC",
      description: "Recon issue 999",
      subagent_type: "general-purpose",
      is_backgrounded: false,
      task_type: "local_agent",
    });
    const fact = readLine(line) as any;
    assert.equal(fact.event, "started");
    assert.equal(fact.agent, "general-purpose");
    assert.equal(fact.what, "Recon issue 999");
  });

  test("task_progress carries the subagent's current step and its running usage", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "task_progress",
      task_id: "a2af3ea13c26088cb",
      tool_use_id: "toolu_019v9u2HmKQQphG5STUL2LaC",
      description: "Reading .worktrees\\agent-999\\tests\\exchangeE2EHold.test.ts",
      subagent_type: "general-purpose",
      usage: { total_tokens: 30855, tool_uses: 1, duration_ms: 3803 },
      last_tool_name: "Read",
    });
    assert.deepEqual(readLine(line), {
      kind: "task",
      event: "progress",
      id: "a2af3ea13c26088cb",
      of: "toolu_019v9u2HmKQQphG5STUL2LaC",
      what: "Reading .worktrees\\agent-999\\tests\\exchangeE2EHold.test.ts",
      agent: "general-purpose",
      tool: "Read",
      status: null,
      background: false,
      tokens: 30855,
      toolUses: 1,
      ms: 3803,
    });
  });

  test("task_notification closes a plain shell task out, carrying its summary as what", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "task_notification",
      task_id: "bvw1rp99g",
      tool_use_id: "toolu_014oEfToXemWeN4h5trWhVML",
      status: "completed",
      output_file: "",
      summary: "Inspect ticket 999",
    });
    const fact = readLine(line) as any;
    assert.equal(fact.event, "notification");
    assert.equal(fact.status, "completed");
    assert.equal(fact.what, "Inspect ticket 999");
  });

  // .loop-logs/1001.jsonl: a review agent's own session hit the rate limit mid-run. A closing
  // status is not always "completed", and the board needs to say so rather than reading it as done.
  test("task_notification carrying a non-completed status", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "task_notification",
      task_id: "a5e05a4e77691426f",
      tool_use_id: "toolu_014JgFbe9Sx3kfqmBEXAZRsR",
      status: "failed",
      summary:
        "Agent terminated early due to an API error: You've hit your session limit · resets 1:30pm (Europe/Zurich) (error type rate_limit, HTTP 429, request id req_011Cf1BsyMEhMnzKMJ8Qk5ma, model sent to the API: claude-opus-5)",
    });
    const fact = readLine(line) as any;
    assert.equal(fact.status, "failed");
    assert.match(fact.what, /session limit/);
  });

  // task_updated is NOT shaped like task_progress: it carries only a `patch`, never `description`,
  // `subagent_type`, `usage` or `last_tool_name` — the status the brief said to check for, and
  // real logs disagreed with. The status this closing patch carries has to be read out of it.
  test("task_updated closes a subagent's task, its status nested under patch", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "task_updated",
      task_id: "a2af3ea13c26088cb",
      patch: { status: "completed", end_time: 1789285944668 },
    });
    assert.deepEqual(readLine(line), {
      kind: "task",
      event: "updated",
      id: "a2af3ea13c26088cb",
      of: null,
      what: null,
      agent: null,
      tool: null,
      status: "completed",
      background: false,
      tokens: 0,
      toolUses: 0,
      ms: 0,
    });
  });

  // .loop-logs/1001.jsonl: the same subtype also carries a mid-run patch with no status at all,
  // just a task flipping to backgrounded — not every task_updated is a closing one.
  test("a mid-run task_updated with no status is not read as closed", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "task_updated",
      task_id: "byvwfrney",
      patch: { is_backgrounded: true },
    });
    const fact = readLine(line) as any;
    assert.equal(fact.status, null);
    assert.equal(fact.background, true);
  });

  // .loop-logs/1001.jsonl: a failed patch carries no description or summary, only a human-readable
  // `error` — the one place a session limit's own message survives to the closing fact.
  test("a failed task_updated's error is what, since it has no description or summary", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "task_updated",
      task_id: "a20d8fa54dedc9318",
      patch: {
        status: "failed",
        end_time: 1789250508286,
        error:
          "Agent terminated early due to an API error: You've hit your session limit · resets 3:10am (Europe/Zurich) (error type rate_limit, HTTP 429, request id req_011CezJJrwAYTQuSahyACpii, model sent to the API: claude-opus-5)",
      },
    });
    const fact = readLine(line) as any;
    assert.equal(fact.status, "failed");
    assert.match(fact.what, /session limit/);
  });

  test("a task event missing its task_id is not a fact, rather than one with a broken key", () => {
    assert.equal(
      readLine(JSON.stringify({ type: "system", subtype: "task_progress", description: "x" })),
      null,
    );
  });

  test("a task_updated with neither a flat nor a nested status reads as still open", () => {
    const fact = readLine(
      JSON.stringify({ type: "system", subtype: "task_updated", task_id: "x", patch: {} }),
    ) as any;
    assert.equal(fact.status, null);
    assert.equal(fact.background, false);
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

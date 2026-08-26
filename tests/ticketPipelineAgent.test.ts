// tests/ticketPipelineAgent.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildAgentArgs, parseAgentOutput } from "../lib/ticketPipeline/agent.ts";
import { branchNameFor, forcedTicket, isRegisteredWorktree } from "../scripts/ticket-pipeline.ts";

const SPEC = { prompt: "/code-review high --fix main", model: "opus", effort: "max", cwd: "/wt" } as const;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

describe("the argv a stage is spawned with", () => {
  test("carries the model and the effort it was given", () => {
    const args = buildAgentArgs(SPEC);
    assert.equal(flag(args, "--model"), "opus");
    assert.equal(flag(args, "--effort"), "max");
    assert.equal(flag(args, "-p"), SPEC.prompt);
  });

  // Measured at 13k tokens a turn in this repo — the Chrome tool schemas, which no stage can use.
  // `--strict-mcp-config` with no `--mcp-config` beside it is what loads none of them.
  test("loads no MCP server", () => {
    const args = buildAgentArgs(SPEC);
    assert.ok(args.includes("--strict-mcp-config"));
    assert.ok(!args.includes("--mcp-config"));
  });

  // Skills cost about 2k for all of them together, and the settings are also what carry the
  // PreToolUse guard. Dropping them to save that would cost the guard as well.
  test("keeps the project's settings, and so its skills and its Bash guard", () => {
    assert.equal(flag(buildAgentArgs(SPEC), "--setting-sources"), "user,project");
  });

  // A stage's prompt names one skill as a starting point, not a boundary. Narrowing the tool set
  // saves about 10k tokens a turn and buys a stage that cannot reach a skill, an agent of its own
  // or the web when the work turns out to need one.
  test("takes no tool away", () => {
    assert.ok(!buildAgentArgs(SPEC).includes("--tools"));
  });
});

describe("reading a stage's output", () => {
  const RESULT = JSON.stringify({
    type: "result",
    result: "done",
    total_cost_usd: 1.5,
    num_turns: 9,
    usage: {
      input_tokens: 12,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 80,
      output_tokens: 34,
    },
  });

  test("takes the result line, not the stream before it", () => {
    const parsed = parseAgentOutput(['{"type":"system"}', RESULT].join("\n"));
    assert.equal(parsed.text, "done");
    assert.equal(parsed.costUsd, 1.5);
    assert.equal(parsed.turns, 9);
  });

  // The first landed run reported a dollar figure and nothing else, so "was it thinking or was it
  // stuck" could not be answered from it at all.
  test("reports what the stage cost in tokens", () => {
    assert.deepEqual(parseAgentOutput(RESULT).usage, {
      input: 12,
      cacheRead: 900,
      cacheWrite: 80,
      output: 34,
    });
  });

  // A stage killed by its timeout leaves whatever it had written on stdout. Reporting that as a
  // parse crash loses the run; the tail is what says why it died.
  test("survives output that is not JSON at all", () => {
    assert.equal(parseAgentOutput("killed by signal SIGTERM").costUsd, 0);
    assert.match(parseAgentOutput("killed by signal SIGTERM").text, /SIGTERM/);
    assert.equal(parseAgentOutput("killed by signal SIGTERM").usage.output, 0);
  });

  // A result line with no usage block at all must still parse.
  test("a result missing its usage reports zeroes rather than throwing", () => {
    assert.equal(parseAgentOutput('{"type":"result","result":"x"}').usage.input, 0);
  });
});

describe("the branch a ticket is worked on", () => {
  // Sessions share one GitHub account, so the branch name is the only thing that distinguishes
  // one run's claim from another's.
  test("names the ticket and survives a title full of punctuation", () => {
    const branch = branchNameFor({ number: 348, title: 'Replay: "Watch replay" locks the player out' });
    assert.match(branch, /^agent\/348-/);
    assert.match(branch, /^[\w./-]+$/);
  });

  test("stays a legal ref for a title that is nothing but punctuation", () => {
    assert.equal(branchNameFor({ number: 7, title: "!!! ???" }), "agent/7-ticket");
  });
});

describe("aiming a run at one ticket", () => {
  test("no flag means the queue picks", () => {
    assert.equal(forcedTicket([]), undefined);
  });

  test("--ticket takes the number after it", () => {
    assert.equal(forcedTicket(["--ticket", "348"]), 348);
  });

  // A typo here would silently run the queue's own pick instead of the ticket asked for, which is
  // a claim on someone else's work.
  test("a number that is not one stops the run", () => {
    assert.throws(() => forcedTicket(["--ticket"]), /needs an issue number/);
    assert.throws(() => forcedTicket(["--ticket", "main"]), /needs an issue number/);
  });
});

describe("deleting the directory a worktree removal left behind", () => {
  const LISTED = [
    "worktree C:/Users/roton/murlan",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree C:/Users/roton/murlan/.worktrees/agent-377",
    "HEAD def",
    "branch refs/heads/agent/377-x",
    "",
  ].join("\n");

  // A registration still standing is the cleanup step having decided to KEEP the worktree, because
  // it holds work nobody staged. An implement agent that died mid-edit wrote 31 files that a
  // --force teardown then destroyed, with no objects left to recover them from.
  test("a path git still names is not an orphan", () => {
    assert.equal(isRegisteredWorktree(LISTED, "C:/Users/roton/murlan/.worktrees/agent-377"), true);
  });

  test("a path git no longer names is", () => {
    assert.equal(isRegisteredWorktree(LISTED, "C:/Users/roton/murlan/.worktrees/agent-999"), false);
  });

  // Windows compares paths without case, and a mismatch reads a live worktree as an orphan.
  test("case and separators do not change the answer", () => {
    assert.equal(
      isRegisteredWorktree(LISTED, String.raw`C:\Users\Roton\murlan\.worktrees\Agent-377`),
      process.platform === "win32"
    );
  });

  // Nothing is deleted on a listing that could not be read.
  test("an empty listing names nothing", () => {
    assert.equal(isRegisteredWorktree("", "C:/Users/roton/murlan/.worktrees/agent-377"), false);
  });
});

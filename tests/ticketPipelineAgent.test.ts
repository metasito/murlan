// tests/ticketPipelineAgent.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildAgentArgs, parseAgentOutput } from "../lib/ticketPipeline/agent.ts";
import { branchNameFor } from "../scripts/ticket-pipeline.ts";

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
  test("takes the result line, not the stream before it", () => {
    const raw = ['{"type":"system"}', '{"type":"result","result":"done","total_cost_usd":1.5,"num_turns":9}'].join("\n");
    const parsed = parseAgentOutput(raw);
    assert.equal(parsed.text, "done");
    assert.equal(parsed.costUsd, 1.5);
    assert.equal(parsed.turns, 9);
  });

  // A stage killed by its timeout leaves whatever it had written on stdout. Reporting that as a
  // parse crash loses the run; the tail is what says why it died.
  test("survives output that is not JSON at all", () => {
    assert.equal(parseAgentOutput("killed by signal SIGTERM").costUsd, 0);
    assert.match(parseAgentOutput("killed by signal SIGTERM").text, /SIGTERM/);
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

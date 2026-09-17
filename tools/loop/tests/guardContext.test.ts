import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../guard-context.mjs", import.meta.url));
let dir = "";

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-context-"));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const assistant = (tokens: number) => ({
  type: "assistant",
  message: {
    usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens - 10 },
    content: [{ type: "text", text: "ok" }],
  },
});
const bash = (id: string, command: string) => ({
  type: "assistant",
  message: { usage: { input_tokens: 10 }, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
});
const noticed = (text: string) => ({ type: "attachment", attachment: { type: "hook_additional_context", content: [text] } });

let n = 0;
function transcript(rows: object[]): string {
  const file = path.join(dir, `t${n++}.jsonl`);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return file;
}

function run(payload: object | string, env: Record<string, string | undefined> = { LOOP_TURNS: "40", LOOP_PHASE: "C" }): string {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const clean = { ...process.env, LOOP_TURNS: undefined, LOOP_PHASE: undefined, ...env };
  return execFileSync(process.execPath, [SCRIPT], { input, encoding: "utf8", env: clean as NodeJS.ProcessEnv });
}

const call = (transcript_path: string, extra: object = {}) => ({
  session_id: "s1",
  transcript_path,
  tool_name: "Read",
  tool_input: { file_path: "a.ts" },
  ...extra,
});

describe("the context ceiling", () => {
  test("under the ceiling is silent", () => {
    assert.equal(run(call(transcript([assistant(199_000)]))), "");
  });

  const ceiling = "Context is past 200k. Commit what works and hand off to the phase of your last PHASE line.";

  test("over the ceiling says so once, pointing at the session's own phase, never the one it started in", () => {
    const out = JSON.parse(run(call(transcript([assistant(10_000), assistant(201_000)]))));
    assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.equal(out.hookSpecificOutput.additionalContext, ceiling);
  });

  test("the notice is the same with or without LOOP_PHASE", () => {
    const out = run(call(transcript([assistant(201_000)])), { LOOP_TURNS: "40" });
    assert.equal(JSON.parse(out).hookSpecificOutput.additionalContext, ceiling);
  });

  test("a notice already in the transcript is not repeated", () => {
    const said = ceiling;
    assert.equal(run(call(transcript([assistant(201_000), noticed(said), assistant(210_000)]))), "");
  });

  test("a subagent is silent", () => {
    assert.equal(run(call(transcript([assistant(201_000)]), { agent_id: "a1" })), "");
  });

  test("outside the loop is silent", () => {
    assert.equal(run(call(transcript([assistant(201_000)])), {}), "");
  });
});

describe("a repeated command", () => {
  const cmd = "npx tsc --noEmit";
  const third = (rows: object[]) =>
    call(transcript(rows), { tool_name: "Bash", tool_input: { command: cmd }, tool_use_id: "b3" });

  test("the third identical command gets the notice", () => {
    const out = run(third([bash("b1", cmd), bash("b2", cmd), bash("b3", cmd)]));
    assert.match(out, /same command three times: batch edits before re-running it/);
  });

  test("the second does not", () => {
    assert.equal(run(third([bash("b1", cmd), bash("b3", cmd)])), "");
  });

  test("the notice for a command is not repeated", () => {
    const rows = [bash("b1", cmd), bash("b2", cmd), bash("b3", cmd)];
    const first = JSON.parse(run(third(rows))).hookSpecificOutput.additionalContext;
    const fourth = call(transcript([...rows, noticed(first), bash("b4", cmd)]), {
      tool_name: "Bash",
      tool_input: { command: cmd },
      tool_use_id: "b4",
    });
    assert.equal(run(fourth), "");
  });

  test("a different command's notice does not silence this one", () => {
    const other = [bash("x1", "ls"), bash("x2", "ls"), bash("x3", "ls")];
    const said = JSON.parse(run(call(transcript(other), { tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "x3" })))
      .hookSpecificOutput.additionalContext;
    const out = run(third([...other, noticed(said), bash("b1", cmd), bash("b2", cmd), bash("b3", cmd)]));
    assert.match(out, /same command three times/);
  });
});

describe("never disturbs a tool call", () => {
  for (const payload of ["", "not json", "{}", '{"transcript_path":"/no/such/file"}']) {
    test(`exits 0 and says nothing on: ${payload || "(empty)"}`, () => {
      assert.equal(run(payload), "");
    });
  }
});

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { READ_CAP, linesRequested, verdict } from "../guard-read.mjs";

const SCRIPT = fileURLToPath(new URL("../guard-read.mjs", import.meta.url));
let dir = "";
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-read-"));
  fs.writeFileSync(path.join(dir, "big.ts"), "x\n".repeat(400));
  fs.writeFileSync(path.join(dir, "small.ts"), "x\n".repeat(40));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const count = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").length - 1 : null);
const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command }, cwd: dir });
const read = (file: string, extra: object = {}) => ({ tool_name: "Read", tool_input: { file_path: path.join(dir, file), ...extra }, cwd: dir });

describe("linesRequested", () => {
  const cases: [object, number][] = [
    [bash("sed -n 330,700p big.ts"), 371],
    [bash("sed -n '1,100p' big.ts && sed -n 200,260p big.ts"), 161],
    [bash("sed -n 10,40p big.ts"), 31],
    [bash("head -n 300 big.ts"), 300],
    [bash("tail -200 big.ts"), 200],
    [bash("git log | head -n 500"), 0],
    [bash("cat big.ts"), 400],
    [bash("cat big.ts | grep -n foo"), 0],
    [bash("sed -n 1,400p big.ts | head"), 0],
    [bash("head -c 20000 big.ts"), 500],
    [bash("nl big.ts"), 400],
    [bash("cat small.ts"), 40],
    [bash("cat > out.md <<'EOF'\nhello\nEOF"), 0],
    [{ tool_name: "PowerShell", tool_input: { command: "Get-Content big.ts -TotalCount 20" }, cwd: dir }, 20],
    [{ tool_name: "PowerShell", tool_input: { command: "Get-Content big.ts" }, cwd: dir }, 400],
    [read("big.ts"), 400],
    [read("big.ts", { offset: 100, limit: 120 }), 120],
    [read("big.ts", { offset: 391 }), 10],
    [read("big.ts", { limit: 300 }), 300],
    [read("small.ts"), 40],
    [read("missing.ts"), 0],
  ];
  for (const [payload, want] of cases) {
    test(JSON.stringify((payload as { tool_input: object }).tool_input), () => {
      assert.equal(linesRequested(payload, count), want);
    });
  }
});

describe("verdict", () => {
  test("over the cap denies, naming the count and the way out", () => {
    const why = verdict(bash("sed -n 330,700p big.ts"), count);
    assert.match(String(why), /371 lines/);
    assert.match(String(why), /sonnet subagent/);
  });
  test("at the cap allows", () => {
    assert.equal(verdict(bash(`sed -n 1,${READ_CAP}p big.ts`), count), null);
  });
});

function run(payload: object | string, env: Record<string, string | undefined> = { LOOP_TURNS: "40" }): string {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  return execFileSync(process.execPath, [SCRIPT], { input, encoding: "utf8", env: { ...process.env, LOOP_TURNS: undefined, ...env } as NodeJS.ProcessEnv });
}

describe("the hook", () => {
  test("denies in the main loop session", () => {
    const out = JSON.parse(run(bash("sed -n 1,400p big.ts")));
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  });
  test("allows a subagent, and a session outside the loop", () => {
    assert.equal(run({ ...bash("sed -n 1,400p big.ts"), agent_id: "a1" }), "");
    assert.equal(run(bash("sed -n 1,400p big.ts"), {}), "");
  });
  for (const payload of ["", "not json", "{}", "null"]) {
    test(`fails open on: ${payload || "(empty)"}`, () => assert.equal(run(payload), ""));
  }
});

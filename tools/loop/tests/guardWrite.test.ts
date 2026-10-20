import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultKeyFile } from "../evidence.mjs";
import { judge, verdict } from "../guard-write.mjs";

const root = path.resolve("/repo");
test("a tracked file in the shared checkout is refused", () => {
  assert.match(String(verdict(path.join(root, ".github", "workflows", "ios.yml"), root)), /shared checkout/);
  assert.notEqual(verdict("components/x.tsx", root), null);
});
test("a relative path resolves against the call's cwd, not the root", () => {
  assert.equal(verdict("components/x.tsx", root, path.join(root, ".worktrees", "agent-12")), null);
  assert.notEqual(verdict("components/x.tsx", root, root), null);
});
test("the worktree and .loop-logs are allowed", () => {
  for (const p of [path.join(root, ".worktrees", "agent-12", "app", "x.ts"), path.join(root, ".loop-logs", "pr-12.md")])
    assert.equal(verdict(p, root), null, p);
});
test("a path outside the repo is refused, so the owner's own folders are not scratch (#1261)", () => {
  for (const p of [path.resolve("/Users/roton/murlan-plans/review-1261.md"), path.resolve("/tmp/pr.md")])
    assert.match(String(verdict(p, root)), /\.loop-logs/, p);
});
test("the hook denies with or without LOOP_TURNS: only the loop's own settings load it", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "guard-write-"));
  execFileSync("git", ["init", "-q", repo]);
  const script = fileURLToPath(new URL("../guard-write.mjs", import.meta.url));
  const input = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: path.join(repo, "a.ts") }, cwd: repo });
  const run = (env: Record<string, string | undefined>) => execFileSync(process.execPath, [script], { input, encoding: "utf8", env: { ...process.env, LOOP_TURNS: undefined, ...env } as NodeJS.ProcessEnv });
  assert.equal(JSON.parse(run({ LOOP_TURNS: "40" })).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(JSON.parse(run({})).hookSpecificOutput.permissionDecision, "deny");
  fs.rmSync(repo, { recursive: true, force: true });
});
test("an unreadable payload is allowed, and says so (ADR-0010)", () => {
  const script = fileURLToPath(new URL("../guard-write.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" });
  assert.deepEqual([run.status, run.stdout], [0, ""]);
  assert.match(run.stderr, /guard-write: could not read the tool call on stdin/);
});
test("a call it cannot judge is refused: no checkout root answers from a cwd that does not exist", () => {
  const script = fileURLToPath(new URL("../guard-write.mjs", import.meta.url));
  const cwd = path.join(os.tmpdir(), "guard-write-missing", String(process.pid));
  const input = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: path.join(cwd, "a.ts") }, cwd });
  const run = spawnSync(process.execPath, [script], { input, encoding: "utf8" });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /guard-write: could not judge this call \(.+\); refusing it\./);
});

test("Read, Grep and Glob are refused for the evidence key, its directory and anything above it, and nothing else", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guard-read-"));
  try {
    const key = defaultKeyFile(process.env, process.platform, home);
    fs.mkdirSync(path.dirname(key), { recursive: true });
    fs.writeFileSync(key, "k");
    const link = path.join(home, "innocent.txt");
    fs.symlinkSync(key, link);
    const call = (tool_name: string, tool_input: Record<string, string>) => judge({ tool_name, tool_input, cwd: root }, () => root, home);
    for (const [tool, input] of [
      ["Read", { file_path: key }],
      ["Read", { file_path: link }],
      ["Read", { file_path: "~/.local/state/murlan-loop/evidence.key" }],
      ["Read", { file_path: "C:\\Users\\u\\AppData\\Local\\murlan-loop\\evidence.key" }],
      ["Grep", { pattern: "x", path: path.dirname(key) }],
      ["Grep", { pattern: "x", path: home }],
      ["Grep", { pattern: "x", path: "/", glob: "*.key" }],
      ["Glob", { pattern: `${path.dirname(key)}/*` }],
      ["Glob", { pattern: "**/evidence.key" }],
      ["Glob", { pattern: "x", path: path.dirname(key) }],
    ] as [string, Record<string, string>][]) {
      assert.match(String(call(tool, input)), /evidence key/, `${tool} ${JSON.stringify(input)}`);
    }
    for (const [tool, input] of [
      ["Read", { file_path: path.join(root, "package.json") }],
      ["Grep", { pattern: "evidence.key", path: path.join(root, "tools") }],
      ["Glob", { pattern: "**/*.ts" }],
      ["Glob", { pattern: "src/**", path: path.join(root, "x") }],
    ] as [string, Record<string, string>][]) {
      assert.equal(call(tool, input), null, `${tool} ${JSON.stringify(input)}`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the registration covers the read tools with the same command as the write tools", () => {
  const settings = JSON.parse(fs.readFileSync(new URL("../loop-settings.json", import.meta.url), "utf8"));
  const entry = settings.hooks.PreToolUse.find((e: { hooks: { args: string[] }[] }) => e.hooks.some((h) => h.args.some((a) => a.endsWith("guard-write.mjs"))));
  assert.deepEqual(entry.matcher.split("|").sort(), ["Edit", "Glob", "Grep", "NotebookEdit", "Read", "Write"]);
  assert.equal(entry.hooks[0].onFailure, "block");
});

test("the hook denies a Read of the key, and refuses a call it cannot judge", () => {
  const script = fileURLToPath(new URL("../guard-write.mjs", import.meta.url));
  const key = defaultKeyFile(process.env, process.platform, os.homedir());
  const run = (input: object) => spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: "utf8" });
  const denied = run({ tool_name: "Read", tool_input: { file_path: key }, cwd: process.cwd() });
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(run({ tool_name: "Read", tool_input: { file_path: path.join(process.cwd(), "package.json") }, cwd: process.cwd() }).stdout, "");
  const missing = path.join(os.tmpdir(), "guard-write-missing", String(process.pid));
  assert.equal(run({ tool_name: "Edit", tool_input: { file_path: path.join(missing, "a.ts") }, cwd: missing }).status, 2);
});

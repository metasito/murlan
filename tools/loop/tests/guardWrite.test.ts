import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verdict } from "../guard-write.mjs";

const root = path.resolve("/repo");
test("a tracked file in the shared checkout is refused", () => {
  assert.match(String(verdict(path.join(root, ".github", "workflows", "ios.yml"), root)), /shared checkout/);
  assert.notEqual(verdict("components/x.tsx", root), null);
});
test("the worktree, .loop-logs and anything outside the repo are allowed", () => {
  for (const p of [path.join(root, ".worktrees", "agent-12", "app", "x.ts"), path.join(root, ".loop-logs", "pr-12.md"), path.resolve("/tmp/pr.md")])
    assert.equal(verdict(p, root), null, p);
});
test("the hook denies in a loop session and is silent outside one", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "guard-write-"));
  execFileSync("git", ["init", "-q", repo]);
  const script = fileURLToPath(new URL("../guard-write.mjs", import.meta.url));
  const input = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: path.join(repo, "a.ts") }, cwd: repo });
  const run = (env: Record<string, string | undefined>) => execFileSync(process.execPath, [script], { input, encoding: "utf8", env: { ...process.env, LOOP_TURNS: undefined, ...env } as NodeJS.ProcessEnv });
  assert.equal(JSON.parse(run({ LOOP_TURNS: "40" })).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(run({}), "");
  fs.rmSync(repo, { recursive: true, force: true });
});

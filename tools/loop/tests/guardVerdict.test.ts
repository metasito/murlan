import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brief } from "../brief.mjs";

const SCRIPT = fileURLToPath(new URL("../guard-verdict.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-verdict-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const LAND = "gh issue comment 7 --body 'VERDICT: LAND abc1234'";

const say = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const call = (id: string, name: string, input: object) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const result = (id: string, content: string) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content }] },
});
const review = (kind: string, n = 7) =>
  call(`${kind}-${n}`, "Agent", { model: "sonnet", prompt: brief(kind, { n, worktree: ".worktrees/agent-7", base: "abc1234" }) });

let serial = 0;
function run(rows: object[], command = LAND, extra: object = {}, loop = true): string {
  const transcript_path = path.join(dir, `t${serial++}.jsonl`);
  fs.writeFileSync(transcript_path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command }, transcript_path, cwd: dir, ...extra });
  const env = { ...process.env, LOOP_TURNS: loop ? "40" : undefined } as NodeJS.ProcessEnv;
  return execFileSync(process.execPath, [SCRIPT], { input, encoding: "utf8", env });
}
const denied = (out: string) => out !== "" && JSON.parse(out).hookSpecificOutput.permissionDecision === "deny";

describe("a LAND follows this round's own reviewers", () => {
  test("the review brief allows it", () => {
    assert.equal(run([say("PHASE D"), review("review")]), "");
  });

  test("a fix brief allows it", () => {
    assert.equal(run([say("PHASE D"), review("fix")]), "");
  });

  test("no reviewers denies it, citing rule 29", () => {
    const out = run([say("PHASE D")]);
    assert.ok(denied(out));
    assert.match(out, /rule 29/);
  });

  test("a scope or completeness brief is not a review", () => {
    assert.ok(denied(run([say("PHASE D"), review("scope"), review("completeness")])));
  });

  test("an earlier round's reviewers do not count", () => {
    assert.ok(denied(run([say("PHASE D"), review("review"), say("PHASE C"), say("PHASE D")])));
  });

  test("another ticket's reviewers do not count", () => {
    assert.ok(denied(run([say("PHASE D"), review("review", 8)])));
  });

  test("the round cap never allows a LAND of the session's own", () => {
    const gate = call("g", "Bash", { command: "node tools/loop/loop-gate.mjs --review-round" });
    assert.ok(denied(run([say("PHASE D"), gate, result("g", "loop-gate: #7 — the cap is 3")])));
  });

  test("a body file is read", () => {
    fs.writeFileSync(path.join(dir, "v.md"), "VERDICT: LAND abc1234\n\nAccepted.\n");
    assert.ok(denied(run([say("PHASE D")], "gh issue comment 7 --body-file v.md")));
  });

  test("a body file is read from where a leading cd left the call", () => {
    fs.mkdirSync(path.join(dir, "wt7"), { recursive: true });
    fs.writeFileSync(path.join(dir, "wt7", "only-here.md"), "VERDICT: LAND abc1234\n");
    assert.ok(denied(run([say("PHASE D")], "cd wt7 && gh issue comment 7 --body-file only-here.md")));
  });

  test("Git Bash's /tmp body file is read on win32", { skip: process.platform !== "win32" }, () => {
    const file = path.join(os.tmpdir(), `guard-verdict-${process.pid}.md`);
    fs.writeFileSync(file, "VERDICT: LAND abc1234\n");
    assert.ok(denied(run([say("PHASE D")], `gh issue comment 7 --body-file /tmp/${path.basename(file)}`)));
    fs.rmSync(file);
  });
});

describe("a LAND by any other spelling is still a LAND", () => {
  test("an issue named by its URL", () => {
    assert.ok(denied(run([say("PHASE D")], "gh issue comment https://github.com/metasito/murlan/issues/7 --body 'VERDICT: LAND abc1234'")));
  });

  test("a gh api post to the issue's comments, inline or from a file", () => {
    fs.writeFileSync(path.join(dir, "api.md"), "VERDICT: LAND abc1234\n");
    for (const command of [
      "gh api repos/metasito/murlan/issues/7/comments -f body='VERDICT: LAND abc1234'",
      'gh api -X POST repos/{owner}/{repo}/issues/7/comments -f "body=VERDICT: LAND abc1234"',
      "gh api repos/metasito/murlan/issues/7/comments -F body=@api.md",
    ]) {
      assert.ok(denied(run([say("PHASE D")], command)), command);
      assert.equal(run([say("PHASE D"), review("review")], command), "", `${command} after the review`);
    }
  });

  test("a transcript it cannot read denies, and says so", () => {
    const out = run([], LAND, { transcript_path: path.join(dir, "missing.jsonl") });
    assert.ok(denied(out));
    assert.match(out, /transcript/);
  });

  test("a payload naming no transcript is allowed, with a warning on stderr", () => {
    const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: LAND }, cwd: dir });
    const env = { ...process.env, LOOP_TURNS: "40" } as NodeJS.ProcessEnv;
    const out = spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8", env });
    assert.equal(out.status, 0);
    assert.equal(out.stdout, "");
    assert.match(out.stderr, /no transcript/);
  });
});

describe("what it leaves alone", () => {
  for (const command of [
    "gh issue comment 7 --body 'VERDICT: HOLD abc1234 — spec gap'",
    "gh issue comment 7 --body 'REVIEW abc1234'",
    "gh issue comment 7 --body 'DOD-CHECK abc1234'",
    "git log --grep 'VERDICT: LAND'",
    "gh api repos/metasito/murlan/issues/7/comments --jq '.[].body'",
  ]) {
    test(command, () => assert.equal(run([say("PHASE D")], command), ""));
  }

  test("outside the loop", () => assert.equal(run([say("PHASE D")], LAND, {}, false), ""));
  test("inside a subagent", () => assert.equal(run([say("PHASE D")], LAND, { agent_id: "a1" }), ""));
});

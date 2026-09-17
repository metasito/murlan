// tools/loop/tests/guardBash.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../guard-bash.mjs";

const SCRIPT = fileURLToPath(new URL("../guard-bash.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Runs a function with process.stderr.write captured rather than printed, then restores it. */
function captureStderr(fn: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let out = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    out += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return out;
}

const REFS = new Set(["main", "HEAD", "origin/main", "HEAD~1"]);
const repo = {
  branch: () => "agent/1-x",
  pushTarget: () => "origin/agent/1-x",
  isRef: (arg: string) => REFS.has(arg),
  pathsClean: (paths: string[]) => !paths.some((p) => p.includes("dirty")),
};
const device = () => "iOS UI (Maestro)";
const guard = (cmd: string) => check(cmd, device, repo);

const ADD = /pathspec/;
const DISCARD = /Edit tool/;
const FORCE_DELETE = /worktrees:remove/;
const DEVICE = /MAESTRO_EVIDENCE_READ=1 <your command>/;
const UNREADABLE = /literal id/;
const MERGE = /not yours to merge/;

const BLOCKED: [string, RegExp][] = [
  ["git add -A", ADD],
  ["git add .", ADD],
  ["git add --all", ADD],
  ["git add -u", ADD],
  ["git commit -q -m x && git add -A", ADD],
  ["cd /c/repo && git add -A -- .", ADD],
  ["git -C d add -A", ADD],
  ["FOO=1 git add -A", ADD],
  ["for f in x; do git add .; done", ADD],
  ["echo x | xargs git add -A", ADD],
  ["env -u X git add -A", ADD],
  ['echo "$(git add -A)"', ADD],
  ["bash <<'EOF'\ngit add -A\nEOF", ADD],
  ["cat <<'EOF' | sh\ngit add -A\nEOF", ADD],
  ["iex @'\ngit add -A\n'@", ADD],
  ['pwsh -Command "git add -A"', ADD],
  ["bash <<< 'git add -A'", ADD],
  ["/usr/bin/git add -A", ADD],
  ["git.exe add -A", ADD],
  ["find / -iname node_modules", /require\.resolve/],
  ["find /c/ -name x", /require\.resolve/],
  ["find C:\\ -name x", /require\.resolve/],
  ["git checkout -- components/MenuLayout.tsx", DISCARD],
  ["git restore components/MenuLayout.tsx", DISCARD],
  ["git restore -- a.ts", DISCARD],
  ["npm test; git checkout -- a.ts b.ts", DISCARD],
  ["git checkout --  spaced.ts", DISCARD],
  ["git restore --staged --worktree a.ts", DISCARD],
  ["git restore --source=HEAD dirty.ts", DISCARD],
  ["git checkout .", DISCARD],
  ["git checkout a.tsx", DISCARD],
  ["git checkout main a.tsx", DISCARD],
  ["git checkout HEAD -- dirty.ts", DISCARD],
  ["git checkout -f main", DISCARD],
  ["git reset --hard", DISCARD],
  ["git reset --hard origin/main", DISCARD],
  ["git clean -fd", DISCARD],
  ["git clean --force", DISCARD],
  ["git switch --discard-changes main", DISCARD],
  ["git stash drop", DISCARD],
  ["git stash clear", DISCARD],
  ["git worktree remove .worktrees/w589 --force", FORCE_DELETE],
  ["git worktree remove --force .worktrees/w589", FORCE_DELETE],
  ["git worktree remove -f .worktrees/w589", FORCE_DELETE],
  ["npm test; git worktree remove .worktrees/x --force", FORCE_DELETE],
  ["git commit -m @'\nmsg\n'@; git worktree remove .worktrees/x --force", FORCE_DELETE],
  ["bash <<'EOF'\ngit worktree remove --force .worktrees/x\nEOF", FORCE_DELETE],
  ["rm -rf .worktrees/agent-7", FORCE_DELETE],
  ["rm -r --force ./.worktrees", FORCE_DELETE],
  ["Remove-Item -Recurse -Force .worktrees\\agent-7", FORCE_DELETE],
  ["ri -r C:\\repo\\.worktrees\\agent-7", FORCE_DELETE],
  ["cmd /c rmdir /s /q .worktrees\\agent-7", FORCE_DELETE],
  ["git push origin HEAD:main", /pull request/],
  ["git push origin main", /pull request/],
  ["git push -f origin +agent/1-x:refs/heads/main", /pull request/],
  ["git push origin --delete main", /pull request/],
  ["gh workflow run ios.yml --ref agent/353-ios-offline-game", DEVICE],
  ["gh workflow run maestro.yml", DEVICE],
  ['gh workflow run "iOS UI (Maestro)"', DEVICE],
  ["gh workflow run IOS.YML", DEVICE],
  ["gh workflow run 123456", DEVICE],
  ["gh api -X POST repos/o/r/actions/workflows/ios.yml/dispatches -f ref=main", DEVICE],
  ["gh api -X POST repos/o/r/Actions/Workflows/Maestro.yml/Dispatches", DEVICE],
  ["echo MAESTRO_EVIDENCE_READ=1; gh workflow run ios.yml", DEVICE],
  ["gh workflow run ios.yml # MAESTRO_EVIDENCE_READ=1", DEVICE],
  ["gh run rerun 33428375221 --failed", DEVICE],
  ["gh -R o/r run rerun 33428375221", DEVICE],
  ["gh api -X POST repos/o/r/actions/runs/33428375221/rerun", DEVICE],
  ["gh api -X POST repos/o/r/actions/jobs/99710945601/rerun", DEVICE],
  ["gh api -X POST repos/o/r/actions/runs/$RUN/rerun-failed-jobs", UNREADABLE],
  ["gh pr merge 994 --merge --delete-branch", MERGE],
  ["gh -R metasito/murlan pr merge 994 --merge", MERGE],
  ["gh --repo o/r pr merge 5", MERGE],
  ["gh --repo=o/r pr merge 5", MERGE],
  ["gh --hostname github.com pr merge 5", MERGE],
  ["GH_REPO=o/r gh pr merge 5", MERGE],
  ["git push && gh pr merge 994 --merge", MERGE],
  ["gh api graphql -f query='mutation{mergePullRequest(input:{pullRequestId:\"x\"}){clientMutationId}}'", MERGE],
  ["gh api --method PUT repos/metasito/murlan/pulls/994/merge -f merge_method=merge", MERGE],
];

const PREFIXES: [string, (cmd: string) => string | null][] = [
  ["as written", (cmd) => cmd],
  ["git -C", (cmd) => (cmd.startsWith("git ") ? cmd.replace(/^git /, "git -C d ") : null)],
  ["gh --repo", (cmd) => (cmd.startsWith("gh ") ? cmd.replace(/^gh /, "gh --repo o/r ") : null)],
  ["an assignment", (cmd) => `X=1 ${cmd}`],
  ["do", (cmd) => `do ${cmd}`],
  ["a subshell", (cmd) => `(${cmd})`],
  ["bash -c", (cmd) => (cmd.includes("'") ? null : `bash -c '${cmd}'`)],
];

describe("the bash guard blocks what has a correct alternative, however it is spelled", () => {
  for (const [cmd, why] of BLOCKED) {
    for (const [prefix, spell] of PREFIXES) {
      const spelled = spell(cmd);
      if (spelled === null) continue;
      test(`blocks (${prefix}): ${JSON.stringify(spelled)}`, () => {
        assert.match(String(guard(spelled)), why);
      });
    }
  }

  test("a push with no refspec, or HEAD, is blocked from main", () => {
    const onMain = { ...repo, branch: () => "main", pushTarget: () => null };
    for (const cmd of ["git push", "git push origin", "git push origin HEAD", "git -C d push -f origin @"]) {
      assert.match(String(check(cmd, device, onMain)), /pull request/, cmd);
    }
    assert.match(String(check("git push", device, { ...repo, pushTarget: () => "origin/main" })), /pull request/);
  });

  test("a sourced checkout is blocked when git cannot answer", () => {
    assert.ok(check("git checkout HEAD -- a.ts", device, { ...repo, isRef: () => true, pathsClean: () => false }));
  });
});

// The floor. A guard that blocks everything passes every assertion above and makes the repo
// unusable, so the allowed cases are pinned as hard as the blocked ones.
describe("the bash guard allows correct usage", () => {
  for (const cmd of [
    "git add -- scripts/x.mjs tests/x.test.ts",
    "git add scripts/",
    "git add -p",
    "git add -- .",
    "git -C .worktrees/agent-7 add -- a.ts",
    "git status --short",
    "git commit -q -m 'x'",
    "find components -iname '*rail*'",
    "find . -maxdepth 2 -name package.json",
    "npm test",
    "gh pr create --title x",
    "git checkout HEAD -- components/MenuLayout.tsx",
    "git restore --source=HEAD~1 a.ts",
    "git restore --staged a.ts",
    "git checkout -b agent/589-x origin/main",
    "git checkout main",
    "git checkout --track origin/x",
    "git checkout -",
    "git switch agent/1-x",
    "git reset --soft HEAD~1",
    "git clean -nd",
    "git stash list",
    "git worktree remove .worktrees/w589",
    "git worktree list",
    "git worktree prune",
    "npm run worktrees:remove -- .worktrees/agent-7",
    "ls .worktrees/agent-7",
    "rm -f .worktrees/agent-7/tmp.txt",
    "rm -rf /tmp/scratch",
    "git push -u origin agent/1071-x",
    "git push origin main:agent/1-x",
    "git push",
    "git push origin HEAD",
    "git commit -m @'\nBlocked now:\n\n  git checkout -- <path>\n  git worktree remove --force\n'@",
    "gh pr create --body @\"\nRun `git restore x` and it reverts.\n\"@",
    "cat <<'EOF' > note.md\ngit checkout -- a.ts is what broke it\nEOF",
    "git commit -F - <<'EOF'\nsay why gh pr merge is the loop's job\nEOF",
    "gh pr create --body-file - <<'EOF'\ngit add -A and rm -rf .worktrees/x\nEOF",
    "grep -n 'git add -A' docs/agents/RULES.md",
    "grep -rn \"gh pr merge\\|git push origin main\" tools",
    "gh issue comment 5 --body 'never run git checkout -- on that file'",
    "node -e \"const p=/git add -A/; console.log(p)\"",
    "gh issue comment 5 --body 'do not use git add -A here; or rm -rf .worktrees'",
    "echo 'find / is slow' > note.txt",
    "git add -- a.ts 2>&1 | tail -3",
    "MAESTRO_EVIDENCE_READ=1 gh workflow run ios.yml --ref agent/353-x",
    "MAESTRO_EVIDENCE_READ=1 gh run rerun 33428375221 --failed",
    "MAESTRO_EVIDENCE_READ=1 gh api -X POST repos/o/r/actions/workflows/ios.yml/dispatches",
    "gh run download 33428373840 -n maestro-debug-ios -D /tmp/art",
    "gh run view 33428373840 --json jobs",
    "gh workflow run ci.yml --ref main",
    "gh workflow run ci.yml --ref agent/353-ios-offline-game",
    "gh workflow view ios.yml",
    "gh api repos/o/r/actions/workflows/ios.yml/runs",
    "gh pr view 994 --json state,mergeStateStatus",
    "gh pr create --base main --head agent/1-x --title t --body-file b.md",
  ]) {
    test(`allows: ${JSON.stringify(cmd)}`, () => {
      assert.equal(guard(cmd), null, `expected ${cmd} to be allowed`);
    });
  }
});

describe("a rerun is gated on the workflow it would re-dispatch, not on being a rerun", () => {
  // `gh run rerun <id>` names a run, not a workflow, so the command alone cannot say whether
  // it costs 25 minutes on a simulator or four on a browser shard. Asking is the only way to
  // know, and a guard that blocks the honest path teaches people to route around the marker.
  const asWorkflow = (name: string | null) => () => name;

  test("blocks a rerun of a device run", () => {
    const message = check("gh run rerun 33428375221 --failed", asWorkflow("iOS UI (Maestro)"));
    assert.ok(message, "expected a rerun of a Maestro run to be blocked");
    assert.match(String(message), /MAESTRO_EVIDENCE_READ=1/);
  });

  test("blocks a rerun of the Android device run", () => {
    assert.ok(check("gh run rerun 33428375221", asWorkflow("Android UI (Maestro)")));
  });

  test("allows a rerun of a run with no pixels to read", () => {
    assert.equal(check("gh run rerun 33495876524 --failed", asWorkflow("CI")), null);
  });

  test("allows a rerun the marker acknowledges", () => {
    assert.equal(
      check("MAESTRO_EVIDENCE_READ=1 gh run rerun 33428375221", asWorkflow("iOS UI (Maestro)")),
      null
    );
  });

  test("allows a rerun whose workflow cannot be resolved", () => {
    // Resolution goes through `gh`. If that cannot answer, the rerun it guards cannot dispatch
    // anything either, so blocking here costs the honest path and protects nothing.
    assert.equal(check("gh run rerun 33428375221 --failed", asWorkflow(null)), null);
  });

  // Resolution costs a network round trip, so it may only be spent on a command whose verdict
  // it can still change.
  for (const [what, cmd] of [
    ["a command that reruns nothing", "gh run view 33428373840 --json jobs"],
    ["a rerun the marker already allows", "MAESTRO_EVIDENCE_READ=1 gh run rerun 33428375221"],
  ]) {
    test(`does not ask about ${what}`, () => {
      let asked = 0;
      check(cmd, () => {
        asked += 1;
        return "iOS UI (Maestro)";
      });
      assert.equal(asked, 0, `${cmd} spent a round trip it could not have acted on`);
    });
  }
});

describe("a rerun is read as its own command, with its own arguments", () => {
  // Each of these reached the guard as a way past it. A rerun that cannot be read is refused
  // rather than allowed: `$RUN` must not be the spelling that gets through.
  const device = () => "iOS UI (Maestro)";
  const ci = () => "CI";

  test("reads --job, which is not a run id", () => {
    // `gh run view <job-id>` answers 404, so a job id resolved as a run resolves to nothing —
    // and `--job` re-dispatches the whole ~25 minute simulator job.
    let asked: unknown = null;
    const message = check("gh run rerun --job 99710945601", (t) => {
      asked = t;
      return "iOS UI (Maestro)";
    });
    assert.ok(message, "expected a device job rerun to be blocked");
    assert.deepEqual(asked, { job: "99710945601" });
  });

  test("reads --job= in its joined spelling", () => {
    assert.ok(check("gh run rerun --job=99710945601", device));
  });

  test("looks at every rerun on the line, not only the first", () => {
    for (const separator of [" && ", "; ", "\n"]) {
      const cmd = `gh run rerun 33495876524${separator}gh run rerun 33428375221`;
      const message = check(cmd, (t) => (t.run === "33428375221" ? "iOS UI (Maestro)" : "CI"));
      assert.ok(message, `expected the device rerun after a ${JSON.stringify(separator)} to block`);
    }
  });

  test("does not take a flag's value for the run id", () => {
    let asked: unknown = null;
    check("gh run rerun -R metasito/murlan 33428375221", (t) => {
      asked = t;
      return "CI";
    });
    assert.deepEqual(asked, { run: "33428375221" }, "the repo was read as the run");
  });

  test("does not take a later command's id for this one's", () => {
    // The download named here is the very command the block message prescribes as the way out.
    let asked: unknown = null;
    const message = check(
      'gh run rerun "$RUN" --failed\ngh run download 33428375221 -n maestro-debug-ios',
      (t) => {
        asked = t;
        return "iOS UI (Maestro)";
      }
    );
    assert.equal(asked, null, "the download's id was read as the rerun's");
    assert.match(String(message), /literal id/);
  });

  for (const cmd of ['gh run rerun "$RUN" --failed', "gh run rerun --failed"]) {
    test(`refuses a rerun it cannot identify: ${cmd}`, () => {
      const message = check(cmd, ci);
      assert.ok(message, `expected ${cmd} to be blocked`);
      assert.match(String(message), /literal id/);
    });
  }

  test("the marker still clears a rerun it cannot identify", () => {
    assert.equal(check('MAESTRO_EVIDENCE_READ=1 gh run rerun "$RUN" --failed', ci), null);
  });
});

describe("a workflow lookup that fails is announced, not swallowed", () => {
  test("a throwing lookup still allows the dispatch, and names what could not be checked", () => {
    let calls = 0;
    let message: string | null = null;
    const stderr = captureStderr(() => {
      message = check("gh run rerun 33428375221 --failed", () => {
        calls += 1;
        throw new Error("connect ETIMEDOUT");
      });
    });
    assert.equal(message, null, "a lookup failure must still allow the dispatch");
    assert.equal(calls, 1);
    assert.match(stderr, /could not look up the rerun's workflow/);
    assert.match(stderr, /ETIMEDOUT/);
  });

  test("logs the failure once even when a line asks more than once", () => {
    let calls = 0;
    const stderr = captureStderr(() => {
      check("gh run rerun 111\ngh run rerun 222", () => {
        calls += 1;
        throw new Error("rate limited");
      });
    });
    assert.equal(calls, 2, "both reruns are still checked");
    assert.equal(
      stderr.split("\n").filter(Boolean).length,
      1,
      "the skipped check is named once, not once per rerun"
    );
  });
});

describe("the entrypoint fails open on a payload it cannot read", () => {
  for (const [what, stdin] of [
    ["text that is not JSON", "not json"],
    ["JSON of the wrong shape", "null"],
  ] as const) {
    test(`${what}: exits 0 and says what could not be checked`, () => {
      const result = spawnSync(process.execPath, [SCRIPT], { input: stdin, encoding: "utf8" });
      assert.equal(result.status, 0, "an unreadable payload must never block a tool call");
      assert.match(
        result.stderr,
        /guard-bash: could not read the tool call on stdin/,
        "a silent allow is the part that makes this self-defeating"
      );
    });
  }
});

describe("the hooks settings.json registers", () => {
  type Hook = { command: string; args?: string[] };
  type Entry = { matcher: string; hooks: Hook[] };
  const settings = JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));
  const entries = (event: string) => settings.hooks[event] as Entry[];
  const allHooks = () => Object.values(settings.hooks as Record<string, Entry[]>).flat().flatMap((e) => e.hooks);
  const text = (h: Hook) => [h.command, ...(h.args ?? [])].join(" ");
  const matched = (event: string, script: string) =>
    entries(event)
      .filter((e) => e.hooks.some((h) => text(h).includes(script)))
      .flatMap((e) => e.matcher.split("|"));
  const hookOf = (script: string) => allHooks().find((h) => text(h).includes(script))!;
  // Exec form, as Claude Code runs it: the placeholder is substituted as a plain string and no shell sees the command.
  const project = (arg: string) => arg.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT);
  const CWDS = [ROOT, join(ROOT, "tools", "loop")];
  const runAsWritten = (cwd: string, hook: Hook, payload: unknown, env: NodeJS.ProcessEnv = process.env) =>
    spawnSync(hook.command, (hook.args ?? []).map(project), { cwd, env, input: JSON.stringify(payload), encoding: "utf8" });

  test("every hook is exec form rooted at the project, so no shell and no cwd decides what runs", () => {
    assert.ok(allHooks().length >= 4, "no hook commands found; the shape of settings.json has changed");
    for (const hook of allHooks()) {
      assert.equal(hook.command, "node", text(hook));
      assert.ok(hook.args?.[0]?.startsWith("${CLAUDE_PROJECT_DIR}/"), `${text(hook)} resolves against the cwd`);
    }
  });

  test("a relative script path is what the subdirectory run catches", () => {
    const relative = { command: "node", args: ["tools/loop/guard-bash.mjs"] };
    const fromSubdir = runAsWritten(CWDS[1], relative, { cwd: ROOT, tool_input: { command: "git add -A" } });
    assert.notEqual(fromSubdir.status, 2, "the planted relative hook must not block from a subdirectory");
  });

  test("cover every tool and every session start they guard", () => {
    for (const tool of ["Bash", "PowerShell"]) assert.ok(matched("PreToolUse", "guard-bash.mjs").includes(tool), tool);
    for (const tool of ["Write", "Edit"]) assert.ok(matched("PreToolUse", "guard-comments.mjs").includes(tool), tool);
    for (const source of ["startup", "resume", "compact", "clear"]) {
      assert.ok(matched("SessionStart", "loop-status.mjs").includes(source), source);
    }
    for (const tool of ["Agent", "Task"]) assert.ok(matched("PreToolUse", "guard-agent-model.mjs").includes(tool), tool);
    assert.deepEqual(matched("PostToolUse", "guard-context.mjs"), [""], "context grows on every tool call");
  });

  for (const cwd of CWDS) {
    test(`run as written from ${cwd === ROOT ? "the root" : "tools/loop"}, each blocks what it guards`, () => {
      const bash = runAsWritten(cwd, hookOf("guard-bash.mjs"), { cwd: ROOT, tool_input: { command: "git add -A" } });
      assert.equal(bash.status, 2, bash.stderr);
      assert.match(bash.stderr, ADD);

      const comments = runAsWritten(cwd, hookOf("guard-comments.mjs"), {
        tool_name: "Write",
        tool_input: { file_path: join(ROOT, "src", "never-written.ts"), content: "// previously this returned null\nconst x = 1;\n" },
      });
      assert.match(comments.stdout, /"permissionDecision":\s*"deny"/, comments.stderr);

      const agent = runAsWritten(
        cwd,
        hookOf("guard-agent-model.mjs"),
        { tool_name: "Agent", tool_input: { prompt: "x" } },
        { ...process.env, LOOP_TURNS: "120" },
      );
      assert.match(agent.stdout, /"permissionDecision":\s*"deny"/, agent.stderr);
    });

    test(`run as written from ${cwd === ROOT ? "the root" : "tools/loop"}, every hook exists and allows an empty payload`, () => {
      for (const hook of allHooks()) {
        assert.ok(existsSync(project(hook.args![0])), text(hook));
        const result = runAsWritten(cwd, hook, {});
        assert.equal(result.status, 0, `${text(hook)} did not allow an empty payload: ${result.stderr.split("\n")[0]}`);
      }
    });
  }
});

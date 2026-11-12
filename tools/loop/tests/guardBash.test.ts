// tools/loop/tests/guardBash.test.ts
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check, gitAt, implementRoute } from "../guard-bash.mjs";
import { readIssue, TRUSTED_SELECT } from "../tracker.mjs";

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

/** Runs a function with the given environment keys set (undefined deletes one), then restores them. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const put = (from: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(from)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  put(vars);
  try {
    return fn();
  } finally {
    put(saved);
  }
}

const REFS = new Set(["main", "HEAD", "origin/main", "HEAD~1"]);
const repo = {
  isRef: (arg: string) => REFS.has(arg),
  pathsClean: (paths: string[]) => !paths.some((p) => p.includes("dirty")),
  unmerged: (paths: string[]) => paths.length > 0 && paths.every((p) => p.includes("conflicted")),
  top: (dir?: string | null): string | null => resolve("/r", dir?.startsWith(".worktrees") ? dir : "."),
  cwd: (dir?: string | null): string => resolve("/r", dir ?? "."),
  onTicket: () => false,
  read: (): string => {
    throw Object.assign(new Error("no such file"), { code: "ENOENT" });
  },
};
const guard = (cmd: string) => check(cmd, repo);

const ADD = /pathspec/;
const DISCARD = /Edit tool/;
const FORCE_DELETE = /before 2\.54\.0[\s\S]*worktrees:remove/;
const MERGE = /not yours to merge/;
const PIPED = /Piping a Playwright run/;

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
  ["for v in a; do p=x/$v.png; git cat-file blob HEAD:$p > $p; done", DISCARD],
  ["git show HEAD:dirty.ts > dirty.ts", DISCARD],
  ["git checkout --theirs -- dirty.ts", DISCARD],
  ["git checkout --theirs -- .", DISCARD],
  ["git checkout --theirs -- conflicted.ts dirty.ts", DISCARD],
  ["git -C .worktrees/agent-5 show HEAD:dirty.ts > .worktrees/agent-5/dirty.ts", DISCARD],
  ["p=dirty.ts; git show HEAD:dirty.ts > $p", DISCARD],
  ["cd sub && git show HEAD:a.ts > a.ts", DISCARD],
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
  ["gh pr merge 994 --merge --delete-branch", MERGE],
  ["gh -R metasito/murlan pr merge 994 --merge", MERGE],
  ["gh --repo o/r pr merge 5", MERGE],
  ["gh --repo=o/r pr merge 5", MERGE],
  ["gh --hostname github.com pr merge 5", MERGE],
  ["GH_REPO=o/r gh pr merge 5", MERGE],
  ["git push && gh pr merge 994 --merge", MERGE],
  ["gh api graphql -f query='mutation{mergePullRequest(input:{pullRequestId:\"x\"}){clientMutationId}}'", MERGE],
  ["gh api --method PUT repos/metasito/murlan/pulls/994/merge -f merge_method=merge", MERGE],
  ["npx playwright test --config tests/e2e/playwright.config.ts a.spec.ts 2>&1 | tail -20", PIPED],
  ["npx playwright test | grep passed", PIPED],
  ["npx --yes playwright test a.spec.ts |& tee e2e.log", PIPED],
  ["node_modules/.bin/playwright.cmd test | tail", PIPED],
  ["npm run test:e2e -- a.spec.ts | Select-String passed", PIPED],
  ["npm --prefix d run -s perf:web | tail", PIPED],
  ["echo $(npx playwright test | tail -1)", PIPED],
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

  test("a sourced checkout is blocked when git cannot answer", () => {
    assert.ok(check("git checkout HEAD -- a.ts", { ...repo, isRef: () => true, pathsClean: () => false }));
  });
});

describe("a merge spelled through an escape, eval or a variable is still a merge", () => {
  for (const cmd of [
    "g\\h pr merge 1",
    "gh pr m\\erge 1",
    "e\\nv gh pr merge 1",
    "eval gh pr merge 1",
    'eval "gh pr merge 1"',
    "eval -- gh pr merge 1",
    "eval g\\\\h pr merge 1",
    "builtin eval 'gh pr merge 1'",
    "command eval gh pr merge 1",
    "eval eval gh pr merge 1",
    'bash -c "eval gh pr merge 1"',
    "a=gh; $a pr merge 1",
    "a=gh && ${a} pr merge 1",
    'a=gh; "$a" -R o/r pr merge 1',
    "a=g; ${a}h pr merge 1",
    "a=gh; $a pr merge 1; a=ls",
    "$GH pr merge 1",
    "$(echo gh) pr merge 1",
    "`echo gh` pr merge 1",
    "\"`echo gh`\" pr merge 1",
    "`which gh` pr merge 1",
    "gh pr `echo merge` 1",
    "eval '`echo gh` pr merge 1'",
    "for a in gh; do $a pr merge 1; done",
    "w=env; $w gh pr merge 1",
    "$WRAP gh pr merge 1",
    "$SHELL -c 'gh pr merge 1'",
    "v=merge; gh pr $v 1",
    "gh pr $VERB 1",
    "a=gh; bash -c '$a pr merge 1'",
    "eval '$a pr merge 1'",
    "c=\"gh pr merge 1\"; $c",
    "c=\"pr merge\"; gh $c 1",
    "eval \"$(cat)\" <<EOF\ngh pr merge 1\nEOF",
    "a=bash; $a -c -- 'gh pr merge 1'",
    "bash -c -- 'gh pr merge 1'",
    "bash -lc 'gh pr merge 1'",
    "echo 'gh pr merge 1' | $SHELL",
    "a=bash; echo 'gh pr merge 1' | $a",
    "$SHELL <<< 'gh pr merge 1'",
    "$PS -Command 'gh pr merge 1'",
    "$COMSPEC /c \"gh pr merge 1\"",
    "a=g; a+=h; $a pr merge 1",
    "a=ls; for a in gh; do $a pr merge 1; done",
    "a=ls; read a <<< gh; $a pr merge 1",
    "a=ls; printf -v a gh; $a pr merge 1",
    "v=x; bash -c 'v=merge; gh pr $v 1; v=x'",
    "a=ls; bash -c 'a=x; a=gh; $a pr merge 1'",
    "$'\\x67h' pr merge 1",
    "$'gh' pr merge 1",
    "gh pr $'\\x6derge' 1",
    "c=$'\\x67h pr merge 1'; $c",
    "c=\"g${e}h pr mer${e}ge 1\"; $c",
    "c=$(printf '\\x67h pr \\x6derge 1'); $c",
    "$(printf '\\x67h pr \\x6derge 1')",
    "gh $(printf 'pr \\x6derge') 1",
    "x=`echo gh`; $x pr merge 1",
    "find . -maxdepth 0 -exec gh pr merge 1 \\;",
    "c=gh,pr,merge,1; IFS=,; $c",
    "c=g?; $c pr merge 1",
    "gh p\\r merge 1",
    "eval \"echo 'gh pr merge 1'\"",
    "`echo gh` pr view 1",
    "git rebase -x 'gh pr merge 1' origin/main",
    "echo 'gh pr merge 1' | xargs -I{} sh -c '{}'",
    "gh api -X PUT repos/o/r/pulls/$N/merge",
    "gh api -X PUT repos/o/r/pulls/$N/$X",
    "{gh,} pr merge 1",
    "g[h] pr merge 1",
    "gh pr mer?e 1",
    "git -c alias.m='!gh pr merge' m",
    "/usr/bin/g? pr merge 1",
    "./g? pr merge 1",
    "/usr/bin/g[h] pr merge 1",
    "v=merge; eval 'gh pr $v 1; v=view'",
    "gh api -X PUT repos/o/r/pulls/$N/$V",
    "gh api repos/o/r/pulls/$N/$V -f merge_method=squash",
    "git -c core.pager='gh pr merge 1' log -1",
    "git -c core.sshCommand='gh pr merge 1' fetch",
    "git -c diff.external='gh pr merge 1' diff",
    "git -c core.editor='gh pr merge 1' commit",
    "git -c sequence.editor='gh pr merge 1' rebase -i HEAD~1",
  ]) {
    test(`blocks: ${JSON.stringify(cmd)}`, () => {
      assert.match(String(guard(cmd)), MERGE);
    });
  }

  for (const cmd of [
    // origin/main already refuses these; kept as regressions, not as proof of the fail-closed logic.
    "echo 'gh pr merge 1' | bash",
    "echo 1 | xargs gh pr merge",
    "echo a\\b; bash <<EOF\ngh pr merge 1\nEOF",
    "echo `date`; bash <<EOF\ngh pr merge 1\nEOF",
  ]) {
    test(`blocks (regression, already refused on main): ${JSON.stringify(cmd)}`, () => {
      assert.match(String(guard(cmd)), MERGE);
    });
  }

  for (const cmd of [
    "git merge origin/main",
    "git fetch && git merge origin/main",
    "cat <<EOF > /tmp/x\nhello gh pr merge world\nEOF",
    "echo 'gh pr merge 12'",
    "echo gh pr merge 12",
    "npm ci && /usr/local/bin/node --test tests/tooling/targetFreeze.test.ts && echo ok",
    "eval echo hi",
    "a=gh; $a pr view 1",
    "$GH pr view 1",
    "$EDITOR notes.md",
    '"$(npm root)/.bin/jest" a.test.ts',
    "$NODE --test a.test.ts",
    "C:\\tools\\gh.exe pr view 1",
    "git -C C:\\repo\\murlan merge origin/main",
    "$PSVersionTable.PSVersion.Major",
    "echo `date` done",
    "`npm bin`/jest a.test.ts",
    "Write-Host a`nb",
    "echo `date`; bash <<EOF\nls\nEOF",
    "echo a\\\\b; cat <<EOF > /tmp/x\ngh pr merge 1\nEOF",
    "git merge $BRANCH",
    "\"$(npm root)/.bin/tsc\" --noEmit",
    "gh pr view $(git branch --show-current)",
    "gh pr create --title t --body \"$(cat <<'EOF'\nguard gh pr merge spellings\nEOF\n)\"",
    "git commit -m \"$(cat <<'EOF'\nguard: read gh pr merge through escapes\nEOF\n)\"",
    "for f in a.ts b.ts; do npx eslint $f; done",
    "bash <<EOF\nls\nEOF",
    "gh pr view 1 && git merge origin/main",
    "node --test $F && gh pr view $N --json mergeable",
    'npx jest $(git diff --name-only origin/main) && gh pr comment $N --body "tests pass, ready to merge"',
    'for f in $(git diff --name-only HEAD~1); do node --test "$f"; done; gh pr view 1 --json mergeStateStatus',
    "npm test -- $FILES && git merge origin/main && gh pr view 1",
    "npx jest $(git diff --name-only) # check the merge path through",
    "git -c core.pager=cat log",
    "gh api repos/o/r/pulls/5/reviews",
    "gh api -X POST repos/o/r/actions/runs/$RUN/rerun",
    "gh pr view $N --json mergeStateStatus",
    "gh api repos/{owner}/{repo}/pulls/$PR/comments",
    "gh api repos/{owner}/{repo}/pulls/$PR/reviews --jq '.[].state'",
    'gh api "repos/{owner}/{repo}/pulls/$N"',
    "gh api repos/metasito/murlan/pulls/$N/files --paginate",
    'gh api "repos/{owner}/{repo}/pulls?head=metasito:$BR"',
    "gh api repos/{owner}/{repo}/pulls/$PR/ccr/review_threads",
    "git -c user.name=x commit",
  ]) {
    test(`allows: ${JSON.stringify(cmd)}`, () => {
      assert.equal(guard(cmd), null);
    });
  }
});

describe("git add -A inside the ticket's own worktree", () => {
  const top = resolve(tmpdir(), ".worktrees", "agent-7");
  const inTree = (cwd: string, t: string | null = top) => ({ ...repo, top: () => t, cwd: (d?: string) => resolve(cwd, d ?? ".") });
  const at = (cmd: string, cwd = top, t: string | null = top) => check(cmd, inTree(cwd, t));

  test("is allowed on pathspecs below its root", () => {
    for (const cmd of ["git add -A components tests", "git add -A -- scripts app", "git add -u tools", "git add ."]) {
      assert.equal(at(cmd, cmd === "git add ." ? join(top, "components") : top), null, cmd);
    }
  });

  test("is refused bare, on the root itself, escaping it, or after a cd", () => {
    for (const cmd of ["git add -A", "git add -A -- .", "git add -A ../../components", "git add -A :/", "cd .. && git add -A components"]) {
      assert.match(String(at(cmd)), ADD, cmd);
    }
  });

  test("is refused in a checkout that is not a loop worktree", () => {
    assert.match(String(at("git add -A components", tmpdir(), tmpdir())), ADD);
    assert.match(String(at("git add -A components", top, null)), ADD);
  });

  test("leaves the discard guard where it was", () => {
    const dirty = { ...inTree(top), pathsClean: () => false };
    assert.match(String(check("git add -A components; git checkout -- f", dirty)), DISCARD);
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
    "git show HEAD:a.ts > /tmp/a.ts",
    'D=/tmp/x && git show HEAD:package.json > "$D/package.json"',
    "git show HEAD:clean.ts > clean.ts",
    "git checkout --theirs -- conflicted.ts",
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
    "npx playwright test --config tests/e2e/playwright.config.ts a.spec.ts --reporter=line",
    "npx playwright test a.spec.ts > e2e.log 2>&1; tail -5 e2e.log",
    "npm run test:e2e || echo red",
    "npx playwright show-report | cat",
    "npm run test:native | tail",
    "git commit -m 'npx playwright test | grep x'",
    "gh workflow run ios.yml --ref agent/1199-device-ci",
    "gh workflow run maestro.yml --ref=agent/1206-device-ci -f force-upload-debug=true",
    "gh -R o/r workflow run ios.yml -r agent/1211-ios-rotate",
    "gh workflow run ios.yml --ref agent/353-ios-offline-game",
    "gh workflow run ios.yml --ref claude/1259-p4-t2-opaque-felt",
    "gh workflow run ios.yml -r claude/1259-p4-t2-opaque-felt",
    "gh workflow run maestro.yml --ref=claude/1259-p4-t2-opaque-felt",
    "MAESTRO_EVIDENCE_READ=1 gh workflow run ios.yml --ref agent/353-x",
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

describe("a file that names a merge is not a script that runs one", () => {
  const QUOTES = 'assert.match(check("gh pr merge 5"), /not yours to merge/);\n';
  const READS = [
    "export const view = (p) => ({ state: p.merged_at ? 'MERGED' : p.state, mergeStateStatus: p.mergeable_state, autoMergeRequest: p.auto_merge });",
    "export const side = (git) => git('merge', 'side', '-m', 'merge_method=merge');",
    "export const update = (gh, pulls, n) => gh(['api', '-X', 'PUT', `${pulls}/${n}/update-branch`]);",
    "",
  ].join("\n");
  const EXEC = "require('child_process').execSync";
  const FILES: Record<string, string> = {
    "a.test.ts": QUOTES,
    "b.test.ts": QUOTES,
    "out.txt": "ok 1 - blocks gh pr merge 5\n",
    "helper.mjs": "export const ok = 1;\n",
    "m.js": "require('child_process').execSync('gh pr merge 5 --auto');\n",
    "m.sh": "gh pr merge 5 --auto\n",
    "m.ps1": "gh pr merge 5 --auto\n",
    "merges.md": "Never run gh pr merge 5, nor PUT pulls/5/merge: the loop merges.\n",
    "edit.mjs": "import { readFileSync, writeFileSync } from 'node:fs';\nconst [file] = process.argv.slice(2);\nwriteFileSync(file, readFileSync(file, 'utf8').replace('a', 'b'));\n",
    "edit.sh": "sed 's/a/b/' \"$1\"\n",
    "edit.ps1": "Get-Content $args[0]\n",
    "reads.mjs": READS,
    "decoy-string.mjs": `${READS}${EXEC}('gh pr merge 5 --merge');\n`,
    "decoy-repo.mjs": `${READS}${EXEC}('gh --repo o/r pr merge 5');\n`,
    "decoy-argv.mjs": `${READS}export const arm = (gh, n) => gh(["pr", "merge", String(n), "--auto"]);\n`,
    "decoy-rest.mjs": `${READS}export const land = (gh, pulls, n) => gh(["api", "-X", "PUT", \`\${pulls}/\${n}/merge\`]);\n`,
    "decoy-octokit.mjs": `${READS}octokit.rest.pulls.merge({ owner: "o", repo: "r", pull_number: 5 });\n`,
    "decoy-graphql.mjs": `${READS}${EXEC}("gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'");\n`,
    "decoy-regex.mjs": `const url = /https?:\\/\\//; ${EXEC}('gh pr merge 5');\n`,
    "decoy-sandwich.mjs": `const a = "/*"; ${EXEC}('gh pr merge 5'); const b = "*/";\n`,
    "decoy-template.mjs": `${EXEC}(\`//usr/bin/gh pr merge 5\`);\n`,
    "decoy-jsdoc.mjs": `/** see // here */ ${EXEC}('gh pr merge 5');\n`,
    "decoy.ts": `// gh pr merge stays the loop's\nconst n: number = 5;\n${EXEC}(\`gh pr merge \${n}\`);\n`,
    "decoy-division.mjs": `if (ok) /\\/\\//.test(url); ${EXEC}('gh pr merge 5');\n`,
    "decoy-default.mjs": `export default /[//]/; ${EXEC}('gh pr merge 5');\n`,
    "decoy-extends.mjs": `class A extends /[//]/.constructor {} ${EXEC}('gh pr merge 5');\n`,
    "decoy-of.mjs": `const of = 4; const r = of / 2, a = '/', b = '//'; ${EXEC}('gh pr merge 5');\n`,
    "decoy-yield.js": `var yield = 4, r = yield / 2, b = '/ //'; ${EXEC}('gh pr merge 5');\n`,
    "decoy-number.mjs": `const half = 1./2, s = 'a / http://x'; ${EXEC}('gh pr merge 5');\n`,
    "decoy-html.cjs": `<!-- \`\nconst s = \` // \`; ${EXEC}('gh pr merge 5');\n`,
    "decoy-lands.mjs": "import { ghMerges } from \"./tools/loop/merges.mjs\";\nghMerges().merge(5, 'abc');\n",
    "decoy-lands-dynamic.mjs": "const m = await import(`../loop/merges.mjs`);\nm.ghMerges().arm(5, 'abc');\n",
    "decoy-lands-cjs.cjs": "require(\"./merges.mjs\").ghMerges().disarm(5);\n",
  };
  const files = {
    ...repo,
    read: (file: string): string => {
      const text = FILES[file.replace(/^\.[\\/]/, "")];
      if (text === undefined) throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      return text;
    },
  };
  const at = (cmd: string) => check(cmd, files);

  for (const cmd of [
    "node --test a.test.ts",
    "node --test a.test.ts b.test.ts",
    "node --test a.test.ts b.test.ts > out.txt",
    "node --test a.test.ts b.test.ts > out.txt 2>&1",
    "node --test a.test.ts 2>&1 | tail -5",
    "node --test --test-reporter=spec a.test.ts b.test.ts",
    "node --import ./helper.mjs --test a.test.ts",
    "node --test a.test.ts b.test.ts && git commit -F - <<'EOF'\nsay why gh pr merge is the loop's job\nEOF",
    "node --test a.test.ts; git commit -m 'gh pr merge is the loop'\"'\"'s job'",
    "git commit -m 'gh pr merge is the loop'\"'\"'s job' && node --test a.test.ts",
    "bash ./helper.mjs > out.txt",
    "node reads.mjs read 5",
    "node reads.mjs create --title x --body-file merges.md --label noticed",
    "node edit.mjs merges.md",
    "node edit.mjs m.js",
    "node --title x edit.mjs merges.md",
    "node --import ./helper.mjs edit.mjs merges.md",
    "node edit.mjs < merges.md",
    "node -e \"require('fs').readFileSync(process.argv[1])\" merges.md",
    "node -p 1 merges.md",
    "bash edit.sh merges.md",
    "pwsh -File edit.ps1 merges.md",
    "bash --rcfile edit.sh -ic true",
    "BASH_ENV=edit.sh bash -c true",
    "npx tsx edit.mjs merges.md",
    "bun run edit.mjs merges.md",
    "deno run edit.mjs merges.md",
    "node -pe 1 merges.md",
    "export ENV=test; npm run test",
    "ENV=test npm run test",
    "bash -c 'ENV=out.txt; echo hi > out.txt'",
    "bash -c 'BASH_ENV=notes.txt; cat notes.txt'",
    "BASH_ENV=out.txt; bash -c true",
    "bash -c 'export BASH_ENV=m.sh'; bash -c true",
    "bash -c true; export BASH_ENV=m.sh",
    "npx tsx watch edit.mjs merges.md",
    "bunx tsx edit.mjs merges.md",
    "deno eval \"console.log(1)\" merges.md",
  ]) {
    test(`allows: ${JSON.stringify(cmd)}`, () => assert.equal(at(cmd), null));
  }

  for (const cmd of [
    "gh pr merge 5",
    "gh -R o/r pr merge 5",
    "X=1 gh pr merge 5",
    "bash -c 'gh pr merge 5'",
    "gh api -X PUT repos/o/r/pulls/5/merge",
    "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
    "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
    "pwsh -EncodedCommand ZwBoAA==",
    "bash -s <<'EOF'\ngh pr merge 5\nEOF",
    "node - <<'EOF'\nrequire('child_process').execSync('gh pr merge 5');\nEOF",
    "node m.js",
    "node m.js --test a.test.ts",
    "node --test --require ./m.js a.test.ts",
    "node --test --import=./m.js a.test.ts",
    "node --title x m.js --test",
    "node --unknown-flag m.js --test a.test.ts",
    "bash m.sh > out.txt",
    "bash < m.sh",
    "node --test a.test.ts && bash m.sh",
    "node --import='data:text/javascript,import cp from \"node:child_process\"; cp.execSync(\"gh pr merge 5\")' --test a.test.ts",
    `node --import='data:text/javascript;base64,${Buffer.from("import cp from 'node:child_process'; cp.execSync('gh pr merge 5')").toString("base64")}' x.js`,
    "node --import 'data:text/javascript,import%20cp%20from%20%22node:child_process%22;cp.execSync(%22gh%20pr%20merge%205%22)' --test a.test.ts",
    "node -r 'data:text/javascript,require(\"child_process\").execSync(\"gh pr merge 5\")' --test a.test.ts",
    "node -e \"require('child_process').execSync('gh pr merge 5')\"",
    "node -r./m.js --test a.test.ts",
    "node --test -r./m.js a.test.ts",
    "NODE_OPTIONS='--require ./m.js' node --test a.test.ts",
    "NODE_OPTIONS=--import=./m.js node x.js",
    "env NODE_OPTIONS='-r./m.js' node --test a.test.ts",
    "export NODE_OPTIONS='--require ./m.js'; node --test a.test.ts",
    "npx node --test --require ./m.js a.test.ts",
    "npx --yes node --test --require ./m.js a.test.ts",
    "npx -y node m.js",
    "bash {fd}< m.sh",
    "bash 0< m.sh",
    "cat m.sh | bash",
    "source m.sh",
    "pwsh -File m.ps1",
    "pwsh m.ps1 merges.md",
    "node m.js merges.md",
    "node -e \"require('child_process').execSync('gh pr merge 5') // a test\" merges.md",
    "bash --rcfile m.sh -ic true",
    "bash -i --rcfile m.sh -c true",
    "bash --init-file=m.sh -i",
    "BASH_ENV=m.sh bash -c true",
    "ENV=m.sh sh -c true",
    "export BASH_ENV=m.sh; bash -c true",
    "bash -c 'export BASH_ENV=m.sh; bash -c true'",
    "export ENV=m.sh && sh -c true",
    "npx tsx watch m.js",
    "bunx tsx m.js",
    "deno eval \"require('child_process').execSync('gh pr merge 5')\"",
    "deno eval --ext=js \"require('child_process').execSync('gh pr merge 5')\"",
    "node -e \"import(process.cwd() + '/tools/loop/settle.mjs').then((s) => s.settle())\"",
    "node -p \"require(process.cwd() + '/tools/loop/settle.mjs')\"",
    "npx tsx m.js",
    "tsx m.js",
    "bun m.js",
    "bun run m.js",
    "deno run m.js",
    "deno run --allow-run m.js",
    "node -pe \"require('child_process').execSync('gh pr merge 5')\"",
    "node -ep \"require('child_process').execSync('gh pr merge 5')\"",
    "bun -e \"require('child_process').execSync('gh pr merge 5')\"",
    "node -e \"import(process.cwd() + '/tools/loop/merges.mjs').then((m) => m.ghMerges().merge(5, 'abc'))\"",
    "node -p \"require(process.cwd() + '/tools/loop/merges.mjs')\"",
    ...Object.keys(FILES).filter((f) => f.startsWith("decoy")).map((f) => `node ${f} read 5`),
  ]) {
    test(`refuses: ${JSON.stringify(cmd)}`, () => assert.match(String(at(cmd)), MERGE));
  }
});

describe("the tracker's recipes run, and the supervisor's merges do not", () => {
  const real = gitAt(ROOT);
  const DOCS = [".claude/commands/queue.md", "docs/agents/issue-tracker.md", "docs/agents/writing-tickets.md", "docs/agents/RULES.md", ".claude/commands/audit.md"];
  const recipes = [...new Set(DOCS.flatMap((d) => [...readFileSync(join(ROOT, d), "utf8").matchAll(/node tools\/loop\/tracker\.mjs [^`\n]*/g)].map((m) => m[0].trim())))];
  const reading = { implementing: () => false };

  test("the docs still give the recipes", () => assert.ok(recipes.length >= 8, recipes.join("\n")));
  for (const cmd of recipes) {
    test(`allows, read from the real file, in the loop and outside it: ${cmd}`, () => {
      assert.equal(check(cmd, real, false, reading), null);
      assert.equal(check(cmd, real, true, reading), null);
    });
  }

  test("the module that arms and merges is refused when a session imports it", () => {
    for (const cmd of [
      "node -e \"import(process.cwd() + '/tools/loop/merges.mjs').then((m) => m.ghMerges().merge(5, 'abc'))\"",
      "node --input-type=module -e \"import { ghMerges } from 'file:///repo/tools/loop/merges.mjs'; ghMerges().arm(5, 'abc')\"",
    ]) {
      assert.match(String(check(cmd, real, false, reading)), MERGE, cmd);
      assert.match(String(check(cmd, real, true, reading)), MERGE, cmd);
    }
  });

  // A comment is judged as code, so a script a doc tells a session to run must not spell a merge even there.
  const RUN = [".claude/commands/queue.md", ".claude/commands/audit.md", "docs/agents/issue-tracker.md", "docs/agents/RULES.md", "docs/agents/checks.md", "docs/agents/suites.md", "docs/agents/traps.md", "docs/agents/device-runs.md", "docs/agents/loop-harness.md", "docs/agents/target-freeze.md", "docs/agents/writing-tickets.md", "CLAUDE.md"];
  const scripts = [...new Set(RUN.flatMap((d) => [...readFileSync(join(ROOT, d), "utf8").matchAll(/\bnode ((?:tools|scripts)\/[\w./-]+\.(?:mjs|js|ts))/g)].map((m) => m[1])))];
  test("the docs still name the scripts a session runs", () => assert.ok(scripts.includes("tools/loop/tracker.mjs") && scripts.length >= 8, scripts.join(" ")));
  for (const script of scripts) {
    test(`a script a doc runs spells no merge, comments included: ${script}`, () => {
      assert.ok(existsSync(join(ROOT, script)), script);
      assert.equal(check(`node ${script}`, real, false, reading), null);
    });
  }

  test("a script of many flags, or a long path, is judged at once", () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-long-"));
    try {
      writeFileSync(join(dir, "long.mjs"), `console.log("gh ${"--paginate ".repeat(200)}x", "pulls${"/pulls".repeat(20000)}");\n`);
      const start = Date.now();
      const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, input: JSON.stringify({ tool_name: "Bash", cwd: dir, tool_input: { command: "node long.mjs" } }), encoding: "utf8", timeout: 10_000 });
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.ok(Date.now() - start < 3000, `${Date.now() - start} ms`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the hook, fed the payload Claude Code sends, allows a tracker read and refuses a merge", () => {
    const hook = (command: string) => spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, input: JSON.stringify({ tool_name: "Bash", cwd: ROOT, tool_input: { command } }), encoding: "utf8" });
    for (const cmd of ["node tools/loop/tracker.mjs read 1651", "node tools/loop/tracker.mjs create --title x --body-file b.md --label noticed"]) {
      const result = hook(cmd);
      assert.equal(result.status, 0, `${cmd}: ${result.stderr}`);
    }
    const merge = hook("gh pr merge 5");
    assert.equal(merge.status, 2);
    assert.match(merge.stderr, MERGE);
  });

  test("with no package installed, as the Windows harness runs it, the hook still judges a script", () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-no-packages-"));
    try {
      writeFileSync(
        join(dir, "no-packages.mjs"),
        'import { registerHooks } from "node:module";\n' +
          "registerHooks({ resolve: (specifier, context, next) => {\n" +
          '  if (!/^(node:|\\.|\\/|file:|[A-Za-z]:)/.test(specifier)) throw new Error(`no package installed: ${specifier}`);\n' +
          "  return next(specifier, context);\n" +
          "} });\n",
      );
      writeFileSync(join(dir, "reads.mjs"), "export const view = (p) => ({ state: p.merged_at ? 'MERGED' : p.state, mergeStateStatus: p.mergeable_state });\n");
      writeFileSync(join(dir, "m.mjs"), "// harmless\nrequire('child_process').execSync('gh pr merge 5');\n");
      const hook = (command: string) =>
        spawnSync(process.execPath, ["--import", pathToFileURL(join(dir, "no-packages.mjs")).href, SCRIPT], {
          cwd: dir,
          input: JSON.stringify({ tool_name: "Bash", cwd: dir, tool_input: { command } }),
          encoding: "utf8",
        });
      const reads = hook("node reads.mjs read 5");
      assert.equal(reads.status, 0, reads.stderr);
      const m = hook("node m.mjs");
      assert.equal(m.status, 2, m.stderr);
      assert.match(m.stderr, MERGE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a device run's dispatch is the workflow's own to refuse", () => {
  // ios.yml and maestro.yml run a job only on attempt 1 of a schedule or a ticket branch
  // (tests/tooling/deviceWorkflowsGate.test.ts): no gh outage opens that, as it opened this guard.
  for (const cmd of [
    "gh workflow run maestro.yml",
    "gh workflow run 123456",
    "gh workflow run ios.yml --ref main",
    "gh api -X POST repos/o/r/actions/workflows/ios.yml/dispatches -f ref=main",
  ]) {
    test(`allows, in the loop and outside it: ${cmd}`, () => {
      assert.equal(check(cmd, repo, false), null);
      assert.equal(check(cmd, repo, true), null);
    });
  }
});

describe("a loop session reruns no run: a red is fixed at its source", () => {
  const NO_RERUN = /^A red is never rerun \(rule 53\)\.$/;
  for (const cmd of [
    "gh run rerun 33428375221 --failed",
    "gh -R o/r run rerun 33428375221",
    "gh run rerun --job 99710945601",
    "gh run rerun --job=99710945601",
    'gh run rerun "$RUN" --failed',
    "gh run rerun --failed",
    'MAESTRO_EVIDENCE_READ=1 gh run rerun "$RUN" --failed',
    "gh run view 33428373840 --json jobs && gh run rerun 33428375221",
    "gh run view 33428373840 --json jobs; gh run rerun 33428375221",
    "gh run view 33428373840 --json jobs\ngh run rerun 33428375221",
    "gh api -X POST repos/o/r/actions/runs/38188271467/rerun-failed-jobs",
    "gh api -X POST repos/o/r/actions/runs/$RUN/rerun",
    "gh api -X POST repos/o/r/actions/jobs/99710945601/rerun",
    "curl -X POST https://api.github.com/repos/o/r/actions/runs/1/rerun",
  ]) {
    test(`refuses in the loop, and allows outside it: ${cmd}`, () => {
      assert.match(String(check(cmd, repo, true)), NO_RERUN);
      assert.equal(check(cmd, repo, false), null);
    });
  }

  test("a command that reruns nothing is not a rerun", () => {
    assert.equal(check("gh run view 33428373840 --json jobs", repo, true), null);
  });
});

describe("a loop session pushes only its own ticket's branch", () => {
  const asTicket = (ticket: string | undefined, cmd: string) => withEnv({ LOOP_TICKET: ticket }, () => check(cmd, repo, true));
  const inLoop = (cmd: string) => asTicket("1529", cmd);
  const OWN_ONLY = /agent\/1529-<slug>/;

  for (const ok of [
    "git push origin HEAD:agent/1529-guard",
    "git push -u origin HEAD:agent/1529-guard",
    "git push -u origin agent/1529-x:agent/1529-x",
    "git push --force-with-lease origin +HEAD:agent/1529-x",
    "git -C .worktrees/agent-1529 push origin HEAD:refs/heads/agent/1529-x",
    "git push -o ci.skip origin HEAD:agent/1529-x",
    "git push origin --delete agent/1529-x",
    "git push -d origin agent/1529-x",
    "git push origin --delete refs/heads/agent/1529-x",
    "git push origin :agent/1529-x",
  ]) test(`allows: ${ok}`, () => assert.equal(inLoop(ok), null));

  for (const no of [
    "git push",
    "git push origin",
    "git push origin HEAD",
    "git push -u origin agent/1529-x",
    "git push origin HEAD:agent/1438-other",
    "git push origin HEAD:agent/15290-other",
    "git push origin HEAD:agent/1529-x HEAD:agent/1438-y",
    "git push --all origin",
    "git push --mirror origin",
    "git push --tags origin",
    "git push origin :agent/1438-other",
    "git push origin --delete agent/1438-other",
    "git push origin --delete agent/1529-x agent/1438-y",
    "git push -d origin agent/15290-x",
    "git push --delete origin HEAD:agent/1529-x",
    "git push --delete origin",
    "cd .worktrees/agent-1529 && git push origin HEAD:agent/1438-x",
    "git push origin HEAD:main",
    "git push origin --delete main",
    "gh api -X PATCH repos/metasito/murlan/git/refs/heads/agent/1438-x -f sha=abc",
    "gh api repos/o/r/git/refs -f ref=refs/heads/agent/1438-x -f sha=abc",
  ]) test(`refuses: ${no}`, () => assert.match(String(inLoop(no)), OWN_ONLY));

  test("with no ticket to name, a loop session pushes nothing", () => {
    for (const ticket of [undefined, "", "abc"]) {
      const said = String(asTicket(ticket, "git push origin HEAD:agent/1529-x"));
      assert.match(said, /spawned without the ticket number/, String(ticket));
      assert.doesNotMatch(said, /agent\/undefined-/);
    }
  });

  test("an owner session is not bound by it", () => {
    for (const cmd of ["git push origin HEAD:agent/1438-x", "git push", "git push origin --delete side/x"]) {
      assert.equal(withEnv({ LOOP_TICKET: "1529" }, () => check(cmd, repo, false)), null, cmd);
    }
  });
});

describe("a loop session reads comments only through rule 25's filter", () => {
  for (const cmd of [
    "gh issue view 5 --comments",
    "gh pr view 5 -c",
    `gh issue view 5 --json comments --jq '.comments[]|select(.body|startswith("DOD-CHECK"))|.body'`,
    "gh issue view 5 --json=title,comments",
    "cd .worktrees/agent-5 && gh -R o/r pr view 5 --json body,comments",
    "gh api repos/metasito/murlan/issues/5/comments --jq '.[].body'",
    "gh api repos/{owner}/{repo}/pulls/5/reviews",
    "gh api -X GET repos/o/r/pulls/5/comments -f per_page=100",
    "gh api repos/o/r/issues/comments --paginate",
  ]) {
    test(`refuses in the loop: ${cmd}`, () => assert.match(String(check(cmd, repo, true)), /node tools\/loop\/tracker\.mjs read <n>/));
    test(`allows outside the loop: ${cmd}`, () => assert.equal(check(cmd, repo, false), null));
  }
  for (const cmd of [
    readIssue(5),
    `gh pr view 5 --json comments --jq '.comments[]|${TRUSTED_SELECT}|.body'`,
    "gh issue comment 5 --body 'read it with gh issue view 5 --comments'",
    "gh issue view 5 --json title,body",
    "gh pr view 5 --json state,mergeStateStatus",
    `gh api repos/o/r/issues/5/comments --jq '.[]|${TRUSTED_SELECT}|.body'`,
    "gh api repos/o/r/issues/5/comments -f body=x",
    "gh api -X POST repos/o/r/pulls/5/reviews --input r.json",
    "gh api repos/o/r/issues/5 --jq .state",
  ]) {
    test(`allows in the loop: ${cmd}`, () => assert.equal(check(cmd, repo, true), null));
  }
});

describe("a redirect target through a variable", () => {
  const show = "git show HEAD:dirty.ts > $P";
  test("only an assignment in command position is read, never one inside another command's quoted data", () => {
    for (const cmd of [`git commit -m "P=dirty.ts x"; ${show}`, `echo 'P=dirty.ts'; ${show}`, `bash -c 'P=dirty.ts'; ${show}`, `P=dirty.ts bash -c 'echo'; ${show}`]) {
      assert.equal(guard(cmd), null, cmd);
    }
    for (const cmd of [`P=dirty.ts; ${show}`, `P=dirty.ts && ${show}`, `bash -c 'P=dirty.ts; ${show}'`, `P=dirty.ts bash -c '${show}'`]) {
      assert.match(String(guard(cmd)), DISCARD, cmd);
    }
  });
});

describe("an MSYS drive path is the Windows path it names", () => {
  test("a redirect to one restoring a dirty tracked file is refused", { skip: process.platform !== "win32" }, () => {
    const msys = `/${resolve("/r")[0].toLowerCase()}/r/dirty.ts`;
    assert.match(String(guard(`git show HEAD:dirty.ts > ${msys}`)), DISCARD);
    assert.equal(guard(`git show HEAD:dirty.ts > /${resolve("/r")[0].toLowerCase()}/elsewhere/dirty.ts`), null);
  });
});

describe("loop sessions only", () => {
  for (const cmd of ["sed -i 's/a/b/' tools/loop/guard-bash.mjs", "perl -pi -e 's/a/b/' x.ts"]) {
    test(`refuses in the loop: ${cmd}`, () => assert.notEqual(check(cmd, repo, true), null));
    test(`allows outside the loop: ${cmd}`, () => assert.equal(check(cmd, repo, false), null));
  }
  test("a worktree added anywhere is git's own business, in the loop as outside it", () => {
    for (const cmd of ["git worktree add -B agent/12-x .worktrees/agent-12 origin/agent/12-x", "git worktree add -b side/x ../murlan-side-1 origin/main", "git worktree add ../x"]) {
      assert.equal(check(cmd, repo, true), null, cmd);
    }
  });
  test("gh run watch is refused in the loop and names the helper", () => {
    assert.match(String(check("gh run watch 123 --exit-status", repo, true)), /await-run\.mjs/);
    assert.equal(check("gh run watch 123", repo, false), null);
    assert.equal(check("gh run view 123 --json status", repo, true), null);
  });
  test("a sleep loop polling a run, or gh pr checks --watch, is refused in the loop and nowhere else", () => {
    for (const cmd of [
      `for i in $(seq 1 48); do s=$(for r in 1 2; do gh run view $r --json status --jq .status; done | sort -u); [ "$s" = completed ] && break; sleep 30; done`,
      `until [ "$(gh run view 1 --json status -q .status)" = completed ]; do sleep 30; done`,
      `while ($true) { gh pr checks 12; Start-Sleep 30 }`,
      "gh pr checks 12 --watch",
      `bash -c 'while true; do gh run view 1; sleep 30; done'`,
      `bash <<< 'while true; do gh run view 1; sleep 30; done'`,
      `iex 'while ($true) { gh run view 1; Start-Sleep 30 }'`,
      "1..48 | % { gh run view 1; Start-Sleep 30 }",
      "do { gh run view 1; Start-Sleep 30 } while ($true)",
      `pwsh -Command "foreach ($i in 1..9) { gh run list --limit 1; Start-Sleep 30 }"`,
      "for i in {1..48}; do gh run view 1; sleep 30; done",
      "for i in {1..48}; do gh pr checks 12; sleep 30; done",
      "for i in {1..48}\ndo\n  gh run view 1\n  sleep 30\ndone",
      "for f in a{1,2}; do gh run view 1; sleep 30; done",
      "bash -c 'for i in {1..9}; do gh run view 1; sleep 30; done'",
    ]) {
      assert.match(String(check(cmd, repo, true)), /await-run\.mjs/, cmd);
      assert.equal(check(cmd, repo, false), null, cmd);
    }
    for (const cmd of [
      "gh workflow run ios.yml --ref agent/1-x && sleep 8 && gh run list --branch agent/1-x --limit 5",
      `for i in $(seq 1 40); do docker info >/dev/null 2>&1 && break; sleep 5; done`,
      "gh pr checks 12",
      'gh pr comment 1 --body "while CI runs"; sleep 5; gh run view 1',
      "gh pr view 12; for f in a b; do echo $f; done; sleep 1",
      "while true; do gh run view 1 && break; done; sleep 30",
      "for i in 1 2; do sleep 1; done; gh run view 1",
      "1..2 | % { Start-Sleep 1 }; gh pr checks 12",
      "bash -c 'for f in a; do echo $f; done; sleep 1; gh run view 1'",
    ]) assert.equal(check(cmd, repo, true), null, cmd);
  });
  test("a timeout in front of a command does not hide it", () => {
    assert.match(String(check("timeout 1480 gh run watch 123 > /dev/null", repo, true)), /await-run\.mjs/);
    assert.notEqual(check("timeout -k 5s --preserve-status 60 gh pr merge 12", repo, false), null);
    assert.equal(check("timeout 60 gh run view 123", repo, true), null);
    for (const opts of ["--signal KILL", "--kill-after 5", "--signal=KILL --kill-after=5"]) {
      assert.notEqual(check(`timeout ${opts} 60 gh pr merge 12`, repo, false), null, opts);
    }
  });
});

describe("a redirect under git -C is judged by the path git sees", () => {
  test("a dirty file named from the shell's cwd is found relative to -C's directory", () => {
    const seen: string[][] = [];
    const spy = { ...repo, pathsClean: (p: string[]) => (seen.push(p), !p.includes("dirty.ts")) };
    const cmd = "git -C .worktrees/agent-5 show HEAD:dirty.ts > .worktrees/agent-5/dirty.ts";
    assert.match(String(check(cmd, spy)), DISCARD);
    assert.deepEqual(seen, [["dirty.ts"]]);
  });
  test("a redirect after a cd is refused with the absolute-path way out", () => {
    assert.match(String(guard("cd sub && git show HEAD:a.ts > a.ts")), /absolute path/);
  });
});

describe("an implement session files no agent work", () => {
  // A worktree on a ticket branch stands in both: in the triage case it is a stale one.
  const stale = { ...repo, onTicket: () => true };
  const implementing = { implementing: () => true };
  const triaging = { implementing: () => false };
  const AGENT_WORK = /files no agent work/;
  const refused = [
    "gh issue create --title x --body-file b.md",
    "gh issue create -t x -F b.md --label bug,ready-for-agent",
    "gh issue create -t x --label ready-for-human --label ready-for-agent",
    "gh issue edit 5 --add-label main-red",
    "gh -R o/r issue edit 5 --add-label=ci-flake",
    "cd /c/Users/roton/murlan && gh issue create --title x --body-file b.md",
    "gh api repos/o/r/issues -f title=x -f body=y",
    "gh api -X POST repos/{owner}/{repo}/issues -f title=x -f 'labels[]=ready-for-agent' -f 'labels[]=ready-for-human'",
    "gh api repos/o/r/issues/5/labels -f 'labels[]=ready-for-agent'",
    "gh api -X PUT repos/o/r/issues/5/labels -f 'labels[]=main-red'",
    "gh api repos/o/r/issues --input new.json",
    "node tools/loop/tracker.mjs create --title x --body-file b.md",
    "node tools/loop/tracker.mjs create --title x --body-file b.md --label ready-for-human --label ready-for-agent",
    "node tools/loop/tracker.mjs label 5 --add main-red",
    "cd .worktrees/agent-5 && node ../../tools/loop/tracker.mjs label 5 --add ci-flake",
  ];
  for (const cmd of refused) {
    test(`refuses in an implement session: ${cmd}`, () => assert.match(String(check(cmd, stale, true, implementing)), AGENT_WORK));
    test(`allows in a triage or wayfinder session beside a stale worktree, or outside the loop: ${cmd}`, () => {
      assert.equal(check(cmd, stale, true, triaging), null);
      assert.equal(check(cmd, stale, false, implementing), null);
    });
  }
  for (const cmd of [
    "gh issue create --title x --body-file b.md --label ready-for-human",
    "gh issue create -t x -F b.md -l noticed",
    "gh issue create -t x -F b.md --label=bug,ready-for-human",
    "gh issue edit 5 --remove-label ready-for-agent --remove-label in-progress --add-label ready-for-human",
    "gh issue comment 5 --body 'gh issue create --label ready-for-agent'",
    "gh api repos/o/r/issues -f title=x -f 'labels[]=ready-for-human'",
    "gh api repos/o/r/issues/5/labels -f 'labels[]=ready-for-human'",
    "gh api repos/o/r/issues/5/comments -f body=x",
    "gh api repos/o/r/issues --jq '.[].number'",
    "node tools/loop/tracker.mjs create --title x --body-file b.md --label ready-for-human",
    "node tools/loop/tracker.mjs label 5 --remove ready-for-agent --remove in-progress --add ready-for-human",
    "node tools/loop/tracker.mjs comment 5 --body-file b.md",
    "node tools/loop/tracker.mjs read 5",
  ]) {
    test(`allows in an implement session: ${cmd}`, () => assert.equal(check(cmd, stale, true, implementing), null));
  }
});

describe("an implement session is known by its own phase, not by a worktree", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-route-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = (...rows: object[]) => {
    const file = join(dir, `t${Math.random().toString(36).slice(2)}.jsonl`);
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return file;
  };
  const say = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
  const bash = (command: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "Bash", input: { command } }] } });
  const route = (env: Record<string, string>, file?: string) => implementRoute(env, file);

  test("a resumed implement session says so in LOOP_PHASE", () => {
    assert.equal(route({ LOOP_PHASE: "D" }, join(dir, "missing.jsonl")), true);
  });

  test("a fresh one by the phase it reported, in text or as an echo", () => {
    assert.equal(route({}, transcript(say("PHASE A"), say("PHASE B"))), true);
    assert.equal(route({}, transcript(say("PHASE A"), bash('echo "PHASE C" && git status'))), true);
  });

  test("a triage or wayfinder session never reports past A", () => {
    assert.equal(route({}, transcript(say("PHASE A"), say("Routing to /triage"))), false);
    assert.equal(route({ LOOP_PHASE: "" }, transcript(say("PHASE A"))), false);
  });

  test("only with no transcript to read does a standing ticket worktree decide, and it says so", () => {
    let stands = false;
    const stderr = captureStderr(() => {
      stands = implementRoute({}, join(dir, "missing.jsonl"), () => true);
    });
    assert.equal(stands, true);
    assert.match(stderr, /cannot read this session's transcript/);
    assert.equal(implementRoute({}, transcript(say("PHASE A")), () => true), false);
  });
});

describe("gitAt.onTicket, the fallback, against real worktrees", () => {
  test("is true from the shared checkout or the worktree while an agent-<n> worktree is on its ticket branch", () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-ticket-"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "ignore" });
    try {
      git("init", "-q", "-b", "main");
      git("commit", "-q", "--allow-empty", "-m", "base");
      assert.equal(gitAt(dir).onTicket(), false);
      git("worktree", "add", "-q", "-b", "agent/7-x", join(".worktrees", "agent-7"));
      assert.equal(gitAt(dir).onTicket(), true);
      assert.equal(gitAt(join(dir, ".worktrees", "agent-7")).onTicket(), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gitAt.unmerged, against a real conflict", () => {
  test("is true only when every path is itself conflicted", () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-unmerged-"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "ignore" });
    try {
      git("init", "-q", "-b", "main");
      writeFileSync(join(dir, "c.txt"), "a\n");
      writeFileSync(join(dir, "d.txt"), "a\n");
      git("add", "."); git("commit", "-qm", "base");
      git("checkout", "-qb", "side");
      writeFileSync(join(dir, "c.txt"), "side\n"); git("commit", "-qam", "side");
      git("checkout", "-q", "main");
      writeFileSync(join(dir, "c.txt"), "main\n"); git("commit", "-qam", "main");
      try { git("merge", "side"); } catch { /* the conflict is the point */ }
      writeFileSync(join(dir, "d.txt"), "dirty\n");
      const repo = gitAt(dir);
      assert.equal(repo.unmerged(["c.txt"], null), true);
      assert.equal(repo.unmerged(["./c.txt"], null), true);
      assert.equal(repo.unmerged([".\\c.txt"], null), true);
      assert.equal(repo.unmerged(["."], null), false);
      assert.equal(repo.unmerged(["c.txt", "d.txt"], null), false);
      assert.equal(repo.unmerged([], null), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a loop session leaves the variables session-env.mjs owns alone", () => {
  const OWNED = /session-env\.mjs owns/;
  for (const cmd of [
    "LOOP_TURNS= npm run loop:test",
    "env LOOP_TEST_BASE=HEAD~1 node tools/loop/loop-gate.mjs --build",
    "LOOP_TEST_WORKTREE=.worktrees/agent-9; node tools/loop/loop-gate.mjs --build",
    "LOOP_TURNS=$(echo) node x.mjs",
    "export LOOP_TURNS=",
    "export -n LOOP_TURNS",
    "unset LOOP_TURNS",
    "unset -v LOOP_PHASE",
    "env -u LOOP_TURNS node x.mjs",
    "env --unset=LOOP_TURNS node x.mjs",
    "bash -c 'LOOP_TURNS= node x.mjs'",
    '$env:LOOP_TURNS = ""',
    '$env:loop_turns=""',
    "${env:LOOP_TEST_GH_SCRIPT} = 'x.mjs'",
    "Remove-Item env:LOOP_TURNS",
    "Remove-Item -Path Env:\\LOOP_TURNS",
    "[Environment]::SetEnvironmentVariable('LOOP_TURNS', $null)",
  ]) {
    test(`refuses in the loop: ${cmd}`, () => assert.match(String(check(cmd, repo, true)), OWNED));
    test(`allows outside the loop: ${cmd}`, () => assert.equal(check(cmd, repo, false), null));
  }
  for (const cmd of ["echo $LOOP_TURNS", "env FOO=1 node x.mjs", "node --import ./tools/loop/tests/helpers/clearLoopEnv.mjs --test x.test.ts"]) {
    test(`allows in the loop: ${cmd}`, () => assert.equal(check(cmd, repo, true), null));
  }
});

describe("a loop session does not shed the variables session-env.mjs owns from inside a child either", () => {
  const OWNED = /session-env\.mjs owns/;
  for (const cmd of [
    `node -e "process.env.LOOP_TURNS=''; require('child_process').execSync('node tools/loop/loop-gate.mjs')"`,
    `node -e "delete process.env.LOOP_TURNS"`,
    `node -e "process.env['LOOP_' + 'TURNS'] = ''"`,
    `node -e "for (const k in process.env) delete process.env[k]"`,
    `node -e "require('child_process').execSync('node x.mjs', { env: {} })"`,
    `node <<'EOF'\ndelete process.env.LOOP_TURNS;\nEOF`,
    `python3 -c "import os; os.environ['LOOP_TURNS'] = ''"`,
    `python3 -c "import os; os.environ.pop('LOOP_TURNS')"`,
    `python3 -c "import os; del os.environ['LOOP_TURNS']"`,
    `python -c "import os; os.environ.clear()"`,
    `perl -e 'delete $ENV{LOOP_TURNS}; exec "node", "x.mjs"'`,
    "env -i node x.mjs",
    "env - node x.mjs",
    "env --ignore-environment PATH=/usr/bin node x.mjs",
    "exec -c node x.mjs",
  ]) {
    test(`refuses in the loop: ${cmd}`, () => assert.match(String(check(cmd, repo, true)), OWNED));
    test(`allows outside the loop: ${cmd}`, () => assert.equal(check(cmd, repo, false), null));
  }
  for (const cmd of [
    `node -e "console.log(process.env.LOOP_TURNS)"`,
    `node -e "process.env.FOO = '1'"`,
    `python3 -c "import os; print(os.environ.get('LOOP_TURNS'))"`,
    "node -e \"require('child_process').execSync('x', { env: { ...process.env, FOO: '1' } })\"",
    "git commit -m 'refuse env -i in a loop session'",
  ]) {
    test(`allows in the loop: ${cmd}`, () => assert.equal(check(cmd, repo, true), null));
  }
});

describe("a loop session leaves agent:check's cache to agent:check", () => {
  for (const cmd of [
    "echo '{}' > .git/agent-check-cache.json",
    "rm .git/worktrees/agent-9/agent-check-cache.json",
    "cp /tmp/x .git/agent-check-cache.json",
    `node -e "require('fs').writeFileSync('.git/agent-check-cache.json', '{}')"`,
    "Set-Content .git\\Agent-Check-Cache.json '{}'",
    "node x.mjs 2> .git/agent-check-cache.json",
    "cd .git && echo '{}' > agent-check-cache.json",
    "cd .git && rm agent*",
    "cat /tmp/x >> .git/agent-check-cache.json",
    "cat /tmp/x | tee .git/agent-check-cache.json",
    "mv .git/agent-check-cache.json /tmp/x",
    "truncate -s 0 .git/agent-check-cache.json",
    "ln -sf /tmp/x .git/agent-check-cache.json",
    "touch .git/agent-check-cache.json",
    "rm .git/agent-check-cache.j*",
    "echo '{}' > .git/agent-check-*.json",
    "cp /tmp/x .git/agent-check-cache.js?n",
    "rm .git/agent-check-cache.{json,bak}",
    `cp /tmp/x ".git/agent-check-"'cache.json'`,
    "f=agent-check; cp /tmp/x .git/$f-cache.json",
    "cp /tmp/x .git/$NAME",
    `node -e "require('fs').writeFileSync('.git/agent-check-' + 'cache.json', '{}')"`,
    `node -e "require('fs').rmSync(['.git/agent', 'check', 'cache.json'].join('-'))"`,
    `python3 -c "open('.git/agent-check-' 'cache.json', 'w').write('{}')"`,
    `node <<'EOF'\nrequire('fs').writeFileSync('.git/agent-check-cache.json', '{}');\nEOF`,
  ]) {
    test(`refuses in the loop: ${cmd}`, () => assert.match(String(check(cmd, repo, true)), /only `npm run agent:check` writes it/));
    test(`allows outside the loop: ${cmd}`, () => assert.equal(check(cmd, repo, false), null));
  }
  for (const cmd of [
    "cat .git/agent-check-cache.json",
    "grep -c pass .git/agent-check-cache.json",
    "jq . < .git/agent-check-cache.json",
    "cat .git/agent-check-cache.j*",
    "cp .git/agent-check-cache.json /tmp/seen.json",
    `node -e "console.log(require('fs').readFileSync('.git/agent-check-' + 'cache.json', 'utf8'))"`,
    "node -e \"console.log(require('fs').readFileSync('.git/agent-check-cache.json', 'utf8'))\"",
    `git commit -m "agent-check-cache.json is written by agent:check alone"`,
    `gh pr comment 12 --body "do not rm .git/agent-check-cache.json by hand"`,
  ]) {
    test(`refuses in the loop: ${cmd}`, () => assert.match(String(check(cmd, repo, true)), /only `npm run agent:check` writes it/));
    test(`allows outside the loop: ${cmd}`, () => assert.equal(check(cmd, repo, false), null));
  }
  for (const cmd of [
    "git commit -F - <<'EOF'\nnever echo '{}' > .git/agent-check-cache.json\nEOF",
    "rm *.log",
    "echo hi > $TMPFILE",
    "cat .github/workflows/ci.yml",
  ]) {
    test(`allows in the loop: ${cmd}`, () => assert.equal(check(cmd, repo, true), null));
  }
  test("agent:check itself is allowed", () => {
    for (const cmd of ["npm run agent:check", "npm run agent:check -- --force"]) assert.equal(check(cmd, repo, true), null, cmd);
  });
});

describe("the entrypoint fails closed on a call it cannot judge", () => {
  test("an evaluation that throws exits 2 and says why", () => {
    const input = JSON.stringify({ tool_input: { command: { toString: 1 } } });
    const result = spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8" });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /guard-bash: could not judge this call \(.+\); refusing it\./);
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

describe("the hooks the project's settings and the loop's own register", () => {
  type Hook = { command: string; args?: string[]; onFailure?: string; if?: unknown };
  type Entry = { matcher: string; hooks: Hook[]; if?: unknown };
  type Hooks = Record<string, Entry[]>;
  const hooksIn = (file: string) => (JSON.parse(readFileSync(join(ROOT, file), "utf8")).hooks ?? {}) as Hooks;
  const PROJECT = hooksIn(".claude/settings.json");
  const LOOP = hooksIn("tools/loop/loop-settings.json");
  const entriesOf = (hooks: Hooks) => Object.values(hooks).flat();
  const allHooks = () => [PROJECT, LOOP].flatMap(entriesOf).flatMap((e) => e.hooks);
  const text = (h: Hook) => [h.command, ...(h.args ?? [])].join(" ");
  const matched = (event: string, script: string, hooks: Hooks = PROJECT) =>
    (hooks[event] ?? [])
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

  test("every PreToolUse hook blocks when it fails, and none is filtered by an `if`", () => {
    for (const hooks of [PROJECT, LOOP]) {
      for (const hook of (hooks.PreToolUse ?? []).flatMap((e) => e.hooks)) assert.equal(hook.onFailure, "block", text(hook));
      for (const entry of entriesOf(hooks)) {
        assert.equal(entry.if, undefined, entry.matcher);
        for (const hook of entry.hooks) assert.equal(hook.if, undefined, text(hook));
      }
    }
  });

  test("the loop-only guards load from the loop's own settings, never every session's", () => {
    for (const tool of ["Write", "Edit", "NotebookEdit"]) assert.ok(matched("PreToolUse", "guard-write.mjs", LOOP).includes(tool), tool);
    for (const tool of ["Agent", "Task"]) assert.ok(matched("PreToolUse", "guard-agent-model.mjs", LOOP).includes(tool), tool);
    for (const script of ["guard-write.mjs", "guard-agent-model.mjs"]) {
      assert.deepEqual(matched("PreToolUse", script, PROJECT), [], `${script} still starts in every owner session`);
    }
  });

  test("a relative script path is what the subdirectory run catches", () => {
    const relative = { command: "node", args: ["tools/loop/guard-bash.mjs"] };
    const fromSubdir = runAsWritten(CWDS[1], relative, { cwd: ROOT, tool_input: { command: "git add -A" } });
    assert.notEqual(fromSubdir.status, 2, "the planted relative hook must not block from a subdirectory");
  });

  test("the project's cover every tool and every session start they guard", () => {
    for (const tool of ["Bash", "PowerShell"]) assert.ok(matched("PreToolUse", "guard-bash.mjs").includes(tool), tool);
    for (const source of ["startup", "resume", "compact", "clear"]) {
      assert.ok(matched("SessionStart", "loop-status.mjs").includes(source), source);
    }
  });

  for (const cwd of CWDS) {
    test(`run as written from ${cwd === ROOT ? "the root" : "tools/loop"}, each blocks what it guards`, () => {
      const bash = runAsWritten(cwd, hookOf("guard-bash.mjs"), { cwd: ROOT, tool_input: { command: "git add -A" } });
      assert.equal(bash.status, 2, bash.stderr);
      assert.match(bash.stderr, ADD);

      const agent = runAsWritten(cwd, hookOf("guard-agent-model.mjs"), { tool_name: "Agent", tool_input: { prompt: "x" } });
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

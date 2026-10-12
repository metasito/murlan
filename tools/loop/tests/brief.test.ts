import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brief, parseHeader, readIssue, KINDS } from "../brief.mjs";

const SCRIPT = fileURLToPath(new URL("../brief.mjs", import.meta.url));
const WT = "C:/Users/roton/murlan/.worktrees/agent-42";

describe("brief", () => {
  test("every kind opens with a header parseHeader reads back", () => {
    for (const kind of KINDS) {
      const text = brief(kind, { n: 42, worktree: WT, base: "abc1234" });
      assert.equal(text.split("\n")[0], `BRIEF ${kind} #42 ${WT} abc1234`);
      assert.deepEqual(parseHeader(text), { kind, n: 42, worktree: WT, base: "abc1234" });
    }
  });

  test("base defaults to origin/main", () => {
    assert.match(brief("review", { n: 7, worktree: WT }), /^BRIEF review #7 \S+ origin\/main$/m);
  });

  test("every brief forbids spawning a subagent", () => {
    for (const kind of KINDS) assert.match(brief(kind, { n: 1, worktree: WT }), /Do not spawn any subagent/);
  });

  test("every brief that names the issue reads its body and only trusted comments", () => {
    assert.match(readIssue(5), /^gh issue view 5 --json title,body,comments --jq '\.title, \.body, /);
    assert.ok(readIssue(5).includes(`select(.authorAssociation|IN("OWNER","MEMBER","COLLABORATOR"))`));
    for (const kind of KINDS) {
      const text = brief(kind, { n: 5, worktree: WT });
      assert.doesNotMatch(text, /--comments/, kind);
      if (["scope", "completeness", "review", "fix"].includes(kind)) assert.ok(text.includes(readIssue(5)), kind);
    }
  });

  test("the completeness brief sweeps every removed or renamed name", () => {
    const text = brief("completeness", { n: 1103, worktree: WT });
    assert.match(text, /gh issue view 1103 --json title,body,comments/);
    assert.match(text, /git -C \S+ diff origin\/main\.\.\.HEAD/);
    for (const kind of ["env var", "npm script", "locale key", "testID", "file path"]) assert.ok(text.includes(kind), kind);
    assert.match(text, /git -C \S+ grep/);
  });

  test("a review sorts findings so that only a bug, an unmet box, a regression or a security risk blocks", () => {
    for (const kind of ["review", "fix"]) {
      const text = brief(kind, { n: 1, worktree: WT });
      assert.match(text, /## Blocking`, `## Nits` and `## Pre-existing/, kind);
      assert.match(text, /A rule breach, a name, a comment, an untested branch or a style preference is a Nit/, kind);
    }
  });

  test("a later round reviews only the fix and checks the earlier Blocking findings", () => {
    const first = brief("review", { n: 1, worktree: WT });
    const later = brief("review", { n: 1, worktree: WT, base: "abc1234" });
    assert.match(first, /does it do what the Definition of done asks/);
    const net = /`git -C \S+ diff abc1234\.\.HEAD`, with `git -C \S+ log -p --first-parent --diff-merges=remerge --merges abc1234\.\.HEAD` for a merge's own edits/;
    assert.match(later, new RegExp(`Review only the fix ${net.source}`));
    assert.match(brief("fix", { n: 1, worktree: WT, base: "abc1234" }), new RegExp(`The fix is ${net.source}`));
    assert.doesNotMatch(later, /log -p --first-parent --diff-merges=remerge abc1234/);
    assert.match(later, /each earlier Blocking finding listed after this brief fixed/);
  });

  test("no brief asks for Blocking findings only and then for three headings", () => {
    for (const kind of KINDS) {
      for (const base of ["origin/main", "abc1234"]) {
        const text = brief(kind, { n: 1, worktree: WT, base });
        if (text.includes("## Pre-existing")) assert.doesNotMatch(text, /Blocking findings only/, `${kind} ${base}`);
      }
    }
  });

  test("the completeness brief asks for the covering test, and leaves test strength to the builder", () => {
    const text = brief("completeness", { n: 1, worktree: WT });
    assert.match(text, /the test that covers it/);
    assert.doesNotMatch(text, /line is deleted|either way|recheck/);
  });
  test("the completeness brief sweeps the tests for a changed literal's old value", () => {
    const text = brief("completeness", { n: 1256, worktree: WT });
    assert.match(text, /literal value the diff changes/);
    assert.match(text, /git -C \S+ grep -n -F <old value> -- tests/);
  });

  test("the scope brief no longer asks for feature groups to split", () => {
    assert.doesNotMatch(brief("scope", { n: 1, worktree: WT }), /feature groups/);
  });

  test("an unknown kind throws, and a non-header first line parses to null", () => {
    assert.throws(() => brief("nope", { n: 1, worktree: WT }));
    assert.equal(parseHeader("You are a reviewer"), null);
    assert.equal(parseHeader(""), null);
  });

  test("the CLI prints the brief, and refuses bad arguments with exit 2", () => {
    assert.equal(execFileSync(process.execPath, [SCRIPT, "scope", "42", WT], { encoding: "utf8" }).trimEnd(), brief("scope", { n: 42, worktree: WT }).trimEnd());
    assert.equal(spawnSync(process.execPath, [SCRIPT, "nope", "42", WT]).status, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT, "review", "x", WT]).status, 2);
  });
});

describe("the brief CLI refuses a worktree or base the delta cannot be read from", () => {
  let root = "";
  let wt = "";
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: wt, encoding: "utf8" }).trim();
  const commit = (file: string) => {
    writeFileSync(join(wt, file), `${file}\n`);
    git("add", "--", file);
    git("commit", "-qm", file);
    return git("rev-parse", "HEAD");
  };
  const tracker = (comments: { body: string }[] = []) => {
    const js = join(root, `gh-${Math.random().toString(36).slice(2)}.mjs`);
    const owned = comments.map((c) => ({ authorAssociation: "OWNER", ...c }));
    writeFileSync(js, `console.log(${JSON.stringify(JSON.stringify({ comments: owned }))});`);
    return js;
  };
  const cli = (...args: string[]) => cliReading([], ...args);
  const cliReading = (comments: { body: string }[], ...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, LOOP_GH_SCRIPT: tracker(comments) } });
  let reviewed = "";
  let rebased = "";

  before(() => {
    root = mkdtempSync(join(tmpdir(), "brief-cli-"));
    wt = join(root, ".worktrees", "agent-7");
    mkdirSync(wt, { recursive: true });
    git("init", "-q", "-b", "main");
    const base = commit("base.txt");
    reviewed = commit("round1.txt");
    commit("fix.txt");
    git("switch", "-q", "-c", "old", base);
    rebased = commit("round1-before-rebase.txt");
    git("switch", "-q", "main");
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test("a later round's base that is an ancestor of HEAD gives the net delta and the merges' own edits", () => {
    const r = cli("review", "7", wt, reviewed.slice(0, 7));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`git -C ${wt} diff ${reviewed.slice(0, 7)}..HEAD`), r.stdout);
    assert.ok(r.stdout.includes(`git -C ${wt} log -p --first-parent --diff-merges=remerge --merges ${reviewed.slice(0, 7)}..HEAD`), r.stdout);
  });

  test("a base the branch was rebased away from exits 2", () => {
    const r = cli("review", "7", wt, rebased.slice(0, 7));
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /not an ancestor of HEAD/);
    assert.equal(cli("fix", "7", wt, rebased.slice(0, 7)).status, 2);
  });

  test("the review brief lists every n/a box of this head's DOD-CHECK for the reviewer to judge", () => {
    const head = git("rev-parse", "--short", "HEAD");
    const na = "- [x] the owner signs the copy off — n/a: no code site, a decision";
    const check = `DOD-CHECK ${head}\n\n- [x] chip enters — package.json:2\n${na}\n- [x] \`npm run agent:check\` green`;
    const older = `DOD-CHECK ${reviewed.slice(0, 7)}\n\n- [x] stale — n/a: an older head`;
    const r = cliReading([{ body: older }, { body: check }], "review", "7", wt);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith(brief("review", { n: 7, worktree: wt }).trimEnd()), r.stdout);
    assert.ok(r.stdout.includes(na), r.stdout);
    assert.doesNotMatch(r.stdout, /chip enters|stale — n\/a/);
    assert.match(brief("review", { n: 7, worktree: wt }), /n\/a: <reason>/);
  });

  test("a worktree that is not .worktrees/agent-<n> exits 2", () => {
    for (const where of [".", root, join(root, ".worktrees", "agent-8")]) {
      const r = cli("review", "7", where, reviewed.slice(0, 7));
      assert.equal(r.status, 2, `${where}: ${r.stdout}`);
      assert.match(r.stderr, /\.worktrees\/agent-7/);
    }
    assert.equal(cli("scope", "7", ".").status, 2);
  });
});

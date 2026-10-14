import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brief, parseHeader, readIssue, KINDS } from "../brief.mjs";

const SCRIPT = fileURLToPath(new URL("../brief.mjs", import.meta.url));
const WT = "C:/Users/roton/murlan/.worktrees/agent-42";
/** A kind's role, which its agent file carries rather than the brief. */
const role = (kind: string) => readFileSync(new URL(`../../../.claude/agents/loop-${kind}.md`, import.meta.url), "utf8").replace(/\s+/g, " ");

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

  test("every kind's agent forbids spawning a subagent, and the brief carries no role of its own", () => {
    for (const kind of KINDS) {
      assert.match(role(kind), /Do not spawn any subagent/, kind);
      assert.doesNotMatch(brief(kind, { n: 1, worktree: WT }), /Do not spawn|Report|Review/, kind);
    }
  });

  test("every brief reads the issue's body and only trusted comments", () => {
    assert.match(readIssue(5), /^gh issue view 5 --json title,body,comments --jq '\.title, \.body, /);
    assert.ok(readIssue(5).includes(`select(.authorAssociation|IN("OWNER","MEMBER","COLLABORATOR"))`));
    for (const kind of KINDS) {
      const text = brief(kind, { n: 5, worktree: WT });
      assert.doesNotMatch(text, /--comments/, kind);
      assert.ok(text.includes(`Issue: \`${readIssue(5)}\``), kind);
    }
  });

  test("every kind but scope is given the change, and each agent reads what its brief gives", () => {
    for (const kind of KINDS) {
      const text = brief(kind, { n: 1103, worktree: WT });
      assert.equal(/^Change: `git -C \S+ diff origin\/main\.\.\.HEAD`$/m.test(text), kind !== "scope", kind);
      assert.match(role(kind), new RegExp(`BRIEF ${kind} #<n> <worktree> <base>`), kind);
      for (const line of ["Issue", ...(kind === "scope" ? [] : ["Change"])]) assert.ok(role(kind).includes(`\`${line}:\``), `${kind} ${line}`);
    }
  });

  test("the completeness check sweeps every removed or renamed name", () => {
    for (const kind of ["env var", "npm script", "locale key", "testID", "file path"]) assert.ok(role("completeness").includes(kind), kind);
    assert.match(role("completeness"), /git -C <worktree> grep -n -F <name>/);
  });

  test("a review sorts findings so that only a bug, an unmet box, a regression or a security risk blocks", () => {
    for (const kind of ["review", "fix"]) {
      assert.match(role(kind), /## Blocking`, `## Nits` and `## Pre-existing/, kind);
      assert.match(role(kind), /A rule breach, a name, a comment, an untested branch or a style preference is a Nit/, kind);
    }
  });

  test("a later round reviews only the fix and checks the earlier Blocking findings", () => {
    assert.match(role("review"), /does it do what the Definition of done asks/);
    assert.match(role("review"), /Any other `<base>` is a later round\. Review only the fix/);
    assert.match(role("review"), /each earlier Blocking finding listed after the brief fixed/);
    const later = brief("review", { n: 1, worktree: WT, base: "abc1234" });
    assert.match(later, /^Change: `git -C \S+ diff abc1234\.\.HEAD`$/m);
    assert.match(brief("fix", { n: 1, worktree: WT, base: "abc1234" }), /^Change: `git -C \S+ diff abc1234\.\.HEAD`$/m);
    assert.doesNotMatch(later, /log -p --first-parent/);
  });

  test("no agent asks for Blocking findings only and then for three headings", () => {
    for (const kind of KINDS) {
      if (role(kind).includes("## Pre-existing")) assert.doesNotMatch(role(kind), /Blocking findings only/, kind);
    }
  });

  test("the completeness check asks for the covering test, and leaves test strength to the builder", () => {
    assert.match(role("completeness"), /the test that covers it/);
    assert.doesNotMatch(role("completeness"), /line is deleted|either way|recheck/);
  });
  test("the completeness check sweeps the tests for a changed literal's old value", () => {
    assert.match(role("completeness"), /literal value the diff changes/);
    assert.match(role("completeness"), /git -C <worktree> grep -n -F <old value> -- tests/);
  });

  test("the scope check no longer asks for feature groups to split", () => {
    assert.doesNotMatch(role("scope"), /feature groups/);
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

  test("a later round's base that is an ancestor of HEAD, with no merge since, gives the plain net diff", () => {
    const r = cli("review", "7", wt, reviewed.slice(0, 7));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`git -C ${wt} diff ${reviewed.slice(0, 7)}..HEAD`), r.stdout);
    assert.doesNotMatch(r.stdout, /--diff-merges/);
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
    assert.match(role("review"), /n\/a: <reason>/);
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

describe("a later round's delta is net of the main a merge brought in", () => {
  let root = "";
  before(() => (root = mkdtempSync(join(tmpdir(), "brief-delta-"))));
  after(() => rmSync(root, { recursive: true, force: true }));

  /** Main changes x.txt; the branch, past its reviewed head, merges main and then fixes y.txt. */
  const scratch = (n: number, mainEdits: string) => {
    const wt = join(root, ".worktrees", `agent-${n}`);
    mkdirSync(wt, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: wt, encoding: "utf8" }).trim();
    const commit = (file: string, body: string) => {
      writeFileSync(join(wt, file), body);
      git("add", "--", file);
      git("commit", "-qm", file);
      return git("rev-parse", "HEAD");
    };
    git("init", "-q", "-b", "trunk");
    commit("base.txt", "base\n");
    git("switch", "-q", "-c", "agent");
    const reviewed = commit("y.txt", "round 1\n");
    git("switch", "-q", "trunk");
    commit(mainEdits, "from main\n");
    git("switch", "-q", "agent");
    const merged = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "merge", "-q", "--no-edit", "trunk"], { cwd: wt });
    if (merged.status !== 0) {
      writeFileSync(join(wt, mainEdits), "resolved\n");
      git("add", "--", mainEdits);
      git("commit", "-q", "--no-edit");
    }
    commit("y.txt", "round 1\nthe fix\n");
    return { wt, reviewed: reviewed.slice(0, 7) };
  };

  const namedBy = (text: string) => {
    const cmd = /^Change: `(git -C \S+ diff \S+(?: HEAD)?)`/m.exec(text)?.[1];
    assert.ok(cmd, text);
    const [, ...args] = cmd.split(" ");
    return execFileSync("git", [...args, "--name-only"], { encoding: "utf8" }).split("\n").filter(Boolean);
  };

  test("a clean merge of main leaves main's files out of the delta", () => {
    const { wt, reviewed } = scratch(8, "x.txt");
    const text = brief("fix", { n: 8, worktree: wt, base: reviewed });
    assert.deepEqual(namedBy(text), ["y.txt"]);
    assert.doesNotMatch(text, /--diff-merges/);
  });

  test("a merge merge-tree cannot redo falls back to the net diff and says what it carries", () => {
    const { wt, reviewed } = scratch(9, "y.txt");
    const text = brief("fix", { n: 9, worktree: wt, base: reviewed });
    assert.ok(namedBy(text).includes("y.txt"), text);
    assert.match(text, /--diff-merges=remerge --merges/);
    assert.match(text, /what a merge brought in from main is not the fix/);
  });
});

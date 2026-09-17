// tools/loop/tests/loopDerive.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ticketOf,
  verdictFor,
  reviewFor,
  reviewRounds,
  ciRedRounds,
  ciRedPosted,
  derive,
  locateRun,
  fixDelta,
  BRANCH,
} from "../loop-derive.mjs";
import { report } from "../loop-status.mjs";
import { ciRedBody } from "../queue-loop.mjs";
import { ticketTally } from "../loop-logs.mjs";

/**
 * The state file these replace failed in one way over and over: it said something that was no
 * longer true. Ticket two inherited ticket one's `VERDICT: LAND` because nothing cleared it, and
 * the gate believed it. Nothing is stored now, so the equivalent question is whether the review
 * found is a review *of this code* — which is what the sha binding decides.
 */
describe("which ticket the work belongs to", () => {
  test("comes from the branch, so it cannot disagree with where you are", () => {
    assert.equal(ticketOf("agent/824-music-delay"), 824);
    assert.equal(ticketOf("agent/55-maestro"), 55);
  });

  test("no ticket off a ticket branch", () => {
    for (const b of ["main", "chore/loop-rebuild", "agent/no-number", "", null]) {
      assert.equal(ticketOf(b as string), null, `${b} should not read as a ticket`);
    }
  });

  test("the pattern is anchored, so `feature/agent/9-x` is not ticket 9", () => {
    assert.equal(BRANCH.test("feature/agent/9-x"), false);
  });
});

describe("whether a review covers the code being pushed", () => {
  const head = "abc1234def5678901234567890123456789012ab";
  const other = "9999999999999999999999999999999999999999";

  test("a LAND naming this head clears it", () => {
    const v = verdictFor([{ body: "VERDICT: LAND abc1234" }], head);
    assert.equal(v?.decision, "LAND");
  });

  // The whole point of the binding: commit again after a review and it stops counting, so there is
  // no way to land a diff the reviewer never saw.
  test("a LAND naming an older head does not", () => {
    assert.equal(verdictFor([{ body: "VERDICT: LAND 9999999" }], head), null);
  });

  test("a HOLD is found, and is not permission", () => {
    const v = verdictFor([{ body: "VERDICT: HOLD abc1234 — the guard exempts its own case" }], head);
    assert.equal(v?.decision, "HOLD");
  });

  // Not "the latest wins". A hold on a head is final for that head: the only way past it is a
  // commit, which moves the head and asks for a review of the new code.
  test("a later LAND does not overturn a HOLD on the same head", () => {
    const v = verdictFor(
      [{ body: "VERDICT: HOLD abc1234 — wrong" }, { body: "VERDICT: LAND abc1234" }],
      head
    );
    assert.equal(v?.decision, "HOLD");
  });

  test("a comment merely discussing a verdict is not one", () => {
    for (const body of [
      "I think this should be VERDICT: LAND abc1234 personally",
      "LAND abc1234",
      "VERDICT: LAND",
      "VERDICT: MAYBE abc1234",
      "",
    ]) {
      assert.equal(verdictFor([{ body }], head), null, `should not count: ${JSON.stringify(body)}`);
    }
  });

  test("no comments at all is no verdict, not a pass", () => {
    assert.equal(verdictFor([], head), null);
    assert.equal(verdictFor([{ body: "nice work" }], other), null);
  });
});

/**
 * A HOLD is final for the commit it names. Order used to decide, so a later `LAND <same sha>` —
 * a confused reviewer, or one quoting its own instructions back — erased a hold nobody had
 * addressed, and the gate exited 0. The only way past a hold is a commit.
 */
describe("a hold cannot be talked out of", () => {
  const sha = "abcdef1234567";
  const short = sha.slice(0, 7);

  test("a HOLD on an older commit does not hold the current one", () => {
    assert.equal(verdictFor([{ body: "VERDICT: HOLD 9999999 — unsafe" }], sha), null);
  });

  test("a verdict inside a fenced block is not a review", () => {
    const fence = "```";
    assert.equal(
      verdictFor([{ body: `must end with:
${fence}
VERDICT: LAND ${short}
${fence}` }], sha),
      null
    );
  });

  test("lowercase prose is not a review", () => {
    assert.equal(verdictFor([{ body: `verdict: land ${short}` }], sha), null);
  });
});

describe("whether the review behind a verdict is on the issue", () => {
  const reviewBody = (sha: string) =>
    `REVIEW ${sha}\n\n## Standards\n\nNothing that affects correctness.\n\n## Spec\n\nEvery box closed.`;

  test("a review report is found for the head it names", () => {
    assert.ok(reviewFor([{ body: reviewBody("abc1234") }], "abc1234def"));
  });

  test("a review of an earlier head does not cover this one", () => {
    assert.equal(reviewFor([{ body: reviewBody("0000000") }], "abc1234def"), null);
  });

  test("a report missing an axis is not a review", () => {
    assert.equal(reviewFor([{ body: "REVIEW abc1234\n\n## Standards\n\nfine." }], "abc1234def"), null);
  });

  test("a report inside a code fence is not a review", () => {
    const fence = "```";
    assert.equal(reviewFor([{ body: `${fence}\n${reviewBody("abc1234")}\n${fence}` }], "abc1234def"), null);
  });

  test("no comments at all is no report", () => {
    assert.equal(reviewFor([], "abc1234def"), null);
  });

  test("a fix round's REVIEW <sha> fix still satisfies reviewFor", () => {
    assert.ok(reviewFor([{ body: reviewBody("abc1234").replace("REVIEW abc1234", "REVIEW abc1234 fix") }], "abc1234def"));
  });
});

describe("counting review rounds", () => {
  test("one VERDICT comment is one round", () => {
    assert.equal(reviewRounds([{ body: "VERDICT: LAND abc1234" }]), 1);
  });

  test("a HOLD counts as a round the same as a LAND", () => {
    assert.equal(
      reviewRounds([{ body: "VERDICT: HOLD abc1234 — no" }, { body: "VERDICT: LAND def5678" }]),
      2
    );
  });

  test("a verdict quoted inside a fence does not count", () => {
    const fence = "```";
    assert.equal(reviewRounds([{ body: `see:\n${fence}\nVERDICT: LAND abc1234\n${fence}` }]), 0);
  });

  test("a VERDICT: line with no sha does not count", () => {
    assert.equal(reviewRounds([{ body: "VERDICT: LAND" }]), 0);
  });

  test("no comments is zero rounds", () => {
    assert.equal(reviewRounds([]), 0);
  });

  const fixReview = { body: "REVIEW def5678 fix\n\n## Standards\n\nok\n\n## Spec\n\nok" };

  test("a verdict whose REVIEW is marked fix, after a CI-RED, does not count toward the cap", () => {
    const comments = [
      { body: "VERDICT: LAND abc1234" },
      { body: "CI-RED abc1234\nrun: x · step: y" },
      fixReview,
      { body: "VERDICT: LAND def5678" },
    ];
    assert.equal(reviewRounds(comments), 1);
  });

  test("a fix label with no CI-RED before it, since the latest claim, still counts", () => {
    const hold = { body: "VERDICT: HOLD def5678 — no" };
    assert.equal(reviewRounds([{ body: "VERDICT: HOLD abc1234 — no" }, fixReview, hold]), 2);
    const stale = [{ body: "CI-RED 0000000" }, { body: "Claimed by `agent/42-x`" }, fixReview, hold];
    assert.equal(reviewRounds(stale), 1);
  });
});

describe("fixDelta", () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      { cwd: dir, encoding: "utf8" }
    ).trim();

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "loop-fixdelta-"));
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "base");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("counts a fix commit's own diff, ignoring an update-branch merge", () => {
    const land = git("rev-parse", "HEAD");
    git("checkout", "-qb", "work");
    writeFileSync(join(dir, "fix.txt"), "one line\n");
    git("add", "-A");
    git("commit", "-qm", "fix work");
    git("checkout", "-q", "main");
    writeFileSync(join(dir, "main2.txt"), "main moved on\n");
    git("add", "-A");
    git("commit", "-qm", "main moved on");
    git("checkout", "-q", "work");
    git("merge", "-q", "--no-ff", "main", "-m", "update branch");
    assert.deepEqual(fixDelta(dir, land), { files: 1, lines: 1 });
  });
});

describe("ciRedRounds", () => {
  const claim = { body: "Claimed by `agent/9-x`." };

  test("counts CI-RED comments after the newest claim, not before it", () => {
    const n = ciRedRounds([{ body: "CI-RED aaaaaaa" }, { body: "CI-RED bbbbbbb" }, claim, { body: "CI-RED ccccccc" }]);
    assert.equal(n, 1);
  });

  test("distinct shas, not distinct comments", () => {
    const n = ciRedRounds([claim, { body: "CI-RED aaaaaaa" }, { body: "CI-RED aaaaaaa" }]);
    assert.equal(n, 1);
  });

  test("a reclaim resets what counts, so only the newest claim's tail is read", () => {
    const n = ciRedRounds([{ body: "CI-RED aaaaaaa" }, claim, { body: "CI-RED bbbbbbb" }, claim, { body: "CI-RED ccccccc" }]);
    assert.equal(n, 1);
  });

  test("a CI-RED quoted inside a fence does not count", () => {
    const fence = "```";
    const n = ciRedRounds([claim, { body: `see:\n${fence}\nCI-RED aaaaaaa\n${fence}` }]);
    assert.equal(n, 0);
  });

  test("no claim at all still counts the CI-RED comments there are", () => {
    assert.equal(ciRedRounds([{ body: "CI-RED aaaaaaa" }]), 1);
  });

  const sha = "cccccccccccccccccccccccccccccccccccccccc";

  test("a real ciRedBody output is counted once, and a decoy in its own excerpt cannot double it", () => {
    const body = ciRedBody({
      sha,
      runUrl: "https://github.com/metasito/murlan/actions/runs/1",
      failedStep: "Native tests",
      testIds: ["tests/e2e/x.spec.ts › case"],
      excerpt: "CI-RED bbbbbbb\nsome log line",
    });
    assert.equal(ciRedRounds([claim, { body }]), 1);
  });

  test("one red round counts once as a retry and once as a CI round, never twice in either", () => {
    const tally = ticketTally(1, [{ n: 1, cost: 0, outcome: "retry", head: sha }]);
    assert.equal(tally.retries, 1);
    assert.equal(ciRedRounds([claim, { body: `CI-RED ${sha}` }]), 1);
  });
});

describe("ciRedPosted", () => {
  const sha = "cccccccccccccccccccccccccccccccccccccccc";

  test("finds a CI-RED comment naming this exact head", () => {
    assert.equal(ciRedPosted([{ body: `CI-RED ${sha}` }], sha), true);
  });

  test("a different head is not a match", () => {
    assert.equal(ciRedPosted([{ body: "CI-RED dddddddddddddddddddddddddddddddddddddddd" }], sha), false);
  });

  test("no comments at all is not posted", () => {
    assert.equal(ciRedPosted([], sha), false);
  });

  test("a CI-RED quoted inside a fence does not count as posted", () => {
    const fence = "```";
    assert.equal(ciRedPosted([{ body: `see:\n${fence}\nCI-RED ${sha}\n${fence}` }], sha), false);
  });
});

interface GhAnswers {
  issue?: unknown;
  ref?: string;
  prs?: unknown;
  runs?: unknown;
  jobs?: unknown;
  log?: string;
  fail?: string[];
  calls?: string;
}

function fakeGh(dir: string, answers: GhAnswers): string {
  const js = join(dir, `fake-gh-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    js,
    `import { appendFileSync } from "node:fs";
  const m = ${JSON.stringify(answers)};
  const a = process.argv.slice(2);
  if (m.calls) appendFileSync(m.calls, a.join(" ") + "\\n");
  const key = a[0] === "issue" ? "issue" : a[0] === "api" ? "ref" : a[0] === "pr" ? "prs"
    : a[1] === "list" ? "runs" : a.includes("--log-failed") ? "log" : "jobs";
  if ((m.fail ?? []).includes(key)) { process.stderr.write("gh: connection reset\\n"); process.exit(1); }
  if (key === "ref" && m.ref === undefined) { process.stderr.write("gh: Not Found (HTTP 404)\\n"); process.exit(1); }
  const v = m[key] ?? { prs: [], runs: [], jobs: [], log: "" }[key];
  if (v === undefined) process.exit(1);
  process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
`,
  );
  return js;
}

/**
 * `derive()` distils `reviewRounds` from the same comment list it already reads for `verdictFor`,
 * so `loop-gate.mjs` gets both without a second call to the tracker.
 */
describe("derive()'s review-round count", () => {
  let dir: string;
  const priorScript = process.env.LOOP_GH_SCRIPT;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "loop-derive-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    writeFileSync(join(dir, "a.txt"), "1");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "agent/1234-x");
    writeFileSync(join(dir, "b.txt"), "2");
    git("add", "-A");
    git("commit", "-qm", "work");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (priorScript === undefined) delete process.env.LOOP_GH_SCRIPT;
    else process.env.LOOP_GH_SCRIPT = priorScript;
  });

  const stubGh = (comments: { body: string }[]) => fakeGh(dir, { issue: { comments } });

  test("counts one round per VERDICT comment on a normal read", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    process.env.LOOP_GH_SCRIPT = stubGh([
      { body: "looks ok" },
      { body: `VERDICT: HOLD ${head} — one more pass` },
      { body: `VERDICT: LAND ${head}` },
    ]);
    const result = derive({ cwd: dir, base: "main" });
    assert.equal(result.trackerReadable, true);
    assert.equal(result.reviewRounds, 2);
  });

  test("null, not zero, when the tracker cannot be read", () => {
    process.env.LOOP_GH_SCRIPT = join(dir, "does-not-exist.mjs");
    const result = derive({ cwd: dir, base: "main" });
    assert.equal(result.trackerReadable, false);
    assert.equal(result.reviewRounds, null);
  });
});

describe("derive({ ci: true }) resumes from what CI said about the pushed head", () => {
  const BR = "agent/1234-x";
  let root = "";
  let dir = "";
  let head = "";
  let mainSha = "";
  let merged = "";
  const prior = { script: process.env.LOOP_GH_SCRIPT, phase: process.env.LOOP_PHASE };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
      cwd,
      encoding: "utf8",
    }).trim();

  before(() => {
    root = mkdtempSync(join(tmpdir(), "loop-derive-ci-"));
    const origin = join(root, "origin.git");
    dir = join(root, "work");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(root, "init", "-q", "-b", "main", dir);
    git(dir, "remote", "add", "origin", origin);
    git(dir, "commit", "-q", "--allow-empty", "-m", "base");
    mainSha = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-qb", BR);
    writeFileSync(join(dir, "b.txt"), "2");
    git(dir, "add", "b.txt");
    git(dir, "commit", "-qm", "work");
    head = git(dir, "rev-parse", "HEAD");
    git(dir, "push", "-q", "origin", BR, "main");
    const other = join(root, "other");
    git(root, "clone", "-q", "-b", BR, origin, other);
    merged = git(other, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-p", "origin/main", "-m", "update branch");
    git(other, "push", "-q", "origin", `${merged}:refs/heads/${BR}`);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
    for (const [k, v] of [["LOOP_GH_SCRIPT", prior.script], ["LOOP_PHASE", prior.phase]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const land = () => [{ body: "Claimed by `agent/1234-x`." }, { body: `VERDICT: LAND ${head}` }];
  const run = (conclusion: string | null, status = "completed", sha = head) => [
    { databaseId: 7, status, conclusion, headSha: sha },
  ];
  const at = (answers: GhAnswers, opts: { base?: string; ci?: boolean; phase?: string } = {}) => {
    process.env.LOOP_GH_SCRIPT = fakeGh(root, answers);
    if (opts.phase === undefined) delete process.env.LOOP_PHASE;
    else process.env.LOOP_PHASE = opts.phase;
    return derive({ cwd: dir, base: opts.base ?? "main", ci: opts.ci ?? true }) as any;
  };
  const pushed = (extra: GhAnswers) => ({ issue: { comments: land() }, ref: head, prs: [{ number: 5 }], ...extra });

  test("nothing committed → C, no fix", () => {
    const s = at({ issue: { comments: land() } }, { base: BR });
    assert.equal(s.phase, "C");
    assert.equal(s.fix, false);
  });

  test("no verdict → D, no fix", () => {
    const s = at({ issue: { comments: [] }, ref: head, prs: [{ number: 5 }], runs: run("failure") });
    assert.equal(s.phase, "D");
    assert.equal(s.fix, false);
  });

  test("HOLD → C, no fix", () => {
    const s = at({ issue: { comments: [{ body: `VERDICT: HOLD ${head} — no` }] }, ref: head, runs: run("failure") });
    assert.equal(s.phase, "C");
    assert.equal(s.fix, false);
  });

  test("LAND, never pushed → E", () => {
    const s = at({ issue: { comments: land() } });
    assert.equal(s.phase, "E");
    assert.equal(s.ci.pushed, false);
    assert.equal(s.fix, false);
  });

  test("LAND, remote on a commit this head is not under → E", () => {
    const s = at(pushed({ ref: mainSha, runs: run("failure", "completed", mainSha) }));
    assert.equal(s.phase, "E");
    assert.equal(s.ci.pushed, false);
  });

  test("LAND, pushed, no open PR → E", () => {
    const s = at(pushed({ prs: [], runs: run("success") }));
    assert.equal(s.phase, "E");
    assert.equal(s.ci.pr, null);
  });

  for (const [name, runs, state] of [
    ["pending", () => run(null, "in_progress"), "pending"],
    ["green", () => run("success"), "green"],
    ["no run yet", () => [], "none"],
    ["infrastructure", () => run("cancelled"), "infrastructure"],
  ] as const) {
    test(`LAND, pushed, CI ${name} → G, no fix`, () => {
      const s = at(pushed({ runs: runs() }));
      assert.equal(s.phase, "G");
      assert.equal(s.ci.state, state);
      assert.equal(s.ci.pushed, true);
      assert.equal(s.fix, false);
    });
  }

  test("LAND + pushed + red → C with fix and ciRounds from comments", () => {
    const comments = [...land(), { body: "CI-RED aaaaaaa" }, { body: `CI-RED ${head.slice(0, 7)}` }];
    const s = at(pushed({ issue: { comments }, runs: run("failure"), jobs: [{ name: "npm test", conclusion: "failure", steps: 4 }] }));
    assert.equal(s.phase, "C");
    assert.equal(s.fix, true);
    assert.equal(s.ciRounds, 2);
    assert.deepEqual(s.ci, { pushed: true, pr: 5, sha: head, state: "red", step: "npm test" });
  });

  test("LAND + update-branch merge commit on the remote → still pushed", () => {
    const s = at(pushed({ ref: merged, runs: run("success", "completed", merged) }));
    assert.equal(s.ci.pushed, true, "the merge commit is fetched once and HEAD is under it");
    assert.equal(s.phase, "G");
  });

  test("gh throws → G with state unreadable, never E", () => {
    for (const fail of ["ref", "prs", "runs", "jobs"]) {
      const s = at(pushed({ runs: run("failure"), fail: [fail] }));
      assert.equal(s.phase, "G", `a failing ${fail} read resumed at ${s.phase}`);
      assert.equal(s.ci.state, "unreadable");
      assert.equal(s.fix, false);
    }
  });

  test("ci:false never calls gh beyond issue view", () => {
    const calls = join(root, "calls.txt");
    const s = at(pushed({ runs: run("failure"), calls }), { ci: false });
    assert.equal(s.phase, "E");
    assert.equal(s.ci, null);
    assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n").map((l) => l.split(" ").slice(0, 2).join(" ")), ["issue view"]);
  });

  test("LOOP_PHASE=C wins over a head with no verdict", () => {
    assert.equal(at({ issue: { comments: [] } }, { phase: "C" }).phase, "C");
    assert.equal(at({ issue: { comments: [] } }, { phase: "Z" }).phase, "D", "only a phase letter is honoured");
  });

  test("a handed phase still computes the fix round", () => {
    const s = at(pushed({ runs: run("failure") }), { phase: "D" });
    assert.equal(s.phase, "D");
    assert.equal(s.fix, true);
  });
});

/**
 * The compaction brief was guarded by nothing: an audit replaced `report` with a function
 * returning "" and the whole suite stayed green, while the one requirement it exists for — telling
 * a session that has just lost its memory that a run is live — silently stopped working.
 */
describe("the compaction brief", () => {
  test("says nothing when no run is live", () => {
    assert.equal(report({ onTicket: false, phase: "A", why: "not on an agent branch" }), "");
  });

  test("names the ticket, the worktree and the phase to resume at", () => {
    const out = report({
      onTicket: true,
      ticket: 621,
      branch: "agent/621-fix",
      cwd: "/repo/.worktrees/agent-621",
      base: "origin/main",
      head: "abcdef1234",
      commits: 2,
      changed: ["a.ts"],
      dirty: false,
      verdict: null,
      phase: "D",
      why: "no review of abcdef1 on the issue",
    });
    assert.match(out, /#621/);
    assert.match(out, /agent-621/);
    assert.match(out, /D — Review/);
    assert.doesNotMatch(out, /uncommitted/i, "claimed an in-progress slice on a clean tree");
  });

  const live = {
    onTicket: true,
    ticket: 8,
    branch: "agent/8-x",
    cwd: "/wt",
    base: "origin/main",
    head: "abcdef1",
    commits: 2,
    changed: ["a.ts"],
    dirty: false,
    verdict: { decision: "LAND", line: "VERDICT: LAND abcdef1" },
  };

  test("a pushed head waiting on CI resumes at the settle phase", () => {
    const out = report({ ...live, phase: "G", fix: false, ci: { pushed: true, pr: 3, state: "pending" }, why: "x" });
    assert.match(out, /G — Settle\. Pushed and waiting for CI; declare \{"phase":"G"\} and exit, the supervisor lands it\./);
  });

  test("a red pushed head resumes at a numbered fix round naming the failed step", () => {
    const ci = { pushed: true, pr: 3, state: "red", step: "npm test" };
    const out = report({ ...live, phase: "C", fix: true, ciRounds: 2, ci, why: "x" });
    assert.match(out, /C \(fix round 2\) — CI failed at npm test; read the CI-RED comment, fix, hand off to D\./);
  });

  test("a handed phase with no resume text of its own still names it", () => {
    assert.match(report({ ...live, phase: "B", why: "x" }), /resume at {2}B\b/);
  });

  test("mentions the in-progress slice only when the worktree is dirty", () => {
    const out = report({
      onTicket: true,
      ticket: 7,
      branch: "agent/7-x",
      cwd: "/wt",
      base: "origin/main",
      head: "abcdef1",
      commits: 0,
      changed: [],
      dirty: true,
      verdict: null,
      phase: "C",
      why: "nothing committed yet",
    });
    assert.match(out, /uncommitted changes/i);
  });

  // A detached worktree used to read as "no run at all", so a conflicted rebase looked like an idle
  // session and the ticket would have been started over.
  test("a stuck run is reported as stuck, not as no run", () => {
    const out = report({ onTicket: true, ticket: 9, phase: "?", why: "detached HEAD" });
    assert.match(out, /#9/);
    assert.match(out, /stuck/i);
  });

  // Two live agent/* worktrees is `onTicket: false` (derive can't say which is the run), but it is
  // not the same as no run being live — the "says nothing" case above must stay narrower than this.
  test("an ambiguous scan is reported, not silenced as no run", () => {
    const out = report({
      onTicket: false,
      phase: "A",
      why: "2 live agent/* worktrees under .worktrees/ (agent/1-a, agent/2-b) — cannot tell which one this run is",
      ambiguous: true,
    });
    assert.notEqual(out, "");
    assert.match(out, /agent\/1-a/);
  });
});

/**
 * `locateRun` is what `loop-status.mjs` and the `SessionStart` hook print, and what decides
 * whether a run is live at all. Both of its failure modes are silent: an answer that names the
 * wrong tree, and an answer that names none.
 */
describe("locateRun", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      { cwd, encoding: "utf8" },
    ).trim();

  const made: string[] = [];
  const newRepo = (tag: string) => {
    const dir = mkdtempSync(join(tmpdir(), `locate-run-${tag}-`));
    made.push(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "commit", "-q", "--allow-empty", "-m", "root");
    return dir;
  };

  /**
   * A ticket worktree under `.worktrees/`, and a second worktree that is neither on a ticket
   * branch nor under `.worktrees/` — a conflicted rebase, a probe tree, a worktree on main. That
   * second tree is the case: derived from it with `--show-toplevel`, the home to scan is its own
   * `.worktrees/`, which does not exist.
   */
  let repo = "";
  let probe = "";
  let ticketTree = "";

  before(() => {
    repo = newRepo("repo");
    ticketTree = join(repo, ".worktrees", "agent-42");
    probe = join(repo, "probe");
    git(repo, "worktree", "add", "-q", "-b", "agent/42-a-thing", ticketTree, "HEAD");
    git(repo, "worktree", "add", "-q", "-b", "probe", probe, "HEAD");
  });

  after(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  test("the fixture's two trees disagree, or the case below tests nothing", () => {
    assert.notEqual(
      resolve(git(probe, "rev-parse", "--show-toplevel")),
      resolve(git(repo, "rev-parse", "--show-toplevel")),
    );
  });

  test("finds the live run from a worktree that is not on a ticket branch", () => {
    const at = locateRun(probe);
    assert.equal(at.ticket, 42, "the scan must reach the checkout's .worktrees, not the probe's");
    assert.equal(at.branch, "agent/42-a-thing");
    assert.equal(resolve(at.cwd), resolve(ticketTree));
  });

  /** `git worktree list` answers for the repository, so a stray tree would otherwise be adopted. */
  test("an agent branch outside .worktrees/ is not this session's run", () => {
    const stray = join(repo, "stray");
    git(repo, "worktree", "add", "-q", "-b", "agent/9999-elsewhere", stray, "HEAD");
    try {
      assert.equal(locateRun(probe).ticket, 42, "the stray is not under a .worktrees/, so it is not a run");
    } finally {
      git(repo, "worktree", "remove", "--force", stray);
      git(repo, "branch", "-qD", "agent/9999-elsewhere");
    }
  });

  test("standing on the ticket branch needs no scan at all", () => {
    const at = locateRun(ticketTree);
    assert.equal(at.ticket, 42);
    assert.equal(at.cwd, ticketTree);
  });

  test("a worktree given explicitly is answered about itself, and named", () => {
    const at = locateRun(undefined, probe);
    assert.equal(at.ticket, null);
    assert.equal(at.cwd, probe);
  });

  test("a checkout with no ticket worktree reports itself, not nothing", () => {
    const at = locateRun(newRepo("bare"));
    assert.equal(at.ticket, null);
    assert.ok(existsSync(at.cwd));
  });

  test("outside a repository, answers rather than throwing", () => {
    const nowhere = mkdtempSync(join(tmpdir(), "locate-run-nogit-"));
    made.push(nowhere);
    const at = locateRun(nowhere);
    assert.equal(at.ticket, null);
    assert.equal(at.cwd, nowhere);
  });

  test("a worktree list git cannot give is not read as no run", () => {
    const nowhere = mkdtempSync(join(tmpdir(), "locate-run-nolist-"));
    made.push(nowhere);
    assert.equal(locateRun(nowhere).phase, "?");
    const brief = report(derive({ cwd: nowhere }));
    assert.match(brief, /could not determine the run: .+; do not pick a ticket until resolved/);
  });

  /**
   * In a child process, and in a repository with nothing live in it: the only way to ask
   * `locateRun()` about a directory is to stand in it, and asked from this suite's own checkout
   * the answer comes from whichever ticket worktree happens to exist today.
   */
  test("asked about nothing in particular, still names a real directory", () => {
    const bare = newRepo("cwd");
    const module = pathToFileURL(join(import.meta.dirname, "..", "loop-derive.mjs")).href;
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { locateRun } from ${JSON.stringify(module)};
         process.stdout.write(JSON.stringify(locateRun()));`,
      ],
      { cwd: bare, encoding: "utf8" },
    );
    const at = JSON.parse(out);
    assert.equal(at.ticket, null, "the fixture has no live run, so this is the no-run answer");
    assert.equal(typeof at.cwd, "string", "an answer naming no tree is the defect");
    assert.equal(resolve(at.cwd), resolve(bare));
  });
});

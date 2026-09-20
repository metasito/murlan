// tools/loop/tests/settleReplay.test.ts
//
// The supervisor's dealings with GitHub had no test at all. `readVerdict`, `landing` and `poll` were
// each unit-tested against hand-built inputs, and the only way to exercise the three together was to
// run a real night against a real pull request — which is how #1028's three empty fix rounds were
// found, one park and $8.40 later.
//
// Here the real `readVerdict` runs, against recorded `gh` payloads in the shapes the API actually
// returns. Only the subprocess is fake.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ciRedBody, poll, SETTLE_ROUNDS, sharedPlan } from "../queue-loop.mjs";
import { readHeadCi, readVerdict } from "../ciVerdict.ts";

const PENDING = { ticket: 1028, pr: 1053, branch: "agent/1028-the-turn-chip" };
const SHA = "5bb5dcf22b863994fc138ab773976e9539d78539";

const runRow = (status: string, conclusion: string | null) => [
  { databaseId: 34872415311, status, conclusion, headSha: SHA },
];

const prRow = (over: Record<string, string> = {}) => ({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "UNSTABLE",
  ...over,
});

/**
 * One fake `gh`. `script` answers the run listing per call, so a run can finish between rounds the
 * way a real one does; everything else is fixed for the scenario.
 */
function ghFake({
  script,
  pr = prRow(),
  jobs = [],
  log = "Native tests\tRun tests\t2026-09-14T00:00:00Z FAIL",
  remoteSha = SHA,
  prList = [{ number: PENDING.pr, headRefOid: SHA }],
  issueComments = [],
}: {
  script: unknown[][];
  pr?: Record<string, string>;
  jobs?: unknown[];
  log?: string | null;
  remoteSha?: string | null;
  prList?: unknown[];
  issueComments?: { body: string }[];
}) {
  const asked: string[][] = [];
  let listed = 0;
  // The executable is checked, not dropped: `mergeAndConfirm` reaches for `git ls-remote` through
  // the same injected runner, and a fake that answers everything cannot catch a misrouted call.
  const gh = (args: string[], file = "gh") => {
    assert.equal(file, "gh", `a ${file} call reached the gh fake: ${args.join(" ")}`);
    asked.push(args);
    if (args[0] === "api") {
      if (remoteSha === null) throw new Error("gh: not found");
      return remoteSha;
    }
    if (args[0] === "pr" && args[1] === "list") return JSON.stringify(prList);
    if (args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")) {
      return JSON.stringify({ headRefOid: SHA });
    }
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify(pr);
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ comments: issueComments });
    if (args[0] === "issue" && args[1] === "comment") return "";
    if (args[0] === "run" && args[1] === "list") {
      const at = Math.min(listed++, script.length - 1);
      return JSON.stringify(script[at]);
    }
    if (args.includes("--log-failed")) {
      if (log === null) throw new Error("gh: could not read the log");
      return log;
    }
    if (args[0] === "run" && args[1] === "view") return JSON.stringify(jobs);
    return "";
  };
  return { gh, asked };
}

/** `poll`'s io, with the real `readVerdict` wired to the fake subprocess. */
const io = (gh: (args: string[], file?: string) => string, written: string[][] = [], cleared = (_sha: string) => true) => ({
  run: (file: string, args: string[]) => (file === "git" ? "" : gh(args, file)),
  verdictOf: (repo: string, branch: string, pr: number) =>
    readVerdict(repo, branch, pr, Date.now() + 60_000, (args) => gh(args)),
  write: (path: string, body: string) => written.push([path, body]),
  mkdir: () => undefined,
  cleared,
});

const DEADLINE = 60_000;

describe("settle, replayed against recorded gh payloads", () => {
  // #1028 exactly: the pull request reads UNSTABLE while the run is still going, and the fix round
  // is handed a branch with no failed step and no log.
  test("an unfinished run is waited on, then handed back once it is red — with its log", async () => {
    const said: string[] = [];
    const written: string[][] = [];
    const { gh } = ghFake({
      script: [runRow("in_progress", null), runRow("in_progress", null), runRow("completed", "failure")],
      jobs: [{ name: "Native tests", conclusion: "failure", steps: 11 }],
    });
    const out = await poll(PENDING, (m: string) => said.push(m), 0, DEADLINE, io(gh, written));
    assert.equal(out.action, "hand-back");
    assert.equal((out as { head?: string }).head, SHA, "the retry row records the head CI judged");
    assert.match(String(out.reason), /Native tests/);
    assert.equal(written.length, 2, "the log, plus the CI-RED note posted alongside it");
    assert.match(written[0][0], /ci-1028\.log$/);
    assert.ok(
      said.filter((s) => /still in_progress/.test(s)).length >= 2,
      "it must wait while the run is going, not hand back on the first poll"
    );
  });

  test("a green run on a clean pull request merges", async () => {
    const { gh, asked } = ghFake({
      script: [runRow("completed", "success")],
      pr: prRow({ mergeStateStatus: "CLEAN" }),
    });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "merge");
    assert.ok(asked.some((a) => a[0] === "pr" && a[1] === "merge"), "the merge is what makes it a landing");
  });

  test("a green head no LAND covers is the owner's, and is never merged", async () => {
    const { gh, asked } = ghFake({ script: [runRow("completed", "success")], pr: prRow({ mergeStateStatus: "CLEAN" }) });
    const judged: string[] = [];
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh, [], (sha) => (judged.push(sha), false)));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /not cleared/);
    assert.deepEqual(judged, [SHA], "the head CI judged is the head cleared");
    assert.ok(!asked.some((a) => a[1] === "merge" || a[1] === "ready"));
  });

  test("a green draft is marked ready, then merged at the head CI judged", async () => {
    const pr: Record<string, unknown> = prRow({ mergeStateStatus: "DRAFT" });
    pr.isDraft = true;
    const { gh, asked } = ghFake({ script: [runRow("completed", "success")], pr: pr as Record<string, string> });
    const readying = (args: string[], file?: string) => {
      if (args[1] === "ready") Object.assign(pr, { isDraft: false, mergeStateStatus: "CLEAN" });
      return gh(args, file);
    };
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(readying));
    assert.equal(out.action, "merge");
    const order = asked.filter((a) => a[1] === "ready" || a[1] === "merge");
    assert.deepEqual(order.map((a) => a[1]), ["ready", "merge"]);
    assert.deepEqual(order[1].slice(-2), ["--match-head-commit", SHA]);
  });

  test("a draft that stays a draft is the owner's once its budget is spent", async () => {
    const pr: Record<string, unknown> = prRow({ mergeStateStatus: "DRAFT" });
    pr.isDraft = true;
    const { gh, asked } = ghFake({ script: [runRow("completed", "success")], pr: pr as Record<string, string> });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.equal(asked.filter((a) => a[1] === "ready").length, SETTLE_ROUNDS.ready);
  });

  test("a pull request someone else merged is not a fix round", async () => {
    const { gh } = ghFake({ script: [runRow("completed", "cancelled")], pr: prRow({ state: "MERGED" }) });
    assert.equal((await poll(PENDING, () => {}, 0, DEADLINE, io(gh))).action, "already-merged");
  });

  // A red run whose log cannot be read is a fix round with nothing to fix. It goes to the owner
  // rather than spending three sessions on five turns of phase A each.
  test("red CI with no readable log goes to the owner, not to a fix round", async () => {
    const said: string[] = [];
    const { gh } = ghFake({
      script: [runRow("completed", "failure")],
      jobs: [{ name: "Native tests", conclusion: "failure", steps: 11 }],
      log: null,
    });
    const out = await poll(PENDING, (m: string) => said.push(m), 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /log could not be read/);
    assert.equal(said.filter((s) => /named no log/.test(s)).length, SETTLE_ROUNDS.retry);
  });

  test("a run that never appears is bounded by its own budget, not by the deadline", async () => {
    const said: string[] = [];
    const { gh } = ghFake({ script: [[]] });
    const out = await poll(PENDING, (m: string) => said.push(m), 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.equal(said.length, SETTLE_ROUNDS.appear, "it asks its budget and stops, never the deadline");
  });

  // The arm that fires a real `gh pr update-branch` if the io seam is not total.
  test("a branch behind main is updated through the injected runner, not the real gh", async () => {
    const { gh, asked } = ghFake({
      script: [runRow("completed", "success")],
      pr: prRow({ mergeStateStatus: "BEHIND" }),
    });
    await poll(PENDING, () => {}, 0, 1, io(gh));
    assert.ok(asked.some((a) => a[0] === "pr" && a[1] === "update-branch"), "the fake must see it");
  });

  test("the deadline is reachable during a round, which it was not while gh run watch blocked", async () => {
    const { gh } = ghFake({ script: [runRow("in_progress", null)] });
    const out = await poll(PENDING, () => {}, 0, -1, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /did not settle in/);
  });
});

describe("readHeadCi, replayed against recorded gh payloads", () => {
  test("answers the remote head, its open PR, the verdict and every failing test id", () => {
    const { gh } = ghFake({
      script: [runRow("completed", "failure")],
      jobs: [{ name: "Native tests", conclusion: "failure", steps: 11 }],
      log: "Native tests\tRun tests\t2026-09-14T00:00:00Z   1) [chromium] › tests/e2e/x.spec.ts:9:5 › some test",
    });
    const out = readHeadCi(
      "metasito/murlan",
      PENDING.branch,
      (args) => gh(args),
      Date.now() + 60_000
    );
    assert.equal(out.remoteSha, SHA);
    assert.equal(out.pr, PENDING.pr);
    assert.equal(out.verdict.pass, false);
    assert.deepEqual(out.testIds, ["tests/e2e/x.spec.ts › some test"]);
  });

  test("a branch with no open pull request reads pr as null", () => {
    const { gh } = ghFake({ script: [runRow("completed", "success")], prList: [] });
    const out = readHeadCi("metasito/murlan", PENDING.branch, (args) => gh(args), Date.now() + 60_000);
    assert.equal(out.pr, null);
    assert.equal(out.verdict.pass, true);
  });

  test("a remote sha that cannot be read reads as null, not a throw", () => {
    const { gh } = ghFake({ script: [runRow("completed", "success")], remoteSha: null });
    const out = readHeadCi("metasito/murlan", PENDING.branch, (args) => gh(args), Date.now() + 60_000);
    assert.equal(out.remoteSha, null);
  });
});

describe("poll posts CI-RED once per red head", () => {
  const redFake = (issueComments: { body: string }[] = []) =>
    ghFake({
      script: [runRow("completed", "failure")],
      jobs: [{ name: "Native tests", conclusion: "failure", steps: 11 }],
      log: "Native tests\tRun tests\t2026-09-14T00:00:00Z   1) [chromium] › tests/e2e/x.spec.ts:9:5 › some test",
      issueComments,
    });
  const comment = (asked: string[][]) => asked.filter((a) => a[0] === "issue" && a[1] === "comment");

  test("hand-back posts one CI-RED comment per red head", async () => {
    const written: string[][] = [];
    const { gh, asked } = redFake();
    await poll(PENDING, () => {}, 0, DEADLINE, io(gh, written));
    const posted = comment(asked);
    assert.equal(posted.length, 1);
    const file = posted[0][posted[0].indexOf("--body-file") + 1];
    const body = written.find(([path]) => path === file)?.[1];
    assert.match(String(body), new RegExp(`^CI-RED ${SHA}`));
  });

  test("the same head red twice posts once", async () => {
    const { gh, asked } = redFake([{ body: `CI-RED ${SHA}\nrun: x · step: y\nfailing: z\nshared: none` }]);
    await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(comment(asked).length, 0);
  });

  test("an unreadable tracker skips posting rather than posting blind", async () => {
    const { gh: base, asked } = redFake();
    const gh = (args: string[], file = "gh") => {
      if (args[0] === "issue" && args[1] === "view") throw new Error("gh: connection reset");
      return base(args, file);
    };
    await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(comment(asked).length, 0);
  });

  // `verdict.output` is only the log's last 400 lines; `readVerdict` now carries `testIds` from
  // the full failed log jobsAndLog already read, so an id outside that tail must still reach here.
  test("a failing id outside the 400-line tail still reaches the CI-RED body", async () => {
    const old =
      "Native tests\tRun tests\t2026-09-14T00:00:00Z   1) [chromium] › tests/e2e/old.spec.ts:9:5 › ancient failure";
    const filler = Array.from({ length: 450 }, (_, i) => `Native tests\tRun tests\t2026-09-14T00:00:00Z filler ${i}`);
    const written: string[][] = [];
    const { gh, asked } = ghFake({
      script: [runRow("completed", "failure")],
      jobs: [{ name: "Native tests", conclusion: "failure", steps: 11 }],
      log: [old, ...filler].join("\n"),
    });
    await poll(PENDING, () => {}, 0, DEADLINE, io(gh, written));
    const file = comment(asked)[0]?.[comment(asked)[0].indexOf("--body-file") + 1];
    const body = String(written.find(([path]) => path === file)?.[1]);
    assert.match(body, /^- tests\/e2e\/old\.spec\.ts$/m);
  });

  test("every gh call it makes past the verdict passes a bounded timeout", async () => {
    const calls: { args: string[]; opts?: { timeout?: number } }[] = [];
    const { gh } = redFake();
    const run = (file: string, args: string[], opts?: { timeout?: number }) => {
      if (file === "git") return "";
      if (args[0] !== "pr") calls.push({ args, opts });
      return gh(args, file);
    };
    await poll(PENDING, () => {}, 0, DEADLINE, {
      run,
      verdictOf: (repo: string, branch: string, pr: number) =>
        readVerdict(repo, branch, pr, Date.now() + 60_000, (a) => gh(a)),
      write: () => {},
      mkdir: () => {},
    });
    assert.deepEqual(
      calls.map((c) => c.args.slice(0, 2).join(" ")),
      ["issue view", "run list", "issue list", "issue comment"],
    );
    for (const c of calls) assert.equal(c.opts?.timeout, 30_000);
  });
});

describe("a red head shared with another branch", () => {
  const issue = { number: 900, title: "shared red: x", state: "OPEN" };
  const evidence = { runId: 7, branch: "agent/1077-x", url: "https://example.test/runs/7", testIds: ["x"] };
  const red = (over: { issueComments?: { body: string }[] } = {}) =>
    ghFake({
      script: [runRow("completed", "failure")],
      jobs: [{ name: "Native tests", conclusion: "failure", steps: 11 }],
      ...over,
    });
  const bodyOf = (asked: string[][], written: string[][]) => {
    const post = asked.find((a) => a[0] === "issue" && a[1] === "comment");
    return post ? String(written.find(([p]) => p === post[post.indexOf("--body-file") + 1])?.[1]) : null;
  };
  const withShared = (gh: (a: string[], f?: string) => string, written: string[][], decision: object) => ({
    ...io(gh, written),
    shared: () => decision,
  });

  test("another branch's open issue blocks this ticket and is named on CI-RED", async () => {
    const written: string[][] = [];
    const { gh, asked } = red();
    const out = await poll(PENDING, () => {}, 0, DEADLINE, withShared(gh, written, { kind: "known", issue, testId: "x", evidence }));
    assert.deepEqual([out.action, (out as { blockedBy?: number }).blockedBy], ["hand-back", 900]);
    assert.match(String(bodyOf(asked, written)), /^shared: #900 \(also red on agent\/1077-x https:\/\/example\.test\/runs\/7\)$/m);
  });

  test("an issue this ticket filed stays its own even when that round's CI-RED never posted", async () => {
    const mine = { ...issue, body: `Failing test id: \`x\`\n\nowner: #${PENDING.ticket} (${PENDING.branch})` };
    const { gh: base } = red();
    const unpostable = (args: string[], file = "gh") => {
      if (args[0] === "issue" && args[1] === "comment") throw new Error("gh: HTTP 502");
      return base(args, file);
    };
    const filed = await poll(PENDING, () => {}, 0, DEADLINE, withShared(unpostable, [], { kind: "file", issue: mine, testId: "x" }));
    const written: string[][] = [];
    const { gh, asked } = red();
    const next = await poll(PENDING, () => {}, 0, DEADLINE, withShared(gh, written, { kind: "known", issue: mine, testId: "x" }));
    assert.deepEqual([filed, next].map((o) => (o as { blockedBy?: number }).blockedBy), [undefined, undefined]);
    assert.match(String(bodyOf(asked, written)), /^shared: #900 owned here$/m);
  });

  test("a shared check that could not answer says why in the log", async () => {
    const said: string[] = [];
    const { gh } = red();
    const why = "could not check shared red — gh: HTTP 422";
    await poll(PENDING, (m: string) => said.push(m), 0, DEADLINE, withShared(gh, [], { kind: "none", why }));
    assert.ok(said.some((m) => m.includes(why)), said.join("\n"));
  });

  test("a landed fix still red on a branch that has it is reopened and taken over by this ticket", async () => {
    const { gh, asked } = red();
    const landed = { kind: "reopen", landed: true, issue: { ...issue, state: "CLOSED" }, testId: "x", evidence };
    const out = await poll(PENDING, () => {}, 0, DEADLINE, withShared(gh, [], landed));
    assert.equal((out as { blockedBy?: number }).blockedBy, undefined);
    assert.deepEqual(
      asked.filter((a) => a[0] === "issue" && ["reopen", "edit"].includes(a[1])).map((a) => a.slice(0, 3)),
      [["issue", "reopen", "900"], ["issue", "edit", "900"]],
    );
  });

  test("a fix already on main updates the branch and settles again, with no CI-RED and no session", async () => {
    const written: string[][] = [];
    let behind = true;
    const { gh: base, asked } = red();
    const gh = (args: string[], file = "gh") => {
      if (args[0] === "pr" && args[1] === "update-branch") behind = false;
      if (args[0] === "pr" && args[1] === "view" && !args.includes("headRefOid")) {
        return JSON.stringify(prRow({ mergeStateStatus: behind ? "BEHIND" : "CLEAN" }));
      }
      if (args[0] === "run" && args[1] === "list" && !behind) return JSON.stringify(runRow("completed", "success"));
      return base(args, file);
    };
    const landed = { kind: "reopen", landed: true, issue: { ...issue, state: "CLOSED" }, testId: "x" };
    const out = await poll(PENDING, () => {}, 0, DEADLINE, withShared(gh, written, landed));
    assert.equal(out.action, "merge");
    assert.ok(asked.some((a) => a[1] === "update-branch"));
    assert.equal(bodyOf(asked, written), null);
  });
});

describe("sharedPlan", () => {
  const issue = { number: 900, title: "t", state: "OPEN" };
  const at = { ticket: 42, behind: false };
  test("reads each decision into a CI-RED line and what the supervisor does", () => {
    assert.deepEqual(sharedPlan({ kind: "none" }, at), { line: "none", action: null });
    assert.deepEqual(sharedPlan({ kind: "file", testId: "x", issue }, at), { line: "#900 owned here", action: null });
    const landed = { kind: "reopen", landed: true, issue, testId: "x" };
    assert.equal(sharedPlan(landed, { ...at, behind: true }).action, "update");
    assert.deepEqual(sharedPlan(landed, at), { line: "#900 owned here", action: "claim", issue: 900 });
  });

  test("a known issue is blocked on only when its owner line names another ticket", () => {
    const known = (body?: string) => sharedPlan({ kind: "known", testId: "x", issue: { ...issue, body } }, at);
    assert.deepEqual(known("owner: #42 (agent/42-x)"), { line: "#900 owned here", action: null });
    assert.deepEqual(known("owner: #420 (agent/420-y)"), { line: "#900", action: "block", issue: 900 });
    assert.equal(known(undefined).action, "block");
  });
});

describe("ciRedBody", () => {
  const runUrl = "https://github.com/metasito/murlan/actions/runs/1";

  // #1088 parked because one long e2e id ate a 200-character budget and hid `fontSubset` and
  // `iconSubset` behind `+10 more` — red, identically, in all three of its CI rounds.
  const long = [
    "tests/e2e/offlineMatch.spec.ts › offline vs AI — a match plays multiple hands and exercises the exchange",
    "tests/fontSubset.test.ts › the subsets carry every character the app can render",
    "tests/iconSubset.test.ts › the shipped subsets carry a glyph for every name the app renders",
  ];

  test("names the head, the run and the step", () => {
    const body = ciRedBody({ sha: SHA, runUrl, failedStep: "Native tests", testIds: ["a.ts › b"], runId: 7 });
    const lines = body.split("\n");
    assert.equal(lines[0], `CI-RED ${SHA}`);
    assert.match(lines[1], /^run: .+ · step: Native tests$/);
    assert.match(body, /^shared: none$/m);
  });

  test("no failing file is dropped, however long the others are", () => {
    const body = ciRedBody({ sha: SHA, runUrl, failedStep: "Test", testIds: long, runId: 7 });
    assert.match(body, /tests\/fontSubset\.test\.ts/);
    assert.match(body, /tests\/iconSubset\.test\.ts/);
    assert.doesNotMatch(body, /\+\d+ more/);
  });

  test("it states how many files are red, which is what makes 'I have them all' checkable", () => {
    assert.match(ciRedBody({ sha: SHA, runUrl, testIds: long, runId: 7 }), /3 failing files/);
  });

  test("thirty ids across one file are one file, and the ids themselves are not pasted", () => {
    const testIds = Array.from({ length: 30 }, (_, i) => `tests/e2e/x.spec.ts › case ${i} does a thing`);
    const body = ciRedBody({ sha: SHA, runUrl, testIds, runId: 7 });
    assert.match(body, /1 failing files, 30 tests/);
    assert.doesNotMatch(body, /case 17/);
  });

  test("it carries the command that prints the failure, against this run", () => {
    assert.match(ciRedBody({ sha: SHA, runUrl, testIds: long, runId: 7 }), /gh run view 7 --log-failed/);
  });

  test("with no id parsed the excerpt is the only signal, so it stays and is fenced", () => {
    const body = ciRedBody({ sha: SHA, runUrl, testIds: [], excerpt: "error TS2322: nope", runId: 7 });
    assert.deepEqual(body.split("\n").slice(-3), ["```", "error TS2322: nope", "```"]);
  });
});

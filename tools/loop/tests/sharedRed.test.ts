// tools/loop/tests/sharedRed.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkShared,
  decideShared,
  fixLandedOnMain,
  recentRedRuns,
  redCachePath,
  redRunListArgs,
  sharedIssueArgs,
  SHARED_RED_LABEL,
  titleFor,
  type RedRun,
  type SharedIssue,
} from "../sharedRed.ts";

const TEST_ID = "tests/e2e/accountRecovery.spec.ts › resend keeps the same code";

const run = (over: Partial<RedRun> = {}): RedRun => ({
  runId: 1,
  branch: "agent/1077-resend",
  headSha: "aaa",
  url: "https://github.com/metasito/murlan/actions/runs/1",
  testIds: [TEST_ID],
  ...over,
});

describe("decideShared", () => {
  const mine = { branch: "agent/1082-recovery-copy", testIds: [TEST_ID] };

  test("no match anywhere is none", () => {
    const decision = decideShared(mine, [run({ testIds: ["other spec › other test"] })], []);
    assert.deepEqual(decision, { kind: "none" });
  });

  test("the same id red on another branch with no issue yet is file", () => {
    const evidence = run();
    const decision = decideShared(mine, [evidence], []);
    assert.equal(decision.kind, "file");
    assert.equal(decision.kind === "file" && decision.testId, TEST_ID);
    assert.equal(decision.kind === "file" && decision.evidence, evidence);
  });

  test("an open shared-red issue already naming the id is known", () => {
    const issue: SharedIssue = { number: 5, title: titleFor(TEST_ID), state: "open" };
    const decision = decideShared(mine, [run()], [issue]);
    assert.deepEqual(decision, { kind: "known", issue, testId: TEST_ID });
  });

  test("a closed shared-red issue whose id fails again is reopen", () => {
    const issue: SharedIssue = { number: 5, title: titleFor(TEST_ID), state: "closed" };
    const decision = decideShared(mine, [run()], [issue]);
    assert.deepEqual(decision, { kind: "reopen", issue, testId: TEST_ID });
  });

  test("the branch's own older run does not count as shared", () => {
    const own = run({ branch: mine.branch, runId: 2 });
    const decision = decideShared(mine, [own], []);
    assert.deepEqual(decision, { kind: "none" });
  });
});

describe("fixLandedOnMain", () => {
  test("true once main's recent runs stop naming the id", () => {
    assert.equal(fixLandedOnMain(TEST_ID, [run({ branch: "agent/x" })]), true);
  });

  test("false while a recent main run still names it", () => {
    assert.equal(fixLandedOnMain(TEST_ID, [run({ branch: "main" })]), false);
  });
});

/**
 * A GitHub that keeps its own issues and run log, so "file once, then known" is answered by state a
 * second call would really read, in the `mainHealth.test.ts:38` style.
 */
function fakeGh(runs: RedRun[], logsById: Record<number, string>) {
  const issues: (SharedIssue & { title: string })[] = [];
  const calls: string[][] = [];
  let next = 900;
  const gh = (args: string[]) => {
    calls.push(args);
    const [verb, noun] = args;
    if (verb === "run" && noun === "list") {
      return JSON.stringify(
        runs.map((r) => ({
          databaseId: r.runId,
          conclusion: "failure",
          status: "completed",
          headSha: r.headSha,
          url: r.url,
          headBranch: r.branch,
          createdAt: new Date().toISOString(),
        })),
      );
    }
    if (verb === "run" && noun === "view" && args.includes("--log-failed")) {
      const id = Number(args[2]);
      return logsById[id] ?? "";
    }
    if (verb === "issue" && noun === "list") return JSON.stringify(issues);
    if (verb === "issue" && noun === "create") {
      const number = (next += 1);
      const url = `https://github.com/metasito/murlan/issues/${number}`;
      const title = args[args.indexOf("--title") + 1];
      issues.push({ number, title, url, state: "open" });
      return `${url}\n`;
    }
    if (verb === "issue" && noun === "reopen") {
      const found = issues.find((i) => i.number === Number(args[2]));
      if (found) found.state = "open";
      return "";
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  return { gh, calls, issues };
}

const LOG_1077 =
  "job\tstep\t2026-09-16T00:00:00Z 1) [chromium] › tests/e2e/accountRecovery.spec.ts:40:3 › resend keeps the same code\n";

describe("checkShared", () => {
  test("files once, then reports known for the same failing id", () => {
    const other = run({ runId: 1077, branch: "agent/1077-resend" });
    const hub = fakeGh([other], { 1077: LOG_1077 });
    const mine = { branch: "agent/1082-recovery-copy", testIds: [TEST_ID] };

    const first = checkShared({ repo: "metasito/murlan", gh: hub.gh, mine });
    assert.equal(first.kind, "file");
    assert.equal(first.kind === "file" && first.issue?.number, 901);

    const second = checkShared({ repo: "metasito/murlan", gh: hub.gh, mine });
    assert.equal(second.kind, "known");
    assert.equal(second.kind === "known" && second.issue.number, 901);
  });

  test("a #1077/#1082-style pair: each branch sees the other's id", () => {
    const run1077 = run({ runId: 1077, branch: "agent/1077-resend" });
    const run1082 = run({ runId: 1082, branch: "agent/1082-recovery-copy", url: "https://github.com/metasito/murlan/actions/runs/1082" });
    const hub = fakeGh([run1077, run1082], { 1077: LOG_1077, 1082: LOG_1077 });

    const fromA = checkShared({ repo: "metasito/murlan", gh: hub.gh, mine: { branch: "agent/1077-resend", testIds: [TEST_ID] } });
    assert.equal(fromA.kind, "file");

    const fromB = checkShared({ repo: "metasito/murlan", gh: hub.gh, mine: { branch: "agent/1082-recovery-copy", testIds: [TEST_ID] } });
    assert.equal(fromB.kind, "known");
  });

  test("an unreachable gh is none, never a throw", () => {
    const decision = checkShared({
      repo: "metasito/murlan",
      gh: () => {
        throw new Error("gh: could not connect");
      },
      mine: { branch: "agent/x", testIds: [TEST_ID] },
    });
    assert.equal(decision.kind, "none");
  });

  test("the filed issue carries the shared-red label", () => {
    const other = run({ runId: 1077, branch: "agent/1077-resend" });
    const hub = fakeGh([other], { 1077: LOG_1077 });
    checkShared({ repo: "metasito/murlan", gh: hub.gh, mine: { branch: "agent/1082-recovery-copy", testIds: [TEST_ID] } });
    const [create] = hub.calls.filter((c) => c[0] === "issue" && c[1] === "create");
    const labels = create.flatMap((a, i) => (a === "--label" ? [create[i + 1]] : []));
    assert.ok(labels.includes(SHARED_RED_LABEL));
    assert.ok(create.includes("--body-file"));
  });
});

describe("recentRedRuns", () => {
  test("a cache hit never reads the log a second time", () => {
    const dir = mkdtempSync(join(tmpdir(), "shared-red-test-"));
    try {
      writeFileSync(redCachePath(2001, dir), `${TEST_ID}\n`, "utf8");
      const hub = fakeGh([run({ runId: 2001, branch: "agent/cached" })], {});
      const rows = recentRedRuns("metasito/murlan", hub.gh, Date.now() - 60_000, { cacheDir: dir });
      assert.deepEqual(rows[0].testIds, [TEST_ID]);
      assert.equal(hub.calls.some((c) => c.includes("--log-failed")), false, "the cache answered, so the log was never asked for");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a miss reads the log once and writes the cache", () => {
    const dir = mkdtempSync(join(tmpdir(), "shared-red-test-"));
    try {
      const hub = fakeGh([run({ runId: 3001, branch: "agent/fresh" })], { 3001: LOG_1077 });
      const rows = recentRedRuns("metasito/murlan", hub.gh, Date.now() - 60_000, { cacheDir: dir });
      assert.deepEqual(rows[0].testIds, [TEST_ID]);
      assert.equal(readFileSync(redCachePath(3001, dir), "utf8").trim(), TEST_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the run list is pinned to ci.yml, limit 40", () => {
    const args = redRunListArgs("metasito/murlan");
    assert.equal(args[args.indexOf("--workflow") + 1], "ci.yml");
    assert.equal(args[args.indexOf("--limit") + 1], "40");
  });
});

describe("the gh arguments", () => {
  test("the shared-red issue listing carries its label and every state", () => {
    const args = sharedIssueArgs("metasito/murlan");
    assert.equal(args[args.indexOf("--label") + 1], SHARED_RED_LABEL);
    assert.equal(args[args.indexOf("--state") + 1], "all", "a closed issue still means this id was reported");
  });
});

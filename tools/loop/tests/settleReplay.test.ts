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
import { poll, SETTLE_ROUNDS } from "../queue-loop.mjs";
import { readVerdict } from "../ciVerdict.ts";

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
function ghFake({ script, pr = prRow(), jobs = [], log = "Native tests\tRun tests\t2026-09-14T00:00:00Z FAIL" }: {
  script: unknown[][];
  pr?: Record<string, string>;
  jobs?: unknown[];
  log?: string | null;
}) {
  const asked: string[][] = [];
  let listed = 0;
  // The executable is checked, not dropped: `mergeAndConfirm` reaches for `git ls-remote` through
  // the same injected runner, and a fake that answers everything cannot catch a misrouted call.
  const gh = (args: string[], file = "gh") => {
    assert.equal(file, "gh", `a ${file} call reached the gh fake: ${args.join(" ")}`);
    asked.push(args);
    if (args[0] === "pr" && args[1] === "view" && args.includes("headRefOid")) {
      return JSON.stringify({ headRefOid: SHA });
    }
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify(pr);
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
const io = (gh: (args: string[], file?: string) => string, written: string[][] = []) => ({
  run: (file: string, args: string[]) => (file === "git" ? "" : gh(args, file)),
  verdictOf: (repo: string, branch: string, pr: number) =>
    readVerdict(repo, branch, pr, Date.now() + 60_000, (args) => gh(args)),
  write: (path: string, body: string) => written.push([path, body]),
  mkdir: () => undefined,
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
    assert.match(String(out.reason), /Native tests/);
    assert.equal(written.length, 1, "the fix round's only input is that log");
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

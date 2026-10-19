// tools/loop/tests/settleReplay.test.ts
//
// The supervisor's dealings with GitHub, end to end. `readLandingState` and `landing` are each
// unit-tested against hand-built inputs; here the real `readLandingState` reads rollups recorded off
// live pull requests. `stepSettle` is fed those reads directly; `runSettle` gets them through a fake gh.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { journaled, settle } from "../queue-loop.mjs";
import { ciRedBody, endSettle, onMainLine, overdueAt, READ_RETRIES, rested, runSettle, SETTLE, startSettle, stepSettle } from "../settle.mjs";
import { appendSupervisor, supervisorLogPath } from "../loop-logs.mjs";
import { readLandingState } from "../ciVerdict.ts";
import { armArgs, disarmArgs } from "../tracker.mjs";
import { readLine } from "../loop-stream.mjs";
import { ciCall, landingAnswer, restJobs, restRun, restRuns } from "./helpers/restCi.ts";

const REPO = "metasito/murlan";
const PENDING = { ticket: 1028, pr: 1053, branch: "agent/1028-the-turn-chip" };
const SHA = "5bb5dcf22b863994fc138ab773976e9539d78539";
const NEW = "9c0ffee22b863994fc138ab773976e9539d78539";

type Fixture = { view: Record<string, unknown> & { statusCheckRollup: unknown[] }; run?: Record<string, unknown>; jobs?: unknown[] };
const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", `rollup-${name}.json`), "utf8"));
const at = (f: Fixture, over: Record<string, unknown>): Fixture => ({ ...f, view: { ...f.view, ...over } });
const GREEN = fixture("green");
const RED = fixture("red");
const ABSENT = fixture("absent");
const GATE_RUNNING = fixture("pending");
const RED_RUN = Number(RED.run?.databaseId);

const NAMED = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z test at tools/loop/tests/x.test.ts:9:5\n✖ breaks (2.1ms)";
const UNNAMED = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z Error: The runner has received a shutdown signal.";
const CLEAN_STATUS = "GraphQL: Pull request Pull request is in clean status (enablePullRequestAutoMerge)";

/**
 * One fake `gh` over a script of recorded rollups, one per `pr view`. The pull request's own state
 * — its head, arming and merge — is kept here and moved by the calls that move it on GitHub,
 * so a scenario reads back what the supervisor did to it.
 */
function rollupFake({
  views,
  log = NAMED,
  attempt = 1,
  armed = false,
  autoMerges = true,
  refuse = {},
  issueComments = [],
  open = [],
}: {
  /** The titles of the open issues `issue list` answers with; `issue create` adds to it. */
  open?: string[];
  views: Fixture[];
  log?: string | null;
  attempt?: number;
  armed?: boolean;
  autoMerges?: boolean;
  refuse?: { auto?: string; merge?: string; disarm?: string; rerun?: string };
  issueComments?: { body: string }[];
}) {
  const asked: string[][] = [];
  const pr = { head: SHA, armed, merged: false, attempt };
  let read = 0;
  let current: Fixture["view"] = views[0].view;
  const gh = (args: string[], file = "gh") => {
    assert.equal(file, "gh", `a ${file} call reached the gh fake: ${args.join(" ")}`);
    asked.push(args);
    const [cmd, sub] = args;
    const kind = kindOf(args);
    if (kind === "update-branch") {
      pr.head = NEW;
      return "";
    }
    if (kind === "rerun") {
      if (refuse.rerun) throw new Error(refuse.rerun);
      pr.attempt += 1;
      return "";
    }
    if (kind === "merge") {
      if (refuse.merge) throw new Error(refuse.merge);
      pr.merged = true;
      return "";
    }
    if (kind === "read") return JSON.stringify([issueComments.map((c) => ({ author_association: "OWNER", user: { login: "o" }, ...c }))]);
    if (kind === "comment") return "";
    if (kind === "list") return JSON.stringify([open.map((title, i) => ({ number: 2000 + i, title }))]);
    if (kind === "create") {
      open.push(titleOf(args));
      return JSON.stringify({ html_url: `https://github.com/${REPO}/issues/${1999 + open.length}` });
    }
    // One landing read is the pull request, then its head's checks and statuses: the script steps on the first.
    if (ciCall(args)?.kind === "pull") {
      const f = views[Math.min(read++, views.length - 1)];
      current = {
        ...f.view,
        headRefOid: pr.head,
        autoMergeRequest: pr.armed ? { mergeMethod: "MERGE" } : null,
        ...(pr.merged ? { state: "MERGED" } : {}),
      };
    }
    const landing = landingAnswer(args, current as never);
    if (landing !== null) return landing;
    if (cmd === "pr" && sub === "merge") {
      if (args.includes("--disable-auto")) {
        if (refuse.disarm) throw new Error(refuse.disarm);
        pr.armed = false;
        return "";
      }
      if (args.includes("--auto")) {
        if (refuse.auto) throw new Error(refuse.auto);
        pr.armed = true;
        pr.merged = autoMerges;
        return "";
      }
      throw new Error(`a direct merge is REST's, not gh pr merge: ${args.join(" ")}`);
    }
    if (cmd === "run" && sub === "view" && args.includes("--log-failed")) {
      if (log === null) throw new Error("gh: could not read the log");
      return log;
    }
    const ci = ciCall(args);
    if (ci?.kind === "jobs") return JSON.stringify(restJobs(RED.jobs as never));
    if (ci?.kind === "run") return JSON.stringify(restRun({ ...(RED.run as { databaseId: number }), headSha: pr.head, attempt: pr.attempt }));
    if (ci?.kind === "runs") return JSON.stringify(restRuns([]));
    throw new Error(`the gh fake has no answer for: gh ${args.join(" ")}`);
  };
  return { gh, asked, pr };
}

const REVIEWED = (_sha: string) => ({ ok: true, why: "reviewed" });

/** `runSettle`'s io, with the real `readLandingState` wired to the fake subprocess. */
const io = (gh: (args: string[], file?: string) => string, written: string[][] = [], cleared: (sha: string) => { ok: boolean; why: string } = REVIEWED) => ({
  run: (file: string, args: string[]) => (file === "git" ? "" : gh(args, file)),
  stateOf: (pr: number) => readLandingState(REPO, pr, (args) => gh(args), Date.now() + 60_000),
  write: (p: string, body: string) => written.push([p, body]),
  mkdir: () => undefined,
  cleared,
  mainFailures: () => null,
});

const DEADLINE = 60_000;
/** What a tracker call does, from its REST path and method; null for the gh porcelain the fake answers itself. */
const kindOf = (a: string[]) => {
  if (a[0] !== "api") return null;
  const path = String(a.find((x) => x.startsWith("repos/")) ?? "");
  const method = a.includes("-X") ? a[a.indexOf("-X") + 1] : "GET";
  if (/\/pulls\/\d+\/update-branch$/.test(path)) return "update-branch";
  if (/\/actions\/runs\/\d+\/rerun-failed-jobs$/.test(path)) return "rerun";
  if (/\/pulls\/\d+\/merge$/.test(path)) return "merge";
  if (/\/issues\/\d+\/comments/.test(path)) return method === "POST" ? "comment" : "read";
  if (/\/issues\?/.test(path)) return "list";
  if (/\/issues$/.test(path) && method === "POST") return "create";
  return null;
};
const fieldOf = (a: string[], name: string) => a.find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
const titleOf = (a: string[]) => fieldOf(a, "title") ?? a[a.indexOf("--title") + 1];
/** The file a call's body comes from: `--body-file`, or REST's `@file` field. */
const bodyFileOf = (a: string[]) => {
  const at = a.indexOf("--body-file");
  if (at !== -1) return a[at + 1];
  return (fieldOf(a, "body") ?? fieldOf(a, "commit_message"))?.replace(/^@/, "") ?? null;
};
const isDirectMerge = (a: string[]) => kindOf(a) === "merge";
const merges = (asked: string[][]) => asked.filter((a) => (a[0] === "pr" && a[1] === "merge") || isDirectMerge(a));
const indexOf = (asked: string[][], match: (a: string[]) => boolean) => asked.findIndex(match);
const isDisarm = (a: string[]) => a[1] === "merge" && a.includes("--disable-auto");
const isComment = (a: string[]) => kindOf(a) === "comment";
/** The text a `--body-file` argument names, from what `io`'s `write` captured; "" when it names none. */
const fileOf = (written: string[][], args: string[]) => {
  const file = bodyFileOf(args);
  return file === null ? "" : (written.findLast(([p]) => p === file)?.[1] ?? "");
};

/**
 * One recorded rollup as `readLandingState` reads it, with the pull request's own head, arm and
 * merge laid over it: the landing state `stepSettle` is fed.
 */
const recorded = (f: Fixture, { head = SHA, armed = false, merged = false, attempt = 1, log = NAMED as string | null } = {}) => {
  const fake = rollupFake({ views: [f], log, attempt, armed });
  Object.assign(fake.pr, { head, merged });
  return readLandingState(REPO, PENDING.pr, (args) => fake.gh(args), Date.now() + 60_000);
};

type Effect = { do: string; line?: string; head?: string; flake?: any; red?: any; then?: string };
/** A failed read: `execFileSync`'s shape, the first line naming the command and `stderr` saying what went wrong. */
const ghFailed = (stderr: string) => Object.assign(new Error(`Command failed: gh pr view 1053\n${stderr}`), { stderr });

/**
 * Steps `stepSettle` over `reads`, the last one repeated, with every effect taken to succeed. Time
 * moves `tick` between reads, plus whatever `slept[i]` says a standby added to the pause after read `i`.
 */
function replay(
  reads: (ReturnType<typeof recorded> | Error)[],
  { cleared = REVIEWED, deadline = DEADLINE, stuckMs = SETTLE.STUCK_MS, tick = 15_000, slept = [] as number[], ledgered = null as { head: string; runId: number; tests?: string[]; step?: string | null } | null } = {},
) {
  let state = startSettle({ at: 0, deadline, stuckMs, pr: PENDING.pr, ledgered });
  const effects: Effect[] = [];
  const judged: string[] = [];
  for (let i = 0, at = 0; i < 1000; at += tick + (slept[i] ?? 0), i++) {
    const r = reads[Math.min(i, reads.length - 1)];
    const read: Record<string, unknown> = { at };
    if (!overdueAt(state, at)) read[r instanceof Error ? "error" : "landing"] = r;
    let step = stepSettle(state, read);
    if (step.ask) {
      const head = String(step.head);
      judged.push(head);
      step = stepSettle(state, { ...read, cleared: cleared(head) });
    }
    effects.push(...step.effects);
    state = step.state;
    if (step.outcome) return { out: step.outcome, effects, judged, at, did: effects.filter((e) => e.do !== "log").map((e) => e.do), said: effects.flatMap((e) => (e.do === "log" ? [String(e.line)] : [])) };
    state = rested(state, slept[i] ?? 0);
  }
  throw new Error("stepSettle never settled");
}

describe("stepSettle, fed recorded landing states", () => {
  const MIN = 60_000;
  const ID = "tools/loop/tests/x.test.ts › breaks";
  const BEHIND = at(GREEN, { mergeStateStatus: "BEHIND" });

  test("a gate still running is waited on, then handed back once it is red", () => {
    const { out, did, said } = replay([recorded(ABSENT), recorded(GATE_RUNNING), recorded(RED), recorded(RED, { attempt: 2 })]);
    assert.equal(out.action, "hand-back");
    assert.ok(said.some((m) => /^PR #1053 · CI \d+ of \d+ jobs/.test(m)), `no CI progress line in ${JSON.stringify(said)}`);
    assert.ok(said.some((m) => /CI gate has not reported/.test(m)) && said.some((m) => /CI gate is in_progress/.test(m)));
    assert.equal(out.head, SHA, "the retry row records the head CI judged");
    assert.match(String(out.reason), /Typecheck and tests/);
    assert.deepEqual(did, ["rerun", "post-red"]);
  });

  test("a cleared green head is armed pinned to that head, and GitHub's merge lands it", () => {
    const { out, effects, judged } = replay([recorded(GREEN), recorded(GREEN, { armed: true, merged: true })]);
    assert.equal(out.action, "already-merged");
    assert.deepEqual(effects.filter((e) => e.do === "arm").map((e) => e.head), [SHA]);
    assert.deepEqual(judged, [SHA], "the head the gate passed is the head cleared");
  });

  test("a green head landable does not clear is the owner's, says why, and is never armed", () => {
    const { out, did } = replay([recorded(GREEN)], { cleared: () => ({ ok: false, why: "no review of 5bb5dcf on the issue" }) });
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /^no review of 5bb5dcf on the issue — .*not cleared/);
    assert.deepEqual(did, []);
  });

  test("a pull request someone else merged is not a fix round", () => {
    const { out, did } = replay([recorded(at(RED, { state: "MERGED" }))]);
    assert.equal(out.action, "already-merged");
    assert.deepEqual(did, []);
  });

  // A red run whose log cannot be read is a fix round with nothing to fix.
  test("red CI with no readable log goes to the owner, not to a fix round", () => {
    const { out, did } = replay([recorded(RED, { log: null })], { stuckMs: 100, tick: 5 });
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /^CI is red and its log could not be read — /);
    assert.ok(!did.includes("post-red"));
  });

  test("a head no check ever reports on is the owner's at the stuck bound, long before the deadline", () => {
    const { out, at: settled } = replay([recorded(at(ABSENT, { statusCheckRollup: [] }))], { stuckMs: 100, tick: 5 });
    assert.equal(out.action, "owner");
    assert.ok(settled < DEADLINE, "the stuck bound ends it, not the deadline");
    assert.match(String(out.reason), /^recheck did not settle — last: /);
  });

  test("mergeability GitHub never computes is the owner's at the stuck bound", () => {
    const { out } = replay([recorded(at(GREEN, { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }))], { stuckMs: 100, tick: 5 });
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /^recheck did not settle — last: /);
  });

  test("a gate still running is waited on to the deadline, past the stuck bound, and names what it waited on", () => {
    const { out, at: settled } = replay([recorded(GATE_RUNNING)], { deadline: 300, stuckMs: 20, tick: 5 });
    assert.equal(out.action, "owner");
    assert.ok(settled >= 300, "a running gate is bounded by the deadline alone");
    assert.match(String(out.reason), /^CI did not settle in \d+m — last: /);
  });

  test("update-branch re-arms on the new head, never the old one", () => {
    const { out, effects, did, judged } = replay([recorded(BEHIND), recorded(GREEN, { head: NEW }), recorded(GREEN, { head: NEW, armed: true, merged: true })]);
    assert.equal(out.action, "already-merged");
    assert.deepEqual(did, ["update-branch", "arm"]);
    assert.deepEqual(effects.filter((e) => e.do === "arm").map((e) => e.head), [NEW]);
    assert.deepEqual(judged, [NEW]);
  });

  test("#1602: a branch that conflicts with main settles as a rebase round, disarmed first, at the head it read", () => {
    const { out, did } = replay([recorded(at(GREEN, { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }), { armed: true })]);
    assert.equal(out.action, "rebase");
    assert.equal(out.reason, "the branch conflicts with main");
    assert.equal(out.head, SHA);
    assert.deepEqual(did, ["disarm"]);
  });

  test("an armed branch is disarmed before main is merged into it", () => {
    const { did } = replay([recorded(BEHIND, { armed: true }), recorded(GREEN, { head: NEW, merged: true })]);
    assert.deepEqual(did.slice(0, 2), ["disarm", "update-branch"]);
  });

  test("the deadline is reachable during a round", () => {
    const { out } = replay([recorded(ABSENT)], { deadline: -1 });
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /did not settle in/);
  });

  test("an owner's park and a missed deadline disarm too", () => {
    for (const [reads, deadline] of [[[recorded(at(GREEN, { state: "CLOSED" }), { armed: true })], DEADLINE], [[recorded(GATE_RUNNING, { armed: true })], 5]] as const) {
      const { out, did } = replay([...reads], { deadline, tick: 1 });
      assert.equal(out.action, "owner");
      assert.equal(did.at(-1), "disarm", JSON.stringify(did));
    }
  });

  test("a head this process armed waits without arming again, and is disarmed when the deadline passes first", () => {
    const { out, did, said } = replay([recorded(GREEN), recorded(GREEN, { armed: true })], { deadline: 5, tick: 1 });
    assert.equal(out.action, "owner");
    assert.deepEqual(did, ["arm", "disarm"]);
    assert.ok(said.some((m) => /waiting for GitHub to merge/.test(m)));
  });

  // `--match-head-commit` is checked when GitHub arms, and is not documented to be checked again at merge.
  describe("a head that moves under an arm", () => {
    const moved = [recorded(GREEN), recorded(GREEN, { head: NEW, armed: true })];

    test("is disarmed before anything else, and the new head is not armed unless it is cleared", () => {
      const cleared = (sha: string) => (sha === SHA ? REVIEWED(sha) : { ok: false, why: `no review of ${sha.slice(0, 7)}` });
      const { out, did, judged, said } = replay(moved, { cleared });
      assert.equal(out.action, "owner");
      assert.deepEqual(judged, [SHA, NEW]);
      assert.deepEqual(did, ["arm", "disarm"]);
      assert.ok(!said.some((m) => /waiting for GitHub to merge/.test(m)), JSON.stringify(said));
    });

    test("a moved head that is cleared is armed again, pinned to itself", () => {
      const { effects } = replay([...moved, recorded(GREEN, { head: NEW, armed: true, merged: true })]);
      assert.deepEqual(
        effects.filter((e) => e.do !== "log").map((e) => [e.do, e.head ?? null]),
        [["arm", SHA], ["disarm", null], ["arm", NEW]],
      );
    });
  });

  describe("a red is rerun once per head", () => {
    test("rerun once, then handed back when the rerun is red too", () => {
      const { out, did } = replay([recorded(RED, { log: UNNAMED }), recorded(GATE_RUNNING), recorded(RED, { log: UNNAMED, attempt: 2 })]);
      assert.deepEqual(did, ["rerun", "post-red"]);
      assert.equal(out.action, "hand-back");
      assert.equal(out.flake, undefined, "a red handed back after its rerun is no flake");
    });

    test("a rerun that goes green is armed, lands, and names the flake: ledgered before the arm, filed once merged", () => {
      const { out, effects, did } = replay([recorded(RED), recorded(GATE_RUNNING), recorded(GREEN, { attempt: 2 }), recorded(GREEN, { attempt: 2, armed: true, merged: true })]);
      assert.equal(out.action, "already-merged");
      assert.deepEqual(did, ["rerun", "note-flake", "arm", "file-flakes"]);
      assert.deepEqual([out.flake?.runId, out.flake?.tests], [RED_RUN, [ID]]);
      const noted = effects.find((e) => e.do === "note-flake")!;
      assert.deepEqual([noted.flake.runId, noted.flake.tests, noted.flake.head], [RED_RUN, [ID], SHA]);
      assert.deepEqual(effects.find((e) => e.do === "arm")!.flake.runId, RED_RUN, "the merge message names the run");
    });

    test("a red already on its second attempt is not rerun again, whoever reran it", () => {
      const { out, did } = replay([recorded(RED, { log: UNNAMED, attempt: 2 })]);
      assert.equal(out.action, "hand-back");
      assert.deepEqual(did, ["post-red"]);
    });

    test("a red naming its failing test is rerun once too, before any CI-RED starts a fix round", () => {
      const { out, did } = replay([recorded(RED), recorded(RED, { attempt: 2 })]);
      assert.equal(out.action, "hand-back");
      assert.deepEqual(did, ["rerun", "post-red"]);
    });
  });

  describe("the flake outlives the process that armed it", () => {
    const flake = { runId: RED_RUN, tests: [ID], step: "Test", head: SHA };

    test("a restart that finds it merged still files the issue and names the flake", () => {
      const { out, effects } = replay([recorded(GREEN, { merged: true })], { ledgered: flake });
      assert.deepEqual([out.flake?.runId, out.flake?.tests], [RED_RUN, [ID]]);
      assert.deepEqual(effects.filter((e) => e.do === "file-flakes").map((e) => e.red.runId), [RED_RUN]);
    });

    test("one ledgered for another head is not this merge's", () => {
      const { out, did } = replay([recorded(GREEN, { merged: true })], { ledgered: { ...flake, head: NEW } });
      assert.equal(out.flake, undefined);
      assert.deepEqual(did, []);
    });
  });

  describe("across a standby", () => {
    const OFFLINE = "error connecting to api.github.com";

    test("a pause the machine slept through does not spend the deadline", () => {
      const { out } = replay([recorded(GATE_RUNNING), recorded(GREEN), recorded(GREEN, { armed: true, merged: true })], { deadline: MIN, tick: 30, slept: [120 * MIN] });
      assert.equal(out.action, "already-merged", String(out.reason));
    });

    test("after a wake, a read the network refused is asked again, and a green one lands", () => {
      const reads = [recorded(GATE_RUNNING), ghFailed(OFFLINE), recorded(GREEN), recorded(GREEN, { armed: true, merged: true })];
      const { out } = replay(reads, { deadline: 60 * MIN, tick: 30, slept: [10 * MIN] });
      assert.equal(out.action, "already-merged", String(out.reason));
    });

    test("after a wake, a read refused for any reason but the network still goes to the owner", () => {
      const reads = [recorded(GATE_RUNNING), ghFailed("HTTP 401: Bad credentials (https://api.github.com/graphql)"), recorded(GREEN)];
      const { out } = replay(reads, { deadline: 60 * MIN, tick: 30, slept: [10 * MIN] });
      assert.equal(out.action, "owner");
      assert.match(String(out.reason), /^could not read CI/);
    });

    test("a read the network refused with no standby is asked again, and a green one lands", () => {
      const reads = [recorded(GATE_RUNNING), ghFailed(OFFLINE), recorded(GREEN), recorded(GREEN, { armed: true, merged: true })];
      const { out } = replay(reads, { tick: 30 });
      assert.equal(out.action, "already-merged", String(out.reason));
    });

    test("a server error is asked again, and goes to the owner once it outlasts its retries", () => {
      const bad = ghFailed("HTTP 502: Bad Gateway (https://api.github.com/graphql)");
      const { out, said } = replay([recorded(GATE_RUNNING), bad], { tick: 30 });
      assert.equal(out.action, "owner");
      assert.match(String(out.reason), /^could not read CI — /);
      assert.equal(said.filter((m) => /asking again/.test(m)).length, READ_RETRIES);
    });

    test("retries count errors in a row: a good read between them starts the count again", () => {
      const bad = ghFailed("HTTP 503: Service Unavailable");
      const reads = [...Array.from({ length: READ_RETRIES * 2 }, (_, i) => (i % 2 ? recorded(GATE_RUNNING) : bad)), recorded(GREEN), recorded(GREEN, { armed: true, merged: true })];
      const { out } = replay(reads, { tick: 30 });
      assert.equal(out.action, "already-merged", String(out.reason));
    });

    test("a 403 goes to the owner at once", () => {
      const { out } = replay([recorded(GATE_RUNNING), ghFailed("HTTP 403: API rate limit exceeded"), recorded(GREEN)], { tick: 30 });
      assert.equal(out.action, "owner");
      assert.match(String(out.reason), /^could not read CI — /);
    });
  });
});

describe("endSettle: what an effect that failed ends the settle as", () => {
  const begun = (over: Record<string, unknown> = {}) => ({ ...startSettle({ at: 0, deadline: DEADLINE, pr: PENDING.pr }), head: SHA, ci: { runId: RED_RUN }, ...over });

  test("an owner's end disarms what may be armed, once", () => {
    const { effects, outcome, state } = endSettle(begun({ armed: "maybe" }), { action: "owner", reason: "the merge failed — x" });
    assert.deepEqual(effects, [{ do: "disarm", then: "the merge failed — x" }]);
    assert.deepEqual(outcome, { action: "owner", reason: "the merge failed — x", runId: RED_RUN, head: SHA });
    assert.deepEqual(endSettle(state, { action: "owner", reason: "could not disarm" }).effects, [], "a disarm that failed is not asked again");
  });

  test("a hand-back disarms before it posts the CI-RED", () => {
    const next = { action: "hand-back", reason: "CI failed at Test" };
    const { effects, outcome } = endSettle(begun({ armed: true }), { action: "hand-back", next });
    assert.deepEqual(effects.map((e: Effect) => e.do), ["disarm", "post-red"]);
    assert.deepEqual(outcome, { ...next, head: SHA, runId: RED_RUN });
  });

  test("a CI-RED that could not be posted is a hold on that head", () => {
    const { effects, outcome } = endSettle(begun(), { action: "hold", reason: "CI-RED for 5bb5dcf could not be posted" });
    assert.deepEqual(effects, []);
    assert.deepEqual(outcome, { action: "hold", reason: "CI-RED for 5bb5dcf could not be posted", head: SHA, runId: RED_RUN });
  });
});

describe("runSettle, through a fake gh over recorded rollups", () => {
  test("a hand-back writes the CI log a fix round reads, then posts its CI-RED", async () => {
    const written: string[][] = [];
    const { gh } = rollupFake({ views: [ABSENT, GATE_RUNNING, RED] });
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh, written));
    assert.equal(out.action, "hand-back");
    assert.equal(written.length, 2, "the log, plus the CI-RED note posted alongside it");
    assert.match(written[0][0], /ci-1028\.log$/);
  });

  test("a cleared green head is armed pinned to that head", async () => {
    const { gh, asked } = rollupFake({ views: [GREEN] });
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "already-merged");
    assert.deepEqual(merges(asked), [armArgs(REPO, PENDING.pr, SHA)]);
  });

  test("the clean-status refusal falls back to a merge still pinned to the head", async () => {
    const { gh, asked } = rollupFake({ views: [GREEN], refuse: { auto: CLEAN_STATUS } });
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "already-merged");
    const [armed, direct] = merges(asked);
    assert.deepEqual(armed, armArgs(REPO, PENDING.pr, SHA));
    assert.deepEqual(direct, ["api", "-X", "PUT", `repos/${REPO}/pulls/${PENDING.pr}/merge`, "-f", "merge_method=merge", "-f", `sha=${SHA}`]);
  });

  test("a merge refused both ways is the owner's", async () => {
    const { gh } = rollupFake({ views: [GREEN], refuse: { auto: CLEAN_STATUS, merge: "GraphQL: Base branch was modified" } });
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /the merge failed — GraphQL: Base branch was modified/);
  });

  describe("which way an arm went is kept in .loop-logs/supervisor.log", () => {
    const board = { start: () => {}, set: () => {}, said: () => {}, close: () => {}, notice: () => {}, warn: () => {} };
    const ways = [
      ["armed", {}, "auto-merge armed at 5bb5dcf"],
      ["merged directly", { auto: CLEAN_STATUS }, `could not arm auto-merge — ${CLEAN_STATUS}; merging 5bb5dcf directly`],
    ] as const;
    for (const [way, refuse, line] of ways) {
      test(way, async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "supervisor-log-"));
        try {
          const { gh } = rollupFake({ views: [GREEN], refuse });
          const screen = journaled(board, () => PENDING.ticket, (l: string) => appendSupervisor(l, dir));
          const out = await settle(PENDING, screen, { watch: (p: never, log: (m: string) => void) => runSettle(p, log, 0, DEADLINE, io(gh)) });
          assert.equal(out.action, "already-merged");
          const kept = readFileSync(supervisorLogPath(null, dir), "utf8").split("\n");
          const stamped = (l: string) => !Number.isNaN(Date.parse(l.split(" ")[0]));
          assert.ok(kept.some((l) => stamped(l) && l.endsWith(` #${PENDING.ticket} ${line}`)), kept.join("\n"));
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  });

  test("update-branch merges main into the branch through gh, then arms the new head", async () => {
    const { gh, asked } = rollupFake({ views: [at(GREEN, { mergeStateStatus: "BEHIND" }), GREEN] });
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "already-merged");
    assert.ok(asked.some((a) => kindOf(a) === "update-branch"), "the fake must see it");
    assert.deepEqual(merges(asked), [armArgs(REPO, PENDING.pr, NEW)]);
  });

  test("an update-branch GitHub refuses is the owner's", async () => {
    const fake = rollupFake({ views: [at(GREEN, { mergeStateStatus: "BEHIND" })] });
    const gh = (args: string[], file = "gh") => {
      if (kindOf(args) === "update-branch") throw new Error("gh: merge conflict (HTTP 422)");
      return fake.gh(args, file);
    };
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /^could not update the branch — gh: merge conflict/);
  });
});

describe("an armed pull request is disarmed on every way out but a merge", () => {
  test("a red is disarmed before its CI-RED is posted, which is what starts a fix round", async () => {
    const { gh, asked } = rollupFake({ views: [RED], armed: true });
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "hand-back");
    const disarm = indexOf(asked, isDisarm);
    assert.ok(disarm !== -1 && disarm < indexOf(asked, isComment), JSON.stringify(asked));
    assert.deepEqual(asked[disarm], disarmArgs(REPO, PENDING.pr));
  });

  test("a missed deadline disarms through gh, leaving nothing armed", async () => {
    const { gh, asked, pr } = rollupFake({ views: [GREEN], autoMerges: false });
    const out = await runSettle(PENDING, () => {}, 0, 5, io(gh));
    assert.equal(out.action, "owner");
    assert.deepEqual(merges(asked), [armArgs(REPO, PENDING.pr, SHA), disarmArgs(REPO, PENDING.pr)]);
    assert.equal(pr.armed, false);
  });

  describe("an arm whose answer never came back may still have armed", () => {
    const TIMEOUT = "gh: Post \"https://api.github.com/graphql\": net/http: request canceled (Client.Timeout exceeded)";
    const silently = (tookEffect: boolean, disarmUnarmed?: string) => {
      const fake = rollupFake({ views: [GREEN], refuse: { merge: "GraphQL: Base branch was modified" } });
      const gh = (args: string[], file = "gh") => {
        if (args.includes("--auto")) {
          fake.asked.push(args);
          if (tookEffect) fake.pr.armed = true;
          throw new Error(TIMEOUT);
        }
        if (args.includes("--disable-auto") && !fake.pr.armed && disarmUnarmed) {
          fake.asked.push(args);
          throw new Error(disarmUnarmed);
        }
        return fake.gh(args, file);
      };
      return { ...fake, gh };
    };

    test("a refused direct merge after it still ends in a disarm", async () => {
      const { gh, asked, pr } = silently(true);
      const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(out.action, "owner");
      assert.match(String(out.reason), /the merge failed/);
      assert.ok(indexOf(asked, isDisarm) > indexOf(asked, isDirectMerge), JSON.stringify(asked));
      assert.equal(pr.armed, false);
    });

    test("a disarm refused because nothing was armed is no failure", async () => {
      const { gh, asked } = silently(false, "GraphQL: Auto merge is not enabled for this pull request");
      const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.ok(asked.some(isDisarm), JSON.stringify(asked));
      assert.match(String(out.reason), /^the merge failed/);
    });
  });

  test("a disarm refused because the pull request merged reads as merged", async () => {
    const fake = rollupFake({ views: [RED], armed: true, refuse: { disarm: "GraphQL: Pull request is already merged" } });
    const gh = (args: string[], file = "gh") => {
      if (args.includes("--disable-auto")) fake.pr.merged = true;
      return fake.gh(args, file);
    };
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "already-merged");
    assert.ok(!fake.asked.some(isComment), "a merged pull request has no fix round");
  });

  test("a disarm GitHub refuses is the owner's, and says the pull request may still merge", async () => {
    const { gh, asked } = rollupFake({ views: [RED], armed: true, refuse: { disarm: "HTTP 502" } });
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /could not disarm auto-merge — HTTP 502/);
    assert.ok(!asked.some(isComment), "no fix round may start on a pull request still armed");
  });
});

describe("a red is rerun once per head", () => {
  const reruns = (asked: string[][]) => asked.filter((a) => kindOf(a) === "rerun");

  test("rerun once through gh, then handed back when the rerun is red too", async () => {
    const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, RED], log: UNNAMED });
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.deepEqual(reruns(asked), [["api", "-X", "POST", `repos/${REPO}/actions/runs/${RED_RUN}/rerun-failed-jobs`]]);
    assert.equal(out.action, "hand-back");
  });

  describe("a red a rerun turned green is a flake, said everywhere it lands", () => {
    const ID = "tools/loop/tests/x.test.ts › breaks";
    const creates = (asked: string[][]) => asked.filter((a) => kindOf(a) === "create");

    test("the settle names the run and its tests, the merge says so, and one issue is filed per test", async () => {
      const written: string[][] = [];
      const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN] });
      const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh, written));
      assert.equal(out.action, "already-merged");
      assert.deepEqual([out.flake?.runId, out.flake?.tests], [RED_RUN, [ID]]);
      const arm = merges(asked).find((a) => a.includes("--auto"))!;
      assert.match(fileOf(written, arm), new RegExp(`${RED_RUN}[\\s\\S]*x\\.test\\.ts › breaks`));
      const [create, ...more] = creates(asked);
      assert.equal(more.length, 0);
      assert.equal(titleOf(create), `CI flake: ${ID}`);
      const mergedAt = asked.findIndex((a, i) => i > indexOf(asked, (b) => b.includes("--auto")) && ciCall(a)?.kind === "pull");
      assert.ok(indexOf(asked, (a) => kindOf(a) === "create") > mergedAt, "filed once the merge is read back, never before it");
    });

    // The issue says the pull request merged on that green; the ledger row is the record either way.
    test("a merge that fails files nothing, and the settle still names the flake", async () => {
      const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], refuse: { auto: CLEAN_STATUS, merge: "GraphQL: Base branch was modified" } });
      const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(out.action, "owner");
      assert.deepEqual([out.flake?.runId, out.flake?.tests], [RED_RUN, [ID]]);
      assert.equal(creates(asked).length, 0);
    });

    test("a test already filed open is not filed again", async () => {
      const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], open: [`CI flake: ${ID}`] });
      await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(creates(asked).length, 0);
    });

    describe("the flake outlives the process that armed it", () => {
      test("it is handed to the ledger before the arm, naming the head", async () => {
        const fake = rollupFake({ views: [RED, GATE_RUNNING, GREEN] });
        const noted: { flake: any; asked: number }[] = [];
        await runSettle({ ...PENDING, noteArmed: (flake: unknown) => noted.push({ flake, asked: fake.asked.length }) } as never, () => {}, 0, DEADLINE, io(fake.gh));
        assert.equal(noted.length, 1);
        assert.deepEqual([noted[0].flake.runId, noted[0].flake.tests, noted[0].flake.head], [RED_RUN, [ID], SHA]);
        assert.ok(!fake.asked.slice(0, noted[0].asked).some((a) => a.includes("--auto")), "noted before the arm");
      });

      test("a restart that finds it merged files the issue from the ledger", async () => {
        const { gh, asked } = rollupFake({ views: [at(GREEN, { state: "MERGED" })] });
        const flake = { runId: RED_RUN, tests: [ID], step: "Test", head: SHA };
        await runSettle({ ...PENDING, flake } as never, () => {}, 0, DEADLINE, io(gh));
        assert.equal(creates(asked).length, 1);
      });
    });

    // Promotion swaps `ready-for-human` for `ci-flake`, so a listing by either label misses it.
    test("a test filed and since promoted is not filed again, whatever its labels", async () => {
      const fake = rollupFake({ views: [RED, GATE_RUNNING, GREEN], open: [`CI flake: ${ID}`] });
      const gh = (args: string[], file = "gh") => (kindOf(args) === "list" && args.some((a) => /[?&]labels=/.test(a)) ? (fake.asked.push(args), "[[]]") : fake.gh(args, file));
      await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(creates(fake.asked).length, 0);
    });

    // More than three reds one rerun cleared reads as a starved runner, not as that many flakes.
    describe("a rerun that clears more than three tests", () => {
      const P = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z ";
      const many = ["a", "b", "c", "d"].flatMap((x) => [`${P}test at tools/loop/tests/${x}.test.ts:9:5`, `${P}✖ breaks (2.1ms)`]).join("\n");
      const TITLE = `CI flake: 4 tests in run ${RED_RUN}`;

      test("files one issue for the run, and one gh listing before it", async () => {
        const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], log: many });
        await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
        assert.deepEqual(creates(asked).map(titleOf), [TITLE]);
        assert.equal(asked.filter((a) => kindOf(a) === "list").length, 1);
      });

      test("names at most twenty tests in the merge and the issue, both passed as files", async () => {
        const lots = Array.from({ length: 25 }, (_, i) => [`${P}test at tools/loop/tests/t${i}.test.ts:9:5`, `${P}✖ breaks (2.1ms)`]).flat().join("\n");
        const written: string[][] = [];
        const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], log: lots });
        await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh, written));
        const arm = merges(asked).find((a) => a.includes("--auto"))!;
        const [create] = creates(asked);
        for (const args of [arm, create]) {
          assert.ok(!args.includes("--body") && !args.some((a) => /^body=[^@]/.test(a)), `no inline body: ${args.join(" ")}`);
          const text = fileOf(written, args);
          assert.equal((text.match(/t\d+\.test\.ts › breaks/g) ?? []).length, 20, text);
          assert.match(text, /and 5 more/);
        }
      });

      test("and dedupes that issue by its title the same way", async () => {
        const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], log: many, open: [TITLE] });
        await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
        assert.equal(creates(asked).length, 0);
      });
    });

  });

  test("a rerun GitHub refuses hands the red back as it is", async () => {
    const said: string[] = [];
    const { gh, asked } = rollupFake({ views: [RED], log: UNNAMED, refuse: { rerun: "HTTP 403: Resource not accessible" } });
    const out = await runSettle(PENDING, (m: string) => said.push(m), 0, DEADLINE, io(gh));
    assert.equal(out.action, "hand-back");
    assert.ok(asked.some(isComment), "the fix round still gets its CI-RED");
    assert.ok(said.some((m) => /could not rerun/.test(m)));
  });
});

describe("arming waits for the reviewer", () => {
  const say = (text: string) => readLine(JSON.stringify({ type: "assistant", message: { id: text, content: [{ type: "text", text }] } }));
  const reviewer = (n: number) => [
    readLine(JSON.stringify({ type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "u1", subagent_type: "loop-review", description: "Review", prompt: `BRIEF review #${n} .worktrees/agent-${n} origin/main\n` })),
    readLine(JSON.stringify({ type: "system", subtype: "task_updated", task_id: "t1", patch: { status: "completed", end_time: 1 } })),
  ];
  const comments = [{ body: `REVIEW ${SHA.slice(0, 7)}\n\n## Blocking\n` }, { body: `VERDICT: LAND ${SHA.slice(0, 7)}` }];
  const git = (args: string[]) => {
    if (args[0] === "rev-list" && args[1] === "--count") return "1";
    if (args[0] === "diff") return "a.ts";
    return "";
  };
  const real = (facts: unknown[]) => {
    const { gh, asked } = rollupFake({ views: [GREEN], issueComments: comments });
    const run = (file: string, args: string[]) => (file === "git" ? git(args) : gh(args, file));
    return { asked, io: { ...io(gh), cleared: undefined, run, facts: () => facts } };
  };

  test("a LAND whose D round ran its reviewer is armed", async () => {
    const { asked, io: withFacts } = real([say("PHASE C"), say("PHASE D"), ...reviewer(PENDING.ticket)]);
    assert.equal((await runSettle(PENDING, () => {}, 0, DEADLINE, withFacts)).action, "already-merged");
    assert.equal(merges(asked).length, 1);
  });

  test("a LAND with no reviewer completed since the last build is the owner's, never armed", async () => {
    const built = readLine(JSON.stringify({ type: "assistant", message: { id: "c", content: [{ type: "tool_use", id: "u", name: "Bash", input: { command: "git commit -m fix" } }] } }));
    const { asked, io: withFacts } = real([...reviewer(PENDING.ticket), say("PHASE C"), built, say("PHASE D")]);
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, withFacts);
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /no loop-review or loop-fix completed for #1028/);
    assert.equal(merges(asked).length, 0);
  });
});

// Only `Date` is mocked: the pause between rounds stays a real timer, as it does across a standby.
describe("runSettle's own sleep across a standby", () => {
  const MIN = 60_000;

  test("a pause the machine slept through does not spend the deadline", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const { gh } = rollupFake({ views: [GATE_RUNNING, GREEN] });
    let reads = 0;
    const stateOf = (pr: number) => {
      if (++reads === 1) setTimeout(() => t.mock.timers.setTime(Date.now() + 120 * MIN), 10);
      return readLandingState(REPO, pr, (args) => gh(args), Date.now() + MIN);
    };
    const out = await runSettle(PENDING, () => {}, 30, MIN, { ...io(gh), stateOf });
    assert.equal(out.action, "already-merged", String(out.reason));
  });
});

describe("runSettle posts CI-RED once per red head", () => {
  const LINE = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z   1) [chromium] › tests/e2e/x.spec.ts:9:5 › some test";
  const redFake = (issueComments: { body: string }[] = []) => rollupFake({ views: [RED], log: LINE, issueComments });

  test("hand-back posts one CI-RED comment per red head", async () => {
    const written: string[][] = [];
    const { gh, asked } = redFake();
    await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh, written));
    const posted = asked.filter(isComment);
    assert.equal(posted.length, 1);
    const file = bodyFileOf(posted[0]);
    const body = written.find(([p]) => p === file)?.[1];
    assert.match(String(body), new RegExp(`^CI-RED ${SHA}`));
  });

  test("a CI-RED from before the newest claim is no CI-RED for this one: runSettle posts it again", async () => {
    const thread = [{ body: `CI-RED ${SHA}\nrun: x · step: y\nfailing: z` }, { body: "Claimed by `agent/1028-the-turn-chip`." }];
    const { gh, asked } = rollupFake({ views: [RED], log: LINE, attempt: 2, issueComments: thread });
    await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(asked.filter(isComment).length, 1);
  });

  test("the same head red twice posts once", async () => {
    const { gh, asked } = redFake([{ body: `CI-RED ${SHA}\nrun: x · step: y\nfailing: z` }]);
    await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(asked.filter(isComment).length, 0);
  });

  // The CI-RED is what starts a fix round, so a red handed back without one stalls the ticket.
  const failing = (what: (a: string[]) => boolean, times = Infinity) => {
    const fake = redFake();
    let left = times;
    const gh = (args: string[], file = "gh") => {
      if (what(args) && left-- > 0) {
        fake.asked.push(args);
        throw new Error("gh: connection reset");
      }
      return fake.gh(args, file);
    };
    return { ...fake, gh };
  };
  const isRead = (a: string[]) => kindOf(a) === "read";

  test("an unreadable tracker is asked again, never posted to blind, and then held rather than handed back", async () => {
    const { gh, asked } = failing(isRead);
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(asked.filter(isComment).length, 0);
    assert.ok(asked.filter(isRead).length > 1, "the tracker is read more than once");
    assert.equal(out.action, "hold");
    assert.equal(out.head, SHA);
  });

  test("a post that keeps failing is tried again, then held", async () => {
    const { gh, asked } = failing(isComment);
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.ok(asked.filter(isComment).length > 1, "the post is tried more than once");
    assert.equal(out.action, "hold");
  });

  test("a post that fails once and then lands hands the red back", async () => {
    const { gh, asked } = failing(isComment, 1);
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(asked.filter(isComment).length, 2);
    assert.equal(out.action, "hand-back");
  });

  // `output` is only the log's last 400 lines; `testIds` come from the full failed log.
  test("a failing id outside the 400-line tail still reaches the CI-RED body", async () => {
    const old = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z   1) [chromium] › tests/e2e/old.spec.ts:9:5 › ancient failure";
    const filler = Array.from({ length: 450 }, (_, i) => `Typecheck and tests\tTest\t2026-10-12T19:07:30Z filler ${i}`);
    const written: string[][] = [];
    const { gh, asked } = rollupFake({ views: [RED], log: [old, ...filler].join("\n") });
    await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh, written));
    const post = asked.find(isComment)!;
    const body = String(written.find(([p]) => p === bodyFileOf(post))?.[1]);
    assert.match(body, /^- tests\/e2e\/old\.spec\.ts$/m);
  });

  test("every gh call it makes past the read passes a bounded timeout", async () => {
    const calls: { args: string[]; opts?: { timeout?: number } }[] = [];
    const { gh } = redFake();
    const run = (file: string, args: string[], opts?: { timeout?: number }) => {
      if (file === "git") return "";
      calls.push({ args, opts });
      return gh(args, file);
    };
    await runSettle(PENDING, () => {}, 0, DEADLINE, { ...io(gh), run, mainFailures: undefined });
    assert.deepEqual(calls.map((c) => kindOf(c.args) ?? ciCall(c.args)?.kind ?? c.args.slice(0, 2).join(" ")), ["rerun", "runs", "read", "comment"]);
    for (const c of calls) assert.equal(c.opts?.timeout, 30_000);
  });
});

describe("a red head's failures that main has too", () => {
  const ID = "tests/e2e/x.spec.ts › some test";
  const HAND_BACK = { action: "hand-back", reason: "CI failed at Typecheck and tests", head: SHA, runId: RED_RUN };
  const red = (line = "1) [chromium] › tests/e2e/x.spec.ts:9:5 › some test") =>
    rollupFake({ views: [RED], log: `Typecheck and tests\tTest\t2026-10-12T19:07:30Z   ${line}` });
  const bodyOf = (asked: string[][], written: string[][]) => {
    const post = asked.find(isComment);
    return post ? String(written.find(([p]) => p === bodyFileOf(post))?.[1]) : null;
  };

  test("onMainLine names the overlap and main's run, in the branch's order", () => {
    assert.equal(onMainLine(["b", "a"], { url: "u", ids: ["a", "b", "c"] }), "2 of 2 also fail on main (u): b, a");
    assert.equal(onMainLine(["a", "z"], { url: "u", ids: ["a"] }), "1 of 2 also fail on main (u): a");
    assert.equal(onMainLine(["z"], { url: "u", ids: ["a"] }), "none");
    assert.equal(onMainLine(["a"], null), "none");
  });

  test("a failure main's latest run has too is named on CI-RED with main's run, and nothing blocks", async () => {
    const written: string[][] = [];
    const { gh, asked } = red();
    const main = { runId: 1, url: "https://example.test/runs/1", ids: [ID] };
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), mainFailures: () => main });
    assert.deepEqual(out, HAND_BACK);
    assert.match(String(bodyOf(asked, written)), /^on main: 1 of \d+ also fail on main \(https:\/\/example\.test\/runs\/1\): /m);
  });

  test("a failure the inherited run had at attempt 1 goes on its own flaky line, and on main: stays none", async () => {
    const written: string[][] = [];
    const { gh, asked } = red();
    const main = { runId: 1, url: "https://example.test/runs/1/attempts/1", ids: [ID], flaky: true };
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), mainFailures: () => main });
    assert.deepEqual(out, HAND_BACK);
    const body = String(bodyOf(asked, written));
    assert.match(body, /^on main: none$/m);
    assert.match(body, /^flaky on main: 1 of \d+ failed attempt 1 of main's rerun-won green \(https:\/\/example\.test\/runs\/1\/attempts\/1\): /m);
  });

  test("a main with nothing to give says none", async () => {
    const written: string[][] = [];
    const { gh, asked } = red();
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), mainFailures: () => null });
    assert.deepEqual(out, HAND_BACK);
    assert.match(String(bodyOf(asked, written)), /^on main: none$/m);
    assert.doesNotMatch(String(bodyOf(asked, written)), /flaky on main/);
  });

  test("a red with no failing test id never reads main", async () => {
    const written: string[][] = [];
    const { gh, asked } = red("error TS2322: Type 'string' is not assignable to type 'number'.");
    let reads = 0;
    const main = () => (reads++, { runId: 1, ids: [ID] });
    const out = await runSettle(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), mainFailures: main });
    assert.deepEqual(out, HAND_BACK, "a type error is a red a fix round can aim at");
    assert.equal(reads, 0);
    assert.match(String(bodyOf(asked, written)), /^on main: none$/m);
  });
});

describe("ciRedBody", () => {
  const runUrl = "https://github.com/metasito/murlan/actions/runs/1";

  // One long e2e id once ate a 200-character budget and hid two failing files behind `+10 more`.
  const long = [
    "tests/e2e/offlineMatch.spec.ts › offline vs bots — a match plays multiple rounds and exercises the exchange",
    "tests/tooling/fontSubset.test.ts › the subsets carry every character the app can render",
    "tests/tooling/iconSubset.test.ts › the shipped subsets carry a glyph for every name the app renders",
  ];

  test("names the head, the run and the step", () => {
    const body = ciRedBody({ sha: SHA, runUrl, failedStep: "Native tests", testIds: ["a.ts › b"], runId: 7 });
    const lines = body.split("\n");
    assert.equal(lines[0], `CI-RED ${SHA}`);
    assert.match(lines[1], /^run: .+ · step: Native tests$/);
    assert.match(body, /^on main: none$/m);
  });

  // queue.md lets a fix round call a failure its own only where a rerun failed it again.
  test("says whether the red survived a rerun, from the run's attempt", () => {
    const body = (attempt?: number) => ciRedBody({ sha: SHA, runUrl, failedStep: "Test", testIds: ["a.ts › b"], runId: 7, attempt });
    assert.match(body(2), /^rerun: survived one$/m);
    for (const attempt of [1, undefined]) assert.match(body(attempt), /^rerun: none$/m);
  });

  test("a hand-back's CI-RED carries the attempt it was read from", async () => {
    const written: string[][] = [];
    const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, RED] });
    await runSettle(PENDING, () => {}, 0, DEADLINE, io(gh, written));
    const post = asked.find(isComment)!;
    assert.match(String(written.find(([p]) => p === bodyFileOf(post))?.[1]), /^rerun: survived one$/m);
  });

  test("no failing file is dropped, however long the others are", () => {
    const body = ciRedBody({ sha: SHA, runUrl, failedStep: "Test", testIds: long, runId: 7 });
    assert.match(body, /tests\/tooling\/fontSubset\.test\.ts/);
    assert.match(body, /tests\/tooling\/iconSubset\.test\.ts/);
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

  test("a timed-out job's command reads that job's own log, which --log-failed leaves empty", () => {
    const logArgs = ["run", "view", "--job", "9", "--repo", "o/r", "--log"];
    const body = ciRedBody({ sha: SHA, runUrl, testIds: long, runId: 7, logArgs });
    assert.match(body, /^gh run view --job 9 --repo o\/r --log \| grep/m);
    assert.doesNotMatch(body, /--log-failed/);
  });

  test("the posted note says the job ran past its timeout-minutes, which its log reads as a cancel", async () => {
    const written: string[][] = [];
    const { gh } = rollupFake({ views: [RED] });
    const stateOf = () => ({
      pr: { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", headRefOid: SHA, armed: false },
      ci: {
        pass: false, runId: 7, head: SHA, failedStep: "Typecheck and tests", attempt: 2,
        output: "##[error]The operation was canceled.", reason: "Typecheck and tests ran past its timeout-minutes",
      },
      progress: { done: 0, total: 0, running: null, failed: null },
    });
    await runSettle(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), stateOf });
    assert.match(written[1]?.[1] ?? "", /^why: Typecheck and tests ran past its timeout-minutes$/m);
  });

  test("with no id parsed the excerpt is the only signal, so it stays and is fenced", () => {
    const body = ciRedBody({ sha: SHA, runUrl, testIds: [], excerpt: "error TS2322: nope", runId: 7 });
    assert.deepEqual(body.split("\n").slice(-3), ["```", "error TS2322: nope", "```"]);
  });

  // A stated count of zero is a target met by diagnosing nothing — the shape CLAUDE.md refuses.
  test("and it states no count, because zero is not one", () => {
    const body = ciRedBody({ sha: SHA, runUrl, testIds: [], excerpt: "error TS2322", runId: 7 });
    assert.doesNotMatch(body, /0 failing files/);
    assert.match(body, /^failing: no test id parsed/m);
  });
});

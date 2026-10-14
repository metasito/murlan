// tools/loop/tests/landReplay.test.ts
//
// The supervisor's dealings with GitHub, end to end. `readLandingState`, `landing` and `decide` are
// each unit-tested against hand-built inputs; here the real `readLandingState` runs against rollups
// recorded off live pull requests, the real `decide` routes each visit from a ledger the visits
// write to, and only the subprocess is fake. One `landOne` call is one pass's visit.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BREAKER, CI_ROUNDS, MAX_HANDOFFS, TICKET_HOLDS, USD_BY_SIZE, USD_DEFAULT, ciRedBody, landOne, onMainLine } from "../queue-loop.mjs";
import { decide, WAIT } from "../decide.mjs";
import { ticketTally } from "../loop-logs.mjs";
import { readLandingState } from "../ciVerdict.ts";
import { armArgs, disarmArgs } from "../land.ts";
import { readLine } from "../loop-stream.mjs";

const REPO = "metasito/murlan";
const N = 1028;
const PR = 1053;
const SHA = "5bb5dcf22b863994fc138ab773976e9539d78539";
const NEW = "9c0ffee22b863994fc138ab773976e9539d78539";
const LIMITS = { BREAKER, CI_ROUNDS, MAX_HANDOFFS, TICKET_HOLDS, USD_BY_SIZE, USD_DEFAULT, WAIT };

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
const ID = "tools/loop/tests/x.test.ts › breaks";

/**
 * One fake `gh` over a script of recorded rollups, one per `pr view`. The pull request's own state
 * — its head, arming and merge — and the issue thread are kept here and moved by the calls that move
 * them on GitHub, so a scenario reads back what the supervisor did across passes.
 */
function rollupFake({
  views,
  log = NAMED,
  attempt = 1,
  head = SHA,
  armed = false,
  autoMerges = false,
  refuse = {},
  issueComments = [],
  open = [],
}: {
  views: Fixture[];
  log?: string | null;
  attempt?: number;
  head?: string;
  armed?: boolean;
  autoMerges?: boolean;
  refuse?: { auto?: string; merge?: string; disarm?: string; rerun?: string; update?: string };
  issueComments?: { body: string }[];
  /** The titles of the open issues `issue list` answers with; `issue create` adds to it. */
  open?: string[];
}) {
  const asked: string[][] = [];
  const written: string[][] = [];
  const pr = { head, armed, merged: false, attempt };
  let read = 0;
  const fileOf = (args: string[]) => {
    const i = args.indexOf("--body-file");
    return i === -1 ? "" : (written.findLast(([p]) => p === args[i + 1])?.[1] ?? "");
  };
  const gh = (args: string[], file = "gh") => {
    assert.equal(file, "gh", `a ${file} call reached the gh fake: ${args.join(" ")}`);
    asked.push(args);
    const [cmd, sub] = args;
    if (cmd === "pr" && sub === "view") {
      const f = views[Math.min(read++, views.length - 1)];
      return JSON.stringify({
        ...f.view,
        headRefOid: pr.head,
        autoMergeRequest: pr.armed ? { mergeMethod: "MERGE" } : null,
        ...(pr.merged ? { state: "MERGED" } : {}),
      });
    }
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
      if (refuse.merge) throw new Error(refuse.merge);
      pr.merged = true;
      return "";
    }
    if (cmd === "pr" && sub === "update-branch") {
      if (refuse.update) throw new Error(refuse.update);
      pr.head = NEW;
      return "";
    }
    if (cmd === "run" && sub === "rerun") {
      if (refuse.rerun) throw new Error(refuse.rerun);
      pr.attempt += 1;
      return "";
    }
    if (cmd === "run" && sub === "view" && args.includes("--log-failed")) {
      if (log === null) throw new Error("gh: could not read the log");
      return log;
    }
    if (cmd === "run" && sub === "view" && args.includes("jobs")) return JSON.stringify(RED.jobs);
    if (cmd === "run" && sub === "view") return JSON.stringify({ ...RED.run, headSha: pr.head, attempt: pr.attempt });
    if (cmd === "run" && sub === "list") return "[]";
    if (cmd === "issue" && sub === "view") {
      return JSON.stringify({ comments: issueComments.map((c) => ({ authorAssociation: "OWNER", ...c })) });
    }
    if (cmd === "issue" && sub === "comment") {
      issueComments.push({ body: fileOf(args) });
      return "";
    }
    if (cmd === "issue" && sub === "list") return JSON.stringify(open.map((title, i) => ({ number: 2000 + i, title })));
    if (cmd === "issue" && sub === "create") {
      open.push(args[args.indexOf("--title") + 1]);
      return `https://github.com/${REPO}/issues/${1999 + open.length}\n`;
    }
    throw new Error(`the gh fake has no answer for: gh ${args.join(" ")}`);
  };
  return { gh, asked, pr, written, issueComments, fileOf };
}
type Fake = ReturnType<typeof rollupFake>;

const REVIEWED = (_sha: string) => ({ ok: true, why: "reviewed" });
type Row = { n: number; outcome: string; pr?: number; head?: string | null; flake?: object | null };
const PUSHED: Row = { n: N, outcome: "pushed", pr: PR, head: SHA };
const ARMED: Row = { n: N, outcome: "armed", pr: PR, head: SHA, flake: null };

/**
 * The ledger the passes share: each visit's tally is read from it, and the arm notes land in it.
 * The run's counters ride across visits as `main` carries them across passes.
 */
function ledger(rows: Row[] = [PUSHED]) {
  let loop: Record<string, any> = { failures: 0, holds: 0, waits: 0, overloads: 0, pinned: null, held: {} };
  const decideAt = (landing: object) => {
    const action = decide({ step: "landing", limits: LIMITS, now: Date.now(), asked: false, own: null, route: { n: N, size: "size:S" }, landing, tally: ticketTally(N, rows), loop });
    loop = action.loop;
    return action;
  };
  const note = (head: string, flake: object | null) => rows.push({ n: N, outcome: "armed", pr: PR, head, flake });
  return { rows, decideAt, note, loop: () => loop };
}

/** One pass's visit, the real `readLandingState` wired to the fake subprocess. */
function visit(fake: Fake, book: ReturnType<typeof ledger>, over: Record<string, unknown> = {}) {
  return landOne({ n: N, pr: PR }, book.decideAt, {
    run: (file: string, args: string[]) => (file === "git" ? "" : fake.gh(args, file)),
    stateOf: (pr: number) => readLandingState(REPO, pr, (args) => fake.gh(args), Date.now() + 60_000),
    write: (p: string, body: string) => fake.written.push([p, body]),
    mkdir: () => undefined,
    cleared: REVIEWED,
    mainFailures: () => null,
    note: book.note,
    log: () => {},
    ...over,
  });
}

const merges = (asked: string[][]) => asked.filter((a) => a[0] === "pr" && a[1] === "merge");
const reruns = (asked: string[][]) => asked.filter((a) => a[0] === "run" && a[1] === "rerun");
const creates = (asked: string[][]) => asked.filter((a) => a[0] === "issue" && a[1] === "create");
const indexOf = (asked: string[][], match: (a: string[]) => boolean) => asked.findIndex(match);
const isDisarm = (a: string[]) => a[1] === "merge" && a.includes("--disable-auto");
const isComment = (a: string[]) => a[0] === "issue" && a[1] === "comment";
const isUpdate = (a: string[]) => a[0] === "pr" && a[1] === "update-branch";

describe("a pull request in flight, one visit a pass", () => {
  test("green: armed at its head while CI runs, waited on, then landed once GitHub merges it", () => {
    const fake = rollupFake({ views: [GATE_RUNNING] });
    const book = ledger();
    const judged: string[] = [];
    const said: string[] = [];
    const armed = visit(fake, book, { cleared: (sha: string) => (judged.push(sha), REVIEWED(sha)), log: (m: string) => said.push(m) });
    assert.equal(armed.act, "arm");
    assert.deepEqual(merges(fake.asked), [armArgs(REPO, PR, SHA)]);
    assert.deepEqual(judged, [SHA], "the head armed is the head cleared");
    assert.ok(said.some((m) => /^PR #1053 · CI \d+ of \d+ jobs/.test(m)), `no CI progress line in ${JSON.stringify(said)}`);
    assert.equal(book.rows.at(-1)?.outcome, "armed", "the arm's row names the head the ledger checks the arm against");

    assert.equal(visit(fake, book).act, "wait");
    assert.equal(merges(fake.asked).length, 1, "an armed head is not armed again");

    fake.pr.merged = true;
    const landed = visit(fake, book);
    assert.equal(landed.kind, "landed");
    assert.equal(landed.flake, null);
  });

  test("red, rerun, green: the rerun keeps the arm, and the flake is filed once the merge is read back", () => {
    const fake = rollupFake({ views: [RED, GATE_RUNNING], armed: true });
    const book = ledger([PUSHED, ARMED]);
    assert.equal(visit(fake, book).act, "rerun");
    assert.deepEqual(reruns(fake.asked), [["run", "rerun", String(RED_RUN), "--failed", "--repo", REPO]]);
    assert.ok(!fake.asked.some(isDisarm) && !fake.asked.some(isComment), "a rerun is neither a disarm nor a fix round");

    assert.equal(visit(fake, book).act, "wait");
    assert.equal(creates(fake.asked).length, 0, "nothing is filed before the merge");

    fake.pr.merged = true;
    const landed = visit(fake, book);
    assert.equal(landed.kind, "landed");
    assert.deepEqual([landed.flake.runId, landed.flake.tests], [RED_RUN, [ID]]);
    const [create, ...more] = creates(fake.asked);
    assert.equal(more.length, 0);
    assert.equal(create[create.indexOf("--title") + 1], `CI flake: ${ID}`);
    assert.ok(create.includes("ready-for-human") && !create.includes("ci-flake"), "ADR 0011 keeps ci-flake the owner's");
  });

  test("red, rerun, red: disarmed, one CI-RED, and the fix round owed until a process runs", () => {
    const fake = rollupFake({ views: [RED], armed: true });
    const book = ledger([PUSHED, ARMED]);
    assert.equal(visit(fake, book).act, "rerun");

    const red = visit(fake, book);
    assert.equal(red.kind, "retry");
    assert.equal(red.head, SHA, "the retry row records the head CI judged");
    const disarm = indexOf(fake.asked, isDisarm);
    assert.ok(disarm !== -1 && disarm < indexOf(fake.asked, isComment), JSON.stringify(fake.asked));
    assert.equal(fake.pr.armed, false);
    assert.match(fake.issueComments[0].body, new RegExp(`^CI-RED ${SHA}[\\s\\S]*^rerun: survived one$`, "m"));
    assert.match(fake.written[0][0], /ci-1028\.log$/, "the log the fix round reads, written before the CI-RED");

    book.rows.push({ n: N, outcome: "retry", pr: PR, head: SHA });
    const owed = visit(fake, book);
    assert.equal(owed.kind, "fix");
    assert.equal(fake.asked.filter(isComment).length, 1, "the same head red twice posts once");
    assert.equal(reruns(fake.asked).length, 1);

    book.rows.push({ n: N, outcome: "handoff", pr: PR }, { n: N, outcome: "pushed", pr: PR, head: SHA });
    const stuck = visit(fake, book);
    assert.equal(stuck.kind, "park");
    assert.match(stuck.why, /^the fix round pushed no commit/);
  });

  test("behind: main is merged in, and the new head is cleared and armed, never the old one", () => {
    const fake = rollupFake({ views: [at(GREEN, { mergeStateStatus: "BEHIND" }), GATE_RUNNING] });
    const judged: string[] = [];
    const out = visit(fake, ledger(), { cleared: (sha: string) => (judged.push(sha), REVIEWED(sha)) });
    assert.equal(out.act, "arm");
    assert.deepEqual(fake.asked.find(isUpdate), ["pr", "update-branch", String(PR), "--repo", REPO]);
    assert.deepEqual(merges(fake.asked), [armArgs(REPO, PR, NEW)]);
    assert.deepEqual(judged, [NEW]);
  });

  test("behind and armed: disarmed before main is merged into it", () => {
    const fake = rollupFake({ views: [at(GREEN, { mergeStateStatus: "BEHIND" }), GATE_RUNNING], armed: true });
    visit(fake, ledger([PUSHED, ARMED]));
    const disarm = indexOf(fake.asked, isDisarm);
    assert.ok(disarm !== -1 && disarm < indexOf(fake.asked, isUpdate), JSON.stringify(fake.asked));
    assert.deepEqual(merges(fake.asked).at(-1), armArgs(REPO, PR, NEW));
  });

  test("an update-branch GitHub has not applied yet is not asked for twice in one visit", () => {
    const behind = at(GREEN, { mergeStateStatus: "BEHIND" });
    const fake = rollupFake({ views: [behind, behind] });
    const lagging = (args: string[], file = "gh") => (isUpdate(args) ? (fake.asked.push(args), "") : fake.gh(args, file));
    const out = visit({ ...fake, gh: lagging }, ledger());
    assert.equal(out.act, "update-branch");
    assert.equal(fake.asked.filter(isUpdate).length, 1);
  });

  test("conflicting: the owner's, disarmed first", () => {
    const fake = rollupFake({ views: [at(GREEN, { mergeable: "CONFLICTING" })], armed: true });
    const out = visit(fake, ledger([PUSHED, ARMED]));
    assert.equal(out.kind, "park");
    assert.equal(out.why, "the branch conflicts with main");
    assert.deepEqual(merges(fake.asked), [disarmArgs(REPO, PR)]);
    assert.equal(fake.pr.armed, false);
  });

  // `--match-head-commit` is checked when GitHub arms, and is not documented to be checked again at merge.
  describe("a head that moves under the arm", () => {
    test("is disarmed before anything else, and a moved head that is cleared is armed pinned to itself", () => {
      const fake = rollupFake({ views: [GATE_RUNNING], head: NEW, armed: true });
      const out = visit(fake, ledger([PUSHED, ARMED]));
      assert.equal(out.act, "arm");
      assert.deepEqual(merges(fake.asked), [disarmArgs(REPO, PR), armArgs(REPO, PR, NEW)]);
    });

    test("a moved head nobody cleared stays unarmed and is the owner's", () => {
      const fake = rollupFake({ views: [GATE_RUNNING], head: NEW, armed: true });
      const out = visit(fake, ledger([PUSHED, ARMED]), { cleared: (sha: string) => ({ ok: false, why: `no review of ${sha.slice(0, 7)}` }) });
      assert.equal(out.kind, "park");
      assert.match(out.why, /^no review of 9c0ffee — 9c0ffee was pushed for review, not cleared$/);
      assert.deepEqual(merges(fake.asked), [disarmArgs(REPO, PR)]);
      assert.equal(fake.pr.armed, false);
    });

    test("an arm the ledger has no note of is treated the same way", () => {
      const fake = rollupFake({ views: [GATE_RUNNING], armed: true });
      visit(fake, ledger());
      assert.deepEqual(merges(fake.asked), [disarmArgs(REPO, PR), armArgs(REPO, PR, SHA)]);
    });
  });
});

describe("arming", () => {
  test("the arm's row is written before the call that arms: an answer lost may have armed", () => {
    const fake = rollupFake({ views: [GATE_RUNNING], refuse: { auto: "gh: request canceled (Client.Timeout exceeded)" } });
    const book = ledger();
    const out = visit(fake, book);
    assert.equal(out.kind, "hold");
    assert.match(out.why, /^could not arm auto-merge — gh: request canceled/);
    assert.equal(book.rows.at(-1)?.outcome, "armed");
  });

  test("the clean-status refusal falls back to a merge still pinned to the head, and it lands", () => {
    const fake = rollupFake({ views: [GREEN], refuse: { auto: CLEAN_STATUS } });
    const out = visit(fake, ledger());
    assert.equal(out.kind, "landed");
    const [armed, direct] = merges(fake.asked);
    assert.deepEqual(armed, armArgs(REPO, PR, SHA));
    assert.deepEqual(direct, armArgs(REPO, PR, SHA).filter((a) => a !== "--auto"));
  });

  test("a merge refused both ways is held, and visited again next pass", () => {
    const fake = rollupFake({ views: [GREEN], refuse: { auto: CLEAN_STATUS, merge: "GraphQL: Base branch was modified" } });
    const out = visit(fake, ledger());
    assert.equal(out.kind, "hold");
    assert.match(out.why, /^the merge failed — GraphQL: Base branch was modified/);
  });

  test("a head landable does not clear is the owner's, says why, and is never armed", () => {
    const fake = rollupFake({ views: [GREEN] });
    const out = visit(fake, ledger(), { cleared: () => ({ ok: false, why: "no review of 5bb5dcf on the issue" }) });
    assert.equal(out.kind, "park");
    assert.match(out.why, /^no review of 5bb5dcf on the issue — .*not cleared/);
    assert.equal(merges(fake.asked).length, 0);
  });

  test("what cleared the head could not be read: a hold, never a park", () => {
    const fake = rollupFake({ views: [GREEN] });
    const out = visit(fake, ledger(), { cleared: () => { throw new Error("could not fetch refs/pull/1053/head"); } });
    assert.equal(out.kind, "hold");
    assert.equal(merges(fake.asked).length, 0);
  });

  describe("it waits for the reviewer", () => {
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
      const fake = rollupFake({ views: [GATE_RUNNING], issueComments: comments });
      const fetched: string[][] = [];
      const run = (file: string, args: string[]) => (file === "git" ? (fetched.push(args), git(args)) : fake.gh(args, file));
      return { fake, fetched, out: visit(fake, ledger(), { cleared: undefined, run, facts: () => facts }) };
    };

    test("a LAND whose D round ran its reviewer is armed, its head fetched from the pull request", () => {
      const { fake, fetched, out } = real([say("PHASE C"), say("PHASE D"), ...reviewer(N)]);
      assert.equal(out.act, "arm");
      assert.equal(merges(fake.asked).length, 1);
      assert.ok(fetched.some((a) => a[0] === "fetch" && a.includes(`refs/pull/${PR}/head`)), JSON.stringify(fetched));
    });

    test("a LAND with no reviewer completed since the last build is the owner's, never armed", () => {
      const { fake, out } = real([...reviewer(N), say("PHASE C"), say("PHASE D")]);
      assert.equal(out.kind, "park");
      assert.match(out.why, /no loop-review or loop-fix completed for #1028/);
      assert.equal(merges(fake.asked).length, 0);
    });
  });
});

describe("what a visit cannot move is held, and the hold is bounded", () => {
  test("a pull request someone else merged lands, red or not", () => {
    const fake = rollupFake({ views: [at(RED, { state: "MERGED" })] });
    assert.equal(visit(fake, ledger()).kind, "landed");
  });

  test("a read that fails is a hold, never a park", () => {
    const fake = rollupFake({ views: [GREEN] });
    const out = visit(fake, ledger(), { stateOf: () => { throw new Error("HTTP 401: Bad credentials"); } });
    assert.equal(out.kind, "hold");
    assert.match(out.why, /^could not read #1053 — HTTP 401/);
  });

  test(`red with no readable log is held, then the owner's after ${TICKET_HOLDS} passes in a row`, () => {
    const fake = rollupFake({ views: [RED], log: null, attempt: 2 });
    const book = ledger();
    for (let i = 1; i <= TICKET_HOLDS; i++) {
      const out = visit(fake, book);
      assert.equal(out.kind, "hold");
      assert.match(out.why, /^CI is red and its log could not be read — /);
      assert.equal(book.loop().held[N], i);
    }
    const parked = visit(fake, book);
    assert.equal(parked.kind, "park");
    assert.match(parked.why, new RegExp(`, ${TICKET_HOLDS + 1} times running$`));
    assert.equal(book.loop().held[N], undefined);
    assert.equal(book.loop().failures, 1);
  });

  test("a head no check reports on is held while armed, and asked again next pass", () => {
    const fake = rollupFake({ views: [at(ABSENT, { statusCheckRollup: [] })], armed: true });
    const out = visit(fake, ledger([PUSHED, ARMED]));
    assert.equal(out.kind, "hold");
  });

  test("a disarm GitHub refuses is held, says it may still merge, and starts no fix round", () => {
    const fake = rollupFake({ views: [RED], armed: true, attempt: 2, refuse: { disarm: "HTTP 502" } });
    const out = visit(fake, ledger([PUSHED, ARMED]));
    assert.equal(out.kind, "hold");
    assert.match(out.why, /could not disarm auto-merge; it may still merge — HTTP 502/);
    assert.ok(!fake.asked.some(isComment), "no fix round may start on a pull request still armed");
  });

  test("a disarm refused because the pull request merged reads as merged on the next visit", () => {
    const fake = rollupFake({ views: [RED], armed: true, attempt: 2, refuse: { disarm: "GraphQL: Pull request is already merged" } });
    const book = ledger([PUSHED, ARMED]);
    assert.equal(visit(fake, book).kind, "hold");
    fake.pr.merged = true;
    assert.equal(visit(fake, book).kind, "landed");
    assert.ok(!fake.asked.some(isComment), "a merged pull request has no fix round");
  });

  test("an update-branch GitHub refuses is held", () => {
    const fake = rollupFake({ views: [at(GREEN, { mergeStateStatus: "BEHIND" })], refuse: { update: "HTTP 422" } });
    const out = visit(fake, ledger());
    assert.equal(out.kind, "hold");
    assert.match(out.why, /^could not update the branch — HTTP 422/);
  });
});

describe("a red is rerun once per head", () => {
  test("a red already on its second attempt is not rerun again, whoever reran it", () => {
    const fake = rollupFake({ views: [RED], log: UNNAMED, attempt: 2 });
    assert.equal(visit(fake, ledger()).kind, "retry");
    assert.equal(reruns(fake.asked).length, 0);
  });

  test("a rerun GitHub refuses hands the red back as it is, with its CI-RED", () => {
    const said: string[] = [];
    const fake = rollupFake({ views: [RED], log: UNNAMED, refuse: { rerun: "HTTP 403: Resource not accessible" } });
    const out = visit(fake, ledger(), { log: (m: string) => said.push(m) });
    assert.equal(out.kind, "retry");
    assert.ok(fake.asked.some(isComment), "the fix round still gets its CI-RED");
    assert.ok(said.some((m) => /could not rerun/.test(m)));
    assert.match(fake.issueComments[0].body, /^rerun: none$/m);
  });

  test("a red handed back after its rerun is no flake when its fix lands", () => {
    const fake = rollupFake({ views: [RED] });
    const book = ledger();
    visit(fake, book);
    visit(fake, book);
    book.rows.push({ n: N, outcome: "retry", pr: PR, head: SHA }, { n: N, outcome: "pushed", pr: PR, head: NEW });
    fake.pr.head = NEW;
    fake.pr.merged = true;
    const landed = visit(fake, book);
    assert.equal(landed.kind, "landed");
    assert.equal(landed.flake, null);
    assert.equal(creates(fake.asked).length, 0);
  });

  test(`the round after the last of ${CI_ROUNDS} is the owner's, with the CI log`, () => {
    const fake = rollupFake({ views: [RED], attempt: 2 });
    const rows: Row[] = [PUSHED];
    for (let i = 1; i < CI_ROUNDS; i++) rows.push({ n: N, outcome: "retry", pr: PR, head: `h${i}` }, { n: N, outcome: "pushed", pr: PR, head: SHA });
    const out = visit(fake, ledger(rows));
    assert.equal(out.kind, "park");
    assert.equal(out.ciRed, true);
    assert.match(fake.written[0][0], /ci-1028\.log$/);
  });
});

describe("a red a rerun turned green is a flake, filed once", () => {
  const merged = (over: Parameters<typeof rollupFake>[0], flake: object = { runId: RED_RUN, tests: [ID], step: "Test" }, head = SHA) => {
    const fake = rollupFake({ ...over, views: [at(GREEN, { state: "MERGED" })] });
    const out = visit(fake, ledger([PUSHED, { ...ARMED, head, flake }]));
    return { fake, out };
  };

  test("a restart that finds it merged still files the issue and names the flake", () => {
    const { fake, out } = merged({ views: [] });
    assert.deepEqual([out.flake?.runId, out.flake?.tests], [RED_RUN, [ID]]);
    assert.equal(creates(fake.asked).length, 1);
  });

  test("one ledgered for another head is not this merge's", () => {
    const { fake, out } = merged({ views: [] }, undefined, NEW);
    assert.equal(out.flake, null);
    assert.equal(creates(fake.asked).length, 0);
  });

  test("a head re-armed after its rerun keeps the rerun's flake", () => {
    const fake = rollupFake({ views: [at(GREEN, { state: "MERGED" })] });
    const out = visit(fake, ledger([PUSHED, { ...ARMED, flake: { runId: RED_RUN, tests: [ID], step: "Test" } }, ARMED]));
    assert.deepEqual(out.flake?.tests, [ID]);
  });

  test("a test already filed open is not filed again", () => {
    const { fake } = merged({ views: [], open: [`CI flake: ${ID}`] });
    assert.equal(creates(fake.asked).length, 0);
  });

  // Promotion swaps `ready-for-human` for `ci-flake`, so a listing by either label misses it.
  test("a test filed and since promoted is not filed again, whatever its labels", () => {
    const fake = rollupFake({ views: [at(GREEN, { state: "MERGED" })], open: [`CI flake: ${ID}`] });
    const gh = (args: string[], file = "gh") => (args[1] === "list" && args.includes("--label") ? (fake.asked.push(args), "[]") : fake.gh(args, file));
    visit({ ...fake, gh }, ledger([PUSHED, { ...ARMED, flake: { runId: RED_RUN, tests: [ID], step: "Test" } }]));
    assert.equal(creates(fake.asked).length, 0);
  });

  // More than three reds one rerun cleared reads as a starved runner, not as that many flakes.
  describe("a rerun that clears more than three tests", () => {
    const TITLE = `CI flake: 4 tests in run ${RED_RUN}`;
    const four = ["a", "b", "c", "d"].map((x) => `tools/loop/tests/${x}.test.ts › breaks`);

    test("files one issue for the run, and one gh listing before it", () => {
      const { fake } = merged({ views: [] }, { runId: RED_RUN, tests: four, step: "Test" });
      assert.deepEqual(creates(fake.asked).map((c) => c[c.indexOf("--title") + 1]), [TITLE]);
      assert.equal(fake.asked.filter((a) => a[0] === "issue" && a[1] === "list").length, 1);
    });

    test("names at most twenty tests in the issue, passed as a file", () => {
      const lots = Array.from({ length: 25 }, (_, i) => `tools/loop/tests/t${i}.test.ts › breaks`);
      const { fake } = merged({ views: [] }, { runId: RED_RUN, tests: lots, step: "Test" });
      const [create] = creates(fake.asked);
      assert.ok(!create.includes("--body"), `no inline body: ${create.join(" ")}`);
      const text = fake.fileOf(create);
      assert.equal((text.match(/t\d+\.test\.ts › breaks/g) ?? []).length, 20, text);
      assert.match(text, /and 5 more/);
    });

    test("and dedupes that issue by its title the same way", () => {
      const { fake } = merged({ views: [], open: [TITLE] }, { runId: RED_RUN, tests: four, step: "Test" });
      assert.equal(creates(fake.asked).length, 0);
    });
  });
});

describe("a red's CI-RED, posted once per head", () => {
  const LINE = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z   1) [chromium] › tests/e2e/x.spec.ts:9:5 › some test";
  const redFake = (issueComments: { body: string }[] = []) => rollupFake({ views: [RED], log: LINE, attempt: 2, issueComments });

  test("a CI-RED from before the newest claim is no CI-RED for this one: it is posted again", () => {
    const thread = [{ body: `CI-RED ${SHA}\nrun: x · step: y\nfailing: z` }, { body: "Claimed by `agent/1028-the-turn-chip`." }];
    const fake = redFake(thread);
    visit(fake, ledger());
    assert.equal(fake.asked.filter(isComment).length, 1);
  });

  test("one already posted for this head is not posted again", () => {
    const fake = redFake([{ body: `CI-RED ${SHA}\nrun: x · step: y\nfailing: z` }]);
    assert.equal(visit(fake, ledger()).kind, "retry");
    assert.equal(fake.asked.filter(isComment).length, 0);
  });

  // The CI-RED is what starts a fix round, so a red handed back without one stalls the ticket.
  const failing = (what: (a: string[]) => boolean) => {
    const fake = redFake();
    const gh = (args: string[], file = "gh") => {
      if (what(args)) {
        fake.asked.push(args);
        throw new Error("gh: connection reset");
      }
      return fake.gh(args, file);
    };
    return { ...fake, gh };
  };

  test("an unreadable tracker is never posted to blind: the red is held, its head with it", () => {
    const fake = failing((a) => a[0] === "issue" && a[1] === "view");
    const out = visit(fake, ledger());
    assert.equal(fake.asked.filter(isComment).length, 0);
    assert.equal(out.kind, "hold");
    assert.equal(out.head, SHA);
  });

  test("a post that fails is held, and the next pass posts it", () => {
    const fake = failing(isComment);
    const book = ledger();
    const out = visit(fake, book);
    assert.equal(out.kind, "hold");
    assert.match(out.why, /^CI-RED for 5bb5dcf could not be posted/);
    const healed = redFake();
    assert.equal(visit(healed, book).kind, "retry");
    assert.equal(healed.asked.filter(isComment).length, 1);
  });

  // `output` is only the log's last 400 lines; `testIds` come from the full failed log.
  test("a failing id outside the 400-line tail still reaches the CI-RED body", () => {
    const old = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z   1) [chromium] › tests/e2e/old.spec.ts:9:5 › ancient failure";
    const filler = Array.from({ length: 450 }, (_, i) => `Typecheck and tests\tTest\t2026-10-12T19:07:30Z filler ${i}`);
    const fake = rollupFake({ views: [RED], log: [old, ...filler].join("\n"), attempt: 2 });
    visit(fake, ledger());
    assert.match(fake.issueComments[0].body, /^- tests\/e2e\/old\.spec\.ts$/m);
  });

  test("every gh call it makes past the read passes a bounded timeout", () => {
    const calls: { args: string[]; opts?: { timeout?: number } }[] = [];
    const fake = redFake();
    const run = (file: string, args: string[], opts?: { timeout?: number }) => {
      if (file === "git") return "";
      calls.push({ args, opts });
      return fake.gh(args, file);
    };
    visit(fake, ledger(), { run, mainFailures: undefined });
    assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["issue view", "run list", "issue comment"]);
    for (const c of calls) assert.equal(c.opts?.timeout, 30_000);
  });

  test("the posted note says the job ran past its timeout-minutes, which its log reads as a cancel", () => {
    const fake = rollupFake({ views: [RED] });
    const stateOf = () => ({
      pr: { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", headRefOid: SHA, armed: false },
      ci: {
        pass: false, runId: 7, head: SHA, failedStep: "Typecheck and tests", attempt: 2,
        output: "##[error]The operation was canceled.", reason: "Typecheck and tests ran past its timeout-minutes",
      },
    });
    visit(fake, ledger(), { stateOf });
    assert.match(fake.issueComments[0]?.body ?? "", /^why: Typecheck and tests ran past its timeout-minutes$/m);
  });
});

describe("a red head's failures that main has too", () => {
  const ID_E2E = "tests/e2e/x.spec.ts › some test";
  const red = (line = "1) [chromium] › tests/e2e/x.spec.ts:9:5 › some test") =>
    rollupFake({ views: [RED], attempt: 2, log: `Typecheck and tests\tTest\t2026-10-12T19:07:30Z   ${line}` });

  test("onMainLine names the overlap and main's run, in the branch's order", () => {
    assert.equal(onMainLine(["b", "a"], { url: "u", ids: ["a", "b", "c"] }), "2 of 2 also fail on main (u): b, a");
    assert.equal(onMainLine(["a", "z"], { url: "u", ids: ["a"] }), "1 of 2 also fail on main (u): a");
    assert.equal(onMainLine(["z"], { url: "u", ids: ["a"] }), "none");
    assert.equal(onMainLine(["a"], null), "none");
  });

  test("a failure main's latest run has too is named on CI-RED with main's run, and nothing blocks", () => {
    const fake = red();
    const main = { runId: 1, url: "https://example.test/runs/1", ids: [ID_E2E] };
    assert.equal(visit(fake, ledger(), { mainFailures: () => main }).kind, "retry");
    assert.match(fake.issueComments[0].body, /^on main: 1 of \d+ also fail on main \(https:\/\/example\.test\/runs\/1\): /m);
  });

  test("a failure the inherited run had at attempt 1 goes on its own flaky line, and on main: stays none", () => {
    const fake = red();
    const main = { runId: 1, url: "https://example.test/runs/1/attempts/1", ids: [ID_E2E], flaky: true };
    assert.equal(visit(fake, ledger(), { mainFailures: () => main }).kind, "retry");
    const body = fake.issueComments[0].body;
    assert.match(body, /^on main: none$/m);
    assert.match(body, /^flaky on main: 1 of \d+ failed attempt 1 of main's rerun-won green \(https:\/\/example\.test\/runs\/1\/attempts\/1\): /m);
  });

  test("a main with nothing to give says none", () => {
    const fake = red();
    visit(fake, ledger(), { mainFailures: () => null });
    assert.match(fake.issueComments[0].body, /^on main: none$/m);
    assert.doesNotMatch(fake.issueComments[0].body, /flaky on main/);
  });

  test("a red with no failing test id never reads main", () => {
    const fake = red("error TS2322: Type 'string' is not assignable to type 'number'.");
    let reads = 0;
    const out = visit(fake, ledger(), { mainFailures: () => (reads++, { runId: 1, ids: [ID_E2E] }) });
    assert.equal(out.kind, "retry", "a type error is a red a fix round can aim at");
    assert.equal(reads, 0);
    assert.match(fake.issueComments[0].body, /^on main: none$/m);
  });
});

describe("ciRedBody", () => {
  const runUrl = "https://github.com/metasito/murlan/actions/runs/1";

  // One long e2e id once ate a 200-character budget and hid two failing files behind `+10 more`.
  const long = [
    "tests/e2e/offlineMatch.spec.ts › offline vs AI — a match plays multiple hands and exercises the exchange",
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

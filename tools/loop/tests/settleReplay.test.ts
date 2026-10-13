// tools/loop/tests/settleReplay.test.ts
//
// The supervisor's dealings with GitHub, end to end. `readLandingState`, `landing` and `poll` are
// each unit-tested against hand-built inputs; here the real `readLandingState` runs against rollups
// recorded off live pull requests, and only the subprocess is fake.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ciRedBody, onMainLine, poll, SETTLE_ROUNDS } from "../queue-loop.mjs";
import { readLandingState } from "../ciVerdict.ts";
import { armArgs, disarmArgs } from "../land.ts";
import { readLine } from "../loop-stream.mjs";

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
 * — its head, draft, arming and merge — is kept here and moved by the calls that move it on GitHub,
 * so a scenario reads back what the supervisor did to it.
 */
function rollupFake({
  views,
  log = NAMED,
  attempt = 1,
  armed = false,
  draft = false,
  autoMerges = true,
  refuse = {},
  issueComments = [],
  deleted = false,
  open = [],
}: {
  deleted?: boolean;
  /** The titles of the open issues `issue list` answers with; `issue create` adds to it. */
  open?: string[];
  views: Fixture[];
  log?: string | null;
  attempt?: number;
  armed?: boolean;
  draft?: boolean;
  autoMerges?: boolean;
  refuse?: { auto?: string; merge?: string; disarm?: string; ready?: boolean; rerun?: string };
  issueComments?: { body: string }[];
}) {
  const asked: string[][] = [];
  const pr = { head: SHA, armed, draft, merged: false, attempt };
  let read = 0;
  let branchGone = deleted;
  const gh = (args: string[], file = "gh") => {
    assert.equal(file, "gh", `a ${file} call reached the gh fake: ${args.join(" ")}`);
    asked.push(args);
    const [cmd, sub] = args;
    if (cmd === "pr" && sub === "view") {
      const f = views[Math.min(read++, views.length - 1)];
      return JSON.stringify({
        ...f.view,
        headRefOid: pr.head,
        isDraft: pr.draft,
        autoMergeRequest: pr.armed ? { mergeMethod: "MERGE" } : null,
        ...(pr.draft ? { mergeStateStatus: "DRAFT" } : {}),
        ...(pr.merged ? { state: "MERGED" } : {}),
      });
    }
    if (cmd === "pr" && sub === "merge") {
      if (args.includes("--disable-auto")) {
        if (refuse.disarm) throw new Error(refuse.disarm);
        pr.armed = false;
        return "";
      }
      if (pr.draft) throw new Error("GraphQL: Pull request is in draft state");
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
    if (cmd === "pr" && sub === "ready") {
      if (!refuse.ready) pr.draft = false;
      return "";
    }
    if (cmd === "pr" && sub === "update-branch") {
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
    if (cmd === "issue" && sub === "comment") return "";
    if (cmd === "issue" && sub === "list") return JSON.stringify(open.map((title, i) => ({ number: 2000 + i, title })));
    if (cmd === "issue" && sub === "create") {
      open.push(args[args.indexOf("--title") + 1]);
      return `https://github.com/${REPO}/issues/${1999 + open.length}\n`;
    }
    if (cmd === "api" && args.includes("DELETE")) {
      if (branchGone) throw new Error("gh: Reference does not exist (HTTP 422)");
      branchGone = true;
      return "";
    }
    throw new Error(`the gh fake has no answer for: gh ${args.join(" ")}`);
  };
  return { gh, asked, pr };
}

const REVIEWED = (_sha: string) => ({ ok: true, why: "reviewed" });

/** `poll`'s io, with the real `readLandingState` wired to the fake subprocess. */
const io = (gh: (args: string[], file?: string) => string, written: string[][] = [], cleared: (sha: string) => { ok: boolean; why: string } = REVIEWED) => ({
  run: (file: string, args: string[]) => (file === "git" ? "" : gh(args, file)),
  stateOf: (pr: number) => readLandingState(REPO, pr, (args) => gh(args), Date.now() + 60_000),
  write: (p: string, body: string) => written.push([p, body]),
  mkdir: () => undefined,
  cleared,
  mainFailures: () => null,
});

const DEADLINE = 60_000;
const merges = (asked: string[][]) => asked.filter((a) => a[0] === "pr" && a[1] === "merge");
const indexOf = (asked: string[][], match: (a: string[]) => boolean) => asked.findIndex(match);
const isDisarm = (a: string[]) => a[1] === "merge" && a.includes("--disable-auto");
const isComment = (a: string[]) => a[0] === "issue" && a[1] === "comment";

describe("settle, replayed against recorded rollups", () => {
  test("a gate still running is waited on, then handed back once it is red — with its log", async () => {
    const said: string[] = [];
    const written: string[][] = [];
    const { gh } = rollupFake({ views: [ABSENT, GATE_RUNNING, RED] });
    const out = await poll(PENDING, (m: string) => said.push(m), 0, DEADLINE, io(gh, written));
    assert.equal(out.action, "hand-back");
    assert.ok(said.some((m) => /^PR #1053 · CI \d+ of \d+ jobs/.test(m)), `no CI progress line in ${JSON.stringify(said)}`);
    assert.ok(said.some((m) => /CI gate has not reported/.test(m)) && said.some((m) => /CI gate is in_progress/.test(m)));
    assert.equal((out as { head?: string }).head, SHA, "the retry row records the head CI judged");
    assert.match(String(out.reason), /Typecheck and tests/);
    assert.equal(written.length, 2, "the log, plus the CI-RED note posted alongside it");
    assert.match(written[0][0], /ci-1028\.log$/);
  });

  test("a cleared green head is armed pinned to that head, and GitHub's merge lands it", async () => {
    const { gh, asked } = rollupFake({ views: [GREEN] });
    const judged: string[] = [];
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh, [], (sha) => (judged.push(sha), REVIEWED(sha))));
    assert.equal(out.action, "already-merged");
    assert.deepEqual(merges(asked), [armArgs(REPO, PENDING.pr, SHA)]);
    assert.deepEqual(judged, [SHA], "the head the gate passed is the head cleared");
  });

  test("the clean-status refusal falls back to a merge still pinned to the head", async () => {
    const { gh, asked } = rollupFake({ views: [GREEN], refuse: { auto: CLEAN_STATUS } });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "already-merged");
    const [armed, direct] = merges(asked);
    assert.deepEqual(armed, armArgs(REPO, PENDING.pr, SHA));
    assert.deepEqual(direct, armArgs(REPO, PENDING.pr, SHA).filter((a) => a !== "--auto"));
  });

  test("a merge refused both ways is the owner's", async () => {
    const { gh } = rollupFake({ views: [GREEN], refuse: { auto: CLEAN_STATUS, merge: "GraphQL: Base branch was modified" } });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /the merge failed — GraphQL: Base branch was modified/);
  });

  test("a green head landable does not clear is the owner's, says why, and is never armed", async () => {
    const { gh, asked } = rollupFake({ views: [GREEN] });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh, [], () => ({ ok: false, why: "no review of 5bb5dcf on the issue" })));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /^no review of 5bb5dcf on the issue — .*not cleared/);
    assert.ok(!asked.some((a) => a[1] === "merge" || a[1] === "ready"));
  });

  test("a green draft is marked ready, and armed only on a later read of the head the gate passed", async () => {
    const { gh, asked } = rollupFake({ views: [GREEN], draft: true });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "already-merged");
    const order = asked.filter((a) => a[1] === "ready" || a[1] === "merge" || a[1] === "view");
    assert.deepEqual(order.slice(0, 4).map((a) => a[1]), ["view", "ready", "view", "merge"]);
    assert.deepEqual(order[3], armArgs(REPO, PENDING.pr, SHA));
  });

  test("a draft found behind main once it is ready is updated before anything is armed", async () => {
    const { gh, asked } = rollupFake({ views: [GREEN, at(GREEN, { mergeStateStatus: "BEHIND" }), GREEN], draft: true });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "already-merged");
    assert.ok(indexOf(asked, (a) => a[1] === "update-branch") < indexOf(asked, (a) => a[1] === "merge"), JSON.stringify(asked));
    assert.deepEqual(merges(asked), [armArgs(REPO, PENDING.pr, NEW)]);
  });

  test("a draft gh pr ready could not move is the owner's, and is never armed", async () => {
    const { gh, asked } = rollupFake({ views: [GREEN], draft: true, refuse: { ready: true } });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /still a draft/);
    assert.equal(asked.filter((a) => a[1] === "ready").length, SETTLE_ROUNDS.ready);
    assert.equal(merges(asked).length, 0);
  });

  describe("a merged branch is deleted, and its deletion confirmed", () => {
    const merged = (deleted: boolean, lsRemote = "") => {
      const fake = rollupFake({ views: [at(GREEN, { state: "MERGED" })], deleted });
      const said: string[] = [];
      const gits: string[][] = [];
      const gitOpts: ({ timeout?: number } | undefined)[] = [];
      const run = (file: string, args: string[], opts?: { timeout?: number }) =>
        file === "git" ? (gits.push(args), gitOpts.push(opts), lsRemote) : fake.gh(args, file);
      return { ...fake, said, gits, gitOpts, io: { ...io(fake.gh), run }, log: (m: string) => said.push(m) };
    };

    test("the look on origin is bounded, as every other call the supervisor makes is", async () => {
      const { gitOpts, io: withGit, log } = merged(false);
      await poll(PENDING, log, 0, DEADLINE, withGit);
      assert.ok((gitOpts[0]?.timeout ?? 0) > 0, JSON.stringify(gitOpts));
    });
    const deletes = (asked: string[][]) => asked.filter((a) => a[0] === "api" && a.includes("DELETE"));

    test("the branch is deleted on origin, then looked for there", async () => {
      const { asked, gits, said, io: withGit, log } = merged(false);
      assert.equal((await poll(PENDING, log, 0, DEADLINE, withGit)).action, "already-merged");
      assert.deepEqual(deletes(asked), [["api", "-X", "DELETE", `repos/${REPO}/git/refs/heads/${PENDING.branch}`]]);
      assert.deepEqual(gits, [["ls-remote", "origin", PENDING.branch]]);
      assert.ok(!said.some((m) => /still on origin/.test(m)), JSON.stringify(said));
    });

    test("a branch GitHub already deleted is no failure", async () => {
      const { asked, said, io: withGit, log } = merged(true);
      assert.equal((await poll(PENDING, log, 0, DEADLINE, withGit)).action, "already-merged");
      assert.equal(deletes(asked).length, 1);
      assert.ok(!said.some((m) => /still on origin/.test(m)), JSON.stringify(said));
    });

    test("a branch still on origin after the delete is said out loud", async () => {
      const { said, io: withGit, log } = merged(false, `${SHA}\trefs/heads/${PENDING.branch}\n`);
      assert.equal((await poll(PENDING, log, 0, DEADLINE, withGit)).action, "already-merged");
      assert.ok(said.some((m) => m.includes(`${PENDING.branch} is still on origin`)), JSON.stringify(said));
    });
  });

  test("a pull request someone else merged is not a fix round", async () => {
    const { gh } = rollupFake({ views: [at(RED, { state: "MERGED" })] });
    assert.equal((await poll(PENDING, () => {}, 0, DEADLINE, io(gh))).action, "already-merged");
  });

  // A red run whose log cannot be read is a fix round with nothing to fix.
  test("red CI with no readable log goes to the owner, not to a fix round", async () => {
    const said: string[] = [];
    const { gh } = rollupFake({ views: [RED], log: null });
    const out = await poll(PENDING, (m: string) => said.push(m), 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /log could not be read/);
    assert.equal(said.filter((s) => /named no log/.test(s)).length, SETTLE_ROUNDS.retry);
  });

  test("a head no check has reported on is bounded by its own budget, not by the deadline", async () => {
    const said: string[] = [];
    const { gh } = rollupFake({ views: [at(ABSENT, { statusCheckRollup: [] })] });
    const out = await poll(PENDING, (m: string) => said.push(m), 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.equal(said.length, SETTLE_ROUNDS.appear, "it asks its budget and stops, never the deadline");
  });

  test("update-branch re-arms on the new head, never the old one", async () => {
    const { gh, asked } = rollupFake({ views: [at(GREEN, { mergeStateStatus: "BEHIND" }), GREEN] });
    const judged: string[] = [];
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh, [], (sha) => (judged.push(sha), REVIEWED(sha))));
    assert.equal(out.action, "already-merged");
    assert.ok(asked.some((a) => a[0] === "pr" && a[1] === "update-branch"), "the fake must see it");
    assert.deepEqual(merges(asked), [armArgs(REPO, PENDING.pr, NEW)]);
    assert.deepEqual(judged, [NEW]);
  });

  test("an armed branch is disarmed before main is merged into it", async () => {
    const { gh, asked } = rollupFake({ views: [at(GREEN, { mergeStateStatus: "BEHIND" }), GREEN], armed: true });
    await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    const disarm = indexOf(asked, isDisarm);
    const update = indexOf(asked, (a) => a[1] === "update-branch");
    assert.ok(disarm !== -1 && disarm < update, JSON.stringify(asked));
  });

  test("the deadline is reachable during a round", async () => {
    const { gh } = rollupFake({ views: [ABSENT] });
    const out = await poll(PENDING, () => {}, 0, -1, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /did not settle in/);
  });
});

describe("an armed pull request is disarmed on every way out but a merge", () => {
  test("a red is disarmed before its CI-RED is posted, which is what starts a fix round", async () => {
    const { gh, asked } = rollupFake({ views: [RED], armed: true });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "hand-back");
    const disarm = indexOf(asked, isDisarm);
    assert.ok(disarm !== -1 && disarm < indexOf(asked, isComment), JSON.stringify(asked));
    assert.deepEqual(asked[disarm], disarmArgs(REPO, PENDING.pr));
  });

  test("an owner's park and a missed deadline disarm too", async () => {
    for (const [views, deadline] of [[[at(GREEN, { state: "CLOSED" })], DEADLINE], [[GATE_RUNNING], 5]] as const) {
      const { gh, asked, pr } = rollupFake({ views: [...views], armed: true });
      const out = await poll(PENDING, () => {}, 0, deadline, io(gh));
      assert.equal(out.action, "owner");
      assert.ok(asked.some(isDisarm), JSON.stringify(asked));
      assert.equal(pr.armed, false);
    }
  });

  test("a head this process armed waits without arming again, and is disarmed when the deadline passes first", async () => {
    const { gh, asked, pr } = rollupFake({ views: [GREEN], autoMerges: false });
    const out = await poll(PENDING, () => {}, 0, 5, io(gh));
    assert.equal(out.action, "owner");
    assert.equal(merges(asked).filter((a) => a.includes("--auto")).length, 1);
    assert.equal(pr.armed, false);
  });

  // `--match-head-commit` is checked when GitHub arms, and is not documented to be checked again at merge.
  describe("a head that moves under an arm", () => {
    const moving = () => {
      const fake = rollupFake({ views: [GREEN], autoMerges: false });
      const gh = (args: string[], file = "gh") => {
        const out = fake.gh(args, file);
        if (args.includes("--auto")) fake.pr.head = NEW;
        return out;
      };
      return { ...fake, gh };
    };

    test("is disarmed before anything else, and the new head is not armed unless it is cleared", async () => {
      const { gh, asked, pr } = moving();
      const said: string[] = [];
      const judged: string[] = [];
      const cleared = (sha: string) => (judged.push(sha), sha === SHA ? REVIEWED(sha) : { ok: false, why: `no review of ${sha.slice(0, 7)}` });
      const out = await poll(PENDING, (m: string) => said.push(m), 0, DEADLINE, io(gh, [], cleared));
      assert.equal(out.action, "owner");
      assert.deepEqual(judged, [SHA, NEW]);
      assert.deepEqual(merges(asked), [armArgs(REPO, PENDING.pr, SHA), disarmArgs(REPO, PENDING.pr)]);
      assert.ok(!said.some((m) => /waiting for GitHub to merge/.test(m)), JSON.stringify(said));
      assert.equal(pr.armed, false);
    });

    test("a moved head that is cleared is armed again, pinned to itself", async () => {
      const { gh, asked } = moving();
      await poll(PENDING, () => {}, 0, 200, io(gh));
      assert.deepEqual(merges(asked).slice(0, 3), [armArgs(REPO, PENDING.pr, SHA), disarmArgs(REPO, PENDING.pr), armArgs(REPO, PENDING.pr, NEW)]);
    });
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
      const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(out.action, "owner");
      assert.match(String(out.reason), /the merge failed/);
      assert.ok(indexOf(asked, isDisarm) > indexOf(asked, (a) => a[1] === "merge" && !a.includes("--auto")), JSON.stringify(asked));
      assert.equal(pr.armed, false);
    });

    test("a disarm refused because nothing was armed is no failure", async () => {
      const { gh, asked } = silently(false, "GraphQL: Auto merge is not enabled for this pull request");
      const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
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
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "already-merged");
    assert.ok(!fake.asked.some(isComment), "a merged pull request has no fix round");
  });

  test("a disarm GitHub refuses is the owner's, and says the pull request may still merge", async () => {
    const { gh, asked } = rollupFake({ views: [RED], armed: true, refuse: { disarm: "HTTP 502" } });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /could not disarm auto-merge — HTTP 502/);
    assert.ok(!asked.some(isComment), "no fix round may start on a pull request still armed");
  });
});

describe("a red is rerun once per head", () => {
  const reruns = (asked: string[][]) => asked.filter((a) => a[0] === "run" && a[1] === "rerun");

  test("rerun once, then handed back when the rerun is red too", async () => {
    const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, RED], log: UNNAMED });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.deepEqual(reruns(asked), [["run", "rerun", String(RED_RUN), "--failed", "--repo", REPO]]);
    assert.equal(out.action, "hand-back");
  });

  test("a rerun that goes green is armed and lands", async () => {
    const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], log: UNNAMED });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(reruns(asked).length, 1);
    assert.equal(out.action, "already-merged");
  });

  describe("a red a rerun turned green is a flake, said everywhere it lands", () => {
    const ID = "tools/loop/tests/x.test.ts › breaks";
    const creates = (asked: string[][]) => asked.filter((a) => a[0] === "issue" && a[1] === "create");

    test("the settle names the run and its tests, the merge says so, and one issue is filed per test", async () => {
      const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN] });
      const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(out.action, "already-merged");
      assert.deepEqual(out.flake, { runId: RED_RUN, tests: [ID] });
      const arm = merges(asked).find((a) => a.includes("--auto"))!;
      assert.match(arm[arm.indexOf("--body") + 1] ?? "", new RegExp(`${RED_RUN}[\\s\\S]*x\\.test\\.ts › breaks`));
      const [create, ...more] = creates(asked);
      assert.equal(more.length, 0);
      assert.equal(create[create.indexOf("--title") + 1], `CI flake: ${ID}`);
      const mergedAt = asked.findIndex((a, i) => i > indexOf(asked, (b) => b.includes("--auto")) && a[1] === "view" && a[0] === "pr");
      assert.ok(indexOf(asked, (a) => a[1] === "create") > mergedAt, "filed once the merge is read back, never before it");
    });

    // The issue says the pull request merged on that green; the ledger row is the record either way.
    test("a merge that fails files nothing, and the settle still names the flake", async () => {
      const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], refuse: { auto: CLEAN_STATUS, merge: "GraphQL: Base branch was modified" } });
      const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(out.action, "owner");
      assert.deepEqual(out.flake, { runId: RED_RUN, tests: [ID] });
      assert.equal(creates(asked).length, 0);
    });

    test("a test already filed open is not filed again", async () => {
      const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], open: [`CI flake: ${ID}`] });
      await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(creates(asked).length, 0);
    });

    // Promotion swaps `ready-for-human` for `ci-flake`, so a listing by either label misses it.
    test("a test filed and since promoted is not filed again, whatever its labels", async () => {
      const fake = rollupFake({ views: [RED, GATE_RUNNING, GREEN], open: [`CI flake: ${ID}`] });
      const gh = (args: string[], file = "gh") => (args[1] === "list" && args.includes("--label") ? (fake.asked.push(args), "[]") : fake.gh(args, file));
      await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(creates(fake.asked).length, 0);
    });

    // More than three reds one rerun cleared reads as a starved runner, not as that many flakes.
    describe("a rerun that clears more than three tests", () => {
      const P = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z ";
      const many = ["a", "b", "c", "d"].flatMap((x) => [`${P}test at tools/loop/tests/${x}.test.ts:9:5`, `${P}✖ breaks (2.1ms)`]).join("\n");
      const TITLE = `CI flake: 4 tests in run ${RED_RUN}`;

      test("files one issue for the run, and one gh listing before it", async () => {
        const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], log: many });
        await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
        assert.deepEqual(creates(asked).map((c) => c[c.indexOf("--title") + 1]), [TITLE]);
        assert.equal(asked.filter((a) => a[0] === "issue" && a[1] === "list").length, 1);
      });

      test("and dedupes that issue by its title the same way", async () => {
        const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, GREEN], log: many, open: [TITLE] });
        await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
        assert.equal(creates(asked).length, 0);
      });
    });

    test("a red handed back after its rerun is no flake", async () => {
      const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, RED] });
      const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(out.flake, undefined);
      assert.equal(creates(asked).length, 0);
    });
  });

  test("a red already on its second attempt is not rerun again, whoever reran it", async () => {
    const { gh, asked } = rollupFake({ views: [RED], log: UNNAMED, attempt: 2 });
    assert.equal((await poll(PENDING, () => {}, 0, DEADLINE, io(gh))).action, "hand-back");
    assert.equal(reruns(asked).length, 0);
  });

  test("a red naming its failing test is rerun once too, before any CI-RED starts a fix round", async () => {
    const { gh, asked } = rollupFake({ views: [RED] });
    assert.equal((await poll(PENDING, () => {}, 0, DEADLINE, io(gh))).action, "hand-back");
    assert.equal(reruns(asked).length, 1);
    assert.ok(indexOf(asked, (a) => a[1] === "rerun") < indexOf(asked, isComment), JSON.stringify(asked));
  });

  test("a rerun GitHub refuses hands the red back as it is", async () => {
    const said: string[] = [];
    const { gh, asked } = rollupFake({ views: [RED], log: UNNAMED, refuse: { rerun: "HTTP 403: Resource not accessible" } });
    const out = await poll(PENDING, (m: string) => said.push(m), 0, DEADLINE, io(gh));
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
    assert.equal((await poll(PENDING, () => {}, 0, DEADLINE, withFacts)).action, "already-merged");
    assert.equal(merges(asked).length, 1);
  });

  test("a LAND with no reviewer completed since the last build is the owner's, never armed", async () => {
    const { asked, io: withFacts } = real([...reviewer(PENDING.ticket), say("PHASE C"), say("PHASE D")]);
    const out = await poll(PENDING, () => {}, 0, DEADLINE, withFacts);
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /no loop-review or loop-fix completed for #1028/);
    assert.equal(merges(asked).length, 0);
  });
});

// Only `Date` is mocked: the pause between rounds stays a real timer, as it does across a standby.
describe("settle across a standby", () => {
  const MIN = 60_000;
  /** `execFileSync`'s shape: the first line names the command, `stderr` says what went wrong. */
  const ghFailed = (stderr: string) => Object.assign(new Error(`Command failed: gh pr view 1053\n${stderr}`), { stderr });
  const OFFLINE = "error connecting to api.github.com";
  /** The real read, with the clock jumping `by` during the pause after the first one. */
  const sleeper = (t: any, gh: (args: string[]) => string, by: number, fails: number[] = [], stderr = OFFLINE) => {
    let reads = 0;
    return (pr: number) => {
      reads += 1;
      if (reads === 1) setTimeout(() => t.mock.timers.setTime(Date.now() + by), 10);
      if (fails.includes(reads)) throw ghFailed(stderr);
      return readLandingState(REPO, pr, (args) => gh(args), Date.now() + MIN);
    };
  };
  const green = () => rollupFake({ views: [GATE_RUNNING, GREEN] });

  test("a pause the machine slept through does not spend the deadline", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const { gh } = green();
    const out = await poll(PENDING, () => {}, 30, MIN, { ...io(gh), stateOf: sleeper(t, gh, 120 * MIN) });
    assert.equal(out.action, "already-merged", String(out.reason));
  });

  test("after a wake, a read the network refused is asked again, and a green one lands", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const { gh } = green();
    const out = await poll(PENDING, () => {}, 30, 60 * MIN, { ...io(gh), stateOf: sleeper(t, gh, 10 * MIN, [2]) });
    assert.equal(out.action, "already-merged", String(out.reason));
  });

  test("after a wake, a read refused for any reason but the network still goes to the owner", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const { gh } = green();
    const refused = sleeper(t, gh, 10 * MIN, [2], "HTTP 401: Bad credentials (https://api.github.com/graphql)");
    const out = await poll(PENDING, () => {}, 30, 60 * MIN, { ...io(gh), stateOf: refused });
    assert.equal(out.action, "owner");
    assert.match(String(out.reason), /^could not read CI/);
  });
});

describe("poll posts CI-RED once per red head", () => {
  const LINE = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z   1) [chromium] › tests/e2e/x.spec.ts:9:5 › some test";
  const redFake = (issueComments: { body: string }[] = []) => rollupFake({ views: [RED], log: LINE, issueComments });

  test("hand-back posts one CI-RED comment per red head", async () => {
    const written: string[][] = [];
    const { gh, asked } = redFake();
    await poll(PENDING, () => {}, 0, DEADLINE, io(gh, written));
    const posted = asked.filter(isComment);
    assert.equal(posted.length, 1);
    const file = posted[0][posted[0].indexOf("--body-file") + 1];
    const body = written.find(([p]) => p === file)?.[1];
    assert.match(String(body), new RegExp(`^CI-RED ${SHA}`));
  });

  describe("a CI-RED from before the newest claim is no CI-RED for this one", () => {
    const thread = [{ body: `CI-RED ${SHA}\nrun: x · step: y\nfailing: z` }, { body: "Claimed by `agent/1028-the-turn-chip`." }];

    test("poll posts it again", async () => {
      const { gh, asked } = rollupFake({ views: [RED], log: LINE, attempt: 2, issueComments: thread });
      await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
      assert.equal(asked.filter(isComment).length, 1);
    });

    test("so does the supervisor's post of a held red", async () => {
      const { postHeldRed } = (await import("../queue-loop.mjs")) as any;
      const { gh, asked } = rollupFake({ views: [RED], log: LINE, attempt: 2, issueComments: thread });
      assert.equal(typeof postHeldRed, "function", "postHeldRed is exported, so its glue is tested");
      assert.equal(postHeldRed(PENDING.ticket, PENDING.pr, () => {}, io(gh)), true);
      assert.equal(asked.filter(isComment).length, 1);
    });
  });

  test("the same head red twice posts once", async () => {
    const { gh, asked } = redFake([{ body: `CI-RED ${SHA}\nrun: x · step: y\nfailing: z` }]);
    await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
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
  const isRead = (a: string[]) => a[0] === "issue" && a[1] === "view";

  test("an unreadable tracker is asked again, never posted to blind, and then held rather than handed back", async () => {
    const { gh, asked } = failing(isRead);
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(asked.filter(isComment).length, 0);
    assert.ok(asked.filter(isRead).length > 1, "the tracker is read more than once");
    assert.equal(out.action, "hold");
    assert.equal(out.head, SHA);
  });

  test("a post that keeps failing is tried again, then held", async () => {
    const { gh, asked } = failing(isComment);
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.ok(asked.filter(isComment).length > 1, "the post is tried more than once");
    assert.equal(out.action, "hold");
  });

  test("a post that fails once and then lands hands the red back", async () => {
    const { gh, asked } = failing(isComment, 1);
    const out = await poll(PENDING, () => {}, 0, DEADLINE, io(gh));
    assert.equal(asked.filter(isComment).length, 2);
    assert.equal(out.action, "hand-back");
  });

  // `output` is only the log's last 400 lines; `testIds` come from the full failed log.
  test("a failing id outside the 400-line tail still reaches the CI-RED body", async () => {
    const old = "Typecheck and tests\tTest\t2026-10-12T19:07:30Z   1) [chromium] › tests/e2e/old.spec.ts:9:5 › ancient failure";
    const filler = Array.from({ length: 450 }, (_, i) => `Typecheck and tests\tTest\t2026-10-12T19:07:30Z filler ${i}`);
    const written: string[][] = [];
    const { gh, asked } = rollupFake({ views: [RED], log: [old, ...filler].join("\n") });
    await poll(PENDING, () => {}, 0, DEADLINE, io(gh, written));
    const post = asked.find(isComment)!;
    const body = String(written.find(([p]) => p === post[post.indexOf("--body-file") + 1])?.[1]);
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
    await poll(PENDING, () => {}, 0, DEADLINE, { ...io(gh), run, mainFailures: undefined });
    assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["run rerun", "run list", "issue view", "issue comment"]);
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
    return post ? String(written.find(([p]) => p === post[post.indexOf("--body-file") + 1])?.[1]) : null;
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
    const out = await poll(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), mainFailures: () => main });
    assert.deepEqual(out, HAND_BACK);
    assert.match(String(bodyOf(asked, written)), /^on main: 1 of \d+ also fail on main \(https:\/\/example\.test\/runs\/1\): /m);
  });

  test("a failure the inherited run had at attempt 1 goes on its own flaky line, and on main: stays none", async () => {
    const written: string[][] = [];
    const { gh, asked } = red();
    const main = { runId: 1, url: "https://example.test/runs/1/attempts/1", ids: [ID], flaky: true };
    const out = await poll(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), mainFailures: () => main });
    assert.deepEqual(out, HAND_BACK);
    const body = String(bodyOf(asked, written));
    assert.match(body, /^on main: none$/m);
    assert.match(body, /^flaky on main: 1 of \d+ failed attempt 1 of main's rerun-won green \(https:\/\/example\.test\/runs\/1\/attempts\/1\): /m);
  });

  test("a main with nothing to give says none", async () => {
    const written: string[][] = [];
    const { gh, asked } = red();
    const out = await poll(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), mainFailures: () => null });
    assert.deepEqual(out, HAND_BACK);
    assert.match(String(bodyOf(asked, written)), /^on main: none$/m);
    assert.doesNotMatch(String(bodyOf(asked, written)), /flaky on main/);
  });

  test("a red with no failing test id never reads main", async () => {
    const written: string[][] = [];
    const { gh, asked } = red("error TS2322: Type 'string' is not assignable to type 'number'.");
    let reads = 0;
    const main = () => (reads++, { runId: 1, ids: [ID] });
    const out = await poll(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), mainFailures: main });
    assert.deepEqual(out, HAND_BACK, "a type error is a red a fix round can aim at");
    assert.equal(reads, 0);
    assert.match(String(bodyOf(asked, written)), /^on main: none$/m);
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

  test("a hand-back's CI-RED carries the attempt it was read from", async () => {
    const written: string[][] = [];
    const { gh, asked } = rollupFake({ views: [RED, GATE_RUNNING, RED] });
    await poll(PENDING, () => {}, 0, DEADLINE, io(gh, written));
    const post = asked.find(isComment)!;
    assert.match(String(written.find(([p]) => p === post[post.indexOf("--body-file") + 1])?.[1]), /^rerun: survived one$/m);
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
    await poll(PENDING, () => {}, 0, DEADLINE, { ...io(gh, written), stateOf });
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

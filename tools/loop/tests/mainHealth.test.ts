// tools/loop/tests/mainHealth.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  alreadyFiled,
  bodyFor,
  checkMain,
  decideMainHealth,
  MAIN_RED_LABEL,
  mainFailures,
  titleFor,
  WINDOW,
  type FiledIssue,
  type MainRun,
} from "../mainHealth.ts";
import type { JobRow } from "../ciVerdict.ts";
import { ciCall, fieldOf, restJobs, restRun, restRuns } from "./helpers/restCi.ts";
import { UNREAD_STEP } from "../../ci/budget-gate.mjs";

const RED: MainRun = {
  databaseId: 34647545165,
  conclusion: "failure",
  status: "completed",
  headSha: "2646def6abc",
  url: "https://github.com/metasito/murlan/actions/runs/34647545165",
};

const GREEN: MainRun = { ...RED, conclusion: "success" };

const JOBS: JobRow[] = [
  { name: "Typecheck and tests", conclusion: "failure", steps: 9 },
  { name: "Build", conclusion: "success", steps: 4 },
];

/**
 * A GitHub that keeps the issues filed against it, so "the same red run twice" is answered by the
 * state a second call would really read rather than by a stub told what to say.
 */
function fakeGh(runs: MainRun[], seed: FiledIssue[] = []) {
  const issues = [...seed];
  const calls: string[][] = [];
  let next = 900;
  const gh = (args: string[]) => {
    calls.push(args);
    const ci = ciCall(args);
    if (ci?.kind === "runs") return JSON.stringify(restRuns(runs));
    if (ci?.kind === "jobs") return JSON.stringify(restJobs(JOBS));
    if (ci?.kind === "issues") {
      // Newest first, and only the page asked for, as GitHub itself answers.
      const limit = Number(ci.query.get("per_page"));
      const rows = [...issues].reverse().slice(0, limit);
      return JSON.stringify(rows.map((i) => ({ number: i.number, title: i.title, html_url: i.url, state: (i.state ?? "open").toLowerCase() })));
    }
    if (ci?.kind === "create") {
      const number = (next += 1);
      const url = `https://github.com/metasito/murlan/issues/${number}`;
      issues.push({ number, title: String(fieldOf(args, "title")), url, state: "OPEN" });
      return JSON.stringify({ html_url: url });
    }
    if (ci?.kind === "comment") return "{}";
    if (ci?.kind === "edit-issue") {
      const issue = issues.find((i) => i.number === ci.id);
      if (!issue) throw new Error(`no issue ${ci.id}`);
      if (fieldOf(args, "state") === "closed") issue.state = "CLOSED";
      return "{}";
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  const created = () => calls.filter((c) => ciCall(c)?.kind === "create");
  const closed = () => calls.filter((c) => ciCall(c)?.kind === "edit-issue");
  return { gh, calls, created, closed, issues };
}

describe("the DoD path, off a fixture gh payload", () => {
  test("a red main files exactly one issue, carrying the run id and the failing step", () => {
    const hub = fakeGh([RED]);
    const health = checkMain({ repo: "metasito/murlan", gh: hub.gh });

    assert.equal(health.state, "filed");
    assert.equal(hub.created().length, 1);
    const [args] = hub.created();
    assert.equal(fieldOf(args, "title"), titleFor(RED.databaseId));
    const body = String(fieldOf(args, "body"));
    assert.match(body, /Typecheck and tests/, "the failing job belongs in the body");
    assert.match(body, new RegExp(String(RED.databaseId)), "so does the run");
    assert.match(body, /2646def6abc/, "and the commit it ran against");
  });

  test("a green main files nothing, and never asks for the jobs", () => {
    const hub = fakeGh([GREEN]);
    assert.equal(checkMain({ repo: "metasito/murlan", gh: hub.gh }).state, "green");
    assert.equal(hub.created().length, 0);
    assert.equal(hub.calls.some((c) => ciCall(c)?.kind === "jobs"), false);
  });

  test("the same red main twice files once", () => {
    const hub = fakeGh([RED]);
    const first = checkMain({ repo: "metasito/murlan", gh: hub.gh });
    const second = checkMain({ repo: "metasito/murlan", gh: hub.gh });

    assert.equal(hub.created().length, 1, "the second call must find the first call's issue");
    assert.equal(first.state, "filed");
    assert.equal(second.state, "filed");
    assert.deepEqual(
      [first, second].map((h) => (h.state === "filed" ? h.runId : null)),
      [RED.databaseId, RED.databaseId],
    );
  });

  test("a second, different red run files again", () => {
    const later: MainRun = { ...RED, databaseId: RED.databaseId + 1 };
    const hub = fakeGh([RED]);
    checkMain({ repo: "metasito/murlan", gh: hub.gh });
    const runs = [later];
    const gh = (args: string[]) => (ciCall(args)?.kind === "runs" ? JSON.stringify(restRuns(runs)) : hub.gh(args));
    checkMain({ repo: "metasito/murlan", gh });
    assert.equal(hub.created().length, 2, "a new red run is news, whatever was filed before it");
  });

  test("a budget gate that could not read its lists is infrastructure on main too, and files nothing", () => {
    const hub = fakeGh([RED]);
    const steps = [
      { name: "Set up job", conclusion: "success" },
      { name: UNREAD_STEP, conclusion: "failure" },
    ];
    const gh = (args: string[]) =>
      ciCall(args)?.kind === "jobs" ? JSON.stringify(restJobs([{ name: "Timing budget", conclusion: "failure", steps }])) : hub.gh(args);
    assert.equal(checkMain({ repo: "metasito/murlan", gh }).state, "unknown");
    assert.equal(hub.created().length, 0);
  });

  test("an unreachable gh is an unknown, never a throw", () => {
    const health = checkMain({
      repo: "metasito/murlan",
      gh: () => {
        throw new Error("gh: could not connect\nand a second line");
      },
    });
    assert.equal(health.state, "unknown");
    assert.match(health.why, /could not connect/);
    assert.equal(health.why.includes("\n"), false, "one line, because it lands in a one-line row");
  });

  test("the issue carries the label the duplicate check reads", () => {
    const hub = fakeGh([RED]);
    checkMain({ repo: "metasito/murlan", gh: hub.gh });
    const [args] = hub.created();
    const labels = args.filter((a) => a.startsWith("labels[]=")).map((a) => a.slice("labels[]=".length));
    assert.ok(labels.includes(MAIN_RED_LABEL), `create must carry ${MAIN_RED_LABEL}`);
    assert.ok(labels.includes("ready-for-agent"), "and reach the queue");
    const list = hub.calls.find((c) => ciCall(c)?.kind === "issues") ?? [];
    assert.equal(ciCall(list)?.query.get("labels"), MAIN_RED_LABEL, "the same label, or the dedupe reads the wrong set");
  });
});

describe("a green main closes the main-red issues it filed", () => {
  const REPO = "metasito/murlan";
  const filed = (number: number, runId: number, state = "OPEN"): FiledIssue => ({ number, title: titleFor(runId), state });
  const closedNumbers = (hub: ReturnType<typeof fakeGh>) => hub.closed().map((c) => ciCall(c)?.id);

  test("green closes an open older main-red issue, with a comment naming the green run", () => {
    const hub = fakeGh([GREEN], [filed(5, GREEN.databaseId - 3)]);
    assert.equal(checkMain({ repo: REPO, gh: hub.gh }).state, "green");
    const [args] = hub.closed();
    assert.equal(ciCall(args)?.id, 5);
    assert.ok(args.includes(`repos/${REPO}/issues/5`));
    const comment = hub.calls.find((c) => ciCall(c)?.kind === "comment" && ciCall(c)?.id === 5) ?? [];
    assert.equal(fieldOf(comment, "body"), `main is green again: ci.yml run ${GREEN.databaseId}.`);
    assert.equal(hub.issues[0].state, "CLOSED");
  });

  test("an issue naming a newer run stays open", () => {
    const hub = fakeGh([GREEN], [filed(5, GREEN.databaseId - 3), filed(6, GREEN.databaseId + 1)]);
    checkMain({ repo: REPO, gh: hub.gh });
    assert.deepEqual(closedNumbers(hub), [5]);
  });

  test("an already-closed issue is not closed again", () => {
    const hub = fakeGh([GREEN], [filed(4, GREEN.databaseId - 9, "CLOSED"), filed(5, GREEN.databaseId - 3)]);
    checkMain({ repo: REPO, gh: hub.gh });
    assert.deepEqual(closedNumbers(hub), [5]);
  });

  test("an issue with no run id in its title is left alone", () => {
    const hub = fakeGh([GREEN], [{ number: 3, title: "main is unhappy", state: "OPEN" }, filed(5, GREEN.databaseId - 3)]);
    checkMain({ repo: REPO, gh: hub.gh });
    assert.deepEqual(closedNumbers(hub), [5]);
  });

  test("unknown closes nothing; the same issue closes once main is really green", () => {
    const runs: MainRun[] = [];
    const hub = fakeGh(runs, [filed(5, GREEN.databaseId - 3)]);
    for (const status of [undefined, "in_progress", "queued"]) {
      runs.splice(0, 1, ...(status ? [{ ...GREEN, status, conclusion: null }] : []));
      assert.equal(checkMain({ repo: REPO, gh: hub.gh }).state, "unknown");
    }
    assert.deepEqual(closedNumbers(hub), []);
    runs[0] = GREEN;
    checkMain({ repo: REPO, gh: hub.gh });
    assert.deepEqual(closedNumbers(hub), [5]);
  });

  test("a gh issue close that throws still returns green, and the next close is still tried", () => {
    const hub = fakeGh([GREEN], [filed(5, GREEN.databaseId - 3), filed(6, GREEN.databaseId - 2)]);
    const gh = (args: string[]) => {
      if (ciCall(args)?.kind === "edit-issue" && ciCall(args)?.id === 6) throw new Error("HTTP 403");
      return hub.gh(args);
    };
    assert.equal(checkMain({ repo: REPO, gh }).state, "green");
    assert.deepEqual(closedNumbers(hub), [5]);
  });

  test("the close is decided as data, before any gh call", () => {
    const health = decideMainHealth(GREEN, [], [filed(5, GREEN.databaseId - 3), filed(6, GREEN.databaseId + 1)]);
    assert.deepEqual(health, { state: "green", why: "ci.yml passed", runId: GREEN.databaseId, close: [5] });
  });

  test("closing does not make the same red run file twice", () => {
    const hub = fakeGh([RED]);
    checkMain({ repo: REPO, gh: hub.gh });
    hub.issues[0].state = "CLOSED";
    checkMain({ repo: REPO, gh: hub.gh });
    assert.equal(hub.created().length, 1);
  });
});

describe("decideMainHealth", () => {
  const none: FiledIssue[] = [];

  test("green is green", () => {
    assert.equal(decideMainHealth(GREEN, [], none).state, "green");
  });

  test("a run still going is unknown, not red", () => {
    const health = decideMainHealth({ ...RED, status: "in_progress", conclusion: null }, [], none);
    assert.equal(health.state, "unknown");
  });

  test("a cancelled run is not main being broken", () => {
    const health = decideMainHealth({ ...RED, conclusion: "cancelled" }, [], none);
    assert.equal(health.state, "unknown", "ci.yml cancels its own in-progress runs on every push");
  });

  test("a stepless runner failure is not main being broken", () => {
    const jobs: JobRow[] = [{ name: "Typecheck and tests", conclusion: "failure", steps: 0 }];
    assert.equal(decideMainHealth(RED, jobs, none).state, "unknown");
  });

  test("a CI gate red with no other job red is main being broken, and files naming the gate", () => {
    const jobs: JobRow[] = [
      { name: "Typecheck and tests", conclusion: "success", steps: 9 },
      { name: "CI gate", conclusion: "failure", steps: 3 },
    ];
    const health = decideMainHealth(RED, jobs, none);
    assert.equal(health.state, "file");
    assert.match(health.why, /CI gate/);
  });

  test("a timed-out run and a startup failure are main being broken", () => {
    const timedOut: JobRow[] = [{ name: "Typecheck and tests", conclusion: "cancelled", steps: 13, timedOut: true }];
    assert.equal(decideMainHealth({ ...RED, conclusion: "timed_out" }, timedOut, none).state, "file");
    assert.equal(decideMainHealth({ ...RED, conclusion: "startup_failure" }, [], none).state, "file");
  });

  test("no run at all is unknown rather than red", () => {
    assert.equal(decideMainHealth(undefined, [], none).state, "unknown");
  });

  test("a red run names the failing job in `why`", () => {
    const health = decideMainHealth(RED, JOBS, none);
    assert.equal(health.state, "file");
    assert.match(health.why, /Typecheck and tests/);
  });
});

describe("alreadyFiled", () => {
  test("matches on the run id in the title, whatever else the title says", () => {
    const issues: FiledIssue[] = [{ number: 1, title: `[bug] ${titleFor(77)} — still red` }];
    assert.ok(alreadyFiled(77, issues));
    assert.equal(alreadyFiled(7, issues), undefined, "a prefix of the id is a different run");
    assert.equal(alreadyFiled(770, issues), undefined);
  });

  test("an issue with no run id in its title matches nothing", () => {
    assert.equal(alreadyFiled(77, [{ number: 1, title: "main is unhappy" }]), undefined);
  });

  test("the titles this module writes are the ones it can read back", () => {
    assert.ok(alreadyFiled(34647545165, [{ number: 1, title: titleFor(34647545165) }]));
  });
});

describe("what is asked of GitHub", () => {
  test("the run read is pinned to ci.yml on main, and its newest run alone", () => {
    const hub = fakeGh([RED]);
    checkMain({ repo: "metasito/murlan", gh: hub.gh });
    const runs = hub.calls.find((c) => ciCall(c)?.kind === "runs") ?? [];
    assert.match(String(runs.at(-1)), /actions\/workflows\/ci\.yml\/runs\?/, "another workflow's green would read as main's");
    assert.equal(ciCall(runs)?.query.get("branch"), "main");
    assert.equal(ciCall(runs)?.query.get("per_page"), "1");
    const run = restRun(RED);
    assert.ok(run.html_url && run.status && run.id, "the url, status and id the module reads all come from the REST run");
  });

  test("the dedupe window is a list, never a search", () => {
    const hub = fakeGh([RED]);
    checkMain({ repo: "metasito/murlan", gh: hub.gh });
    assert.ok(!hub.calls.some((c) => c.some((a) => a.includes("search/"))), "search trails its own writes by minutes");
    const list = hub.calls.find((c) => ciCall(c)?.kind === "issues") ?? [];
    assert.equal(Number(ciCall(list)?.query.get("per_page")), WINDOW);
    assert.equal(ciCall(list)?.query.get("state"), "all", "a closed issue still means this run was reported");
  });
});

describe("bodyFor", () => {
  test("says what is missing rather than printing undefined", () => {
    const body = bodyFor({ state: "file", runId: 5, title: titleFor(5), why: "x" }, undefined);
    assert.equal(body.includes("undefined"), false);
    assert.match(body, /id 5/);
  });
});

describe("mainFailures", () => {
  const REPO = "metasito/murlan";
  const keyed = (run: MainRun, jobs: JobRow[]) => (args: string[]) => {
    const key = args.join(" ");
    const ci = ciCall(args);
    if (ci?.kind === "runs") return JSON.stringify(restRuns([run]));
    if (ci?.kind === "jobs" && ci.id === run.databaseId && !ci.attempt) return JSON.stringify(restJobs(jobs));
    if (key === ["run", "view", String(run.databaseId), "--repo", REPO, "--log-failed"].join(" ")) {
      return "Typecheck and tests\tRun jest\t2026-09-21T10:00:00.0000000Z FAIL android tests/native/a.test.tsx\n";
    }
    throw new Error(`unexpected gh call: ${key}`);
  };

  test("a green main has no failures to give", () => {
    assert.equal(mainFailures(keyed(GREEN, JOBS), REPO), null);
  });

  test("a red main gives its run and the failing test paths from its failed log", () => {
    assert.deepEqual(mainFailures(keyed(RED, JOBS), REPO), {
      runId: RED.databaseId,
      url: RED.url,
      ids: ["tests/native/a.test.tsx"],
    });
  });

  test("a red main whose jobs never ran a step is infrastructure, not failures", () => {
    const stepless = JOBS.map((j) => ({ ...j, conclusion: "failure", steps: 0 }));
    assert.equal(mainFailures(keyed(RED, stepless), REPO), null);
  });

  test("a main run stopped by a job's own timeout-minutes is red, not infrastructure", () => {
    const cancelled = { ...RED, conclusion: "cancelled" };
    const jobs = [{ name: "Typecheck and tests", conclusion: "cancelled", steps: 13, databaseId: 112945168721 }];
    const base = keyed(cancelled, jobs as never);
    const gh = (args: string[]) => {
      if (args[1] === `repos/${REPO}/check-runs/112945168721/annotations`) {
        return JSON.stringify([{ message: "The job has exceeded the maximum execution time of 20m0s" }]);
      }
      if (args.join(" ") === `run view --job 112945168721 --repo ${REPO} --log`) {
        return "Typecheck and tests\tRun jest\t2026-10-07T18:39:00.0000000Z FAIL node tests/native/slow.test.tsx\n";
      }
      return base(args);
    };
    assert.deepEqual(mainFailures(gh, REPO), { runId: RED.databaseId, url: RED.url, ids: ["tests/native/slow.test.tsx"] });
  });

  test("an unreachable gh is null, never a throw", () => {
    const gh = () => {
      throw new Error("gh: could not connect");
    };
    assert.equal(mainFailures(gh, REPO), null);
  });

  // Main 38189115110 skipped its suite and inherited 38188271467, green only at attempt 2.
  describe("a green main vouches for the pull-request run it inherited", () => {
    const HEAD = "83e4d520240d82398dba3ca8b15a57c9376bd1f8";
    const PR_RUN = 38188271467;
    const PR_URL = `https://github.com/${REPO}/actions/runs/${PR_RUN}`;
    const WOBBLE =
      "tests/e2e/reducedMotionWobbleReset.spec.ts › the landing wobble's reset survives a live reduced-motion toggle (#786)" +
      " › a toggle mid-wobble brings the cards to rest instead of freezing them scaled";
    const firstAttempt = (id: number, args: string[]) => {
      const ci = ciCall(args);
      if (ci?.id !== id || ci.attempt !== 1) return null;
      if (ci.kind === "run") return JSON.stringify(restRun({ databaseId: id, status: "completed", conclusion: "failure", attempt: 1 }));
      if (ci.kind === "jobs") return JSON.stringify(restJobs([{ name: "Browser tests 12/17", conclusion: "failure", steps: Array(16).fill({}), databaseId: 7 }]));
      return null;
    };
    /** Any read of a run's attempt, by REST path or gh flag. */
    const ATTEMPT = /--attempt|\/attempts\//;
    const inherited = (attempt: number, asked: string[] = [], mainTree = "f00d") => (args: string[]) => {
      const key = args.join(" ");
      asked.push(key);
      const ci = ciCall(args);
      if (ci?.kind === "runs" && ci.query.get("branch") === "main") return JSON.stringify(restRuns([GREEN]));
      if (key === `api repos/${REPO}/commits/${GREEN.headSha}/pulls`) return JSON.stringify([{ head: { sha: HEAD } }]);
      if (key === `api repos/${REPO}/commits/${GREEN.headSha}`) return JSON.stringify({ commit: { tree: { sha: mainTree } } });
      if (key === `api repos/${REPO}/commits/${HEAD}`) return JSON.stringify({ commit: { tree: { sha: "f00d" } } });
      if (ci?.kind === "runs" && ci.query.get("head_sha") === HEAD && ci.query.get("status") === "success") {
        return JSON.stringify(restRuns([{ databaseId: PR_RUN, attempt, url: PR_URL }]));
      }
      const first = firstAttempt(PR_RUN, args);
      if (first) return first;
      if (key === `run view ${PR_RUN} --repo ${REPO} --log-failed --attempt 1`) {
        return `Browser tests 12/17\tUNKNOWN STEP\t2026-10-12T00:33:53.4326052Z   1) [chromium] › ${WOBBLE.replace(" › ", ":28:7 › ")} \n`;
      }
      throw new Error(`unexpected gh call: ${key}`);
    };

    test("a failure at attempt 1 is flaky on main, not on main", () => {
      const asked: string[] = [];
      assert.deepEqual(mainFailures(inherited(2, asked), REPO), {
        runId: PR_RUN,
        url: `${PR_URL}/attempts/1`,
        ids: [WOBBLE],
        flaky: true,
      });
      assert.ok(asked.some((k) => k.endsWith("--log-failed --attempt 1")), asked.join("\n"));
    });

    test("an inherited run green at attempt 1 has nothing to give, and its log is never read", () => {
      const asked: string[] = [];
      assert.equal(mainFailures(inherited(1, asked), REPO), null);
      assert.ok(!asked.some((k) => ATTEMPT.test(k)), asked.join("\n"));
    });

    test("main's own green won at attempt 2 gives attempt 1's failures as flaky, before any inherited run", () => {
      const own = { ...GREEN, attempt: 2 };
      const asked: string[] = [];
      const gh = (args: string[]) => {
        const key = args.join(" ");
        asked.push(key);
        if (ciCall(args)?.kind === "runs") return JSON.stringify(restRuns([own]));
        const first = firstAttempt(own.databaseId, args);
        if (first) return first;
        if (key === `run view ${own.databaseId} --repo ${REPO} --log-failed --attempt 1`) {
          return `Browser tests 12/17\tUNKNOWN STEP\t2026-10-12T00:33:53.4326052Z   1) [chromium] › ${WOBBLE.replace(" › ", ":28:7 › ")} \n`;
        }
        throw new Error(`unexpected gh call: ${key}`);
      };
      assert.deepEqual(mainFailures(gh, REPO), { runId: own.databaseId, url: `${own.url}/attempts/1`, ids: [WOBBLE], flaky: true });
      assert.ok(!asked.some((k) => k.includes("/pulls")), asked.join("\n"));
    });

    test("a main whose tree differs from the pull request's ran its own suite, and its green is its own", () => {
      const asked: string[] = [];
      assert.equal(mainFailures(inherited(2, asked, "beef"), REPO), null);
      assert.ok(!asked.some((k) => ATTEMPT.test(k)), asked.join("\n"));
    });
  });
});

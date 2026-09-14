// tools/loop/tests/mainHealth.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  alreadyFiled,
  bodyFor,
  checkMain,
  decideMainHealth,
  filedIssueArgs,
  MAIN_RED_LABEL,
  mainRunArgs,
  titleFor,
  WINDOW,
  type FiledIssue,
  type MainRun,
} from "../mainHealth.ts";
import type { JobRow } from "../ciVerdict.ts";

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
    const [verb, noun] = args;
    if (verb === "run" && noun === "list") return JSON.stringify(runs);
    if (verb === "run" && noun === "view") return JSON.stringify({ jobs: JOBS.map((j) => ({ ...j, steps: Array(j.steps).fill(0) })) });
    if (verb === "issue" && noun === "list") {
      // Newest first, and only the window asked for, as `gh` itself answers.
      const limit = Number(args[args.indexOf("--limit") + 1]);
      return JSON.stringify([...issues].reverse().slice(0, limit));
    }
    if (verb === "issue" && noun === "create") {
      const number = (next += 1);
      const url = `https://github.com/metasito/murlan/issues/${number}`;
      issues.push({ number, title: args[args.indexOf("--title") + 1], url });
      return `${url}\n`;
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  const created = () => calls.filter((c) => c[0] === "issue" && c[1] === "create");
  return { gh, calls, created, issues };
}

describe("the DoD path, off a fixture gh payload", () => {
  test("a red main files exactly one issue, carrying the run id and the failing step", () => {
    const hub = fakeGh([RED]);
    const health = checkMain({ repo: "metasito/murlan", gh: hub.gh });

    assert.equal(health.state, "filed");
    assert.equal(hub.created().length, 1);
    const [args] = hub.created();
    assert.equal(args[args.indexOf("--title") + 1], titleFor(RED.databaseId));
    const body = args[args.indexOf("--body") + 1];
    assert.match(body, /Typecheck and tests/, "the failing job belongs in the body");
    assert.match(body, new RegExp(String(RED.databaseId)), "so does the run");
    assert.match(body, /2646def6abc/, "and the commit it ran against");
  });

  test("a green main files nothing, and never asks for the jobs", () => {
    const hub = fakeGh([GREEN]);
    assert.equal(checkMain({ repo: "metasito/murlan", gh: hub.gh }).state, "green");
    assert.equal(hub.created().length, 0);
    assert.equal(hub.calls.some((c) => c[1] === "view"), false);
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
    const gh = (args: string[]) => (args[0] === "run" && args[1] === "list" ? JSON.stringify(runs) : hub.gh(args));
    checkMain({ repo: "metasito/murlan", gh });
    assert.equal(hub.created().length, 2, "a new red run is news, whatever was filed before it");
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
    const labels = args.flatMap((a, i) => (a === "--label" ? [args[i + 1]] : []));
    assert.ok(labels.includes(MAIN_RED_LABEL), `create must carry ${MAIN_RED_LABEL}`);
    assert.ok(labels.includes("ready-for-agent"), "and reach the queue");
    const list = hub.calls.find((c) => c[0] === "issue" && c[1] === "list") ?? [];
    assert.equal(list[list.indexOf("--label") + 1], MAIN_RED_LABEL, "the same label, or the dedupe reads the wrong set");
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

describe("the gh arguments", () => {
  test("the run list is pinned to ci.yml on main", () => {
    const args = mainRunArgs("metasito/murlan");
    assert.equal(args[args.indexOf("--workflow") + 1], "ci.yml", "another workflow's green would read as main's");
    assert.equal(args[args.indexOf("--branch") + 1], "main");
    const fields = args[args.indexOf("--json") + 1].split(",");
    assert.ok(fields.includes("url"), "the issue is worth little without a link to the run");
    assert.ok(fields.includes("status"), "a run still going must be distinguishable from a red one");
    assert.ok(fields.includes("databaseId"), "the run id is the dedupe key");
  });

  test("the dedupe window is a list, never a search", () => {
    const args = filedIssueArgs("metasito/murlan");
    assert.equal(args.includes("--search"), false, "search trails its own writes by minutes");
    assert.equal(Number(args[args.indexOf("--limit") + 1]), WINDOW);
    assert.equal(args[args.indexOf("--state") + 1], "all", "a closed issue still means this run was reported");
  });
});

describe("bodyFor", () => {
  test("says what is missing rather than printing undefined", () => {
    const body = bodyFor({ state: "file", runId: 5, title: titleFor(5), why: "x" }, undefined);
    assert.equal(body.includes("undefined"), false);
    assert.match(body, /id 5/);
  });
});

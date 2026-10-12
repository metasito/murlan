// tools/loop/tests/mainHealth.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  alreadyFiled,
  bodyFor,
  checkMain,
  filedIssueArgs,
  MAIN_RED_LABEL,
  mainRunArgs,
  titleFor,
  WINDOW,
  type FiledIssue,
  type MainRun,
} from "../mainHealth.ts";

const RED: MainRun = {
  databaseId: 34647545165,
  conclusion: "failure",
  headSha: "2646def6abc",
  url: "https://github.com/metasito/murlan/actions/runs/34647545165",
};

const GREEN: MainRun = { ...RED, conclusion: "success" };

/**
 * A GitHub that keeps the issues filed against it, so "the same red run twice" is answered by the
 * state a second call would really read rather than by a stub told what to say. It answers nothing
 * about jobs or logs: main's latest run's own conclusion is the whole verdict.
 */
function fakeGh(runs: MainRun[], seed: FiledIssue[] = []) {
  const issues = [...seed];
  const calls: string[][] = [];
  let next = 900;
  const gh = (args: string[]) => {
    calls.push(args);
    const [verb, noun] = args;
    if (verb === "run" && noun === "list") return JSON.stringify(runs);
    if (verb === "issue" && noun === "list") {
      // Newest first, and only the window asked for, as `gh` itself answers.
      const limit = Number(args[args.indexOf("--limit") + 1]);
      return JSON.stringify([...issues].reverse().slice(0, limit));
    }
    if (verb === "issue" && noun === "create") {
      const number = (next += 1);
      const url = `https://github.com/metasito/murlan/issues/${number}`;
      issues.push({ number, title: args[args.indexOf("--title") + 1], url, state: "OPEN" });
      return `${url}\n`;
    }
    if (verb === "issue" && noun === "close") {
      const issue = issues.find((i) => i.number === Number(args[2]));
      if (!issue) throw new Error(`no issue ${args[2]}`);
      issue.state = "CLOSED";
      return "";
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  const created = () => calls.filter((c) => c[0] === "issue" && c[1] === "create");
  const closed = () => calls.filter((c) => c[0] === "issue" && c[1] === "close");
  return { gh, calls, created, closed, issues };
}

const REPO = "metasito/murlan";

describe("main's latest ci.yml run files and closes main-red", () => {
  test("a red main files exactly one issue, carrying the run and the commit", () => {
    const hub = fakeGh([RED]);
    const health = checkMain({ repo: REPO, gh: hub.gh });

    assert.equal(health.state, "filed");
    assert.equal(hub.created().length, 1);
    const [args] = hub.created();
    assert.equal(args[args.indexOf("--title") + 1], titleFor(RED.databaseId));
    const body = args[args.indexOf("--body") + 1];
    assert.match(body, new RegExp(String(RED.databaseId)), "the run belongs in the body");
    assert.match(body, /2646def6abc/, "and the commit it ran against");
  });

  test("a green main files nothing", () => {
    const hub = fakeGh([GREEN]);
    assert.equal(checkMain({ repo: REPO, gh: hub.gh }).state, "green");
    assert.equal(hub.created().length, 0);
  });

  test("the same red main twice files once", () => {
    const hub = fakeGh([RED]);
    const first = checkMain({ repo: REPO, gh: hub.gh });
    const second = checkMain({ repo: REPO, gh: hub.gh });

    assert.equal(hub.created().length, 1, "the second call must find the first call's issue");
    assert.deepEqual(
      [first, second].map((h) => (h.state === "filed" ? h.runId : null)),
      [RED.databaseId, RED.databaseId],
    );
  });

  test("a second, different red run files again", () => {
    const later: MainRun = { ...RED, databaseId: RED.databaseId + 1 };
    const hub = fakeGh([RED]);
    checkMain({ repo: REPO, gh: hub.gh });
    const gh = (args: string[]) => (args[0] === "run" && args[1] === "list" ? JSON.stringify([later]) : hub.gh(args));
    checkMain({ repo: REPO, gh });
    assert.equal(hub.created().length, 2, "a new red run is news, whatever was filed before it");
  });

  // A push to main is never cancelled by ci.yml's concurrency group, which cancels pull requests only.
  test("only failure files: a cancelled, unfinished or absent run is unknown", () => {
    for (const runs of [[{ ...RED, conclusion: "cancelled" }], [{ ...RED, conclusion: null }], [{ ...RED, conclusion: "" }], []]) {
      const hub = fakeGh(runs);
      assert.equal(checkMain({ repo: REPO, gh: hub.gh }).state, "unknown", JSON.stringify(runs));
      assert.equal(hub.created().length, 0);
    }
  });

  test("an unreachable gh is an unknown, never a throw", () => {
    const health = checkMain({
      repo: REPO,
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
    checkMain({ repo: REPO, gh: hub.gh });
    const [args] = hub.created();
    const labels = args.flatMap((a, i) => (a === "--label" ? [args[i + 1]] : []));
    assert.ok(labels.includes(MAIN_RED_LABEL), `create must carry ${MAIN_RED_LABEL}`);
    assert.ok(labels.includes("ready-for-agent"), "and reach the queue");
    const list = hub.calls.find((c) => c[0] === "issue" && c[1] === "list") ?? [];
    assert.equal(list[list.indexOf("--label") + 1], MAIN_RED_LABEL, "the same label, or the dedupe reads the wrong set");
  });
});

describe("a green main closes the main-red issues it filed", () => {
  const filed = (number: number, runId: number, state = "OPEN"): FiledIssue => ({ number, title: titleFor(runId), state });
  const closedNumbers = (hub: ReturnType<typeof fakeGh>) => hub.closed().map((c) => Number(c[2]));

  test("green closes an open older main-red issue, with a comment naming the green run", () => {
    const hub = fakeGh([GREEN], [filed(5, GREEN.databaseId - 3)]);
    const health = checkMain({ repo: REPO, gh: hub.gh });
    assert.deepEqual(health, { state: "green", why: "ci.yml passed", runId: GREEN.databaseId, close: [5] });
    const [args] = hub.closed();
    assert.equal(args?.[2], "5");
    assert.equal(args[args.indexOf("--repo") + 1], REPO);
    assert.equal(args[args.indexOf("--comment") + 1], `main is green again: ci.yml run ${GREEN.databaseId}.`);
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
    for (const conclusion of [undefined, null, ""]) {
      runs.splice(0, 1, ...(conclusion === undefined ? [] : [{ ...GREEN, conclusion }]));
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
      if (args[1] === "close" && args[2] === "6") throw new Error("HTTP 403");
      return hub.gh(args);
    };
    assert.equal(checkMain({ repo: REPO, gh }).state, "green");
    assert.deepEqual(closedNumbers(hub), [5]);
  });

  test("closing does not make the same red run file twice", () => {
    const hub = fakeGh([RED]);
    checkMain({ repo: REPO, gh: hub.gh });
    hub.issues[0].state = "CLOSED";
    checkMain({ repo: REPO, gh: hub.gh });
    assert.equal(hub.created().length, 1);
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
  test("the run list is main's latest ci.yml run, and asks only what the verdict and the issue use", () => {
    const args = mainRunArgs(REPO);
    assert.equal(args[args.indexOf("--workflow") + 1], "ci.yml", "another workflow's green would read as main's");
    assert.equal(args[args.indexOf("--branch") + 1], "main");
    assert.equal(args[args.indexOf("--limit") + 1], "1");
    assert.deepEqual(args[args.indexOf("--json") + 1].split(","), ["databaseId", "conclusion", "headSha", "url"]);
  });

  test("the dedupe window is a list, never a search", () => {
    const args = filedIssueArgs(REPO);
    assert.equal(args.includes("--search"), false, "search trails its own writes by minutes");
    assert.equal(Number(args[args.indexOf("--limit") + 1]), WINDOW);
    assert.equal(args[args.indexOf("--state") + 1], "all", "a closed issue still means this run was reported");
    assert.ok(args[args.indexOf("--json") + 1].split(",").includes("state"), "an issue already closed must not be closed again");
  });
});

describe("bodyFor", () => {
  test("says what is missing rather than printing undefined", () => {
    const body = bodyFor({ databaseId: 5, conclusion: "failure" });
    assert.equal(body.includes("undefined"), false);
    assert.match(body, /id 5/);
  });
});

// #293
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classify, pickRoute, claimedElsewhere, launchOpen, nextPick, openIssues, routeOf, sizeOf, stranded, takeable, takeableReasons, waitingOn, LAUNCH_MILESTONE } from "../next-ticket.mjs";
import { importUnderShellGuard } from "../../../tests/helpers/importShellGuard.ts";
import { TRUSTED_AUTHORS } from "../loop-derive.mjs";
import { park } from "../queue-loop.mjs";

function issue(number: number, labelNames: string[], author_association = "OWNER") {
  return { number, title: `issue ${number}`, labels: labelNames.map((name) => ({ name })), author_association };
}

const noPrs = { openPr: () => false, liveWorktrees: () => new Set<number>() };

describe("an issue opened from outside the repo", () => {
  test("never reaches an agent, whatever it is labelled", () => {
    for (const association of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", undefined]) {
      for (const labels of [[], ["needs-triage"], ["ready-for-agent"], ["wayfinder:task"]]) {
        const stranger = { ...issue(1, labels), author_association: association };
        const b = classify([stranger], noPrs);
        assert.equal(routeOf(stranger), null, `${association} ${labels}`);
        assert.deepEqual(b.owner.map((i) => i.number), [1], `${association} ${labels}`);
      }
    }
  });

  test("a collaborator's issue is routed as before", () => {
    assert.equal(routeOf(issue(1, [], "COLLABORATOR")), "triage");
    assert.equal(routeOf(issue(1, ["ready-for-agent"], "COLLABORATOR")), "implement");
  });

  test("the picker trusts exactly the authors the loop's marker reader trusts", () => {
    assert.deepEqual(TRUSTED_AUTHORS, ["OWNER", "MEMBER", "COLLABORATOR"]);
    for (const association of TRUSTED_AUTHORS) assert.equal(routeOf(issue(1, [], association)), "triage", association);
  });
});

describe("classify's bucketing", () => {
  test("an unlabelled issue routes to triage, not to the owner", () => {
    const buckets = classify([issue(1, [])], noPrs);

    assert.deepEqual(buckets.owner, []);
    assert.equal(buckets.triage.length, 1);
    assert.equal(buckets.triage[0].number, 1);
  });

  test("an explicit needs-triage label still routes to triage", () => {
    const buckets = classify([issue(2, ["needs-triage"])], noPrs);

    assert.equal(buckets.triage.length, 1);
    assert.equal(buckets.triage[0].number, 2);
  });

  test("triage still precedes wayfinder when both have work", () => {
    // Precedence is deliberate, not incidental — per the ordering comment
    // above `classify`.
    const buckets = classify([issue(3, []), issue(4, ["wayfinder:research"])], noPrs);

    const route = pickRoute(buckets);
    assert.equal(route.skill, "triage");
    assert.equal(route.ticket.number, 3);
  });

  test("a blocked wayfinder child is not routed", () => {
    const buckets = classify([issue(6, ["wayfinder:research"]), issue(7, ["wayfinder:task"])], noPrs);
    const blocked = new Set([6]);
    const take = (list: { number: number }[], n: number) => list.filter((i) => !blocked.has(i.number)).slice(0, n);

    assert.equal(pickRoute(buckets, take).ticket.number, 7);
    blocked.add(7);
    assert.equal(pickRoute(buckets, take).skill, "handoff");
  });

  test("an owner-gated label still routes to owner", () => {
    const buckets = classify([issue(5, ["ready-for-human"])], noPrs);

    assert.equal(buckets.owner.length, 1);
    assert.equal(buckets.owner[0].number, 5);
  });

  // The shape a release creates: `ready-for-human` is added beside the `ready-for-agent` that is
  // already there. Routed as frontier work, #38 was claimed and escalated on two runs in a row and
  // would have been on every run after, because it sorts to the same place each time.
  test("an owner label beats ready-for-agent when a ticket carries both", () => {
    const buckets = classify([issue(38, ["ready-for-agent", "ready-for-human", "size:M"])], noPrs);

    assert.equal(buckets.frontier.length, 0, "an owner-gated ticket must never reach the frontier");
    assert.equal(buckets.owner.length, 1);
    assert.equal(buckets.owner[0].number, 38);
  });

  test("needs-info and rejected gate a ready-for-agent ticket the same way", () => {
    for (const label of ["needs-info", "rejected"]) {
      const buckets = classify([issue(39, ["ready-for-agent", label])], noPrs);
      assert.equal(buckets.frontier.length, 0, `${label} must keep a ticket off the frontier`);
      assert.equal(buckets.owner.length, 1, `${label} must land in owner`);
    }
  });

  test("ready-for-agent still wins over an unlabelled issue", () => {
    const buckets = classify([issue(6, ["ready-for-agent", "size:S"]), issue(7, [])], noPrs);

    assert.equal(buckets.frontier.length, 1);
    assert.equal(buckets.frontier[0].number, 6);
    assert.equal(buckets.triage.length, 1);
    assert.equal(buckets.triage[0].number, 7);
  });

  test("in-progress and blocked are still skipped regardless of other labels", () => {
    const buckets = classify(
      [issue(8, ["in-progress"]), issue(9, ["ready-for-agent", "blocked"])],
      noPrs,
    );

    assert.equal(buckets.frontier.length, 0);
    assert.equal(buckets.triage.length, 0);
    assert.equal(buckets.wayfinder.length, 0);
    assert.equal(buckets.owner.length, 0);
  });
});

describe("the frontier's order", () => {
  test("the oldest ticket comes first, whatever its size", () => {
    const b = classify([issue(995, ["ready-for-agent", "size:S"]), issue(70, ["ready-for-agent", "size:L"])], noPrs);
    assert.deepEqual(b.frontier.map((i) => i.number), [70, 995]);
  });

  test("a red main comes first, then the Launch milestone, then the rest, each oldest first", () => {
    const launch = (n: number) => ({ ...issue(n, ["ready-for-agent"]), milestone: { title: LAUNCH_MILESTONE } });
    const b = classify([
      issue(10, ["ready-for-agent"]),
      launch(900),
      issue(1500, ["ready-for-agent", "main-red"]),
      launch(300),
      { ...issue(5, ["ready-for-agent"]), milestone: { title: "Later" } },
    ], noPrs);
    assert.deepEqual(b.frontier.map((i) => i.number), [1500, 300, 900, 5, 10]);
  });

  test("a CI flake ranks with a red main, ahead of older ordinary and Launch work", () => {
    const b = classify([
      issue(10, ["ready-for-agent"]),
      { ...issue(300, ["ready-for-agent"]), milestone: { title: LAUNCH_MILESTONE } },
      issue(1528, ["ready-for-agent", "ci-flake"]),
      issue(1600, ["ready-for-agent", "main-red"]),
    ], noPrs);
    assert.deepEqual(b.frontier.map((i) => i.number), [1528, 1600, 300, 10]);
  });

  test("with nothing takeable, the handoff names the owner's asks, the Launch milestone's first", () => {
    const b = classify([
      issue(44, ["ready-for-human"]),
      { ...issue(1107, ["ready-for-human"]), milestone: { title: LAUNCH_MILESTONE } },
      issue(60, ["deferred"]),
    ], noPrs);
    assert.equal(waitingOn(b.owner), "nothing agent-takeable; waiting on you: #1107, #44");
    assert.equal(waitingOn([]), "nothing agent-takeable");
  });

  test("the handoff names live asks only, the Launch milestone's first and then the newest", () => {
    const b = classify([
      issue(44, ["ready-for-human"]),
      issue(60, ["ready-for-human", "deferred"]),
      { ...issue(1107, ["ready-for-human"]), milestone: { title: LAUNCH_MILESTONE } },
      issue(1529, ["needs-info"]),
      issue(1536, ["ready-for-human"]),
    ], noPrs);
    assert.equal(waitingOn(b.owner), "nothing agent-takeable; waiting on you: #1107, #1536, #1529, #44");
  });

  test("counts the Launch milestone's open issues whatever their labels, so an empty one is visible", () => {
    const launch = (n: number, labels: string[]) => ({ ...issue(n, labels), milestone: { title: LAUNCH_MILESTONE } });
    assert.equal(
      launchOpen([
        issue(10, ["ready-for-agent"]),
        launch(300, ["ready-for-agent"]),
        launch(900, ["in-progress", "ready-for-agent"]),
        launch(1107, ["ready-for-human"]),
      ]),
      3,
    );
    assert.equal(launchOpen([issue(10, ["ready-for-agent"])]), 0);
  });

  test("a deferred ticket is the owner's even when it is ready-for-agent", () => {
    const b = classify([issue(61, ["ready-for-agent", "deferred"])], noPrs);
    assert.deepEqual([b.frontier, b.owner.map((i) => i.number)], [[], [61]]);
  });
});

describe("a ticket stranded between CI rounds", () => {
  const inProgress = {
    number: 1043,
    title: "t",
    labels: [{ name: "in-progress" }, { name: "ready-for-agent" }],
  };

  test("an in-progress ticket with an open PR and no live worktree is stranded", () => {
    assert.equal(stranded(inProgress, { openPr: true, liveWorktree: false }), true);
  });

  test("an in-progress ticket whose worktree is standing belongs to a live run", () => {
    assert.equal(stranded(inProgress, { openPr: true, liveWorktree: true }), false);
  });

  test("an in-progress ticket that never pushed is mid-build, not stranded", () => {
    assert.equal(stranded(inProgress, { openPr: false, liveWorktree: false }), false);
  });

  test("a ready-for-agent ticket whose own PR is open and whose worktree is gone is stranded without a claim", () => {
    const released = issue(1100, ["ready-for-agent"]);
    assert.equal(stranded(released, { openPr: true, liveWorktree: false }), true);
    assert.equal(stranded(released, { openPr: true, liveWorktree: true }), false);
    assert.equal(stranded(released, { openPr: false, liveWorktree: false }), false);
  });

  test("git is read only for a ticket that has an open PR", () => {
    let gitReads = 0;
    const io = { openPr: (n: number) => n === 1043, liveWorktrees: () => (gitReads++, new Set<number>()) };
    classify([issue(10, ["ready-for-agent"]), issue(11, ["ready-for-agent"]), issue(12, ["in-progress"])], io);
    assert.equal(gitReads, 0, "a frontier with no open PRs costs no git subprocess");
    classify([issue(10, ["ready-for-agent"]), inProgress], io);
    assert.equal(gitReads, 1);
  });

  test("a parked ticket still waiting on the owner is not stranded", () => {
    const parked = issue(1100, ["ready-for-human"]);
    assert.equal(stranded(parked, { openPr: true, liveWorktree: false }), false);
  });

  test("a park the owner sends back is stranded, ahead of an older plain ticket", () => {
    const labels = new Set(["in-progress", "ready-for-agent", "size:S"]);
    let note = "";
    park(1438, {
      phase: "D",
      why: "review HOLD",
      log: "l",
      cwd: null,
      branch: "agent/1438-x",
      dirty: false,
      run: (cmd: string, args: string[]) => {
        if (cmd === "gh" && args[1] === "edit") {
          args.forEach((a, i) => {
            if (a === "--remove-label") labels.delete(args[i + 1]);
            if (a === "--add-label") labels.add(args[i + 1]);
          });
        }
        return "";
      },
      write: (_path: string, body: string) => void (note = body),
    });
    assert.deepEqual([...labels].sort(), ["ready-for-human", "size:S"], "park's own labels");
    const swap = /swap `([^`]+)` for `([^`]+)`/.exec(note);
    assert.ok(swap, "the park note tells the owner which label to swap");
    labels.delete(swap[1]);
    labels.add(swap[2]);

    const sentBack = issue(1438, [...labels]);
    const io = { openPr: (n: number) => n === 1438, liveWorktrees: () => new Set<number>() };
    const b = classify([sentBack, issue(1200, ["ready-for-agent"])], io);
    assert.deepEqual(b.stranded.map((i) => i.number), [1438]);
    assert.deepEqual(b.frontier.map((i) => i.number), [1438, 1200]);
  });

  test("a stranded ticket reaches the frontier ahead of fresh work", () => {
    const fresh = issue(1100, ["ready-for-agent"]);
    const io ={ openPr: (n: number) => n === 1043, liveWorktrees: () => new Set<number>() };
    assert.deepEqual(
      classify([fresh, inProgress], io).frontier.map((i) => i.number),
      [1043, 1100],
    );
  });

  test("git unreadable reads every claimed ticket as live, rather than as free", () => {
    const io = { openPr: () => true, liveWorktrees: () => null };
    assert.deepEqual(classify([inProgress], io).frontier, []);
  });
});

describe("claimedElsewhere", () => {
  // The comment promised fail-open and the code had no try/catch, so an unreachable origin threw
  // out of takeable(), out of the picker, and took the supervisor's for(;;) with it.
  test("an unreachable tracker does not empty the queue", () => {
    const threw = () => {
      throw new Error("could not read from remote repository");
    };
    assert.equal(claimedElsewhere(42, threw), false);
  });

  test("a claim is live only while its pull request is open", () => {
    assert.equal(claimedElsewhere(42, () => [{ number: 984, state: "OPEN" }]), true);
    assert.equal(claimedElsewhere(42, () => []), false);
  });
});

describe("the open issues, from one query", () => {
  const answer = (hasNextPage: boolean) => () =>
    JSON.stringify({
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage, endCursor: hasNextPage ? "c1" : null },
            nodes: [
              {
                number: 12,
                title: "a ticket",
                authorAssociation: "OWNER",
                labels: { nodes: [{ name: "ready-for-agent" }, { name: "size:S" }] },
                milestone: { title: LAUNCH_MILESTONE },
                issueDependenciesSummary: { blockedBy: 2 },
              },
              {
                number: 13,
                title: "another",
                authorAssociation: "NONE",
                labels: { nodes: [] },
                milestone: null,
                issueDependenciesSummary: { blockedBy: 0 },
              },
            ],
          },
        },
      },
    });

  test("each node arrives in the shape the policy reads", () => {
    assert.deepEqual(openIssues(answer(false)), [
      {
        number: 12,
        title: "a ticket",
        author_association: "OWNER",
        labels: [{ name: "ready-for-agent" }, { name: "size:S" }],
        milestone: { title: LAUNCH_MILESTONE },
        blocked: true,
      },
      { number: 13, title: "another", author_association: "NONE", labels: [], milestone: null, blocked: false },
    ]);
  });

  test("a second page is read from the first page's cursor, never truncated", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return args.includes("after=c1") ? answer(false)() : answer(true)();
    };
    assert.deepEqual(openIssues(run).map((i: { number: number }) => i.number), [12, 13, 12, 13]);
    assert.equal(calls.length, 2);
    assert.ok(!calls[0].some((a) => a.startsWith("after=")), "the first page has no cursor");
  });

  test("a next page with no cursor to reach it throws, never drops the pages after it", () => {
    const noCursor = () => answer(false)().replace('"hasNextPage":false', '"hasNextPage":true');
    assert.throws(() => openIssues(noCursor), /hasNextPage.*endCursor/);
  });

  test("an inspected ticket says why it is not takeable", () => {
    assert.deepEqual(takeableReasons({ ...issue(1, ["ready-for-agent"]), issue_dependencies_summary: { blocked_by: 0 } }), []);
    const gated = { ...issue(2, ["ready-for-human", "in-progress", "blocked"], "NONE"), issue_dependencies_summary: { blocked_by: 1 } };
    assert.deepEqual(takeableReasons(gated), [
      "has open blockers",
      "labelled in-progress",
      "labelled blocked",
      "owner-gated (ready-for-human)",
      "opened from outside the repo (NONE)",
    ]);
  });

  test("a candidate with an open native blocker is passed over for the next", () => {
    const blocked = { ...issue(5, ["ready-for-agent"]), blocked: true };
    const free = { ...issue(6, ["ready-for-agent"]), blocked: false };
    const unclaimed = () => false;
    assert.deepEqual(takeable([blocked, free], 1, unclaimed).map((i: { number: number }) => i.number), [6]);
  });
});

describe("nextPick", () => {
  // In-process, the supervisor picks many times in one process: a listing cached across picks would
  // never see a pull request opened since the first.
  test("two picks in one process each read the open pull requests afresh", () => {
    const node = (number: number, labels: string[]) => ({
      number, title: `issue ${number}`, authorAssociation: "OWNER", labels: { nodes: labels.map((name) => ({ name })) },
      milestone: null, issueDependenciesSummary: { blockedBy: 0 },
    });
    let prs: object[] = [];
    const run = (args: string[]) =>
      args[0] === "api"
        ? JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(990007, ["in-progress"]), node(990008, ["ready-for-agent", "size:S"])] } } } })
        : JSON.stringify(prs);
    assert.deepEqual(nextPick(run), {
      skill: "implement", number: 990008, title: "issue 990008", size: "size:S",
      queue: { implement: 1, triage: 0, wayfinder: 0, owner: 0, launch: 0 },
    });
    prs = [{ number: 1, state: "OPEN", headRefName: "agent/990007-x" }];
    assert.equal(nextPick(run).number, 990007, "the claimed ticket's pull request opened since the first pick strands it");
  });

  test("the handoff route carries no ticket and no size", () => {
    const run = (args: string[]) =>
      args[0] === "api" ? JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }) : "[]";
    assert.deepEqual(nextPick(run), {
      skill: "handoff", number: 0, title: "nothing agent-takeable", size: null,
      queue: { implement: 0, triage: 0, wayfinder: 0, owner: 0, launch: 0 },
    });
  });
});

describe("sizeOf", () => {
  test("reads the size label the spawn's turn bound is derived from", () => {
    assert.equal(sizeOf(issue(1, ["ready-for-agent", "size:L"])), "size:L");
    assert.equal(sizeOf(issue(2, ["ready-for-agent"])), null);
  });
});

describe("isInvokedDirectly", () => {
  test("importing the module (not running it) never shells out to `gh`", () => {
    const moduleUrl = new URL("../next-ticket.mjs", import.meta.url).href;

    const { shelledOutTo } = importUnderShellGuard(moduleUrl);

    assert.equal(shelledOutTo, null, "importing the module must not shell out to `gh`");
  });
});

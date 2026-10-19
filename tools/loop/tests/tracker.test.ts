import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { armArgs, disarmArgs, fakeTracker, flagsOf, ghTracker, issueText, runCli, isTrusted, readIssue, TRUSTED_AUTHORS, TRUSTED_SELECT, trustedComments } from "../tracker.mjs";

type Seed = Record<number, { state?: string; labels?: string[]; title?: string }>;

/**
 * GitHub's issue endpoints over memory, answering `gh api` the way REST does, so the real adapter is
 * judged by the state its calls leave and the fake can be held to the same cases.
 */
const restHub = (seed: Seed) => {
  const issues = new Map(
    Object.entries(seed).map(([n, s]) => [Number(n), { title: s.title ?? `issue ${n}`, state: (s.state ?? "OPEN").toLowerCase(), labels: [...(s.labels ?? [])], thread: [] as { body: string }[] }]),
  );
  const argv: string[][] = [];
  const of = (n: number) => {
    if (!issues.has(n)) issues.set(n, { title: `issue ${n}`, state: "open", labels: [], thread: [] });
    return issues.get(n)!;
  };
  const gh = (args: string[]) => {
    argv.push(args);
    assert.equal(args[0], "api", "REST only: gh issue and gh pr are GraphQL");
    const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
    const path = String(args.find((a) => a.startsWith("repos/")));
    const fields = args.filter((a, i) => args[i - 1] === "-f" || args[i - 1] === "-F");
    const labels = fields.filter((f) => f.startsWith("labels[]=")).map((f) => f.slice("labels[]=".length));
    let m: RegExpExecArray | null;
    if ((m = /issues\/(\d+)\/labels$/.exec(path))) {
      of(Number(m[1])).labels = method === "DELETE" ? [] : labels;
      return "[]";
    }
    if ((m = /issues\/(\d+)\/comments/.exec(path))) {
      const issue = of(Number(m[1]));
      if (method === "POST") {
        const body = String(fields.find((f) => f.startsWith("body="))?.slice(5));
        issue.thread.push({ body: body.startsWith("@") ? body.slice(1) : body });
        return "{}";
      }
      return JSON.stringify([issue.thread.map((c) => ({ body: c.body, author_association: "OWNER", user: { login: "loop" } }))]);
    }
    if ((m = /issues\/(\d+)$/.exec(path))) {
      const issue = of(Number(m[1]));
      if (method === "PATCH") issue.state = String(fields.find((f) => f.startsWith("state="))?.slice(6));
      return JSON.stringify({ title: issue.title, state: issue.state, labels: issue.labels.map((name) => ({ name })) });
    }
    if (/issues\?/.test(path)) {
      const q = new URLSearchParams(path.split("?")[1]);
      const rows = [...issues.entries()]
        .sort(([a], [b]) => b - a)
        .filter(([, i]) => i.labels.includes(String(q.get("labels"))) && (q.get("state") === "all" || i.state === q.get("state")))
        .slice(0, Number(q.get("per_page")))
        .map(([number, i]) => ({ number, title: i.title, html_url: `u${number}`, state: i.state, created_at: "" }));
      return JSON.stringify(args.includes("--slurp") ? [rows] : rows);
    }
    throw new Error(`the hub has no answer for ${args.join(" ")}`);
  };
  return { gh, argv, labels: (n: number) => [...of(n).labels].sort() };
};

/** Each case runs against the real adapter over the hub and against the fake, which must agree. */
describe("the gh tracker and the fake agree", () => {
  const start = ["ready-for-agent", "size:S"];
  type T = ReturnType<typeof fakeTracker>;
  const both = (seed: Seed, act: (t: T) => unknown) => {
    const hub = restHub(seed);
    const real = act(ghTracker(hub.gh) as unknown as T);
    const fake = fakeTracker(seed);
    return { real, fake: act(fake), hub, fakeTracker: fake };
  };

  const transitions: [string, (t: T) => unknown, string[]][] = [
    ["claim", (t) => t.claim(7), ["in-progress", "ready-for-agent", "size:S"]],
    ["release", (t) => (t.claim(7), t.release(7)), ["ready-for-agent", "size:S"]],
    ["park", (t) => (t.claim(7), t.park(7)), ["ready-for-human", "size:S"]],
    ["park without a claim", (t) => t.park(7), ["ready-for-human", "size:S"]],
  ];
  for (const [name, act, after] of transitions) {
    test(name, () => {
      const r = both({ 7: { labels: start } }, (t) => (act(t), t.issue(7).labels.sort()));
      assert.deepEqual(r.real, after, "gh");
      assert.deepEqual(r.fake, after, "fake");
    });
  }

  test("a transition is one replace of the whole set, keeping labels it does not name", () => {
    const { hub } = both({ 7: { labels: ["in-progress", "ready-for-agent", "loop"] } }, (t) => t.park(7));
    const writes = hub.argv.filter((a) => a.includes("-X"));
    assert.equal(writes.length, 1, JSON.stringify(writes));
    assert.deepEqual(hub.labels(7), ["loop", "ready-for-human"]);
  });

  test("a transition that would change nothing writes nothing", () => {
    const { hub } = both({ 7: { labels: ["ready-for-agent"] } }, (t) => t.release(7));
    assert.equal(hub.argv.filter((a) => a.includes("-X")).length, 0);
  });

  test("a failed replace leaves the labels as they were, never half moved", () => {
    const hub = restHub({ 7: { labels: ["in-progress", "ready-for-agent"] } });
    const gh = (args: string[]) => {
      if (args.includes("PUT")) throw new Error("gh: Bad Gateway (HTTP 502)");
      return hub.gh(args);
    };
    assert.throws(() => ghTracker(gh).park(7), /502/);
    assert.deepEqual(hub.labels(7), ["in-progress", "ready-for-agent"]);
  });

  test("issue reads state and label names", () => {
    const r = both({ 7: { state: "CLOSED", labels: ["in-progress"] } }, (t) => t.issue(7));
    assert.deepEqual(r.real, { state: "CLOSED", labels: ["in-progress"] });
    assert.deepEqual(r.fake, r.real);
  });

  test("a comment posted is read back as a trusted comment", () => {
    const r = both({}, (t) => (t.comment(7, "note.md"), t.comments(7).map((c) => c.body)));
    assert.deepEqual(r.real, ["note.md"]);
    assert.deepEqual(r.fake, r.real);
  });

  test("a closed issue reads closed, its last comment the reason", () => {
    const r = both({ 7: {} }, (t) => (t.closeIssue(7, "green again"), [t.issue(7).state, t.comments(7).at(-1)?.body]));
    assert.deepEqual(r.real, ["CLOSED", "green again"]);
    assert.deepEqual(r.fake, r.real);
  });

  test("labelled honours the state asked for and the newest-first limit", () => {
    const seed = { 3: { labels: ["parity"] }, 5: { labels: ["parity"], state: "CLOSED" }, 8: { labels: ["parity"] }, 9: { labels: ["other"] } };
    const numbers = (t: T) => [
      t.labelled("parity").map((i) => i.number),
      t.labelled("parity", { state: "all" }).map((i) => i.number),
      t.labelled("parity", { state: "all", limit: 2 }).map((i) => i.number),
      t.labelled("parity", { state: "closed" }).map((i) => i.number),
    ];
    const r = both(seed, numbers);
    assert.deepEqual(r.real, [[8, 3], [8, 5, 3], [8, 5], [5]]);
    assert.deepEqual(r.fake, r.real);
  });
});

describe("the tracker's CLI, a session's writes over REST", () => {
  const said: string[] = [];
  const cli = (t: ReturnType<typeof fakeTracker>, ...argv: string[]) => runCli(argv, t as never, (line: string) => void said.push(line));

  test("every verb a recipe names reaches the tracker", () => {
    const t = fakeTracker({ 5: { labels: ["ready-for-agent", "in-progress"] }, 6: { labels: ["parity"] } });
    cli(t, "comment", "5", "--body-file", "note.md");
    cli(t, "label", "5", "--remove", "ready-for-agent", "--remove", "in-progress", "--add", "ready-for-human");
    cli(t, "create", "--title", "a thing", "--body-file", "b.md", "--label", "ready-for-human");
    cli(t, "pr-create", "--head", "agent/5-x", "--title", "T", "--body-file", "pr.md");
    cli(t, "pr-edit", "1", "--body-file", "pr.md");
    cli(t, "close", "6", "--comment", "done");
    assert.deepEqual(t.held(5), { state: "OPEN", labels: ["ready-for-human"], comments: ["note.md"] });
    assert.equal(t.held(6).state, "CLOSED");
    assert.deepEqual(t.writes(), [
      ["createIssue", { title: "a thing", bodyFile: "b.md", labels: ["ready-for-human"] }],
      ["editPr", 1, "pr.md"],
    ]);
    assert.deepEqual(t.prs().map((p) => p.headRefName), ["agent/5-x"]);
  });

  test("list prints the issues as JSON, by label when asked", () => {
    const t = fakeTracker({ 3: { labels: ["parity"], title: "p" }, 4: { labels: ["ready-for-agent"], title: "r" } });
    said.length = 0;
    cli(t, "list", "--label", "parity");
    cli(t, "list");
    assert.deepEqual(JSON.parse(said[0]), [{ number: 3, title: "p" }]);
    assert.deepEqual(JSON.parse(said[1]).map((i: { number: number }) => i.number), [3, 4]);
  });

  test("a missing flag or number is refused with the usage, and writes nothing", () => {
    const t = fakeTracker({ 5: {} });
    assert.throws(() => cli(t, "comment", "5"), /comment needs --body-file/);
    assert.throws(() => cli(t, "label", "x", "--add", "y"), /needs an issue or pull request number/);
    assert.throws(() => cli(t, "merge", "5"), /usage:/);
    assert.deepEqual(t.held(5).comments, []);
  });

  test("flags repeat, and what is not a flag is positional", () => {
    assert.deepEqual(flagsOf(["5", "--add", "a", "--add", "b"]), { _: ["5"], add: ["a", "b"] });
  });
});

test("a comment goes through a file, never an inline body", () => {
  const hub = restHub({});
  ghTracker(hub.gh).comment(7, "note.md");
  assert.deepEqual(hub.argv, [["api", "-X", "POST", "repos/metasito/murlan/issues/7/comments", "-F", "body=@note.md"]]);
});

test("the fake refuses the operations it is told to, and changes nothing for them", () => {
  const t = fakeTracker({ 7: { labels: ["in-progress"] } }, { fail: ["comment"] });
  assert.throws(() => t.comment(7, "note.md"), /comment/);
  t.park(7);
  assert.deepEqual(t.held(7), { state: "OPEN", labels: ["ready-for-human"], comments: [] });
});

/** `gh api --paginate --slurp` answers with one array per page. */
const paged = (pages: unknown[][], asked: string[][] = []) => (args: string[]) => {
  asked.push(args);
  return JSON.stringify(args.includes("--slurp") ? pages : pages[0]);
};

describe("every listing is read whole", () => {
  const pr = (number: number, ref: string) => ({ number, state: "open", merged_at: null, head: { ref, sha: `s${number}` } });

  test("the open pull requests are every page's, not the first page's", () => {
    const asked: string[][] = [];
    const first = Array.from({ length: 100 }, (_, i) => pr(i + 1, `agent/${i + 1}-x`));
    const prs = ghTracker(paged([first, [pr(101, "agent/101-x")]], asked)).openPrs();
    assert.equal(prs.length, 101);
    assert.deepEqual(prs[100], { number: 101, state: "OPEN", headRefName: "agent/101-x", headRefOid: "s101", mergedAt: null });
    assert.deepEqual(asked[0].slice(0, 3), ["api", "--paginate", "--slurp"]);
  });

  test("so are a ticket's comments and the open issues", () => {
    const asked: string[][] = [];
    const c = (body: string) => ({ body, author_association: "OWNER", user: { login: "o" }, created_at: "t" });
    assert.equal(ghTracker(paged([[c("a")], [c("b")]], asked)).comments(7).length, 2);
    const issue = (number: number) => ({ number, title: "t", author_association: "OWNER", labels: [], milestone: null });
    assert.equal(ghTracker(paged([[issue(1)], [issue(2)]], asked)).openIssues().length, 2);
    assert.ok(asked.every((a) => a.includes("--paginate") && a.includes("--slurp")), JSON.stringify(asked));
  });
});

describe("the shapes callers read", () => {
  test("an open issue arrives in the shape the picker routes on, and a pull request is not an issue", () => {
    const issues = [
      {
        number: 12,
        title: "a ticket",
        author_association: "OWNER",
        labels: [{ name: "ready-for-agent", color: "x" }],
        milestone: { title: "Launch", number: 1 },
        issue_dependencies_summary: { blocked_by: 2 },
      },
      { number: 13, title: "another", author_association: "NONE", labels: [], milestone: null, issue_dependencies_summary: { blocked_by: 0 } },
      { number: 14, title: "a pr", author_association: "OWNER", labels: [], milestone: null, pull_request: {} },
    ];
    assert.deepEqual(ghTracker(paged([issues])).openIssues(), [
      { number: 12, title: "a ticket", author_association: "OWNER", labels: [{ name: "ready-for-agent" }], milestone: { title: "Launch" }, blocked: true },
      { number: 13, title: "another", author_association: "NONE", labels: [], milestone: null, blocked: false },
    ]);
  });

  test("a merged pull request reads MERGED, and only the pull request itself carries its file count", () => {
    const merged = { number: 5, state: "closed", merged_at: "2026-10-01T00:00:00Z", head: { ref: "agent/5-x", sha: "abc" }, changed_files: 3 };
    assert.deepEqual(ghTracker(() => JSON.stringify(merged)).pr(5), {
      number: 5, state: "MERGED", headRefName: "agent/5-x", headRefOid: "abc", mergedAt: "2026-10-01T00:00:00Z", changedFiles: 3,
    });
  });

  test("a branch's pull request is asked for by its owner-qualified head", () => {
    const asked: string[][] = [];
    const t = ghTracker(paged([[]], asked));
    assert.equal(t.openPrFor("agent/5-x"), null);
    assert.match(asked[0][1], /pulls\?state=open&head=metasito%3Aagent%2F5-x/);
  });

  test("facts are null when the tracker cannot be read, never zeros", () => {
    assert.equal(
      ghTracker(() => {
        throw new Error("HTTP 403");
      }).facts(7),
      null,
    );
  });

  test("facts carry REST's state and reason in the spelling the loop compares", () => {
    const gh = (args: string[]) =>
      args[1].endsWith("/comments?per_page=100") || args.includes("--slurp")
        ? "[[]]"
        : JSON.stringify({ title: "t", html_url: "u", labels: [{ name: "size:M" }], state: "closed", state_reason: "completed" });
    assert.deepEqual(ghTracker(gh).facts(7), {
      title: "t", url: "u", labels: ["size:M"], size: "size:M", state: "CLOSED", stateReason: "COMPLETED", comments: [],
    });
  });
});

describe("trust lives here", () => {
  const c = (author_association: string) => ({ body: author_association, author_association, user: { login: "x" }, created_at: "t" });

  test("a ticket's comments are its trusted authors' unless all are asked for", () => {
    const t = ghTracker(paged([[c("OWNER"), c("NONE"), c("MEMBER"), c("CONTRIBUTOR")]]));
    assert.deepEqual(t.comments(7).map((x) => x.body), ["OWNER", "MEMBER"]);
    assert.equal(t.comments(7, { all: true }).length, 4);
    const fake = fakeTracker({ 7: { comments: [{ body: "o" }, { body: "n", authorAssociation: "NONE" }] } });
    assert.deepEqual(fake.comments(7).map((x) => x.body), ["o"]);
  });

  test("either API's spelling of the association is read", () => {
    assert.deepEqual(TRUSTED_AUTHORS, ["OWNER", "MEMBER", "COLLABORATOR"]);
    assert.ok(isTrusted({ authorAssociation: "COLLABORATOR" }) && isTrusted({ author_association: "COLLABORATOR" }));
    assert.ok(!isTrusted({}) && !isTrusted({ author_association: "NONE" }));
    assert.equal(trustedComments([{ authorAssociation: "OWNER" }, { author_association: "FIRST_TIME_CONTRIBUTOR" }]).length, 1);
  });
});

describe("the supervisor's writes", () => {
  const asking = () => {
    const asked: string[][] = [];
    return { asked, t: ghTracker((args: string[]) => (asked.push(args), JSON.stringify({ html_url: "u" }))) };
  };

  test("are REST, except auto-merge, which only GraphQL can arm or disarm", () => {
    const { asked, t } = asking();
    t.createIssue({ title: "CI flake: x", bodyFile: "f.md", labels: ["ready-for-human"] });
    t.closeIssue(7, "green again");
    t.rerunFailed(99);
    t.updateBranch(5);
    t.merge(5, "abc", "m.md");
    t.merge(5, "abc");
    assert.deepEqual(asked, [
      ["api", "-X", "POST", "repos/metasito/murlan/issues", "-f", "title=CI flake: x", "-F", "body=@f.md", "-f", "labels[]=ready-for-human"],
      ["api", "-X", "POST", "repos/metasito/murlan/issues/7/comments", "-f", "body=green again"],
      ["api", "-X", "PATCH", "repos/metasito/murlan/issues/7", "-f", "state=closed", "-f", "state_reason=completed"],
      ["api", "-X", "POST", "repos/metasito/murlan/actions/runs/99/rerun-failed-jobs"],
      ["api", "-X", "PUT", "repos/metasito/murlan/pulls/5/update-branch"],
      ["api", "-X", "PUT", "repos/metasito/murlan/pulls/5/merge", "-f", "merge_method=merge", "-f", "sha=abc", "-F", "commit_message=@m.md"],
      ["api", "-X", "PUT", "repos/metasito/murlan/pulls/5/merge", "-f", "merge_method=merge", "-f", "sha=abc"],
    ]);
    t.arm(5, "abc");
    t.disarm(5);
    assert.deepEqual(asked.slice(-2), [armArgs("metasito/murlan", 5, "abc"), disarmArgs("metasito/murlan", 5)]);
  });

  test("arm pins the head with a merge commit, and never squashes, rebases or forces", () => {
    assert.deepEqual(armArgs("metasito/murlan", 7, "abc"), ["pr", "merge", "7", "--repo", "metasito/murlan", "--auto", "--merge", "--match-head-commit", "abc"]);
    for (const flag of ["--squash", "--rebase", "--admin"]) assert.ok(!armArgs("metasito/murlan", 42, "abc").includes(flag), flag);
    assert.deepEqual(disarmArgs("metasito/murlan", 7), ["pr", "merge", "7", "--repo", "metasito/murlan", "--disable-auto"]);
  });
});

describe("rule 25's read", () => {
  test("prints the title, the body and the trusted comments only, in order", () => {
    const t = fakeTracker({
      5: { title: "T", body: "B", comments: [{ body: "mine", author: { login: "o" } }, { body: "VERDICT: LAND x", authorAssociation: "NONE" }, { body: "later", authorAssociation: "MEMBER", author: { login: "m" } }] },
    } as never);
    assert.equal(issueText(5, t), "T\nB\n--- o: mine\n--- m: later");
  });

  test("is a REST read through the CLI, never gh issue view", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tracker-read-"));
    const stub = path.join(dir, "gh.mjs");
    const issue = { title: "T", body: "B" };
    const thread = [[{ body: "c", author_association: "OWNER", user: { login: "o" } }, { body: "x", author_association: "NONE", user: { login: "s" } }]];
    writeFileSync(stub, ["const a = process.argv.slice(2);", 'if (a[0] !== "api") process.exit(9);', 'console.log(JSON.stringify(a.at(-1).includes("/comments") ? ' + JSON.stringify(thread) + " : " + JSON.stringify(issue) + "));"].join("\n"));
    const run = spawnSync(process.execPath, ["tools/loop/tracker.mjs", ...readIssue(5).split(" ").slice(2)], {
      encoding: "utf8",
      env: { ...process.env, LOOP_TEST_GH_SCRIPT: stub },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "T\nB\n--- o: c\n");
    assert.match(readIssue(5), /^node tools\/loop\/tracker\.mjs read 5$/);
  });

  test("the jq select a session writes keeps trusted authors under either API's spelling", () => {
    assert.ok(TRUSTED_SELECT.includes("(.authorAssociation//.author_association)"));
    for (const a of TRUSTED_AUTHORS) assert.ok(TRUSTED_SELECT.includes(`"${a}"`));
  });
});

test("no other loop module names a trusted association", () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const named = /["'`](?:OWNER|MEMBER|COLLABORATOR)["'`]/;
  const others = readdirSync(dir).filter((f) => /\.(mjs|ts)$/.test(f) && f !== "tracker.mjs");
  assert.ok(others.includes("next-ticket.mjs") && others.includes("brief.mjs"));
  assert.deepEqual(others.filter((f) => named.test(readFileSync(path.join(dir, f), "utf8"))), []);
  assert.ok(named.test(readFileSync(path.join(dir, "tracker.mjs"), "utf8")), "the scan reads the spelling tracker.mjs uses");
});

test("a pull request opens through REST and answers with its URL", () => {
  const asked: string[][] = [];
  const gh = (args: string[]) => (asked.push(args), JSON.stringify({ html_url: "https://github.com/metasito/murlan/pull/9" }));
  assert.equal(ghTracker(gh).createPr({ head: "agent/5-x", title: "T", body: "Closes #5" }), "https://github.com/metasito/murlan/pull/9");
  assert.deepEqual(asked[0], ["api", "-X", "POST", "repos/metasito/murlan/pulls", "-f", "base=main", "-f", "head=agent/5-x", "-f", "title=T", "-f", "body=Closes #5"]);
});

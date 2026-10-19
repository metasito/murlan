import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeTracker, ghTracker, isTrusted, TRUSTED_AUTHORS, trustedComments } from "../tracker.mjs";

const ISSUE = /^repos\/metasito\/murlan\/issues\/(\d+)/;

/** A `gh api` holding one issue's labels, so the real adapter is judged by the state its calls leave. */
const ghHolding = (state: string, labels: string[]) => {
  const held = new Set(labels);
  const argv: string[][] = [];
  const gh = (args: string[]) => {
    argv.push(args);
    assert.equal(args[0], "api", "REST only: gh issue and gh pr are GraphQL");
    const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
    const path = args.find((a) => ISSUE.test(a)) ?? "";
    const label = /\/labels\/(.+)$/.exec(path)?.[1];
    if (method === "GET") return JSON.stringify({ state: state.toLowerCase(), labels: [...held].map((name) => ({ name })) });
    if (method === "POST" && path.endsWith("/labels")) {
      args.filter((a) => a.startsWith("labels[]=")).forEach((a) => held.add(a.slice("labels[]=".length)));
    }
    if (method === "DELETE" && label) {
      if (!held.delete(decodeURIComponent(label))) throw Object.assign(new Error("gh: Label does not exist (HTTP 404)"), { stderr: "gh: Label does not exist (HTTP 404)" });
    }
    return "";
  };
  return { gh, argv, held: () => [...held].sort() };
};

describe("the gh tracker and the fake agree on every transition", () => {
  const start = ["ready-for-agent", "size:S"];
  const cases: [string, (t: ReturnType<typeof fakeTracker>) => unknown, string[]][] = [
    ["claim", (t) => t.claim(7), ["in-progress", "ready-for-agent", "size:S"]],
    ["release", (t) => (t.claim(7), t.release(7)), ["ready-for-agent", "size:S"]],
    ["park", (t) => (t.claim(7), t.park(7)), ["ready-for-human", "size:S"]],
    ["park without a claim", (t) => t.park(7), ["ready-for-human", "size:S"]],
  ];
  for (const [name, act, after] of cases) {
    test(name, () => {
      const real = ghHolding("OPEN", start);
      act(ghTracker(real.gh) as unknown as ReturnType<typeof fakeTracker>);
      const fake = fakeTracker({ 7: { labels: start } });
      act(fake);
      assert.deepEqual(real.held(), after, "gh");
      assert.deepEqual(fake.held(7).labels, after, "fake");
    });
  }

  test("issue reads state and label names", () => {
    const real = ghHolding("CLOSED", ["in-progress"]);
    assert.deepEqual(ghTracker(real.gh).issue(7), { state: "CLOSED", labels: ["in-progress"] });
    assert.deepEqual(fakeTracker({ 7: { state: "CLOSED", labels: ["in-progress"] } }).issue(7), {
      state: "CLOSED",
      labels: ["in-progress"],
    });
  });
});

test("a label the tracker cannot remove for any reason but its absence is a failure", () => {
  const gh = (args: string[]) => {
    if (args.includes("DELETE")) throw Object.assign(new Error("HTTP 502"), { stderr: "gh: Bad Gateway (HTTP 502)" });
    return "";
  };
  assert.throws(() => ghTracker(gh).release(7), /502/);
});

test("a comment goes through a file, never an inline body", () => {
  const real = ghHolding("OPEN", []);
  ghTracker(real.gh).comment(7, "note.md");
  assert.deepEqual(real.argv, [["api", "-X", "POST", "repos/metasito/murlan/issues/7/comments", "-F", "body=@note.md"]]);
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

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { git } from "../../tools/loop/cli.mjs";
import { NIGHTLY } from "../e2e/tiers.mjs";
import { CODE, TARGETS, codeowners, isCode, isTarget, matcher, run, unmatched } from "../../tools/ci/target-freeze.mjs";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(root, "tools", "ci", "target-freeze.mjs");
const tracked = trackedFiles(root);
const inScratch = (p: string) => `tests/e2e/${p}`;

describe("the list looks at the repository as it is", () => {
  test("every target and code pattern names a tracked file", () => {
    assert.deepEqual(unmatched(tracked), []);
  });

  test("every nightly spec is a target, so tiers.mjs and the freeze cannot drift apart", () => {
    const nightly = tracked.filter((f) => NIGHTLY.test(f));
    assert.ok(nightly.length >= 20, `only ${nightly.length} nightly specs found`);
    assert.deepEqual(nightly.filter((f) => !isTarget(f)), []);
  });

  test("the mockups and captures are targets; their neighbours are not", () => {
    for (const f of ["tests/e2e/fixtures/lantern-table/index.html", "tests/e2e/57-polish-audit/captures/online-table__tablet.png", "tests/e2e/handParityLarge.spec.ts"]) {
      assert.ok(isTarget(f), f);
    }
    for (const f of ["tests/e2e/fixtures.ts", "tests/e2e/57-polish-audit/online-table.txt", inScratch("sub/handParityX.spec.ts"), "components/GameTable.tsx"]) {
      assert.ok(!isTarget(f), f);
    }
    assert.ok(matcher("*.nightly.spec.ts")(inScratch("deep/a.nightly.spec.ts")));
    assert.ok(isCode("lib/game/gameEngine.ts") && !isCode("library/x.ts") && !isCode("tests/lib/x.ts"));
  });

  test(".github/CODEOWNERS is the list's own rendering", () => {
    assert.equal(fs.readFileSync(path.join(root, ".github", "CODEOWNERS"), "utf8"), codeowners());
  });

  test("ci.yml runs it on every pull request and push, in a gated job with the full history", () => {
    const jobs = parse(fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8")).jobs;
    const job = jobs.secrets;
    assert.equal(job.if, undefined);
    assert.equal(job.steps[0].with["fetch-depth"], 0);
    const step = job.steps.find((s: { run?: string }) => s.run === 'node tools/ci/target-freeze.mjs "$BASE"');
    assert.equal(step?.if, "github.event_name == 'pull_request' || github.event_name == 'push'");
    assert.equal(step.env?.BASE, "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}");
    assert.ok(job.steps.indexOf(step) > job.steps.findIndex((s: { uses?: string }) => s.uses?.startsWith("actions/setup-node@")));
    assert.ok([jobs["ci-gate"].needs].flat().includes("secrets"));
  });
});

describe("planted diffs", () => {
  let dir = "";
  const at = () => git(dir);
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  const commit = (message: string) => {
    at()(["add", "-A"]);
    at()(["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", message]);
  };
  const branch = (name: string, change: () => void) => {
    at()(["switch", "-q", "-c", name, "main"]);
    change();
    commit(name);
  };
  const judge = (base = "main") => {
    const lines: string[] = [];
    return { code: run(base, at(), (l) => lines.push(l)), out: lines.join("\n") };
  };
  const representative = [...TARGETS.map((t) => tracked.find(matcher(t.pattern))!), ...CODE.map((dir) => tracked.find((f) => f.startsWith(dir))!)];
  const spares = ["tests/e2e/fixtures/lantern-table/index.html", "tests/e2e/fixtures/spare/index.html", inScratch("spare.nightly.spec.ts")];

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "target-freeze-"));
    at()(["init", "-q", "-b", "main"]);
    for (const f of [...representative, ...spares, "docs/notes.md", inScratch("other.spec.ts")]) write(f, "base\n");
    commit("base");
    branch("mixed", () => {
      write("tests/e2e/fixtures/lantern-table/index.html", "moved\n");
      write("components/GameTable.tsx", "moved\n");
    });
    branch("targets-only", () => {
      write("tests/e2e/fixtures/lantern-table/index.html", "moved\n");
      write("docs/notes.md", "the decision\n");
    });
    branch("code-only", () => {
      write("components/GameTable.tsx", "moved\n");
      write(inScratch("other.spec.ts"), "moved\n");
    });
    branch("renamed-out", () => {
      at()(["mv", "tests/e2e/fixtures/lantern-table/index.html", "tests/e2e/elsewhere.html"]);
      write("lib/x.ts", "moved\n");
    });
    branch("nightly-deleted", () => {
      fs.rmSync(path.join(dir, tracked.find((f) => NIGHTLY.test(f))!));
      write("app/x.tsx", "moved\n");
    });
    branch("empty", () => {});
    branch("floor", () => fs.rmSync(path.join(dir, "tests/e2e/tiers.mjs")));
    at()(["switch", "-q", "main"]);
    write("components/main-moved.tsx", "main\n");
    commit("main moves the code");
    branch("targets-after-main-moved", () => {
      at()(["reset", "-q", "--hard", "targets-only"]);
    });
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const on = (name: string) => {
    at()(["switch", "-q", name]);
    return judge();
  };

  test("a diff moving a mockup and a component is refused, naming both", () => {
    const { code, out } = on("mixed");
    assert.equal(code, 1);
    assert.match(out, /RULES\.md 52/);
    assert.match(out, /Targets:\n  tests\/e2e\/fixtures\/lantern-table\/index\.html\nCode:\n  components\/GameTable\.tsx/);
  });

  test("a target-only diff passes, and says it moved targets", () => {
    assert.deepEqual(on("targets-only"), { code: 0, out: "targets only (1 files)" });
  });

  test("a code-only diff passes", () => {
    assert.deepEqual(on("code-only"), { code: 0, out: "no parity target touched" });
  });

  test("renaming a mockup out of the targets beside a code change is still refused", () => {
    const { code, out } = on("renamed-out");
    assert.equal(code, 1);
    assert.match(out, /Targets:\n  tests\/e2e\/fixtures\/lantern-table\/index\.html\n/);
  });

  test("deleting a nightly spec beside an app change is refused", () => {
    const { code, out } = on("nightly-deleted");
    assert.equal(code, 1);
    assert.match(out, /Targets:\n  \S+\.nightly\.spec\.ts\nCode:\n  app\/x\.tsx/);
  });

  test("main's own code changes since the branch point are not the branch's", () => {
    assert.deepEqual(on("targets-after-main-moved"), { code: 0, out: "targets only (1 files)" });
  });

  test("an empty diff, a missing base and an unreadable base are red, not green", () => {
    assert.match(on("empty").out, /no change set to judge/);
    assert.equal(on("empty").code, 1);
    assert.equal(run(undefined, at(), () => {}), 1);
    const bad = judge("no-such-ref");
    assert.equal(bad.code, 1);
    assert.match(bad.out, /no change set from no-such-ref/);
  });

  test("a pattern that names no tracked file turns it red", () => {
    const { code, out } = on("floor");
    assert.equal(code, 1);
    assert.match(out, /name no tracked file.*tests\/e2e\/tiers\.mjs/);
  });

  test("the script ci.yml runs exits on the verdict", () => {
    at()(["switch", "-q", "mixed"]);
    const mixed = spawnSync(process.execPath, [SCRIPT, "main"], { cwd: dir, encoding: "utf8" });
    assert.equal(mixed.status, 1, mixed.stdout + mixed.stderr);
    assert.match(mixed.stdout, /::error::this change moves the parity targets/);
    at()(["switch", "-q", "code-only"]);
    assert.equal(spawnSync(process.execPath, [SCRIPT, "main"], { cwd: dir, encoding: "utf8" }).status, 0);
  });
});

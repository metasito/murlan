import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { git } from "../../tools/loop/cli.mjs";
import { NIGHTLY } from "../e2e/tiers.mjs";
import { CODE, GUARD_JOB, TARGETS, armed, codeowners, isCode, isTarget, matcher, run, unmatched } from "../../tools/ci/target-freeze.mjs";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(root, "tools", "ci", "target-freeze.mjs");
const CI = path.join(root, ".github", "workflows", "ci.yml");
const tracked = trackedFiles(root);
const inScratch = (p: string) => `tests/e2e/${p}`;
const ciText = fs.readFileSync(CI, "utf8");
const freezeStep = () => parse(ciText).jobs[GUARD_JOB].steps.find((s: { name?: string }) => s.name === "Target freeze");

describe("the list looks at the repository as it is", () => {
  test("every target and code pattern names a tracked file", () => {
    assert.deepEqual(unmatched(tracked), []);
  });

  test("every nightly spec is a target, so tiers.mjs and the freeze cannot drift apart", () => {
    const nightly = tracked.filter((f) => NIGHTLY.test(f));
    assert.ok(nightly.length >= 20, `only ${nightly.length} nightly specs found`);
    assert.deepEqual(nightly.filter((f) => !isTarget(f)), []);
  });

  test("the mockups and their staging are targets; readings of the app and their neighbours are not", () => {
    for (const f of ["tests/e2e/fixtures/lantern-table/index.html", "tests/e2e/helpers/mockupStage.ts", "tests/helpers/lanternFixture.ts", "tests/e2e/handParityLarge.spec.ts"]) {
      assert.ok(isTarget(f), f);
    }
    for (const f of [
      "tests/e2e/fixtures.ts",
      "tests/e2e/57-polish-audit/online-table.txt",
      "tests/e2e/57-polish-audit/captures/online-table__tablet.png",
      "tests/fixtures/handRow.json",
      inScratch("sub/handParityX.spec.ts"),
      "components/GameTable.tsx",
    ]) {
      assert.ok(!isTarget(f), f);
    }
    assert.ok(matcher("*.nightly.spec.ts")(inScratch("deep/a.nightly.spec.ts")));
    assert.ok(isCode("lib/game/gameEngine.ts") && !isCode("library/x.ts") && !isCode("tests/lib/x.ts"));
  });

  test(".github/CODEOWNERS is the list's own rendering", () => {
    assert.equal(fs.readFileSync(path.join(root, ".github", "CODEOWNERS"), "utf8"), codeowners());
  });

  test("ci.yml runs base's copy on every pull request and push, in a gated job with the full history", () => {
    const jobs = parse(ciText).jobs;
    assert.equal(jobs[GUARD_JOB].steps[0].with["fetch-depth"], 0);
    const step = freezeStep();
    assert.equal(step?.if, "github.event_name == 'pull_request' || github.event_name == 'push'");
    assert.equal(step.env?.BASE, "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}");
    assert.ok(armed(ciText));
    assert.ok([jobs["ci-gate"].needs].flat().includes(GUARD_JOB));
  });
});

describe("planted diffs", () => {
  let dir = "";
  const temps: string[] = [];
  const at = () => git(dir);
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  const real = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
  const edit = (file: string, from: string, to: string) => {
    const was = fs.readFileSync(path.join(dir, file), "utf8");
    assert.ok(was.includes(from), `${file} has no ${from}`);
    write(file, was.replace(from, to));
  };
  const commit = (message: string) => {
    at()(["add", "-A"]);
    at()(["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", message]);
  };
  const branch = (name: string, change: () => void, from = "main") => {
    at()(["switch", "-q", "-c", name, from]);
    change();
    commit(name);
  };
  const merge = (name: string, onto: string, other: string) => {
    at()(["switch", "-q", "-c", name, onto]);
    at()(["-c", "user.name=t", "-c", "user.email=t@example.com", "merge", "-q", "--no-ff", "-m", `merge ${other}`, other]);
  };
  const judge = (base = "main", opts = {}) => {
    const lines: string[] = [];
    return { code: run(base, at(), (l) => lines.push(l), opts), out: lines.join("\n") };
  };
  const on = (name: string, base = "main") => {
    at()(["switch", "-q", name]);
    return judge(base);
  };
  const ciStep = (name: string, base = "main") => {
    at()(["switch", "-q", name]);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "target-freeze-runner-"));
    temps.push(temp);
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", freezeStep().run], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, BASE: base, RUNNER_TEMP: temp },
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const representative = [...TARGETS.map((t) => tracked.find(matcher(t.pattern))!), ...CODE.map((d) => tracked.find((f) => f.startsWith(d))!)];
  const spares = ["tests/e2e/fixtures/lantern-table/index.html", "tests/e2e/fixtures/spare/index.html", inScratch("spare.nightly.spec.ts")];
  const tools = ["tools/ci/target-freeze.mjs", "scripts/lib/entry.mjs", "tools/loop/cli.mjs", "tools/loop/session-env.mjs", ".github/workflows/ci.yml"];
  const FIXTURE = "tests/e2e/fixtures/lantern-table/index.html";
  const SELF = "tools/ci/target-freeze.mjs";
  const CI_FILE = ".github/workflows/ci.yml";
  const targetAndCode = () => {
    write(FIXTURE, "moved\n");
    write("components/GameTable.tsx", "moved\n");
  };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "target-freeze-"));
    at()(["init", "-q", "-b", "main"]);
    for (const f of [...representative, ...spares, "docs/notes.md", inScratch("other.spec.ts")]) write(f, "base\n");
    for (const f of tools) write(f, real(f));
    commit("base");
    branch("mixed", targetAndCode);
    branch("targets-only", () => {
      write(FIXTURE, "moved\n");
      write("docs/notes.md", "the decision\n");
    });
    branch("code-only", () => {
      write("components/GameTable.tsx", "moved\n");
      write(inScratch("other.spec.ts"), "moved\n");
    });
    branch("split-commits", () => write(FIXTURE, "moved\n"));
    write("components/GameTable.tsx", "moved\n");
    commit("the code, a commit later");
    branch("renamed-out", () => {
      at()(["mv", FIXTURE, inScratch("elsewhere.html")]);
      write("lib/x.ts", "moved\n");
    });
    branch("nightly-deleted", () => {
      fs.rmSync(path.join(dir, tracked.find((f) => NIGHTLY.test(f))!));
      write("app/x.tsx", "moved\n");
    });
    branch("empty", () => {});
    branch("floor", () => fs.rmSync(path.join(dir, "tests/e2e/tiers.mjs")));
    branch("verdict-tampered", () => {
      targetAndCode();
      edit(SELF, "if (targets.length && code.length)", "if (false)");
    });
    branch("list-emptied", () => {
      targetAndCode();
      edit(SELF, "export const TARGETS = Object.freeze([", "export const TARGETS = Object.freeze([]);\nexport const WERE = Object.freeze([");
    });
    branch("step-deleted", () => {
      targetAndCode();
      edit(CI_FILE, `node "$RUNNER_TEMP/freeze-base/${SELF}" "$BASE"`, "true");
    });
    branch("gate-dropped", () => {
      targetAndCode();
      edit(CI_FILE, `[scope, ${GUARD_JOB}, `, "[scope, ");
    });
    branch("guard-job-edited", () => edit(CI_FILE, "timeout-minutes: 10\n    steps:", "timeout-minutes: 11\n    steps:"));
    branch("guard-job-edited-with-code", () => {
      edit(CI_FILE, "timeout-minutes: 10\n    steps:", "timeout-minutes: 11\n    steps:");
      write("components/GameTable.tsx", "moved\n");
    });
    branch("pre-freeze", () => fs.rmSync(path.join(dir, SELF)));
    branch("bootstrap", () => {
      write(SELF, real(SELF));
      write(FIXTURE, "moved\n");
    }, "pre-freeze");
    branch("bootstrap-mixed", () => {
      write(SELF, real(SELF));
      targetAndCode();
    }, "pre-freeze");
    at()(["switch", "-q", "main"]);
    write("components/main-moved.tsx", "main\n");
    commit("main moves the code");
    branch("targets-after-main-moved", () => at()(["reset", "-q", "--hard", "targets-only"]));
    merge("targets-merging-main", "targets-only", "main");
    merge("merge-ref-mixed", "main", "mixed");
    merge("merge-ref-targets", "main", "targets-only");
  });

  after(() => {
    for (const d of [dir, ...temps]) fs.rmSync(d, { recursive: true, force: true });
  });

  test("a diff moving a mockup and a component is refused, naming both", () => {
    const { code, out } = on("mixed");
    assert.equal(code, 1);
    assert.match(out, /RULES\.md 52/);
    assert.match(out, /Targets:\n {2}tests\/e2e\/fixtures\/lantern-table\/index\.html\nCode:\n {2}components\/GameTable\.tsx/);
  });

  test("a target-only diff passes, and says it moved targets", () => {
    assert.deepEqual(on("targets-only"), { code: 0, out: "targets only (1 files)" });
  });

  test("a code-only diff passes", () => {
    assert.deepEqual(on("code-only"), { code: 0, out: "no parity target touched" });
  });

  test("the target and the code in separate commits of one branch are refused", () => {
    assert.equal(on("split-commits").code, 1);
  });

  test("renaming a mockup out of the targets beside a code change is still refused", () => {
    const { code, out } = on("renamed-out");
    assert.equal(code, 1);
    assert.match(out, /Targets:\n {2}tests\/e2e\/fixtures\/lantern-table\/index\.html\n/);
  });

  test("deleting a nightly spec beside an app change is refused", () => {
    const { code, out } = on("nightly-deleted");
    assert.equal(code, 1);
    assert.match(out, /Targets:\n {2}\S+\.nightly\.spec\.ts\nCode:\n {2}app\/x\.tsx/);
  });

  test("main's own code changes are not the branch's: after main moved, after merging main, and on a merge ref", () => {
    assert.deepEqual(on("targets-after-main-moved"), { code: 0, out: "targets only (1 files)" });
    assert.deepEqual(on("targets-merging-main"), { code: 0, out: "targets only (1 files)" });
    assert.deepEqual(on("merge-ref-targets"), { code: 0, out: "targets only (1 files)" });
    assert.equal(on("merge-ref-mixed").code, 1);
  });

  test("a push whose tree is unchanged is green; a base that is the head itself is red", () => {
    assert.deepEqual(on("empty"), { code: 0, out: "no file changed" });
    const self = judge("HEAD");
    assert.equal(self.code, 1);
    assert.match(self.out, /HEAD is the commit under judgement/);
  });

  test("a missing base and an unreadable base are red, not green", () => {
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

  test("ci.yml's step judges a change by base's copy, so a change loosening its own copy is still refused", () => {
    for (const name of ["verdict-tampered", "list-emptied"]) {
      at()(["switch", "-q", name]);
      const headCopy = spawnSync(process.execPath, [path.join(dir, SELF), "main"], { cwd: dir, encoding: "utf8" });
      assert.equal(headCopy.status, 0, `${name}: the planted bypass no longer bypasses head's copy, so this test proves nothing`);
      const { code, out } = ciStep(name);
      assert.equal(code, 1, out);
      assert.match(out, /::error::this change moves the parity targets/);
    }
    assert.equal(ciStep("code-only").code, 0);
    assert.equal(ciStep("targets-only").code, 0);
  });

  test("a change that disarms the step or drops it from the gate is refused by base's copy", () => {
    for (const name of ["step-deleted", "gate-dropped"]) {
      const { code, out } = ciStep(name);
      assert.equal(code, 1, out);
      assert.match(out, /no longer runs base's copy of the freeze/);
    }
  });

  test("the job running the freeze is itself a target", () => {
    const alone = ciStep("guard-job-edited");
    assert.equal(alone.code, 0, alone.out);
    assert.match(alone.out, /targets only \(1 files\)/);
    const withCode = ciStep("guard-job-edited-with-code");
    assert.equal(withCode.code, 1);
    assert.match(withCode.out, /ci\.yml \(the secrets job, which runs this freeze\)/);
  });

  test("head's copy judges only while base has none, and then by the same rule", () => {
    assert.equal(ciStep("bootstrap", "pre-freeze").code, 0);
    const mixed = ciStep("bootstrap-mixed", "pre-freeze");
    assert.equal(mixed.code, 1, mixed.out);
    assert.match(mixed.out, /--bootstrap|this change moves the parity targets/);
    at()(["switch", "-q", "targets-only"]);
    const claimed = judge("main", { bootstrap: true });
    assert.equal(claimed.code, 1);
    assert.match(claimed.out, /carries tools\/ci\/target-freeze\.mjs/);
  });

  test("the script exits on the verdict", () => {
    at()(["switch", "-q", "mixed"]);
    const mixed = spawnSync(process.execPath, [SCRIPT, "main"], { cwd: dir, encoding: "utf8" });
    assert.equal(mixed.status, 1, mixed.stdout + mixed.stderr);
    assert.match(mixed.stdout, /::error::this change moves the parity targets/);
  });
});

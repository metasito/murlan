import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { parse } from "yaml";
import { git } from "../../tools/loop/cli.mjs";
import { NIGHTLY } from "../e2e/tiers.mjs";
import { CODE, JUDGES, POSTERS, TARGETS, codeowners, freezeVerdict, impostors, isCode, isTarget, matcher, retriggered, run, unmatched } from "../../tools/ci/target-freeze.mjs";
import { CHECK as VERDICT } from "../../tools/ci/verdict-check.mjs";
import { ownedBy } from "../../tools/ci/codeowners.mjs";
import { wiringOf } from "../../tools/ci/test-verdict.mjs";
import { ALIASES, localPath, resolveSpecifier } from "../helpers/specifiers.ts";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = ".github/workflows/target-freeze.yml";
const tracked = trackedFiles(root);
const APP = /^(lib|components|app|context|locales|shared)\//;
const SOURCE = /\.(ts|tsx|mjs|js)$/;
const importsOf = (file: string, text: string) => ts.preProcessFile(text, true, true).importedFiles.map((i) => i.fileName);
/** What a specifier names, or undefined when it is no relative path, mapped path or installed package. */
const place = (from: string, spec: string) => {
  try {
    return resolveSpecifier(from, spec);
  } catch {
    return undefined;
  }
};
/** A tracked file, or null when the specifier is a package; undefined when it names nothing. */
const resolveImport = (from: string, spec: string, all: Set<string>) => {
  const placed = place(from, spec);
  if (placed?.kind !== "local") return placed ? null : undefined;
  const joined = placed.path;
  const base = joined.replace(/\.(m?js|tsx?)$/, "");
  return [joined, ...[".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"].map((e) => base + e)].find((c) => all.has(c));
};
/** Test-side files reached from the roots through any import, the app files they stop at, and imports that name no tracked file. */
const reach = (roots: string[], all: string[], read: (f: string) => string) => {
  const known = new Set(all);
  const helpers = new Set<string>();
  const app = new Set<string>();
  const unresolved: string[] = [];
  const queue = [...roots];
  while (queue.length) {
    const from = queue.pop()!;
    for (const spec of importsOf(from, read(from))) {
      const file = resolveImport(from, spec, known);
      if (file === null) continue;
      if (!file) {
        unresolved.push(`${from} -> ${spec}`);
        continue;
      }
      if (roots.includes(file) || helpers.has(file) || app.has(file)) continue;
      if (APP.test(file)) app.add(file);
      else {
        helpers.add(file);
        if (SOURCE.test(file)) queue.push(file);
      }
    }
  }
  return { helpers: [...helpers], app: [...app], unresolved };
};
const PLUMBING: Record<string, string> = {
  "tests/e2e/fixtures.ts": "turns a browser error into a failure; it measures nothing and can only add failures",
  "tests/e2e/helpers/selectors.ts": "locators for the table and the hand; a locator that misses fails the spec rather than shifting a reading",
  "tests/e2e/helpers/offlineSeed.ts": "puts the app in a saved state before a spec measures; the reading is taken after it",
  "tests/e2e/helpers/press.ts": "a press that takes time; it drives the app and reads nothing",
  "tests/e2e/helpers/navigation.ts": "menu clicks that cross the chrome before a table exists",
  "tests/e2e/helpers/online.ts": "registers and joins an online room; it reads nothing",
  "tests/e2e/helpers/bot.ts": "plays a game through the UI; it asserts progress, not geometry or cost",
  "tests/e2e/helpers/labels.ts": "the Italian copy a spec looks a control up by; a changed label fails the lookup",
  "tests/support/game.ts": "builds game states for the engine; no time, size or count is read through it",
};
const SPEC_ONLY_APP: Record<string, string> = {
  "lib/game/simulate.ts": "the headless match player behind the state builders in tests/support/game.ts; no spec reads a measurement from it",
};
const inScratch = (p: string) => `tests/e2e/${p}`;
const workflowText = fs.readFileSync(path.join(root, WORKFLOW), "utf8");
const workflow = parse(workflowText);
type Step = { name?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string>; run?: string; if?: string };
const steps = (): Step[] => (Object.values(workflow.jobs)[0] as { steps: Step[] }).steps;
const freezeRun = () => steps().find((s) => s.name === "Target freeze")!.run!;

describe("the list looks at the repository as it is", () => {
  test("every target and code pattern names a tracked file", () => {
    assert.deepEqual(unmatched(tracked), []);
  });

  test("every judge names a tracked file, owned and not frozen", () => {
    for (const j of JUDGES) {
      const named = tracked.filter(matcher(j.pattern));
      assert.ok(named.length > 0, `${j.pattern} names no tracked file`);
      assert.deepEqual(named.filter(isTarget), [], j.pattern);
    }
    assert.ok(tracked.filter(matcher("tools/ci/results-*.mjs")).length >= 4, "the reporters are no longer under the judges' pattern");
  });

  test("every file of the runners' wiring is owned, so a reporter added to a config is a judge before it lands", () => {
    const wiring = wiringOf(tracked, (f) => fs.readFileSync(path.join(root, f), "utf8"), JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts);
    for (const f of ["tools/ci/e2e-budget.mjs", "tools/ci/native-budget.mjs", "tools/ci/preflightMemory.mjs", "tools/ci/results-writer.mjs", "scripts/nodeTest.mjs", "jest.config.js", "tests/native/harness/timeoutHeadroomEnvironment.mjs", "tests/native/setup.ts", "tests/native/mocks/http.ts", "tests/native/harness/assetRegistry.ts"]) assert.ok(wiring.includes(f), `${f} is not derived as wiring`);
    const owned = ownedBy(codeowners());
    assert.deepEqual(wiring.filter((f) => !owned(f)), []);
  });

  test("every nightly spec is a target, so tiers.mjs and the freeze cannot drift apart", () => {
    const nightly = tracked.filter((f) => NIGHTLY.test(f));
    assert.ok(nightly.length >= 20, `only ${nightly.length} nightly specs found`);
    assert.deepEqual(nightly.filter((f) => !isTarget(f)), []);
  });

  test("the mockups and their staging are targets; readings of the app and their neighbours are not", () => {
    for (const f of ["tests/e2e/fixtures/lantern-table/index.html", "tests/e2e/helpers/mockupStage.ts", "tests/helpers/lanternFixture.ts", "tests/e2e/handParityLarge.spec.ts", WORKFLOW]) {
      assert.ok(isTarget(f), f);
    }
    for (const f of [
      "tests/e2e/fixtures.ts",
      "tests/e2e/57-polish-audit/online-table.txt",
      "tests/e2e/57-polish-audit/captures/online-table__tablet.png",
      "tests/fixtures/handRow.json",
      inScratch("sub/handParityX.spec.ts"),
      "components/GameTable.tsx",
      ".github/workflows/ci.yml",
    ]) {
      assert.ok(!isTarget(f), f);
    }
    assert.ok(matcher("*.nightly.spec.ts")(inScratch("deep/a.nightly.spec.ts")));
    assert.ok(isCode("lib/game/gameEngine.ts") && !isCode("library/x.ts") && !isCode("tests/lib/x.ts"));
  });

  test("documentation under a code directory is not code", () => {
    const target = "tests/e2e/lampSeats.spec.ts";
    assert.equal(freezeVerdict([target, "components/CLAUDE.md"]).ok, true);
    assert.equal(freezeVerdict([target, "components/x.tsx"]).ok, false);
  });

  test("the rest spec is a target, so a change to it cannot land beside the code it judges", () => {
    const spec = "tests/e2e/tableAtRest.spec.ts";
    assert.ok(isTarget(spec));
    assert.equal(freezeVerdict([spec, "components/x.tsx"]).ok, false);
    assert.equal(freezeVerdict([spec, "tests/e2e/skiaPerf.spec.ts"]).ok, true);
  });

  test("everything a target reaches through imports is a target or plumbing with a reason, and every plumbing entry is reached", () => {
    const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
    const roots = tracked.filter((f) => isTarget(f) && SOURCE.test(f) && f.startsWith("tests/") && !f.startsWith("tests/tooling/"));
    const { helpers, unresolved } = reach(roots, tracked, read);
    assert.deepEqual(unresolved, [], "unresolved/untracked import");
    assert.ok(helpers.length >= 8, `only ${helpers.length} helpers found`);
    const reached = helpers.filter((f) => !isTarget(f));
    assert.deepEqual(reached.filter((f) => !(f in PLUMBING)), []);
    assert.deepEqual(Object.keys(PLUMBING).filter((f) => !reached.includes(f)), []);
    for (const [f, why] of Object.entries(PLUMBING)) assert.ok(why.length > 20, f);
  });

  test("app code imports nothing under tests/, so the walk that stops at app code loses no helper", () => {
    const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
    const into = tracked
      .filter((f) => APP.test(f) && SOURCE.test(f))
      .flatMap((f) => importsOf(f, read(f)).map((i) => [f, localPath(f, i, false)] as const))
      .filter(([, target]) => target?.startsWith("tests/"))
      .map(([f, target]) => `${f} -> ${target}`);
    assert.deepEqual(into, []);
  });

  test("an app file a target reaches is also imported by the app, so a threshold kept only for the specs is not hidden there", () => {
    const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
    const roots = tracked.filter((f) => isTarget(f) && SOURCE.test(f) && f.startsWith("tests/") && !f.startsWith("tests/tooling/"));
    const known = new Set(tracked);
    const appFiles = tracked.filter((f) => APP.test(f) && SOURCE.test(f) && !/\.(test|spec)\./.test(f));
    const importedByApp = new Set(appFiles.flatMap((f) => importsOf(f, read(f)).map((i) => resolveImport(f, i, known))));
    const specOnly = reach(roots, tracked, read).app.filter((f) => !importedByApp.has(f));
    assert.deepEqual(specOnly.filter((f) => !(f in SPEC_ONLY_APP)), []);
    assert.deepEqual(Object.keys(SPEC_ONLY_APP).filter((f) => !specOnly.includes(f)), []);
  });

  test("a measuring helper reached only through a plumbing module or a target, by any kind of import, is found", () => {
    const files: Record<string, string> = {
      "scratch/a.nightly.spec.ts": "import './plain'; export { COUNT } from './zzMeasure'; const x = import('./lazy.js');",
      "scratch/plain.ts": "import { y } from './counter';",
      "scratch/counter.ts": "export const y = 1;",
      "scratch/zzMeasure.ts": "export const COUNT = 1;",
      "scratch/lazy.ts": "export const z = 1;",
    };
    const { helpers } = reach(["scratch/a.nightly.spec.ts"], Object.keys(files), (f) => files[f]);
    assert.deepEqual(helpers.sort(), ["scratch/counter.ts", "scratch/lazy.ts", "scratch/plain.ts", "scratch/zzMeasure.ts"]);
  });

  test("an import that names no tracked file is reported, and a JSON import is a reached file", () => {
    const files: Record<string, string> = {
      "scratch/a.nightly.spec.ts": "import floor from './floor.json' with { type: 'json' }; import './zzUntracked';",
      "scratch/floor.json": "{}",
    };
    const found = reach(["scratch/a.nightly.spec.ts"], Object.keys(files), (f) => files[f]);
    assert.deepEqual(found.helpers, ["scratch/floor.json"]);
    assert.deepEqual(found.unresolved, ["scratch/a.nightly.spec.ts -> ./zzUntracked"]);
  });

  test("an alias from tsconfig is followed, and a specifier that is no package, relative path or alias is unresolved", () => {
    assert.ok(ALIASES.some(([prefix, dir]) => prefix === "@shared/" && dir === "shared"));
    const files: Record<string, string> = {
      "scratch/a.nightly.spec.ts": "import { f } from '@shared/zzFloor'; import { g } from '@zzunknown/x'; import fs from 'node:fs'; import { test } from '@playwright/test';",
      "shared/zzFloor.ts": "export const f = 1;",
    };
    const found = reach(["scratch/a.nightly.spec.ts"], Object.keys(files), (f) => files[f]);
    assert.deepEqual(found.app, ["shared/zzFloor.ts"]);
    assert.deepEqual(found.unresolved, ["scratch/a.nightly.spec.ts -> @zzunknown/x"]);
  });

  test("the measuring helpers are targets", () => {
    for (const f of ["renderCounters", "virtualClock", "tableTrace", "phones", "settle", "safeArea"]) assert.ok(isTarget(`tests/e2e/helpers/${f}.ts`), f);
    assert.equal(freezeVerdict(["tests/e2e/helpers/renderCounters.ts", "components/table/lampRig.ts"]).ok, false);
  });

  test(".github/CODEOWNERS is the list's own rendering", () => {
    assert.equal(fs.readFileSync(path.join(root, ".github", "CODEOWNERS"), "utf8"), codeowners());
  });
});

describe("the workflow runs base's script on the head's objects, and of the head's only its list", () => {
  test("it runs on every pull request into main, again when one is retargeted, and on nothing else", () => {
    assert.deepEqual(workflow.on, { pull_request_target: { branches: ["main"], types: ["opened", "synchronize", "reopened", "edited"] } });
  });

  test("it reads only, holds no secret and keeps no cache", () => {
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.doesNotMatch(workflowText, /secrets\.|actions\/cache|\.github\/actions\/install|\bnpm\b|\bnpx\b/);
  });

  test("one ungated job, whose name is the status check the ruleset requires", () => {
    const jobs = Object.values(workflow.jobs) as Record<string, unknown>[];
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].name, "Target freeze");
    for (const key of ["if", "permissions", "continue-on-error", "container", "services"]) assert.equal(jobs[0][key], undefined, key);
  });

  test("its actions are pinned as ci.yml pins them, and the checkout is the base's", () => {
    const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
    const uses = steps().filter((s) => s.uses);
    assert.deepEqual(uses.map((s) => s.uses!.split("@")[0]), ["actions/checkout", "actions/setup-node"]);
    for (const s of uses) assert.ok(ci.includes(`uses: ${s.uses}`), `${s.uses} is not ci.yml's pin`);
    assert.deepEqual(uses[0].with, { "fetch-depth": 0, "persist-credentials": false });
    assert.deepEqual(uses[1].with, { "package-manager-cache": false, "node-version-file": ".node-version" });
  });

  test("its one run fetches the head as objects and runs the checked-out script on them, with the pull request's fields through env", () => {
    const runs = steps().filter((s) => s.run);
    assert.equal(runs.length, 1);
    assert.equal(steps().length, 3);
    for (const s of steps()) assert.equal(s.if, undefined);
    assert.deepEqual(runs[0].env, { HEAD_SHA: "${{ github.event.pull_request.head.sha }}" });
    assert.equal(
      freezeRun(),
      [
        'git fetch --no-tags origin "+$HEAD_SHA:refs/freeze/head"',
        '[ "$(git rev-parse refs/freeze/head)" = "$HEAD_SHA" ] || { echo "::error::the fetched head is not $HEAD_SHA."; exit 1; }',
        "node tools/ci/target-freeze.mjs HEAD refs/freeze/head",
        "",
      ].join("\n"),
    );
  });

  test("no other workflow names a job Target freeze or Test verdict, whose check would stand in for the real one", () => {
    const dirOf = path.join(root, ".github", "workflows");
    const workflows = fs.readdirSync(dirOf).map((f) => ({ path: `.github/workflows/${f}`, text: fs.readFileSync(path.join(dirOf, f), "utf8") }));
    assert.ok(workflows.length > 5);
    assert.deepEqual(impostors(workflows), []);
    for (const line of ["    name: Target freeze", "    name: 'Target freeze'", '      - name: "target freeze" # x']) {
      assert.deepEqual(impostors([{ path: ".github/workflows/ci.yml", text: `jobs:\n  x:\n${line}\n` }]), [".github/workflows/ci.yml"], line);
    }
    assert.deepEqual(impostors([{ path: WORKFLOW, text: workflowText }]), []);
    const verdictPoster = ".github/workflows/test-verdict.yml";
    assert.deepEqual(impostors([{ path: ".github/workflows/ci.yml", text: "jobs:\n  x:\n    name: Test verdict\n" }]), [".github/workflows/ci.yml"]);
    assert.deepEqual(impostors([{ path: verdictPoster, text: fs.readFileSync(path.join(root, verdictPoster), "utf8") }]), []);
    assert.deepEqual(impostors([{ path: verdictPoster, text: "jobs:\n  x:\n    name: Target freeze\n" }]), [verdictPoster]);
    assert.deepEqual(impostors([{ path: ".github/workflows/ci.yml", text: `jobs:\n  x:\n    name: ${VERDICT.replace(" ", ".")}\n` }]), [], "the name is matched literally");
  });

  test("the Test verdict's poster is a target, frozen with the code, and runs on CI's workflow_run alone", () => {
    const verdictPoster = ".github/workflows/test-verdict.yml";
    assert.equal(POSTERS[VERDICT], verdictPoster);
    for (const f of [verdictPoster, "tools/ci/verdict-check.mjs", "tools/ci/verdict-name.mjs", "tests/tooling/verdictCheck.test.ts"]) {
      assert.ok(isTarget(f), f);
      assert.equal(freezeVerdict([f, "lib/game/gameEngine.ts"]).ok, false, f);
    }
    const real = fs.readFileSync(path.join(root, verdictPoster), "utf8");
    assert.deepEqual(retriggered([{ path: verdictPoster, text: real }]), []);
    const on = "on:\n  workflow_run:\n    workflows: [CI]\n    types: [completed]\n";
    for (const loose of [
      real.replace(on, `${on}  pull_request:\n`),
      real.replace(on, "on:\n  pull_request:\n  workflow_run:\n    workflows: [CI]\n    types: [completed]\n"),
      real.replace(on, "on: [pull_request, workflow_run]\n"),
      real.replace(on, '"on":\n  pull_request:\n'),
      `${real}\non:\n  push:\n`,
      real.replace(on, `${on}true:\n  pull_request:\n`),
    ]) {
      assert.notEqual(loose, real);
      assert.deepEqual(retriggered([{ path: verdictPoster, text: loose }]), [verdictPoster], loose.slice(0, 400));
    }
    assert.deepEqual(retriggered([{ path: ".github/workflows/ci.yml", text: "on: [pull_request]\n" }]), []);
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
  const branch = (name: string, change: () => void) => {
    at()(["switch", "-q", "-c", name, "main"]);
    change();
    commit(name);
  };
  const merge = (name: string, onto: string, other: string) => {
    at()(["switch", "-q", "-c", name, onto]);
    at()(["-c", "user.name=t", "-c", "user.email=t@example.com", "merge", "-q", "--no-ff", "-m", `merge ${other}`, other]);
  };
  const judge = (head: string, base = "main") => {
    const lines: string[] = [];
    return { code: run(base, head, at(), (l) => lines.push(l)), out: lines.join("\n") };
  };
  const REFUSED = /^::error::this change moves the parity targets and the code they judge together \(RULES\.md 52\)\./;
  const pulls: string[] = [];
  const asPullRequest = (name: string, headSha = at().text(["rev-parse", name])) => {
    pulls.push(name);
    const pr = String(pulls.length);
    at()(["update-ref", `refs/pull/${pr}/head`, name]);
    const runner = fs.mkdtempSync(path.join(os.tmpdir(), "target-freeze-runner-"));
    temps.push(runner);
    git(os.tmpdir())(["clone", "-q", "--branch", "main", dir, runner]);
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", freezeRun()], {
      cwd: runner,
      encoding: "utf8",
      env: { ...process.env, HEAD_SHA: headSha },
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const ownCopy = (name: string) => {
    at()(["switch", "-q", name]);
    return spawnSync(process.execPath, [path.join(dir, SELF), "main", name], { cwd: dir, encoding: "utf8" });
  };
  const representative = [...TARGETS.map((t) => tracked.find(matcher(t.pattern))!), ...CODE.map((d) => tracked.find((f) => f.startsWith(d))!)];
  const spares = ["tests/e2e/fixtures/lantern-table/index.html", "tests/e2e/fixtures/spare/index.html", inScratch("spare.nightly.spec.ts")];
  const SELF = "tools/ci/target-freeze.mjs";
  const tools = [SELF, "tools/ci/codeowners.mjs", "scripts/lib/entry.mjs", "tools/loop/cli.mjs", "tools/loop/session-env.mjs", "tools/ci/verdict-name.mjs", ".github/workflows/test-verdict.yml"];
  const FIXTURE = "tests/e2e/fixtures/lantern-table/index.html";
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
    branch("workflow-with-code", () => {
      write(WORKFLOW, "on: push\n");
      write("lib/x.ts", "moved\n");
    });
    branch("empty", () => {});
    branch("retired", () => {
      fs.rmSync(path.join(dir, "tests/e2e/tiers.mjs"));
      edit(SELF, '  { pattern: "tests/e2e/tiers.mjs", what: "which specs are nightly" },\n', "");
    });
    at()(["switch", "-q", "--orphan", "unrelated"]);
    at()(["checkout", "main", "--", "."]);
    commit("unrelated history");
    branch("emptied-kept", () => {
      fs.rmSync(path.join(dir, "tests/e2e/tiers.mjs"));
    });
    branch("emptied-quoted", () => {
      fs.rmSync(path.join(dir, "tests/e2e/tiers.mjs"));
      edit(SELF, '{ pattern: "tests/e2e/tiers.mjs"', "{ pattern: `tests/e2e/${'tiers'}.mjs`");
    });
    branch("retired-commented", () => {
      fs.rmSync(path.join(dir, "tests/e2e/tiers.mjs"));
      edit(SELF, '  { pattern: "tests/e2e/tiers.mjs", what: "which specs are nightly" },\n', '  // { pattern: "tests/e2e/tiers.mjs" },\n');
    });
    branch("head-syntax", () => edit(SELF, "export const OWNER", "}{ export const OWNER"));
    branch("head-bare", () => edit(SELF, 'import fs from "node:fs";', 'import fs from "node:fs";\nimport "zz-not-installed";'));
    branch("no-self", () => fs.rmSync(path.join(dir, SELF)));
    branch("spoof", () => {
      write(".github/workflows/ci.yml", "jobs:\n  fake:\n    name: Target freeze\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n");
      write("components/GameTable.tsx", "moved\n");
    });
    branch("verdict-tampered", () => {
      targetAndCode();
      edit(SELF, "if (targets.length && code.length)", "if (false)");
    });
    branch("list-emptied", () => {
      targetAndCode();
      edit(SELF, "export const TARGETS = Object.freeze([", "export const TARGETS = Object.freeze([]);\nexport const WERE = Object.freeze([");
    });
    at()(["switch", "-q", "main"]);
    write("components/main-moved.tsx", "main\n");
    commit("main moves the code");
    at()(["switch", "-q", "-c", "targets-after-main-moved", "targets-only"]);
    merge("targets-merging-main", "targets-only", "main");
    merge("merge-ref-mixed", "main", "mixed");
    merge("merge-ref-targets", "main", "targets-only");
    at()(["switch", "-q", "main"]);
  });

  after(() => {
    for (const d of [dir, ...temps]) fs.rmSync(d, { recursive: true, force: true });
  });

  test("a diff moving a mockup and a component is refused, naming both", () => {
    const { code, out } = judge("mixed");
    assert.equal(code, 1);
    assert.match(out, REFUSED);
    assert.match(out, /Targets:\n {2}tests\/e2e\/fixtures\/lantern-table\/index\.html\nCode:\n {2}components\/GameTable\.tsx/);
  });

  test("a target-only diff passes, and says it moved targets", () => {
    assert.deepEqual(judge("targets-only"), { code: 0, out: "targets only (1 files)" });
  });

  test("a code-only diff passes", () => {
    assert.deepEqual(judge("code-only"), { code: 0, out: "no parity target touched" });
  });

  test("the target and the code in separate commits of one branch are refused", () => {
    const { code, out } = judge("split-commits");
    assert.equal(code, 1);
    assert.match(out, REFUSED);
  });

  test("renaming a mockup out of the targets beside a code change is still refused", () => {
    const { code, out } = judge("renamed-out");
    assert.equal(code, 1);
    assert.match(out, /Targets:\n {2}tests\/e2e\/fixtures\/lantern-table\/index\.html\n/);
  });

  test("deleting a nightly spec beside an app change is refused", () => {
    const { code, out } = judge("nightly-deleted");
    assert.equal(code, 1);
    assert.match(out, /Targets:\n {2}\S+\.nightly\.spec\.ts\nCode:\n {2}app\/x\.tsx/);
  });

  test("editing the workflow beside code is refused", () => {
    const { code, out } = judge("workflow-with-code");
    assert.equal(code, 1);
    assert.match(out, /Targets:\n {2}\.github\/workflows\/target-freeze\.yml\nCode:\n {2}lib\/x\.ts/);
  });

  test("main's own code changes are not the branch's: after main moved, after merging main, and on a merge ref", () => {
    assert.deepEqual(judge("targets-after-main-moved"), { code: 0, out: "targets only (1 files)" });
    assert.deepEqual(judge("targets-merging-main"), { code: 0, out: "targets only (1 files)" });
    assert.deepEqual(judge("merge-ref-targets"), { code: 0, out: "targets only (1 files)" });
    const mixed = judge("merge-ref-mixed");
    assert.equal(mixed.code, 1);
    assert.match(mixed.out, REFUSED);
  });

  test("a head with no file changed is green; a head that is the base itself is red", () => {
    assert.deepEqual(judge("empty"), { code: 0, out: "no file changed" });
    assert.deepEqual(judge("main"), { code: 1, out: "::error::main is the commit under judgement, so there is no change set to judge." });
  });

  test("a missing or unreadable base or head is red, not green", () => {
    assert.equal(run(undefined, "mixed", at(), () => {}), 1);
    assert.equal(run("main", undefined, at(), () => {}), 1);
    for (const [base, head] of [["no-such-ref", "mixed"], ["main", "no-such-ref"]]) {
      const bad = judge(head, base);
      assert.equal(bad.code, 1);
      assert.match(bad.out, /^::error::could not read \S+ or \S+, or they share no merge base, so nothing was judged: /);
    }
  });

  test("a head sharing no history with the base is red, not green", () => {
    const bad = judge("unrelated");
    assert.equal(bad.code, 1);
    assert.match(bad.out, /or they share no merge base, so nothing was judged: Command failed: git diff /);
  });

  test("a pattern that names no file in the base turns it red", () => {
    const { code, out } = judge("mixed", "retired");
    assert.equal(code, 1);
    assert.match(out, /^::error::these patterns name no file in retired, so the freeze no longer sees them: tests\/e2e\/tiers\.mjs$/);
  });

  test("a target retires in one pull request: its file and its pattern go together", () => {
    assert.deepEqual(judge("retired"), { code: 0, out: "targets only (2 files)" });
  });

  test("a head that deletes a target's last file but keeps its pattern is red, not left to every later pull request", () => {
    const { code, out } = judge("emptied-kept");
    assert.equal(code, 1);
    assert.match(out, /^::error::these patterns name no file in emptied-kept but its list still holds them, so every later pull request would be refused: tests\/e2e\/tiers\.mjs$/);
  });

  test("head's list is the one its module evaluates to: another quoting is read, a commented pattern is not", () => {
    const quoted = judge("emptied-quoted");
    assert.equal(quoted.code, 1);
    assert.match(quoted.out, /but its list still holds them, so every later pull request would be refused: tests\/e2e\/tiers\.mjs$/);
    assert.equal(judge("retired-commented").code, 0);
  });

  test("a head whose list cannot be evaluated is red and says why, not that it could not be read", () => {
    const cause = (head: string, node?: string) => {
      const lines: string[] = [];
      const code = run("main", head, at(), (l) => lines.push(l), node);
      return { code, out: lines.join("\n") };
    };
    for (const [head, node, reason] of [
      ["head-syntax", undefined, /SyntaxError|did not evaluate/],
      ["head-bare", undefined, /zz-not-installed|ERR_MODULE_NOT_FOUND/],
      ["code-only", "24.9.0", /Node 24\.9\.0 does not deny the network/],
    ] as const) {
      const { code, out } = cause(head, node);
      assert.equal(code, 1, head);
      assert.match(out, new RegExp(`^::error::could not evaluate ${head}'s target list: `));
      assert.match(out, reason);
      assert.doesNotMatch(out, /merge base|could not read/);
    }
  });

  test("a head that deletes the script is refused with its own message", () => {
    assert.deepEqual(judge("no-self"), { code: 1, out: `::error::no-self has no ${SELF}, so no list would judge the pull requests after it.` });
  });

  test("a head whose other workflow names a job Target freeze is refused", () => {
    assert.deepEqual(judge("spoof"), {
      code: 1,
      out: "::error::.github/workflows/ci.yml names a job or step Target freeze or Test verdict outside its poster: a job so named reports a check that would stand in for the real one, and a step so named is refused because the scan cannot tell it from a job (RULES.md 52).",
    });
  });

  test("the workflow judges against the checked-out tip of main, so a head that merged a newer main is judged on its own change", () => {
    const merged = asPullRequest("targets-merging-main");
    assert.equal(merged.code, 0, merged.out);
    assert.match(merged.out, /^targets only \(1 files\)$/m);
    assert.match(judge("targets-merging-main", "main~1").out, REFUSED);
  });

  test("the workflow fetches the event's head by SHA, and a SHA it cannot fetch or match is red", () => {
    const bySha = asPullRequest("code-only", at().text(["rev-parse", "mixed"]));
    assert.match(bySha.out, REFUSED);
    for (const sha of ["1".repeat(40), ""]) {
      const bad = asPullRequest("code-only", sha);
      assert.notEqual(bad.code, 0, bad.out);
      assert.match(bad.out, sha ? /fatal: .*not our ref 1{40}/ : /^::error::the fetched head is not \.$/m);
      assert.doesNotMatch(bad.out, /^(code only|targets only|no file changed)/m);
    }
  });

  test("the workflow's run, from base's checkout, refuses a head that loosens its own copy", () => {
    for (const name of ["verdict-tampered", "list-emptied"]) {
      const own = ownCopy(name);
      assert.equal(own.status, 0, `${name}: the planted bypass no longer bypasses head's copy, so this test proves nothing\n${own.stdout}`);
      const { code, out } = asPullRequest(name);
      assert.equal(code, 1, out);
      assert.match(out, /^::error::this change moves the parity targets/m);
    }
    at()(["switch", "-q", "main"]);
  });

  test("the workflow's run passes what the rule allows, by the verdict it prints", () => {
    const targets = asPullRequest("targets-only");
    assert.equal(targets.code, 0, targets.out);
    assert.match(targets.out, /^targets only \(1 files\)$/m);
    const code = asPullRequest("code-only");
    assert.equal(code.code, 0, code.out);
    assert.match(code.out, /^no parity target touched$/m);
    const mixed = asPullRequest("mixed");
    assert.equal(mixed.code, 1, mixed.out);
    assert.match(mixed.out, /^::error::this change moves the parity targets/m);
  });
});

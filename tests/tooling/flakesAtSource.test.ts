import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments, blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";
import { trackedFiles } from "../helpers/trackedFiles.ts";
import { grepPhrases, loadAction, loadWorkflow, step, stepIn, workflowFiles, type Job, type Step } from "../helpers/workflow.ts";
import { QUARANTINE, TICKETED_DIRS, grown, run, sources, ticketsIn } from "../../tools/ci/flake-tickets.mjs";

type Quarantine = { skips: Record<string, number>; retries: Record<string, number> };
type Site = { file: string; line: number; reason: string };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const quarantine = JSON.parse(read(QUARANTINE)) as Quarantine;
const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
const CI = loadWorkflow("ci.yml");
const lineOf = (src: string, at: number) => src.slice(0, at).split("\n").length;
const tally = (sites: { file: string }[]) =>
  sites.reduce<Record<string, number>>((n, s) => ({ ...n, [s.file]: (n[s.file] ?? 0) + 1 }), {});
const where = (sites: Site[]) => sites.map((s) => `${s.file}:${s.line} ${s.reason}`).join("\n");

const TEST_COMMAND =
  /\bnpm (?:run )?test\b|\bnpm run (?:loop:test|verify)\b|\bnpx (?:jest|playwright test)\b|\bplaywright test\b|\bnode\b[^\n;&|]*\s--test\b|nodeTest\.mjs|\bmaestro\b[^\n;&|]*\stest\b/;
const RERUN_FLAG = /(?<![\w-])--(?:retries|last-failed|only-failures|onlyFailures|test-rerun-failures)\b|\brerunFailures\b/;
const RERUN_CALL = /\bgh run rerun\b|\/rerun(?:-failed-jobs)?\b/;

const units = [
  ...workflowFiles().map((f) => ({ file: `.github/workflows/${f}`, jobs: loadWorkflow(f).jobs })),
  ...trackedFiles(root, ".github/actions")
    .filter((f) => path.basename(f) === "action.yml")
    .map((f) => ({ file: f, jobs: { [path.basename(path.dirname(f))]: loadAction(path.basename(path.dirname(f))) } as Record<string, Job> })),
];
const shellLines = (script = "") => script.replace(/\\\n/g, " ").split("\n").filter((l) => !/^\s*#/.test(l));
const commands = (s: Step) => [s.run, s.with?.script].filter((c): c is string => typeof c === "string").join("\n");

function runsTests(s: Step): boolean {
  if (TEST_COMMAND.test(shellLines(commands(s)).join("\n"))) return true;
  const local = /^\.\/\.github\/actions\/([\w-]+)$/.exec(s.uses ?? "")?.[1];
  return !!local && (loadAction(local).steps ?? []).some(runsTests);
}

function leavesOnFailure(lines: string[], at: number): boolean {
  if (/\|\|\s*(?:\{[^}]*)?\bexit [1-9]/.test(lines[at])) return true;
  if (!/^\s*if ! /.test(lines[at])) return false;
  const fi = lines.findIndex((l, i) => i > at && /^\s*fi\b/.test(l));
  return fi > at && lines.slice(at + 1, fi).some((l) => /^\s*exit [1-9]/.test(l));
}

function retriedTests(script = ""): string[] {
  const lines = shellLines(script);
  let depth = 0;
  return lines.flatMap((line, i) => {
    const opens = line.match(/(?:^|[;&|])\s*do(?=\s|$)/g)?.length ?? 0;
    const closes = line.match(/(?:^|[;&|])\s*done(?=[\s;]|$)/g)?.length ?? 0;
    const looped = (depth > 0 || opens > 0) && TEST_COMMAND.test(line) && !leavesOnFailure(lines, i);
    const ored = line.split("||").filter((part) => TEST_COMMAND.test(part)).length > 1;
    depth += opens - closes;
    return looped || ored ? [line.trim()] : [];
  });
}

const everyStep = units.flatMap(({ file, jobs }) =>
  Object.entries(jobs).flatMap(([id, job]) => (job.steps ?? []).map((s, at) => ({ file, id, job, s, at }))),
);

describe("no runner retries a failing test", () => {
  test("every Playwright config and spec retries nothing", () => {
    const configs = trackedFiles(root, ":(glob)**/playwright*.config.*");
    assert.ok(configs.length >= 3, `${configs.length} Playwright configs found; the glob has stopped matching them`);
    const files = [...new Set([...configs, ...trackedFiles(root, "tests/e2e").filter((f) => /\.(?:tsx?|mjs)$/.test(f))])];
    const found = files.flatMap((file) =>
      [...blankComments(read(file)).matchAll(/\bretries\s*:\s*([^,}\n]+)/g)].map((m) => ({ file, value: m[1].trim() })),
    );
    assert.ok(found.length > 0, "no `retries:` read in any Playwright file; the base config sets it to 0");
    const retrying = found.filter((r) => r.value !== "0").map((r) => `${r.file}: retries ${r.value}`);
    assert.deepEqual(retrying, [], "a retry turns a flake green and hides it; fix the test at its source");
  });

  test("jest retries nothing", () => {
    const files = ["jest.config.js", ...trackedFiles(root, "tests/native").filter((f) => /\.[jt]sx?$/.test(f))];
    assert.ok(files.length > 50, `${files.length} jest files found; tests/native has moved`);
    assert.deepEqual(files.filter((f) => /\bretryTimes\b/.test(blankComments(read(f)))), []);
  });

  test("no script or step passes a runner a flag that reruns failures", () => {
    const texts: [string, string][] = [
      ...Object.entries(scripts).map(([name, s]): [string, string] => [`package.json ${name}`, s]),
      ["scripts/nodeTest.mjs", blankComments(read("scripts/nodeTest.mjs"))],
      ...everyStep.map(({ file, id, s }): [string, string] => [`${file} ${id}`, shellLines(commands(s)).join("\n")]),
    ];
    assert.ok(texts.length > 100, `${texts.length} scripts and steps read`);
    assert.deepEqual(texts.filter(([, t]) => RERUN_FLAG.test(t)).map(([at]) => at), []);
  });

  test("no workflow reruns a run, or uses an action that retries", () => {
    const found = everyStep
      .filter(({ s }) => RERUN_CALL.test(shellLines(commands(s)).join("\n")) || /retry|rerun/i.test(s.uses ?? ""))
      .map(({ file, id, s }) => `${file} ${id}: ${s.name ?? s.uses ?? s.run}`);
    assert.deepEqual(found, []);
  });

  test("a step that runs tests, failing, is never continued past unread", () => {
    const tested = everyStep.filter(({ s }) => runsTests(s));
    assert.ok(tested.length >= 10, `${tested.length} test steps found; the command pattern has stopped matching`);
    assert.ok(tested.some(({ s }) => !TEST_COMMAND.test(commands(s))),"no test step reached through a composite action");
    const jobs = units.flatMap(({ file, jobs }) =>
      Object.entries(jobs)
        .filter(([, j]) => j["continue-on-error"] && (j.steps ?? []).some(runsTests))
        .map(([id]) => `${file} ${id}: the whole job`),
    );
    const steps = tested
      .filter(({ s }) => s["continue-on-error"])
      .filter(({ job, s, at }) => {
        const later = (job.steps ?? []).slice(at + 1).filter((l) => !l["continue-on-error"]);
        return !s.id || !later.some((l) => JSON.stringify([l.run, l.if, l.env]).includes(`steps.${s.id}.outcome`));
      })
      .map(({ file, id, s }) => `${file} ${id}: ${s.name ?? s.id ?? s.run}`);
    assert.deepEqual([...jobs, ...steps], [], "continue-on-error on a test reads green; a later step must judge steps.<id>.outcome");
  });

  test("a test step runs twice in a job only when its first run never reached a test", () => {
    const again = everyStep.filter(({ job, s, at }) => {
      if (!runsTests(s)) return false;
      const steps = job.steps ?? [];
      const first = steps.findIndex((o) => (o.uses ?? o.run) === (s.uses ?? s.run));
      if (first === at) return false;
      const gate = new RegExp(`steps\\.${steps[first].id}\\.outcome == 'failure' && steps\\.([\\w-]+)\\.outputs\\.started == 'false'`).exec(s.if ?? "");
      const probe = gate ? steps.findIndex((o) => o.id === gate[1]) : -1;
      return !(steps[first].id && probe > first && probe < at);
    });
    assert.deepEqual(again.map(({ file, id, s }) => `${file} ${id}: ${s.name ?? s.uses ?? s.run}`), [], "running a failed test again is a retry");
  });

  test("no step loops a test command, or runs it again on failure, beyond the quarantine list", () => {
    const found = everyStep.flatMap(({ file, id, s }) => retriedTests(commands(s)).map((text) => ({ file, text: `${id}: ${text}` })));
    const listed = found.map((r) => `${r.file} ${r.text}`).join("\n");
    assert.deepEqual(tally(found), quarantine.retries, `retries outside ${QUARANTINE}, or entries it no longer needs; a failure must leave the step:\n${listed}`);
  });

  test("the loop detector sees a retry and passes a loop that leaves on failure", () => {
    assert.equal(retriedTests("for a in 1 2; do\n  npm test && exit 0\ndone").length, 1);
    assert.equal(retriedTests("npx playwright test || npx playwright test").length, 1);
    assert.equal(retriedTests("for a in 1 2 3; do\n  if ! node --test x.test.ts; then\n    exit 1\n  fi\n  git push && exit 0\ndone").length, 0);
    assert.equal(retriedTests("npm test 2>&1 | tee out.txt").length, 0);
  });
});

const verifyPhrases = grepPhrases(stepIn(CI, "Assert the integration suites actually ran").step.run ?? "");
const skipMessageBody = /export function skipMessage\(\)[^{]*\{([\s\S]*?)\n\}/.exec(read("tests/helpers/testServer.ts"))?.[1] ?? "";
const globOf = (script: string) => /"([^"]+)"\s*$/.exec(scripts[script])?.[1] ?? "";
const jobRunning = (command: RegExp) =>
  Object.values(CI.jobs).find((j) => (j.steps ?? []).some((s) => command.test(s.run ?? "")));
const onLinux = (rel: string) =>
  ([["test", /^\s*npm test\b/m], ["loop:test", /^\s*npm run loop:test\b/m]] as const).some(
    ([script, command]) => path.matchesGlob(rel, globOf(script)) && /ubuntu/.test(String(jobRunning(command)?.["runs-on"])),
  );
const skippedZero = Object.values(CI.jobs)
  .flatMap((j) => j.steps ?? [])
  .map((s) => s.run ?? "")
  .filter((r) => r.includes("'^# skipped 0$'"));
const jest = createRequire(import.meta.url)(path.join(root, "jest.config.js")) as {
  projects: { preset: string; rootDir: string; testMatch: string[] }[];
};
const jestRunsOn = (rel: string, os: string) =>
  jest.projects.some((p) => {
    const abs = `${p.rootDir}/${rel}`;
    const [keep, drop] = [p.testMatch.filter((g) => !g.startsWith("!")), p.testMatch.filter((g) => g.startsWith("!"))];
    return p.preset.endsWith(`/${os}`) && keep.some((g) => path.matchesGlob(abs, g)) && !drop.some((g) => path.matchesGlob(abs, g.slice(1)));
  });

const HEARD: [string, (s: Site, src: string) => boolean][] = [
  ["names an open issue", (s, src) => src.split("\n").slice(Math.max(0, s.line - 2), s.line).some((l) => ticketsIn(l).length > 0)],
  [
    "prints what verify's assert step fails on",
    (s) =>
      path.matchesGlob(s.file, globOf("test")) &&
      verifyPhrases.some((p) => s.reason.includes(p) || (/\bskipMessage\(\)/.test(s.reason) && skipMessageBody.includes(p))),
  ],
  [
    "runs under a step that fails on a skip",
    (s, src) =>
      skippedZero.some((r) => {
        if (r.includes(s.file)) return true;
        const pick = /grep -lE '([^']+)' ([^\s)]+)/.exec(r);
        return !!pick && path.matchesGlob(s.file, pick[2]) && src.split("\n").some((l) => new RegExp(pick[1]).test(l));
      }),
  ],
  [
    "skips off a platform CI's Linux jobs still run it on",
    (s) => /^process\.platform (?:=== "(?!linux")\w+"|!== "linux") && /.test(s.reason) && onLinux(s.file),
  ],
  [
    "skips off a platform its other jest project runs it on",
    (s) => {
      const os = /Platform\.OS === '(ios|android)' \? (it|test) : \2\.skip\b/.exec(s.reason)?.[1];
      return !!os && jestRunsOn(s.file, os);
    },
  ],
];

function closing(blank: string, open: number): number {
  let depth = 0;
  for (let i = open; i < blank.length; i++) {
    if ("([{".includes(blank[i])) depth++;
    else if (")]}".includes(blank[i]) && --depth === 0) return i;
  }
  return blank.length;
}

function topLevel(blank: string, open: number, close: number): [number, number][] {
  const parts: [number, number][] = [];
  let [depth, from] = [0, open + 1];
  for (let i = open + 1; i < close; i++) {
    if ("([{".includes(blank[i])) depth++;
    else if (")]}".includes(blank[i])) depth--;
    else if (blank[i] === "," && depth === 0) {
      parts.push([from, i]);
      from = i + 1;
    }
  }
  return [...parts, [from, close] as [number, number]].filter(([a, b]) => blank.slice(a, b).trim());
}

function skipSites(file: string, src: string): Site[] {
  const blank = blankCommentsAndStrings(src);
  const at = (i: number, reason: string): Site => ({ file, line: lineOf(src, i), reason: reason.replace(/\s+/g, " ").trim() });
  const argsOf = (i: number) => {
    const open = blank.indexOf("(", i);
    return open >= 0 && !blank.slice(i, open).trim() ? src.slice(open + 1, closing(blank, open)) : "";
  };
  const sites: Site[] = [];
  for (const m of blank.matchAll(/(?<![\w.$])(?:it|test|describe|suite)(?:\.describe)?(?:\.(?:parallel|serial))?\.(?:skip|fixme|fail|todo|failing)\b/g))
    sites.push(at(m.index, argsOf(m.index + m[0].length) || src.split("\n")[lineOf(src, m.index) - 1]));
  for (const m of blank.matchAll(/(?<![\w.$])x(?:it|test|describe)\s*\(/g)) sites.push(at(m.index, argsOf(m.index + m[0].length - 1)));
  for (const m of blank.matchAll(/(?<![\w.$])(?:(?:t|testInfo|ctx|context)\.(?:skip|todo|fixme|fail)|test\.info\(\)\.(?:skip|fixme|fail))\s*\(/g))
    sites.push(at(m.index, argsOf(m.index + m[0].length - 1)));
  for (const m of blank.matchAll(/(?<![\w.$])(?:it|test|describe|suite)(?:\.\w+)*\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    for (const [a, b] of topLevel(blank, open, closing(blank, open))) {
      const start = a + blank.slice(a, b).search(/\S/);
      if (blank[start] !== "{") continue;
      for (const [k0, k1] of topLevel(blank, start, closing(blank, start))) {
        const key = /^\s*(skip|todo)\s*(?::|$)/.exec(blank.slice(k0, k1));
        if (!key) continue;
        const value = blank.slice(k0, k1).includes(":")
          ? src.slice(k0 + blank.slice(k0, k1).indexOf(":") + 1, k1).trim()
          : (new RegExp(`^\\s*(?:const|let) ${key[1]} = (.+?);?$`, "m").exec(src)?.[1] ?? key[1]);
        if (value === "false" || /^(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|^function\b/.test(value)) continue;
        sites.push(at(k0 + blank.slice(k0, k1).search(/\S/), value));
      }
    }
  }
  return sites;
}

const scanned = sourcesUnder(root, ["tests", "tools"], /\.(?:tsx?|mjs|js)$/).filter(([rel]) => /(?:^|\/)tests\//.test(rel));
const sites = scanned.flatMap(([file, src]) => skipSites(file, src).map((s) => ({ ...s, src })));
const heardBy = (s: Site & { src: string }) => HEARD.find(([, heard]) => heard(s, s.src))?.[0];

describe("a test is skipped only where CI hears it, or with an open issue named", () => {
  test("the scan finds the suite's skips", () => {
    assert.ok(scanned.length > 500, `${scanned.length} test sources read`);
    assert.ok(sites.length >= 100, `${sites.length} skip sites found; the scan has stopped matching`);
    for (const [rule] of HEARD.slice(1)) assert.ok(sites.some((s) => heardBy(s) === rule), `no skip is heard by "${rule}": the rule reads nothing`);
  });

  test("every skip outside the quarantine list is one CI hears or one naming its issue", () => {
    const unheard = sites.filter((s) => !heardBy(s));
    assert.deepEqual(
      tally(unheard),
      quarantine.skips,
      `skips outside ${QUARANTINE}, or entries it no longer needs. Fix the test, or mark the line with \`// flake: #<open issue>\`:\n${where(unheard)}`,
    );
  });

  test("every flake ticket sits on a skip, so CI checks the issues the skips name", () => {
    const onSites = sites.filter((s) => heardBy(s) === HEARD[0][0]).flatMap((s) => s.src.split("\n").slice(Math.max(0, s.line - 2), s.line).flatMap(ticketsIn));
    assert.deepEqual([...new Set(sources(root).flatMap(ticketsIn))].sort(), [...new Set(onSites)].sort(), "a flake tag on no skip line names an issue that quarantines nothing");
  });

  test("the conditions the rules read are the ones CI runs", () => {
    assert.ok(verifyPhrases.length >= 4, "verify's assert step greps for nothing");
    assert.ok(skipMessageBody && verifyPhrases.some((p) => skipMessageBody.includes(p)), "skipMessage() prints nothing verify greps for");
    assert.ok(skippedZero.length >= 2, `${skippedZero.length} steps fail on a skip`);
    assert.ok(globOf("test") && globOf("loop:test"), "npm test or loop:test no longer ends in its glob");
    assert.ok(jestRunsOn("tests/native/theme.test.tsx", "android") && !jestRunsOn("tests/native/oneSoundPerMoment.test.tsx", "android"));
  });
});

describe("the quarantine list only shrinks, and its tickets stay open", () => {
  const gate = CI.jobs["ci-gate"];
  const check = step(gate, "Every flake ticket is open, and the quarantine list did not grow");

  test("CI gate runs the network half whatever its needs concluded, with what it reads checked out", () => {
    assert.match(check.run ?? "", /^node tools\/ci\/flake-tickets\.mjs$/);
    assert.equal(check.if, "always()");
    assert.match(String(check.env?.BASE), /github\.event\.pull_request\.base\.sha/);
    assert.equal(gate.permissions?.issues, "read");
    const sparse = String((gate.steps ?? [])[0]?.with?.["sparse-checkout"]).split("\n").map((l) => l.trim());
    for (const dir of [...TICKETED_DIRS, path.posix.dirname(QUARANTINE).split("/")[0], "scripts/lib"]) assert.ok(sparse.includes(dir), `CI gate does not check out ${dir}`);
  });

  test("a list that grew is named, one that shrank is not", () => {
    const base = { skips: { a: 2 }, retries: {} };
    assert.deepEqual(grown(base, { skips: { a: 1 }, retries: {} }), []);
    assert.equal(grown(base, { skips: { a: 3 }, retries: {} }).length, 1);
    assert.equal(grown(base, { skips: { a: 2, b: 1 }, retries: {} }).length, 1);
  });

  test("a closed ticket, a pull request, a grown list and a missing base each fail it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "flake-tickets-"));
    try {
      mkdirSync(path.join(dir, "tests", "tooling"), { recursive: true });
      mkdirSync(path.join(dir, "tools"));
      for (let i = 0; i < 100; i++) writeFileSync(path.join(dir, "tests", `f${i}.test.ts`), "");
      writeFileSync(path.join(dir, "tests", "q.test.ts"), [["//", "flake:", "#7"].join(" "), ["//", "flake:", "#8"].join(" ")].join("\n"));
      writeFileSync(path.join(dir, QUARANTINE), JSON.stringify({ skips: { a: 2 }, retries: {} }));
      const answer = (issues: Record<number, object>, baseList: object | null) => (url: string) => {
        const n = /\/issues\/(\d+)$/.exec(url)?.[1];
        const body = n ? issues[Number(n)] : baseList;
        return Promise.resolve(new Response(body ? JSON.stringify(body) : "", { status: body ? 200 : 404 }));
      };
      const verdict = async (env: Record<string, string>, issues: Record<number, object>, baseList: object | null) => {
        const lines: string[] = [];
        const code = await run({ GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", ...env }, { fetch: answer(issues, baseList) as typeof fetch, log: (l) => lines.push(l), root: dir });
        return { code, out: lines.join("\n") };
      };
      const open = { state: "open" };
      assert.equal((await verdict({ BASE: "abc" }, { 7: open, 8: open }, { skips: { a: 2 }, retries: {} })).code, 0);
      assert.equal((await verdict({ BASE: "abc" }, { 7: open, 8: open }, null)).code, 0);
      assert.match((await verdict({ BASE: "abc" }, { 7: open, 8: { state: "closed" } }, null)).out, /#8 is closed/);
      assert.match((await verdict({ BASE: "abc" }, { 7: open, 8: { state: "open", pull_request: {} } }, null)).out, /#8 is a pull request/);
      assert.match((await verdict({ BASE: "abc" }, { 7: open }, null)).out, /#8: HTTP 404/);
      assert.match((await verdict({ BASE: "abc" }, { 7: open, 8: open }, { skips: { a: 1 }, retries: {} })).out, /went from 1 to 2/);
      assert.equal((await verdict({ EVENT: "pull_request" }, { 7: open, 8: open }, null)).code, 1);
      assert.equal((await verdict({ GH_TOKEN: "" }, {}, null)).code, 1);
      rmSync(path.join(dir, "tests"), { recursive: true });
      mkdirSync(path.join(dir, "tests"));
      assert.match((await verdict({ BASE: "abc" }, {}, null)).out, /does not hold the tests/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

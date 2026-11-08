import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments, blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";
import { trackedFiles } from "../helpers/trackedFiles.ts";
import { grepPhrases, loadAction, loadWorkflow, stepIn, workflowFiles, type Job, type Step } from "../helpers/workflow.ts";
import { LABEL, QUARANTINE, SOURCE, TICKETED_DIRS, grown, run, ticketsIn } from "../../tools/ci/flake-tickets.mjs";
import { git } from "../../tools/loop/cli.mjs";

type Quarantine = { skips: Record<string, number>; retries: Record<string, number> };
type Site = { file: string; line: number; kind: "member" | "x" | "call" | "option"; reason: string };
type Shell = { errexit: boolean; pipefail: boolean };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const quarantine = JSON.parse(read(QUARANTINE)) as Quarantine;
const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
const CI = loadWorkflow("ci.yml");
const lineOf = (src: string, at: number) => src.slice(0, at).split("\n").length;
const tally = (sites: { file: string }[]) =>
  sites.reduce<Record<string, number>>((n, s) => ({ ...n, [s.file]: (n[s.file] ?? 0) + 1 }), {});
const where = (sites: Site[]) => sites.map((s) => `${s.file}:${s.line} ${s.reason}`).join("\n");

const RUNNER =
  /\bnpm (?:run )?test\b|\bnpm run (?:loop:test|verify)\b|\bnpx (?:jest|playwright test)\b|\bplaywright test\b|(?:^|[\s;&|(])jest(?:\s|$)|\bnode\b[^\n;&|]*\s--test\b|nodeTest\.mjs|\bmaestro\b[^\n;&|]*\stest\b/;
const testScripts = Object.keys(scripts).filter((name) => RUNNER.test(scripts[name]));
const shellScripts = trackedFiles(root, ":(glob)**/*.sh").filter((f) => !f.startsWith("docs/"));
const testShells = shellScripts.filter((f) => RUNNER.test(read(f)));
const RERUN_FLAG = /(?<![\w-])--(?:retries|last-failed|only-failures|onlyFailures|test-rerun-failures)\b|\brerunFailures\b/;
const RERUN_CALL = /\bgh run rerun\b|\/rerun(?:-failed-jobs)?\b/;
const EXITS = /^(?:exit\s+[1-9]\d*|\{[\s\S]*\bexit\s+[1-9]\d*\s*;?\s*\})$/;

function stripComments(script: string): string {
  let [out, quote] = ["", ""];
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (quote) {
      out += c;
      if (c === "\\" && quote === '"') out += script[++i] ?? "";
      else if (c === quote) quote = "";
    } else if (c === "\\") out += c + (script[++i] ?? "");
    else if (c === "'" || c === '"') [out, quote] = [out + c, c];
    else if (c === "#" && (i === 0 || /\s/.test(script[i - 1]))) {
      while (i + 1 < script.length && script[i + 1] !== "\n") i++;
    } else out += c;
  }
  return out.replace(/\\\n/g, " ");
}

function splitTop(text: string, at: (i: number) => number): { text: string; cut: string }[] {
  const parts: { text: string; cut: string }[] = [];
  let [quote, depth, from] = ["", 0, 0];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote !== "'") i++;
      else if (c === quote) quote = "";
    } else if (c === "\\") i++;
    else if ("'\"`".includes(c)) quote = c;
    else if ("({".includes(c)) depth++;
    else if (")}".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const width = at(i);
      if (!width) continue;
      parts.push({ text: text.slice(from, i).trim(), cut: text.slice(i, i + width) });
      from = i + width;
      i += width - 1;
    }
  }
  return [...parts, { text: text.slice(from).trim(), cut: "" }];
}

function statements(script: string): { text: string; background: boolean }[] {
  const src = stripComments(script);
  const ends = (i: number) =>
    src[i] === "\n" || (src[i] === ";" && src[i + 1] !== ";" && src[i - 1] !== ";")
      ? 1
      : src[i] === "&" && !"&>|".includes(src[i + 1] ?? " ") && !"&>|".includes(src[i - 1] ?? " ")
        ? 1
        : 0;
  return splitTop(src, ends)
    .filter((p) => p.text)
    .flatMap(({ text, cut }) => {
      const out: string[] = [];
      let rest = text;
      for (let m; (m = /^(then|do|else)\s+([\s\S]+)$/.exec(rest)); rest = m[2]) out.push(m[1]);
      return [...out, rest].map((t, i, all) => ({ text: t, background: cut === "&" && i === all.length - 1 }));
    });
}

const segments = (statement: string) => {
  const ops = splitTop(statement, (i) => (["&&", "||"].includes(statement.slice(i, i + 2)) ? 2 : statement[i] === "|" ? 1 : 0));
  return ops.map((p, i) => ({ text: p.text, before: i ? ops[i - 1].cut : "" }));
};

function isTest(segment: string): boolean {
  const command = segment.replace(/^(?:(?:if|elif|while|until|then|do|else|time|!|\{|\()\s*|\w+=\S*\s+)+/, "");
  if (/^(?:echo|printf)\b/.test(command)) return false;
  return (
    RUNNER.test(command) ||
    testScripts.some((name) => new RegExp(`\\bnpm run ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w:-])`).test(command)) ||
    testShells.some((f) => command.includes(f))
  );
}

/** Every place in a script where a failing test can still leave it green. */
function shellFindings(script: string, mode: Shell): string[] {
  const all = statements(script);
  const level: number[] = [];
  for (let d = 0, i = 0; i < all.length; i++) {
    if (/^(?:fi|done|esac)\b/.test(all[i].text)) d = Math.max(0, d - 1);
    level.push(d);
    if (/^(?:if|for|while|until|case|select)\b/.test(all[i].text)) d++;
  }
  const last = level.lastIndexOf(0);
  let { errexit, pipefail } = mode;
  let lifted = false;
  const found: string[] = [];
  const stack: { kind: string; tested: boolean; needs: "" | "then" | "else"; part: string; exits: Set<string> }[] = [];
  const tail = (frame: (typeof stack)[number] | undefined, text: string) => {
    const segs = segments(text);
    if (frame?.tested && segs[1]?.before === "||" && !EXITS.test(segs[1].text)) found.push(`a compound holding a test ends in ||: ${text}`);
  };
  all.forEach(({ text, background }, i) => {
    if (/^set\b/.test(text)) {
      if (/\s-[a-z]*e|-o\s+errexit/.test(text)) [errexit, lifted] = [true, false];
      if (/\s\+[a-z]*e|\+o\s+errexit/.test(text)) lifted = true;
      if (/-o\s+pipefail/.test(text)) pipefail = true;
      if (/\+o\s+pipefail/.test(text)) pipefail = false;
    }
    const segs = segments(text);
    const tested = segs.map((s) => isTest(s.text));
    if (tested.some(Boolean)) for (const f of stack) f.tested = true;
    const top = stack.at(-1);
    if (top && /\bexit\s+[1-9]/.test(text)) top.exits.add(top.part);
    const keyword = /^(if|elif|while|until|for|case|select|then|else|fi|done|esac)\b/.exec(text)?.[1];
    if (keyword === "if" || keyword === "elif") {
      if (keyword === "if") stack.push({ kind: "if", tested: false, needs: "", part: "cond", exits: new Set() });
      if (tested.some(Boolean)) {
        if (keyword === "elif") found.push(`an elif's condition swallows a test's failure: ${text}`);
        else stack.at(-1)!.needs = /^if\s+!/.test(text) ? "then" : "else";
      }
      return;
    }
    if (keyword === "while" || keyword === "until") {
      if (tested.some(Boolean)) found.push(`a loop on a test's status runs it until it passes: ${text}`);
      stack.push({ kind: "loop", tested: false, needs: "", part: "body", exits: new Set() });
      return;
    }
    if (keyword === "for" || keyword === "case" || keyword === "select") {
      stack.push({ kind: keyword, tested: false, needs: "", part: "body", exits: new Set() });
      return;
    }
    if ((keyword === "then" || keyword === "else") && top) {
      top.part = keyword;
      return;
    }
    if (keyword === "fi" || keyword === "done" || keyword === "esac") {
      const frame = stack.pop();
      if (frame?.needs && !frame.exits.has(frame.needs))
        found.push(`an if on a test whose failure branch (${frame.needs}) does not exit non-zero`);
      tail(frame, text);
      return;
    }
    if (/^!\s/.test(text) && tested.some(Boolean)) found.push(`! turns a test's failure into success: ${text}`);
    if (background && tested.some(Boolean)) found.push(`a test sent to the background is never waited on: ${text}`);
    segs.forEach((seg, k) => {
      if (!tested[k]) return;
      const next = segs[k + 1];
      const guarded = next?.before === "||" && EXITS.test(next.text);
      if (next?.before === "||" && !guarded) found.push(`|| after a test, not an exit: ${text}`);
      if (next?.before === "&&" && !(i === last && level[i] === 0)) found.push(`&& after a test, which errexit does not see: ${text}`);
      if (next?.before === "|" && !pipefail) found.push(`a pipe without pipefail reports the last command, not the test: ${text}`);
      if (lifted && !guarded) found.push(`set +e lifts errexit over a test: ${text}`);
      if (!errexit && !guarded && !(i === last && level[i] === 0)) found.push(`without errexit a test before the last command is not the verdict: ${text}`);
    });
  });
  return found;
}

const units = [
  ...workflowFiles().map((f) => ({ file: `.github/workflows/${f}`, env: loadWorkflow(f).env, jobs: loadWorkflow(f).jobs })),
  ...trackedFiles(root, ".github/actions")
    .filter((f) => path.basename(f) === "action.yml")
    .map((f) => ({ file: f, env: undefined, jobs: { [path.basename(path.dirname(f))]: loadAction(path.basename(path.dirname(f))) } as Record<string, Job> })),
];
const commands = (s: Step) => [s.run, s.with?.script].filter((c): c is string => typeof c === "string").join("\n");
const shellOf = (s: Step, job: Job): Shell | string => {
  const shell = s.shell ?? (/windows/.test(String(job["runs-on"])) ? "pwsh" : undefined);
  if (shell === undefined || shell === "sh") return { errexit: true, pipefail: false };
  if (shell === "bash") return { errexit: true, pipefail: true };
  return shell;
};

function runsTests(s: Step): boolean {
  if (statements(commands(s)).some(({ text }) => segments(text).some((seg) => isTest(seg.text)))) return true;
  const local = /^\.\/\.github\/actions\/([\w-]+)$/.exec(s.uses ?? "")?.[1];
  return !!local && (loadAction(local).steps ?? []).some(runsTests);
}

const everyStep = units.flatMap(({ file, env, jobs }) =>
  Object.entries(jobs).flatMap(([id, job]) => (job.steps ?? []).map((s, at) => ({ file, env, id, job, s, at }))),
);
const sameStep = (a: Step) => JSON.stringify([a.uses, a.with, a.run]).replace(/\s+/g, " ");

/** A step that reruns an earlier one, gated on a probe between them that read no test as started. */
function probedRerun(job: Job, at: number): boolean {
  const steps = job.steps ?? [];
  const first = steps.findIndex((o) => sameStep(o) === sameStep(steps[at]));
  if (first === at || !steps[first].id) return false;
  const gate = new RegExp(`^steps\\.${steps[first].id}\\.outcome == 'failure' && steps\\.([\\w-]+)\\.outputs\\.started == 'false'$`).exec(steps[at].if ?? "");
  const probe = gate ? steps.findIndex((o) => o.id === gate[1]) : -1;
  return probe > first && probe < at;
}

const FAILURE_GATE = /\bfailure\(\)|\.(?:outcome|conclusion|result)\s*==\s*'failure'|!=\s*'success'/;
const judged = [
  ...everyStep
    .filter(({ s }) => runsTests(s))
    .map(({ file, id, job, s }) => ({ file, at: `${id}: ${s.name ?? s.id ?? s.run}`, script: commands(s), under: shellOf(s, job) })),
  ...Object.entries(scripts).map(([name, script]) => ({ file: "package.json", at: name, script, under: { errexit: false, pipefail: false } as Shell | string })),
  ...shellScripts.map((file) => ({ file, at: file, script: read(file), under: { errexit: false, pipefail: false } as Shell | string })),
];

describe("no runner retries a failing test", () => {
  test("every Playwright config, as Playwright itself resolves it, retries nothing", () => {
    const configs = trackedFiles(root, ":(glob)**/playwright*.config.*");
    assert.ok(configs.length >= 3, `${configs.length} Playwright configs found; the glob has stopped matching them`);
    const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
    for (const config of configs) {
      const out = spawnSync(process.execPath, [cli, "test", "--list", "--reporter=json", "--config", config], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CI: "1" },
        maxBuffer: 64 * 1024 * 1024,
      }).stdout;
      const listed = JSON.parse(out.slice(Math.max(0, out.search(/^\{/m)))) as { config: { projects: { name: string; retries: number }[] }; errors: unknown[] };
      assert.deepEqual(listed.errors, [], `${config} does not load`);
      assert.ok(listed.config.projects.length > 0, `${config} resolves no project`);
      const retrying = listed.config.projects.filter((p) => p.retries !== 0).map((p) => `${config} ${p.name}: retries ${p.retries}`);
      assert.deepEqual(retrying, [], "a retry turns a flake green and hides it; fix the test at its source");
    }
  });

  test("no tracked file asks jest or a Playwright describe to retry", () => {
    const jestRetry = new RegExp(`\\b${["retry", "Times"].join("")}\\b`);
    const describeRetry = /\.configure\(\s*\{[^}]*\bretries\b/;
    const texts = trackedFiles(root)
      .map((f) => [f, readFileSync(path.join(root, f))] as const)
      .filter(([, bytes]) => !bytes.includes(0))
      .map(([f, bytes]) => [f, bytes.toString("utf8")] as const);
    assert.ok(texts.length > 1000, `${texts.length} tracked text files read`);
    assert.deepEqual(texts.filter(([, t]) => jestRetry.test(t) || describeRetry.test(t)).map(([f]) => f), []);
  });

  test("no script, step or env passes a runner a flag that reruns failures", () => {
    const texts: [string, string][] = [
      ...Object.entries(scripts).map(([name, s]): [string, string] => [`package.json ${name}`, s]),
      ["scripts/nodeTest.mjs", blankComments(read("scripts/nodeTest.mjs"))],
      ...units.map(({ file, env }): [string, string] => [`${file} env`, JSON.stringify(env ?? {})]),
      ...everyStep.map(({ file, id, job, s }): [string, string] => [`${file} ${id}`, [stripComments(commands(s)), JSON.stringify([job.env, s.env, s.with])].join("\n")]),
    ];
    assert.ok(texts.length > 100, `${texts.length} scripts and steps read`);
    assert.deepEqual(texts.filter(([, t]) => RERUN_FLAG.test(t)).map(([at]) => at), []);
  });

  test("no workflow reruns a run, or uses an action that retries", () => {
    const found = everyStep
      .filter(({ s }) => RERUN_CALL.test(stripComments(commands(s))) || /retry|rerun/i.test(s.uses ?? ""))
      .map(({ file, id, s }) => `${file} ${id}: ${s.name ?? s.uses ?? s.run}`);
    assert.deepEqual(found, []);
  });

  test("a step that runs tests, failing, is never continued past unread", () => {
    const tested = everyStep.filter(({ s }) => runsTests(s));
    assert.ok(tested.length >= 10, `${tested.length} test steps found; the command pattern has stopped matching`);
    assert.ok(tested.some(({ s }) => !RUNNER.test(commands(s))), "no test step reached through a composite action");
    const jobs = units.flatMap(({ file, jobs }) =>
      Object.entries(jobs)
        .filter(([, j]) => j["continue-on-error"] && (j.steps ?? []).some(runsTests))
        .map(([id]) => `${file} ${id}: the whole job`),
    );
    const steps = tested
      .filter(({ s }) => s["continue-on-error"])
      .filter(({ job, s, at }) => {
        const judges = new RegExp(`steps\\.${s.id}\\.outcome\\s*(?:==\\s*'failure'|!=\\s*'success')`);
        const later = (job.steps ?? []).slice(at + 1).filter((l) => !l["continue-on-error"]);
        return !s.id || !later.some((l) => judges.test(l.if ?? "") && statements(l.run ?? "").some(({ text }) => /\bexit\s+[1-9]/.test(text)));
      })
      .map(({ file, id, s }) => `${file} ${id}: ${s.name ?? s.id ?? s.run}`);
    assert.deepEqual([...jobs, ...steps], [], "continue-on-error on a test reads green; a later step gated on steps.<id>.outcome failing must exit 1");
  });

  test("no step or job that runs tests runs only once something has failed", () => {
    const jobs = units.flatMap(({ file, jobs }) =>
      Object.entries(jobs)
        .filter(([, j]) => FAILURE_GATE.test(j.if ?? "") && (j.steps ?? []).some(runsTests))
        .map(([id]) => `${file} ${id}: the whole job`),
    );
    const steps = everyStep
      .filter(({ job, s, at }) => FAILURE_GATE.test(s.if ?? "") && runsTests(s) && !probedRerun(job, at))
      .map(({ file, id, s }) => `${file} ${id}: ${s.name ?? s.id ?? s.run}`);
    assert.deepEqual([...jobs, ...steps], [], "a test run on failure is a retry, or a check nobody reads on success");
  });

  test("a test step runs twice in a job only when its first run never reached a test", () => {
    const again = everyStep.filter(({ job, s, at }) => {
      const steps = job.steps ?? [];
      return runsTests(s) && steps.findIndex((o) => sameStep(o) === sameStep(s)) !== at && !probedRerun(job, at);
    });
    assert.deepEqual(again.map(({ file, id, s }) => `${file} ${id}: ${s.name ?? s.uses ?? s.run}`), [], "running a failed test again is a retry");
  });

  test("no step, script or shell script lets a failing test leave it green, beyond the quarantine list", () => {
    assert.ok(judged.filter((j) => j.file.endsWith(".sh")).length >= 4, "fewer than four shell scripts read");
    assert.ok(testScripts.length >= 4, `${testScripts.length} package.json scripts run tests`);
    const found = judged.flatMap(({ file, at, script, under }) =>
      typeof under === "string" ? [{ file, text: `${at}: runs tests under ${under}, which this judge cannot read` }] : shellFindings(script, under).map((text) => ({ file, text: `${at}: ${text}` })),
    );
    const listed = found.map((r) => `${r.file} ${r.text}`).join("\n");
    assert.deepEqual(tally(found), quarantine.retries, `retries outside ${QUARANTINE}, or entries it no longer needs; a failure must leave the step:\n${listed}`);
  });

  test("the judge sees every way a failing test is made green, and passes a loop that leaves on failure", () => {
    const bash = { errexit: true, pipefail: false };
    const red = [
      "for a in 1 2; do\n  npm test && exit 0\ndone",
      "npx playwright test || npx playwright test",
      "npm test || true",
      "until npm test\ndo\n  sleep 1\ndone",
      "while ! node --test x.test.ts\ndo\n  :\ndone",
      "if ! npm test; then\n  npm test\nfi",
      "if npm test; then\n  echo ok\nfi",
      "set +e\nnpm test\nexit 0",
      "npm test | tee out.txt",
      "! npm test",
      "npm test &",
      "for a in 1 2; do\n  npm test\ndone || true",
      "npm run test:e2e || echo flaky",
    ];
    for (const script of red) assert.ok(shellFindings(script, bash).length > 0, `not seen: ${script}`);
    assert.ok(shellFindings("npm test\necho done", { errexit: false, pipefail: false }).length > 0, "a test before the last command, without errexit");
    const green = [
      "for a in 1 2 3; do\n  if ! node --test x.test.ts; then\n    exit 1\n  fi\n  git push && exit 0\ndone",
      "npm test 2>&1 | tee out.txt # pipefail",
      "npm test || { echo '::error::failed'; exit 1; }",
      'echo "run npx playwright test again" || true',
      "npm run lint && npm test",
    ];
    for (const script of green) assert.deepEqual(shellFindings(script, { errexit: true, pipefail: true }), [], script);
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

const literalsOf = (expr: string): string[] | null => {
  const quoted = /^(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)')$/.exec(expr);
  if (quoted) return [quoted[1] ?? quoted[2]];
  if (/^`[^`]*`$/.test(expr)) return [expr.slice(1, -1).replace(/\$\{[^}]*\}/g, "")];
  if (expr === "skipMessage()") return [...skipMessageBody.matchAll(/"((?:[^"\\\n]|\\.)*)"|`([^`]*)`/g)].map((m) => (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ""));
  return null;
};
const reasonLiterals = (s: Site): string[] | null => {
  if (s.kind === "call") return literalsOf(s.reason);
  if (s.kind !== "option") return null;
  const shape = /^[\s\S]+&&\s*([\s\S]+)$/.exec(s.reason) ?? /^[^?]+\?\s*([\s\S]+?)\s*:\s*false$/.exec(s.reason) ?? /^[^?]+\?\s*false\s*:\s*([\s\S]+)$/.exec(s.reason);
  return shape ? literalsOf(shape[1].trim()) : null;
};

const HEARD: [string, (s: Site, src: string) => boolean][] = [
  ["names an open issue", (s, src) => src.split("\n").slice(Math.max(0, s.line - 2), s.line).some((l) => ticketsIn(l).length > 0)],
  [
    "prints what verify's assert step fails on",
    (s) => {
      const literals = reasonLiterals(s);
      return path.matchesGlob(s.file, globOf("test")) && !!literals?.length && literals.every((l) => verifyPhrases.some((p) => l.includes(p)));
    },
  ],
  [
    "runs under a step that fails on a skip",
    (s, src) =>
      (s.kind === "call" || s.kind === "option") &&
      skippedZero.some((r) => {
        if (r.includes(s.file)) return true;
        const pick = /grep -lE '([^']+)' ([^\s)]+)/.exec(r);
        return !!pick && path.matchesGlob(s.file, pick[2]) && src.split("\n").some((l) => new RegExp(pick[1]).test(l));
      }),
  ],
  [
    "skips off a platform CI's Linux jobs still run it on",
    (s) => {
      const lit = /^process\.platform (?:=== "(?!linux")\w+"|!== "linux") && ([\s\S]+)$/.exec(s.reason)?.[1];
      return s.kind === "option" && !!lit && !!literalsOf(lit) && onLinux(s.file);
    },
  ],
  [
    "skips off a platform its other jest project runs it on",
    (s) => {
      const os = /Platform\.OS === '(ios|android)' \? (it|test) : \2\.skip\b/.exec(s.reason)?.[1];
      return s.kind === "member" && !!os && jestRunsOn(s.file, os);
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
  const text = blankComments(src);
  const at = (i: number, kind: Site["kind"], reason: string): Site => ({ file, line: lineOf(src, i), kind, reason: reason.replace(/\s+/g, " ").trim() });
  const argsOf = (i: number) => {
    const open = blank.indexOf("(", i);
    return open >= 0 && !blank.slice(i, open).trim() ? text.slice(open + 1, closing(blank, open)) : "";
  };
  const sites: Site[] = [];
  for (const m of blank.matchAll(/(?<![\w.$])(?:it|test|describe|suite)(?:\.describe)?(?:\.(?:parallel|serial))?\.(?:skip|fixme|fail|todo|failing)\b/g))
    sites.push(at(m.index, "member", argsOf(m.index + m[0].length) || text.split("\n")[lineOf(src, m.index) - 1]));
  for (const m of blank.matchAll(/(?<![\w.$])x(?:it|test|describe)\s*\(/g)) sites.push(at(m.index, "x", argsOf(m.index + m[0].length - 1)));
  for (const m of blank.matchAll(/(?<![\w.$])(?:(?:t|testInfo|ctx|context)\.(?:skip|todo|fixme|fail)|test\.info\(\)\.(?:skip|fixme|fail))\s*\(/g))
    sites.push(at(m.index, "call", argsOf(m.index + m[0].length - 1)));
  for (const m of blank.matchAll(/(?<![\w.$])(?:it|test|describe|suite)(?:\.\w+)*\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    for (const [a, b] of topLevel(blank, open, closing(blank, open))) {
      const start = a + blank.slice(a, b).search(/\S/);
      if (blank[start] !== "{") continue;
      for (const [k0, k1] of topLevel(blank, start, closing(blank, start))) {
        const key = /^\s*(skip|todo)\s*(?::|$)/.exec(blank.slice(k0, k1));
        if (!key) continue;
        const value = blank.slice(k0, k1).includes(":")
          ? text.slice(k0 + blank.slice(k0, k1).indexOf(":") + 1, k1).trim()
          : (new RegExp(`^\\s*(?:const|let) ${key[1]} = (.+?);?$`, "m").exec(text)?.[1] ?? key[1]);
        if (value === "false" || /^(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|^function\b/.test(value)) continue;
        sites.push(at(k0 + blank.slice(k0, k1).search(/\S/), "option", value));
      }
    }
  }
  return sites;
}

const scanned = sourcesUnder(root, TICKETED_DIRS, SOURCE).filter(([rel]) => /(?:^|\/)tests\//.test(rel));
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

  test("a reason is heard by its literal, never by a comment or a computed string", () => {
    const file = ["tests", "tooling", "x.test.ts"].join("/");
    const site = (kind: Site["kind"], reason: string): Site => ({ file, line: 1, kind, reason });
    const phrase = verifyPhrases[0];
    const heard = (s: Site) => HEARD[1][1](s, "");
    assert.ok(heard(site("option", `!ready && "${phrase}"`)));
    assert.ok(heard(site("option", `ready ? "${phrase}" : false`)));
    assert.ok(heard(site("call", `"${phrase}"`)));
    assert.ok(!heard(site("option", `!ready && reasonFor("${phrase}")`)));
    assert.ok(!heard(site("option", `!ready && "unrelated"`)));
    assert.ok(!heard(site("member", `"${phrase}", () => {}`)));
    const [parsed] = skipSites(file, `test("a", { skip: !ready && "unrelated" /* ${phrase} */ }, () => {});`);
    assert.ok(parsed && !heard(parsed), "a phrase in a comment is heard");
    const platform = (reason: string) => HEARD[3][1](site("option", reason), "");
    assert.ok(platform(`process.platform === "win32" && "no symlinks"`));
    assert.ok(!platform(`process.platform === "win32" && other && "no symlinks"`));
    assert.ok(!platform(`process.platform === "win32" || "no symlinks"`));
  });

  test("every flake ticket sits on a skip, so CI checks the issues the skips name", () => {
    const onSites = sites.filter((s) => heardBy(s) === HEARD[0][0]).flatMap((s) => s.src.split("\n").slice(Math.max(0, s.line - 2), s.line).flatMap(ticketsIn));
    const tagged = sourcesUnder(root, TICKETED_DIRS, SOURCE).flatMap(([, src]) => ticketsIn(src));
    assert.deepEqual([...new Set(tagged)].sort(), [...new Set(onSites)].sort(), "a flake tag on no skip line names an issue that quarantines nothing");
  });

  test("the conditions the rules read are the ones CI runs", () => {
    assert.ok(verifyPhrases.length >= 4, "verify's assert step greps for nothing");
    assert.ok(skipMessageBody && literalsOf("skipMessage()")!.every((l) => verifyPhrases.some((p) => l.includes(p))), "skipMessage() prints something verify greps nothing for");
    assert.ok(skippedZero.length >= 2, `${skippedZero.length} steps fail on a skip`);
    assert.ok(globOf("test") && globOf("loop:test"), "npm test or loop:test no longer ends in its glob");
    assert.ok(jestRunsOn("tests/native/theme.test.tsx", "android") && !jestRunsOn("tests/native/oneSoundPerMoment.test.tsx", "android"));
  });
});

describe("the quarantine list only shrinks, and its tickets stay open and labelled", () => {
  test("a list that grew is named, one that shrank is not", () => {
    const base = { skips: { a: 2 }, retries: {} };
    assert.deepEqual(grown(base, { skips: { a: 1 }, retries: {} }), []);
    assert.equal(grown(base, { skips: { a: 3 }, retries: {} }).length, 1);
    assert.equal(grown(base, { skips: { a: 2, b: 1 }, retries: {} }).length, 1);
  });

  test("it reads base and head as commits, falls back to the default branch, and fails on each bad ticket", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "flake-tickets-"));
    try {
      const at = git(dir);
      at(["init", "-q", "-b", "main"]);
      const commit = (files: Record<string, string | null>) => {
        for (const [f, body] of Object.entries(files)) {
          if (body === null) rmSync(path.join(dir, f), { force: true });
          else {
            mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
            writeFileSync(path.join(dir, f), body);
          }
        }
        at(["add", "-A"]);
        at(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "c"]);
        return at.text(["rev-parse", "HEAD"]);
      };
      const list = (n: number) => JSON.stringify({ skips: { a: n }, retries: {} });
      const tag = (n: number) => ["//", "flake:", `#${n}`].join(" ");
      const source = (name: string) => [TICKETED_DIRS[0], `${name}.test.ts`].join("/");
      const thin = commit({ [QUARANTINE]: list(1), [source("q")]: tag(7) });
      const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [source(`f${i}`), ""]));
      const noList = commit({ ...many, [QUARANTINE]: null, [source("q")]: `${tag(7)}\n${tag(8)}` });
      const base = commit({ [QUARANTINE]: list(1) });
      const head = commit({ [QUARANTINE]: list(2) });
      const shrunk = commit({ [QUARANTINE]: list(0) });
      const open = { state: "open", labels: [{ name: LABEL }] };
      const verdict = async (b: string | undefined, h: string, { env = {}, issues = { 7: open, 8: open } as Record<number, object>, label = 200 } = {}) => {
        const lines: string[] = [];
        const get = (url: string) => {
          const n = /\/issues\/(\d+)$/.exec(url)?.[1];
          const [status, body] = n ? (issues[Number(n)] ? [200, issues[Number(n)]] : [404, {}]) : [label, { name: LABEL }];
          return Promise.resolve(new Response(JSON.stringify(body), { status }));
        };
        const code = await run(b, h, {
          at,
          env: { GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", DEFAULT_BRANCH: "main", ...env },
          fetch: get as typeof fetch,
          log: (l) => lines.push(l),
        });
        return { code, out: lines.join("\n") };
      };
      assert.equal((await verdict(base, shrunk)).code, 0);
      assert.match((await verdict(base, head)).out, /went from 1 to 2/);
      at(["update-ref", "refs/remotes/origin/main", base]);
      assert.match((await verdict(noList, head)).out, /went from 1 to 2/);
      assert.match((await verdict(noList, head, { env: { DEFAULT_BRANCH: "" } })).out, /no DEFAULT_BRANCH/);
      at(["update-ref", "refs/remotes/origin/main", noList]);
      const fresh = await verdict(noList, head);
      assert.equal(fresh.code, 0, fresh.out);
      assert.match(fresh.out, /is new/);
      assert.match((await verdict(base, shrunk, { issues: { 7: open, 8: { ...open, state: "closed" } } })).out, /#8 is closed/);
      assert.match((await verdict(base, shrunk, { issues: { 7: open, 8: { ...open, pull_request: {} } } })).out, /#8 is a pull request/);
      assert.match((await verdict(base, shrunk, { issues: { 7: open, 8: { state: "open", labels: [] } } })).out, /#8 has no ci-flake label/);
      assert.match((await verdict(base, shrunk, { issues: { 7: open } })).out, /#8: HTTP 404/);
      assert.match((await verdict(base, shrunk, { label: 404 })).out, /label does not exist; ask the owner to add ci-flake/);
      assert.match((await verdict(base, noList)).out, /has no tests\/tooling\/flakesAtSource\.json/);
      assert.match((await verdict(base, thin)).out, /only 1 sources/);
      assert.match((await verdict(undefined, head)).out, /needs the base and head/);
      assert.equal((await verdict(base, shrunk, { env: { GH_TOKEN: "" } })).code, 1);
      assert.match((await verdict("no-such-ref", head)).out, /could not read/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

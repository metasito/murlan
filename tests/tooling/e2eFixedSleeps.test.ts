// A fixed real-time wait in the browser suite is a guess at how long the app needs: too short
// on a slow runner and it flakes, too long everywhere else and it bills every run. Wait for the
// state instead (a locator assertion, `expect.poll`, `helpers/settle.ts`). A wait that really is
// about elapsed time — a hold, a measuring window — says so where it stands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { blankComments } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const E2E = "tests/e2e";
const MARKER = /fixed wait on purpose:\s*\S+\s+\S+\s+\S+/;

/**
 * The waits that predate this check, per file. A count may only fall: a new unjustified wait
 * goes red above it, and a removed one goes red until its entry is lowered, so the allowance
 * can never quietly grow back.
 */
const LEGACY: Record<string, number> = {
  "tests/e2e/a11yOverlays.spec.ts": 1,
  "tests/e2e/cardScale.spec.ts": 3,
  "tests/e2e/controlRail.spec.ts": 4,
  "tests/e2e/exchangeFit.spec.ts": 1,
  "tests/e2e/exchangeNoOverlap.spec.ts": 1,
  "tests/e2e/feltIdle.spec.ts": 3,
  "tests/e2e/feltNap.spec.ts": 1,
  "tests/e2e/handBudget.spec.ts": 3,
  "tests/e2e/handClearance.spec.ts": 6,
  "tests/e2e/handScroll.spec.ts": 5,
  "tests/e2e/handTapStrips.spec.ts": 2,
  "tests/e2e/helpers/bot.ts": 7,
  "tests/e2e/helpers/feltParityGrid.ts": 1,
  "tests/e2e/helpers/mailSink.ts": 1,
  "tests/e2e/helpers/mockupParity.ts": 1,
  "tests/e2e/helpers/settle.ts": 1,
  "tests/e2e/helpers/virtualClock.ts": 1,
  "tests/e2e/lampSeats.spec.ts": 1,
  "tests/e2e/onlineTableSurvey.spec.ts": 2,
  "tests/e2e/playedHand.spec.ts": 2,
  "tests/e2e/profileSignedOut.spec.ts": 1,
  "tests/e2e/resultCutout.spec.ts": 1,
  "tests/e2e/seatFans.spec.ts": 4,
  "tests/e2e/tutorialSkip.spec.ts": 1,
  "tests/e2e/webPerf.spec.ts": 7,
};

type Site = { file: string; line: number; justified: boolean };

/** A promise resolved by a timer: arrow or function executor, the resolver passed or called. */
const PROMISE_SLEEP = String.raw`new\s+Promise\s*(?:<[^>]*>)?\s*\(\s*(?:async\s+)?(?:function\s*)?\(?\s*(\w+)\s*(?::[^),]*)?\)?\s*(?:=>)?\s*\{?\s*(?:return\s+)?(?:window\.|globalThis\.)?setTimeout\s*\(\s*(?:\1\b|\(\)\s*=>\s*\1\(|function\s*\(\)\s*\{\s*\1\()`;

const sleepCall = (names: string[]) =>
  new RegExp(
    [String.raw`(?:\.waitForTimeout|\[\s*["'\x60]waitForTimeout["'\x60]\s*\])\s*\(`, PROMISE_SLEEP, ...names.map((n) => String.raw`(?<![\w.$]|function\s+)${n}\s*\(`)].join("|"),
    "g"
  );

/** Declarations whose whole body is one sleep, as `[name, body start, body end]`. */
function wrappers(code: string, known: string[]): [string, number, number][] {
  const found: [string, number, number][] = [];
  const header = /(?:function\s+(\w+)\s*\([^)]*\)[^{;]*\{|(?:const|let)\s+(\w+)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]*)?=>\s*)/g;
  for (const m of code.matchAll(header)) {
    const start = m.index + m[0].length;
    let end = start;
    if (m[0].endsWith("{") || code[start] === "{") {
      let depth = 0;
      for (end = m[0].endsWith("{") ? start - 1 : start; end < code.length; end++) {
        if (code[end] === "{") depth++;
        else if (code[end] === "}" && --depth === 0) break;
      }
    } else end = code.indexOf("\n", start) === -1 ? code.length : code.indexOf("\n", start);
    const body = code.slice(start, end).replace(/^\s*\{/, "").trim();
    const call = sleepCall(known.filter((n) => n !== (m[1] ?? m[2]))).exec(body.replace(/^(?:return|await)\s+/, ""));
    if (call?.index === 0 && !/;\s*\S/.test(body.replace(/;?\s*$/, ""))) found.push([(m[1] ?? m[2])!, start, end]);
  }
  return found;
}

/** Names that sleep when called: wrappers of a sleep (to any depth), `timers/promises`, a promisified timer. */
function sleepers(files: string[]): string[] {
  const names = new Set<string>();
  for (const code of files) {
    for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?timers\/promises["']/g)) {
      for (const spec of m[1]!.split(",")) {
        const [imported, local] = spec.trim().split(/\s+as\s+/);
        if (imported === "setTimeout") names.add(local ?? imported);
      }
    }
    for (const m of code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:\w+\.)?promisify\(\s*setTimeout\s*\)/g)) names.add(m[1]!);
  }
  for (let size = -1; size !== names.size; ) {
    size = names.size;
    for (const code of files) for (const [name] of wrappers(code, [...names])) names.add(name);
  }
  return [...names];
}

/** Every fixed real-time wait in `files`, as `[repo-relative path, source]`. */
export function fixedSleeps(files: [string, string][]): Site[] {
  const code = new Map(files.map(([f, src]) => [f, blankComments(src)]));
  const names = sleepers([...code.values()]);
  const sites: Site[] = [];
  for (const [file, src] of files) {
    const text = code.get(file)!;
    const lines = src.split("\n");
    const bodies = wrappers(text, names).map(([, start, end]) => [start, end]);
    const hits = [...text.matchAll(sleepCall(names))]
      .map((m) => m.index)
      .filter((i) => !bodies.some(([start, end]) => i >= start! && i < end!));
    for (const index of hits) {
      const line = text.slice(0, index).split("\n").length;
      const justified = MARKER.test(lines[line - 1] ?? "") || MARKER.test(lines[line - 2] ?? "");
      sites.push({ file, line, justified });
    }
  }
  return sites;
}

function e2eSources(): [string, string][] {
  return readdirSync(path.join(repoRoot, E2E), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.ts$/.test(f))
    .map((f) => {
      const rel = path.posix.join(E2E, f.split(path.sep).join("/"));
      return [rel, readFileSync(path.join(repoRoot, rel), "utf8")];
    });
}

test("the scan finds every shape of fixed wait, and a written reason excuses one", () => {
  const sites = fixedSleeps([
    ["a.spec.ts", "await page.waitForTimeout(500);\n// await page.waitForTimeout(1);\n"],
    ["b.spec.ts", "await new Promise((r) => setTimeout(r, 200));\nawait new Promise<void>(done => setTimeout(() => done(), 9));\n"],
    ["c.ts", "export function nap(ms: number) {\n  return new Promise((resolve) => setTimeout(resolve, ms));\n}\nawait nap(10);\n"],
    ["d.spec.ts", 'import { nap } from "./c.ts";\nawait nap(40);\n'],
    ["e.spec.ts", 'import { setTimeout as wait } from "node:timers/promises";\nawait wait(30);\n'],
    ["f.spec.ts", "// fixed wait on purpose: a hold must last in real time\nawait page.waitForTimeout(800);\n"],
    ["h.spec.ts", "await new Promise(function (resolve) { setTimeout(resolve, 500); });\nawait page['waitForTimeout'](5);\n"],
    ["i.ts", 'import { promisify } from "node:util";\nconst later = promisify(setTimeout);\nexport const pause = (ms: number) => nap(ms);\nawait later(5);\nawait pause(7);\n'],
    ["j.ts", "async function poll(read: () => boolean) {\n  while (!read()) await nap(50);\n}\nawait poll(() => true);\nawait new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 9));\n"],
    ["g.spec.ts", "await expect(locator).toBeVisible();\npage.setDefaultTimeout(5);\n"],
  ]);
  assert.deepEqual(
    sites.map((s) => `${s.file}:${s.line}${s.justified ? " ok" : ""}`),
    [
      "a.spec.ts:1", "b.spec.ts:1", "b.spec.ts:2", "c.ts:4", "d.spec.ts:2", "e.spec.ts:2", "f.spec.ts:2 ok",
      "h.spec.ts:1", "h.spec.ts:2", "i.ts:4", "i.ts:5", "j.ts:2",
    ]
  );
});

const sites = fixedSleeps(e2eSources());

test("the suite is scanned at all", () => {
  assert.ok(e2eSources().length > 60, "fewer than 60 files under tests/e2e: the walk no longer sees the suite");
  assert.ok(sites.length > 0, "no fixed wait found anywhere, which the legacy list says is false");
});

test("no fixed real-time wait is added to the browser suite without a written reason", () => {
  const unjustified = new Map<string, Site[]>();
  for (const s of sites.filter((x) => !x.justified)) unjustified.set(s.file, [...(unjustified.get(s.file) ?? []), s]);
  const over = [...unjustified].filter(([file, list]) => list.length > (LEGACY[file] ?? 0));
  assert.deepEqual(
    over.map(([file, list]) => `${file}: ${list.length} (${list.map((s) => s.line).join(", ")})`),
    [],
    "Wait for the state instead — a locator assertion, expect.poll, or helpers/settle.ts. " +
      "A wait that is about elapsed time itself takes `// fixed wait on purpose: <why>` on or above its line."
  );
});

test("the legacy allowance shrinks with every wait removed", () => {
  const counts = new Map<string, number>();
  for (const s of sites.filter((x) => !x.justified)) counts.set(s.file, (counts.get(s.file) ?? 0) + 1);
  const stale = Object.entries(LEGACY).filter(([file, n]) => (counts.get(file) ?? 0) < n);
  assert.deepEqual(
    stale.map(([file, n]) => `${file}: ${n} → ${counts.get(file) ?? 0}`),
    [],
    "lower (or delete) these LEGACY entries to what the file now holds"
  );
});

// A fixed real-time wait in the browser suite is a guess at how long the app needs: too short
// on a slow runner and it flakes, too long everywhere else and it bills every run. Wait for the
// state instead (a locator assertion, `expect.poll`, `helpers/settle.ts`). A wait that really is
// about elapsed time — a hold, a measuring window — says so where it stands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fixedSleeps, type Site } from "../helpers/sleepScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const E2E = "tests/e2e";

/**
 * The waits that predate this check, per file. A count may only fall: a new unjustified wait
 * goes red above it, and a removed one goes red until its entry is lowered, so the allowance
 * can never quietly grow back. A wait that is a poll's cadence rather than a guess at the app
 * carries its reason here.
 */
const LEGACY: Record<string, number | { n: number; why: string }> = {
  "tests/e2e/a11yOverlays.spec.ts": 1,
  "tests/e2e/cardScale.spec.ts": 3,
  "tests/e2e/controlRail.spec.ts": 3,
  "tests/e2e/exchangeFit.spec.ts": 1,
  "tests/e2e/feltIdle.spec.ts": 3,
  "tests/e2e/feltNap.spec.ts": 1,
  "tests/e2e/handClearance.spec.ts": 6,
  "tests/e2e/handScroll.spec.ts": 5,
  "tests/e2e/handTapStrips.spec.ts": 2,
  "tests/e2e/helpers/mailSink.ts": { n: 1, why: "the cadence of polling the server's mail sink, which pushes nothing" },
  "tests/e2e/helpers/mockupParity.ts": 1,
  "tests/e2e/helpers/settle.ts": {
    n: 1,
    why: "the cadence of `settled`'s stillness readings: three equal readings this far apart are what still means",
  },
  "tests/e2e/helpers/virtualClock.ts": {
    n: 1,
    why: "the real-time gap between virtual steps, which lets the page's own work run between them",
  },
  "tests/e2e/onlineTableSurvey.spec.ts": 2,
  "tests/e2e/playedRound.spec.ts": 2,
  "tests/e2e/profileSignedOut.spec.ts": 1,
  "tests/e2e/resultCutout.spec.ts": 1,
  "tests/e2e/seatFans.spec.ts": 4,
  "tests/e2e/tutorialSkip.spec.ts": 1,
  "tests/e2e/webPerf.spec.ts": 7,
};

const allowance = (file: string) => {
  const entry = LEGACY[file];
  return typeof entry === "object" ? entry.n : (entry ?? 0);
};

const CODE = /\.(?:[cm]?[jt]s|tsx)$/;

function e2eSources(): [string, string][] {
  return readdirSync(path.join(repoRoot, E2E), { recursive: true, encoding: "utf8" })
    .filter((f) => CODE.test(f))
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
    ["i.ts", 'import { promisify } from "node:util";\nimport { nap } from "./c.ts";\nconst later = promisify(setTimeout);\nexport const pause = (ms: number) => nap(ms);\nawait later(5);\nawait pause(7);\n'],
    ["j.ts", 'import { nap } from "./c.ts";\n' + "async function poll(read: () => boolean) {\n  while (!read()) await nap(50);\n}\nawait poll(() => true);\nawait new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 9));\n"],
    ["g.spec.ts", "await expect(locator).toBeVisible();\npage.setDefaultTimeout(5);\n"],
    ["k.spec.ts", "const settle = () => Promise.resolve();\nawait settle();\nawait nap(5);\n"],
  ]);
  assert.deepEqual(
    sites.map((s) => `${s.file}:${s.line}${s.justified ? " ok" : ""}`),
    [
      "a.spec.ts:1", "b.spec.ts:1", "b.spec.ts:2", "c.ts:4", "d.spec.ts:2", "e.spec.ts:2", "f.spec.ts:2 ok",
      "h.spec.ts:1", "h.spec.ts:2", "i.ts:5", "i.ts:6", "j.ts:3",
    ]
  );
});

const sites = fixedSleeps(e2eSources());

test("the suite is scanned at all", () => {
  assert.ok(e2eSources().length > 60, "fewer than 60 files under tests/e2e: the walk no longer sees the suite");
  const scanned = new Set(e2eSources().map(([f]) => f));
  const helpers = readdirSync(path.join(repoRoot, E2E, "helpers"), { recursive: true, encoding: "utf8" })
    .filter((f) => statSync(path.join(repoRoot, E2E, "helpers", f)).isFile())
    .map((f) => path.posix.join(E2E, "helpers", f.split(path.sep).join("/")));
  assert.deepEqual(
    helpers.filter((f) => !scanned.has(f)),
    [],
    "a file under tests/e2e/helpers/ is not scanned: a helper is where a sleep hides from every spec that calls it"
  );
  assert.ok(sites.length > 0, "no fixed wait found anywhere, which the legacy list says is false");
});

test("no fixed real-time wait is added to the browser suite without a written reason", () => {
  const unjustified = new Map<string, Site[]>();
  for (const s of sites.filter((x) => !x.justified)) unjustified.set(s.file, [...(unjustified.get(s.file) ?? []), s]);
  const over = [...unjustified].filter(([file, list]) => list.length > allowance(file));
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
  const stale = Object.keys(LEGACY).filter((file) => (counts.get(file) ?? 0) < allowance(file));
  assert.deepEqual(
    stale.map((file) => `${file}: ${allowance(file)} → ${counts.get(file) ?? 0}`),
    [],
    "lower (or delete) these LEGACY entries to what the file now holds"
  );
});

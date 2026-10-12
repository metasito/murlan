import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { budgetReport, overBudget, run } from "../../tools/ci/budget-gate.mjs";

const env = { GITHUB_REPOSITORY: "o/r", PR: "7", GITHUB_RUN_ID: "41" };
const native = "tests/native/mancheOutcomeOnTheFelt.test.tsx";
const lists = { "over-budget-native-1": [{ file: native, seconds: 32.9, budget: 15 }] };
type PrFile = { filename: string; status: string; patch?: string };

/** `gh` as the gate calls it: the pull request's files, the run's artifact names, and a download that can fail. */
const fakeGh = (files: PrFile[], { failDownloads = 0, asked = [] as string[][] } = {}) => {
  let downloads = 0;
  return (args: string[]) => {
    asked.push(args);
    if (args[0] === "api" && args[1].startsWith("repos/o/r/pulls/7/files")) return files.map((f) => JSON.stringify(f)).join("\n");
    if (args[0] === "api" && args[1].startsWith("repos/o/r/actions/runs/41/artifacts")) return Object.keys(lists).join("\n");
    if (args[0] === "run" && args[1] === "download") {
      if (++downloads <= failDownloads) throw new Error("HTTP 503: Egress is over the account limit");
      const dir = args[args.indexOf("--dir") + 1];
      for (const [name, list] of Object.entries(lists)) {
        mkdirSync(path.join(dir, name), { recursive: true });
        writeFileSync(path.join(dir, name, "over-budget.json"), JSON.stringify(list));
      }
      return "";
    }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
};

const gate = async (gh: (args: string[]) => string, vars: Record<string, string | undefined> = env) => {
  const said: string[] = [];
  const slept: number[] = [];
  const code = await run(vars, gh, async (s: number) => void slept.push(s), (line: string) => void said.push(line));
  return { code, said: said.join("\n"), slept };
};

test("a touched test file over its budget reddens the run, naming it", async () => {
  const { code, said } = await gate(fakeGh([{ filename: native, status: "modified" }]));
  assert.equal(code, 1);
  assert.match(said, /mancheOutcomeOnTheFelt\.test\.tsx: 32\.9s against a budget of 15s/);
});

test("no touched file over budget, and no timings change, is a pass", async () => {
  assert.equal((await gate(fakeGh([{ filename: "lib/x.ts", status: "modified" }]))).code, 0);
  assert.equal((await gate(fakeGh([{ filename: "tests/e2e/ariaTwins.spec.ts", status: "modified" }]))).code, 0);
});

test("a download storage refuses is retried, and the lists it then reads decide", async () => {
  const { code, slept } = await gate(fakeGh([{ filename: native, status: "modified" }], { failDownloads: 2 }));
  assert.equal(code, 1);
  assert.equal(slept.length, 2);
});

test("lists that never arrive are not an empty list, and exit apart from a finding", async () => {
  const { code, said, slept } = await gate(fakeGh([{ filename: native, status: "modified" }], { failDownloads: Infinity }));
  assert.equal(code, 2);
  assert.ok(slept.length >= 2, "gave up without retrying");
  assert.match(said, /could not be read[\s\S]*503/);
});

test("a run it cannot name is refused before any call", async () => {
  for (const missing of ["GITHUB_REPOSITORY", "PR", "GITHUB_RUN_ID"]) {
    const asked: string[][] = [];
    const { code } = await gate(fakeGh([], { asked }), { ...env, [missing]: undefined });
    assert.equal(code, 1, missing);
    assert.deepEqual(asked, [], missing);
  }
  assert.equal((await gate(fakeGh([]), { ...env, PR: "abc" })).code, 1);
});

describe("overBudget: which run lists, against which changed files", () => {
  const spec = "tests/e2e/tableProportions.spec.ts";
  const both = {
    "over-budget-native-1": [{ file: native, seconds: 32.9, budget: 15 }],
    "over-budget-browser-2": [{ file: spec, seconds: 94, budget: 75.6 }],
  };
  type Fake = { download?: () => void; listed?: string[]; asked?: string[][] };
  const listsGh = (found: Record<string, object[]>, files: PrFile[], { download, listed, asked }: Fake = {}) => (args: string[]) => {
    asked?.push(args);
    if (args[0] === "api" && args[1].startsWith("repos/o/r/pulls/7/files")) return files.map((f) => JSON.stringify(f)).join("\n");
    if (args[0] === "api" && args[1].startsWith("repos/o/r/actions/runs/41/artifacts")) return (listed ?? Object.keys(found)).join("\n");
    if (args[0] === "run" && args[1] === "download") {
      download?.();
      const dir = args[args.indexOf("--dir") + 1];
      for (const [name, list] of Object.entries(found)) {
        mkdirSync(path.join(dir, name), { recursive: true });
        writeFileSync(path.join(dir, name, "over-budget.json"), JSON.stringify(list));
      }
      return "";
    }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  const read = (gh: (args: string[]) => string) => overBudget("o/r", 7, 41, gh, Date.now() + 60_000);

  test("names a touched file over its budget, and only that one", () => {
    const found = read(listsGh(both, [{ filename: native, status: "modified" }, { filename: "lib/x.ts", status: "modified" }]));
    assert.deepEqual(found.files, [native]);
    assert.match(budgetReport(found), /mancheOutcomeOnTheFelt\.test\.tsx.*32\.9s.*15s/);
    assert.doesNotMatch(budgetReport(found), /tableProportions/);
  });

  test("a file over budget the pull request did not touch, or no list at all, is no finding", () => {
    assert.deepEqual(read(listsGh(both, [{ filename: "lib/x.ts", status: "modified" }])).files, []);
    assert.deepEqual(read(listsGh({}, [{ filename: native, status: "modified" }])).files, []);
  });

  test("raising its own spec's recorded time past the ratio is a finding", () => {
    const raise = (to: number) =>
      listsGh({}, [
        { filename: spec, status: "modified" },
        { filename: "tests/e2e/timings.json", status: "modified", patch: `@@ -40,3 +40,3 @@\n-  "tableProportions.spec.ts": 22.8,\n+  "tableProportions.spec.ts": ${to},\n` },
      ]);
    const found = read(raise(90));
    assert.deepEqual(found.files, [spec]);
    assert.match(budgetReport(found), /22\.8s.*90s/);
    assert.deepEqual(read(raise(30)).files, []);
  });

  test("a new spec with no recorded time has no budget yet, and is named as such", () => {
    const found = read(listsGh(both, [{ filename: "tests/e2e/brandNew.spec.ts", status: "added" }]));
    assert.deepEqual(found.files, []);
    assert.deepEqual(found.exempt, ["tests/e2e/brandNew.spec.ts"]);
  });

  test("a list that cannot be read throws, never reads as empty", () => {
    const expired = listsGh(both, [{ filename: native, status: "modified" }], {
      download: () => {
        throw new Error("HTTP 410: artifact expired");
      },
    });
    assert.throws(() => read(expired), /artifact expired/);
  });

  // Run 38229501646, attempt 2: the artifacts endpoint lists every attempt's upload under one name.
  test("a list a rerun uploaded twice under one name is read once, not refused", () => {
    const one = { "over-budget-native-1": both["over-budget-native-1"] };
    const found = read(listsGh(one, [{ filename: native, status: "modified" }], { listed: ["over-budget-native-1", "over-budget-native-1"] }));
    assert.deepEqual(found.files, [native]);
  });

  test("a pull request that changes no test file downloads nothing", () => {
    const asked: string[][] = [];
    assert.deepEqual(read(listsGh(both, [{ filename: "lib/x.ts", status: "modified" }], { asked })).files, []);
    assert.ok(!asked.some((a) => a[1] === "download" || /\/artifacts/.test(a[1] ?? "")), JSON.stringify(asked));
  });

  test("a file over budget on both projects is one finding, at its slower time", () => {
    const twice = {
      "over-budget-native-1": [{ file: native, seconds: 20, budget: 15 }],
      "over-budget-native-2": [{ file: native, seconds: 32.9, budget: 15 }],
    };
    const lines = budgetReport(read(listsGh(twice, [{ filename: native, status: "modified" }]))).split("\n").filter((l) => l.includes(native));
    assert.deepEqual(lines, [`  ${native}: 32.9s against a budget of 15s`]);
  });
});

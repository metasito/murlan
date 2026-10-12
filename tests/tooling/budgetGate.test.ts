import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "../../tools/ci/budget-gate.mjs";

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
  assert.equal((await gate(fakeGh([{ filename: "tests/e2e/a.spec.ts", status: "modified" }]))).code, 0);
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

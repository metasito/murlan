import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  actionFiles,
  pinnedActions,
  RECORD,
  remoteActions,
  repoRoot,
  runtimeOf,
  RUNTIMES,
  USES,
  workflowFiles,
} from "../../scripts/refresh-action-runtimes.mjs";

const record = (): Record<string, string> => JSON.parse(readFileSync(path.join(repoRoot, RECORD), "utf8"));

function unrecordedOrOff(refs: string[], recorded: Record<string, string>): string[] {
  const missing = [...new Set(refs)].filter((ref) => !(ref in recorded)).map((ref) => `${ref}: not recorded`);
  const off = Object.entries(recorded)
    .filter(([, using]) => !RUNTIMES.has(using))
    .map(([ref, using]) => `${ref}: runs.using ${using}`);
  return [...missing, ...off];
}

const PINNED = /^["']?[\w.-]+\/[\w./-]+@[0-9a-f]{40}["']?\s+#\s*v?\d+\.\d+\.\d+\s*$/;

function unpinnedUses(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => USES.exec(line)?.[1].trim())
    .filter((ref): ref is string => ref !== undefined)
    .filter((ref) => !/^["']?(\.\/|docker:\/\/)/.test(ref) && !PINNED.test(ref));
}

function countUses(source: string): number {
  return source.split(/\r?\n/).filter((line) => USES.test(line)).length;
}

const hasTopLevelPermissions = (source: string) => /^permissions:/m.test(source);

describe("the checks themselves", () => {
  test("flag a tag, a branch and a SHA with no version comment", () => {
    const source = [
      "      - uses: actions/checkout@v4",
      "        uses: foo/bar@main",
      `      - uses: actions/cache@${"a".repeat(40)}`,
      `    uses: org/repo/.github/workflows/x.yml@${"b".repeat(39)} # v1.0.0`,
    ].join("\n");
    assert.equal(unpinnedUses(source).length, 4);
  });

  test("pass a SHA with its version, and a local action", () => {
    const source = [
      `      - uses: actions/checkout@${"c".repeat(40)} # v4.4.0`,
      "      - uses: ./.github/actions/drive-android-flows",
    ].join("\n");
    assert.deepEqual(unpinnedUses(source), []);
    assert.equal(countUses(source), 2);
  });

  test("read the runtime an action.yml declares", () => {
    assert.equal(runtimeOf("name: x\nruns:\n  using: 'node20'\n  main: dist/index.js\n"), "node20");
    assert.equal(runtimeOf("runs:\n\n  main: a.js\n  using: node24\nbranding:\n  icon: x\n"), "node24");
    assert.equal(runtimeOf("runs:\n  main: a.js\nbranding:\n  using: node24\n"), undefined);
    assert.equal(runtimeOf("name: x\n"), undefined);
    assert.deepEqual(remoteActions(`      - uses: "github/codeql-action/init@${"d".repeat(40)}" # v4.39.1\n    - uses: ./x\n`), [
      `github/codeql-action/init@${"d".repeat(40)}`,
    ]);
  });

  test("flag a recorded node20 runtime and an unrecorded pin", () => {
    const pin = `actions/checkout@${"e".repeat(40)}`;
    const other = `actions/cache@${"f".repeat(40)}`;
    assert.deepEqual(unrecordedOrOff([pin], { [pin]: "node20" }), [`${pin}: runs.using node20`]);
    assert.deepEqual(unrecordedOrOff([pin, other], { [pin]: "node24" }), [`${other}: not recorded`]);
    assert.deepEqual(unrecordedOrOff([pin], { [pin]: "composite" }), []);
  });

  test("permissions counts only at the top level", () => {
    assert.equal(hasTopLevelPermissions("jobs:\n  a:\n    permissions:\n      contents: read\n"), false);
    assert.equal(hasTopLevelPermissions("on: push\npermissions:\n  contents: read\n"), true);
  });
});

describe("every workflow and composite action", () => {
  const files = [...workflowFiles(), ...actionFiles()];

  test("the scan finds something to check", () => {
    assert.ok(workflowFiles().length >= 6, `found ${workflowFiles().length} workflows`);
    assert.ok(actionFiles().length >= 1, "found no composite action");
    const total = files.reduce((n, file) => n + countUses(readFileSync(path.join(repoRoot, file), "utf8")), 0);
    assert.ok(total >= 40, `found ${total} uses: lines`);
  });

  for (const file of files) {
    test(`${file} pins every action to a commit SHA`, () => {
      assert.deepEqual(unpinnedUses(readFileSync(path.join(repoRoot, file), "utf8")), []);
    });
  }

  test("every pinned action runs on a runtime GitHub still ships", () => {
    const refs = pinnedActions();
    assert.ok(refs.length >= 10, `found ${refs.length} distinct remote actions`);
    assert.deepEqual(unrecordedOrOff(refs, record()), [], `run scripts/refresh-action-runtimes.mjs and commit ${RECORD}`);
  });

  for (const file of workflowFiles()) {
    test(`${file} declares top-level permissions`, () => {
      assert.ok(hasTopLevelPermissions(readFileSync(path.join(repoRoot, file), "utf8")));
    });
  }
});

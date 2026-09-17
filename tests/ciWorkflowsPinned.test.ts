import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isYaml = (name: string) => /\.ya?ml$/.test(name);

function workflowFiles(): string[] {
  return readdirSync(path.join(repoRoot, ".github/workflows"))
    .filter(isYaml)
    .map((name) => `.github/workflows/${name}`);
}

function actionFiles(): string[] {
  const dir = path.join(repoRoot, ".github/actions");
  return readdirSync(dir).flatMap((action) =>
    ["action.yml", "action.yaml"]
      .map((name) => `.github/actions/${action}/${name}`)
      .filter((file) => existsSync(path.join(repoRoot, file))),
  );
}

const USES = /^\s*(?:-\s+)?uses:\s*(.*)$/;
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

  test("permissions counts only at the top level", () => {
    assert.equal(hasTopLevelPermissions("jobs:\n  a:\n    permissions:\n      contents: read\n"), false);
    assert.equal(hasTopLevelPermissions("on: push\npermissions:\n  contents: read\n"), true);
  });
});

describe("every workflow and composite action", () => {
  const files = [...workflowFiles(), ...actionFiles()];

  test("the scan finds something to check", () => {
    assert.ok(workflowFiles().length >= 7, `found ${workflowFiles().length} workflows`);
    assert.ok(actionFiles().length >= 1, "found no composite action");
    const total = files.reduce((n, file) => n + countUses(readFileSync(path.join(repoRoot, file), "utf8")), 0);
    assert.ok(total >= 40, `found ${total} uses: lines`);
  });

  for (const file of files) {
    test(`${file} pins every action to a commit SHA`, () => {
      assert.deepEqual(unpinnedUses(readFileSync(path.join(repoRoot, file), "utf8")), []);
    });
  }

  for (const file of workflowFiles()) {
    test(`${file} declares top-level permissions`, () => {
      assert.ok(hasTopLevelPermissions(readFileSync(path.join(repoRoot, file), "utf8")));
    });
  }
});

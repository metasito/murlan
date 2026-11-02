import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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

const RUNTIMES = new Set(["node24", "composite", "docker"]);
const REMOTE = /^([\w.-]+)\/([\w.-]+)((?:\/[\w.-]+)*)@([0-9a-f]{40})$/;

function remoteActions(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => USES.exec(line)?.[1].split(/\s+#/)[0].replace(/["']/g, "").trim())
    .filter((ref): ref is string => ref !== undefined && REMOTE.test(ref));
}

function runtimeOf(actionYml: string): string | undefined {
  const runs = /^runs:[^\n]*\n((?:[ \t]*(?:[ \t][^\n]*)?(?:\n|$))*)/m.exec(actionYml)?.[1];
  return runs === undefined ? undefined : /^[ \t]+using:\s*["']?([\w-]+)/m.exec(runs)?.[1];
}

async function fetchActionYml(ref: string): Promise<string> {
  const [, owner, repo, sub, sha] = REMOTE.exec(ref)!;
  for (const name of ["action.yml", "action.yaml"]) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}${sub}/${name}`;
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch((error: Error) => error);
      if (!(response instanceof Error) && response.ok) return response.text();
      if (!(response instanceof Error) && response.status === 404) break;
      if (attempt === 3) throw new Error(`${url}: ${response instanceof Error ? response.message : response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`${ref} has no action.yml or action.yaml`);
}

async function offRuntime(refs: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const off: string[] = [];
  let next = [...new Set(refs)];
  while (next.length > 0) {
    next.forEach((ref) => seen.add(ref));
    const actions = await Promise.all(next.map(async (ref) => ({ ref, yml: await fetchActionYml(ref) })));
    next = [];
    for (const { ref, yml } of actions) {
      const using = runtimeOf(yml);
      if (!using || !RUNTIMES.has(using)) off.push(`${ref}: runs.using ${using ?? "unread"}`);
      if (using === "composite") next.push(...remoteActions(yml).filter((child) => !seen.has(child)));
    }
    next = [...new Set(next)];
  }
  return off;
}

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

  test("flag a pin whose action runs on node20", async () => {
    assert.deepEqual(await offRuntime(["actions/checkout@11d5960a326750d5838078e36cf38b85af677262"]), [
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262: runs.using node20",
    ]);
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

  test("every pinned action runs on a runtime GitHub still ships", async () => {
    const refs = files.flatMap((file) => remoteActions(readFileSync(path.join(repoRoot, file), "utf8")));
    assert.ok(new Set(refs).size >= 10, `found ${new Set(refs).size} distinct remote actions`);
    assert.deepEqual(await offRuntime(refs), []);
  });

  for (const file of workflowFiles()) {
    test(`${file} declares top-level permissions`, () => {
      assert.ok(hasTopLevelPermissions(readFileSync(path.join(repoRoot, file), "utf8")));
    });
  }
});

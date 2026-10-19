// The floor under eslint.guards.cjs: each point is a way a guard can report green without looking.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint, type Linter } from "eslint";
import { directives } from "../helpers/hookSuppression.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

type Ignore = { glob: string; reason: string };
type Sample = { file: string; code: string };
type Guard = { id: string; why: string; selector: string; files: string[]; ignores?: Ignore[]; plant: Sample & { hits: number }; spare: Sample[] };
type Block = { files?: string[]; ignores?: string[]; plugins?: Record<string, unknown>; rules?: Record<string, unknown> };
const { GUARDS, plugin, guardBlocks } = require("../../eslint.guards.cjs") as {
  GUARDS: Guard[];
  plugin: { meta: { name: string; version?: string }; rules: Record<string, unknown> };
  guardBlocks: () => Block[];
};
const config = require("../../eslint.config.js") as Block[];
const minimatch = require("minimatch") as (file: string, glob: string, opts: { dot: boolean }) => boolean;
const tsParser = require("@typescript-eslint/parser") as Linter.Parser;

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
const matches = (file: string, globs: string[]) => globs.some((glob) => minimatch(file, glob, { dot: true }));
const globsOf = (guard: Guard) => (guard.ignores ?? []).map((i) => i.glob);
const targets = (guard: Guard) => tracked.filter((f) => matches(f, guard.files) && !matches(f, globsOf(guard)));
const ruleOf = (guard: Guard) => `murlan/${guard.id}`;
const real = new ESLint({ cwd: ROOT });

async function reports(lint: ESLint, source: string, file: string, rule: string): Promise<number> {
  const [result] = await lint.lintText(source, { filePath: path.join(ROOT, file) });
  const unread = result!.messages.filter((m) => m.fatal || (m.ruleId === null && /ignored/i.test(m.message)));
  assert.deepEqual(unread, [], `not linted at ${file}:\n${source}`);
  return result!.messages.filter((m) => m.ruleId === rule).length;
}

/** A disable naming no rule, and any directive naming a guard: both take a guard out of eslint.config.js's hands (D17). */
function guardSwitches(source: string, file: string): string[] {
  return directives(source, file).flatMap(({ line, keyword, rules }) => {
    if (keyword !== "eslint" && rules.length === 0) return [`${file}:${line}: ${keyword} names no rule`];
    return rules.filter((r) => r.startsWith("murlan/")).map((r) => `${file}:${line}: ${keyword} ${r}`);
  });
}

describe("the guard registry's floor", () => {
  test("1. every guard's plant fires it exactly `hits` times under the real config, and no spare fires it", async () => {
    for (const guard of GUARDS) {
      const { file, code, hits } = guard.plant;
      assert.ok(hits > 0 && guard.spare.length > 0, `${guard.id} needs a plant that fires and a spare`);
      for (const sample of [guard.plant, ...guard.spare]) {
        assert.ok(
          matches(sample.file, guard.files) && !matches(sample.file, globsOf(guard)),
          `${guard.id}: ${sample.file} is outside what it reads, so its sample tests nothing`
        );
      }
      assert.equal(await reports(real, code, file, ruleOf(guard)), hits, `${guard.id}'s plant at ${file}:\n${code}`);
      for (const spare of guard.spare) {
        assert.equal(await reports(real, spare.code, spare.file, ruleOf(guard)), 0, `${guard.id} reports its spare at ${spare.file}:\n${spare.code}`);
      }
    }
  });

  test("2. every glob a guard names reads a tracked file, and the real config runs the guard on each", async () => {
    const byFile = new Map<string, Guard[]>();
    for (const guard of GUARDS) {
      for (const glob of guard.files) {
        assert.ok(tracked.some((f) => matches(f, [glob])), `${guard.id}: ${glob} reads nothing`);
      }
      for (const file of targets(guard)) byFile.set(file, [...(byFile.get(file) ?? []), guard]);
    }
    const unguarded: string[] = [];
    for (const [file, guards] of byFile) {
      const rules = ((await real.calculateConfigForFile(path.join(ROOT, file))) as Block | undefined)?.rules ?? {};
      for (const guard of guards) {
        const level = rules[ruleOf(guard)];
        if ((Array.isArray(level) ? level[0] : level) !== 2) unguarded.push(`${file}: ${guard.id}`);
      }
    }
    assert.deepEqual(unguarded, [], "eslint.config.js ignores or turns off a guard where the registry says it runs");
  });

  test("3. an exemption reads a tracked file the guard would otherwise read, and says why", () => {
    const loose = GUARDS.flatMap((guard) =>
      (guard.ignores ?? [])
        .filter(({ glob, reason }) => !reason?.trim() || !tracked.some((f) => matches(f, [glob]) && matches(f, guard.files)))
        .map(({ glob }) => `${guard.id}: ${glob}`)
    );
    assert.deepEqual(loose, [], "an exemption with no reason, or one naming no file the guard reads, exempts nothing it can defend");
  });

  test("4. no block in the config sets a guard below error, and only guardBlocks() sets one", () => {
    const below = config.flatMap((block) =>
      Object.entries(block.rules ?? {})
        .filter(([rule, level]) => rule.startsWith("murlan/") && !["error", 2].includes(Array.isArray(level) ? level[0] : level))
        .map(([rule, level]) => `${rule}: ${JSON.stringify(level)}`)
    );
    assert.deepEqual(below, [], "a guard set to off or warn reports green without looking");
    assert.deepEqual(Object.keys(plugin.rules).sort(), GUARDS.map((g) => g.id).sort());
    assert.ok(config.some((block) => block.plugins?.murlan === plugin), "eslint.config.js never registers the plugin");
    const naming = config
      .filter((block) => Object.keys(block.rules ?? {}).some((r) => r.startsWith("murlan/")))
      .map(({ files, ignores, rules }) => ({ files, ignores, rules }));
    const registered = guardBlocks()
      .filter((block) => block.rules)
      .map(({ files, ignores, rules }) => ({ files, ignores, rules }));
    assert.deepEqual(naming, registered, "a block outside guardBlocks() sets a guard, or one guard is missing from the config");
  });

  test("5. no source switches a guard off, and no directive is bare", () => {
    const switched = tracked
      .filter((f) => /\.(?:[cm]?js|tsx?)$/.test(f))
      .flatMap((file) => guardSwitches(readFileSync(path.join(ROOT, file), "utf8"), file));
    assert.deepEqual(switched, [], "a guard has no inline exemption (D17): change the guard, or change the code");
  });

  test("5, seen: the directive scan sees each way to switch a guard off", () => {
    assert.equal(guardSwitches("/* eslint-disable */", "a.ts").length, 1);
    assert.equal(guardSwitches("// eslint-disable-next-line -- why", "a.ts").length, 1);
    assert.equal(guardSwitches("// eslint-disable-line murlan/no-focused-test", "a.ts").length, 1);
    assert.equal(guardSwitches('/* eslint murlan/no-focused-test: "off" */', "a.ts").length, 1);
    assert.equal(guardSwitches("// eslint-disable-next-line no-console, murlan/one-modal", "a.tsx").length, 1);
    assert.deepEqual(guardSwitches("// eslint-disable-next-line no-console -- why", "a.ts"), []);
    assert.deepEqual(guardSwitches('const s = "/* eslint-disable */";', "a.ts"), []);
  });

  test("the one Modal is components/AppModal.tsx, and the real config holds its orientations", async () => {
    const SHELL = "components/AppModal.tsx";
    const importGuard = GUARDS.find((g) => g.id === "one-modal")!;
    const alone = new ESLint({
      cwd: ROOT,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["**/*.{ts,tsx}"],
          languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { murlan: plugin as ESLint.Plugin },
          rules: { [ruleOf(importGuard)]: "error" },
        },
      ],
    });
    const importing: string[] = [];
    for (const file of tracked.filter((f) => matches(f, importGuard.files))) {
      if ((await reports(alone, readFileSync(path.join(ROOT, file), "utf8"), file, ruleOf(importGuard))) > 0) importing.push(file);
    }
    assert.deepEqual(importing, [SHELL], "exactly one file reads react-native's Modal, and it is the shell");

    const rule = "murlan/modal-keeps-landscape";
    const shell = readFileSync(path.join(ROOT, SHELL), "utf8");
    const portrait = shell.replace(/supportedOrientations=\{[^}]*\}/g, "");
    assert.notEqual(portrait, shell, `${SHELL} no longer declares supportedOrientations`);
    assert.equal(await reports(real, shell, SHELL, rule), 0);
    assert.ok((await reports(real, portrait, SHELL, rule)) > 0, `eslint.config.js does not hold ${SHELL}'s <Modal> to landscape`);
  });

  test("6. the registry's ids are unique, each guard is a selector entry, and its why names a path that exists", () => {
    const ids = GUARDS.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length, "two guards share an id");
    const FIELDS = ["id", "why", "selector", "files", "ignores", "plant", "spare"];
    const dangling: string[] = [];
    for (const guard of GUARDS) {
      assert.deepEqual(Object.keys(guard).filter((k) => !FIELDS.includes(k)), [], `${guard.id} is more than a selector entry`);
      assert.ok(typeof guard.selector === "string" && guard.selector.trim(), `${guard.id} has no selector`);
      const named = [...guard.why.matchAll(/(?<![\w./-])[\w.][\w.()-]*\/(?:[\w.()-]+\/)*[\w.-]+\.[a-z]+\b/g)].map(([p]) => p);
      if (named.length === 0) dangling.push(`${guard.id}: names no path`);
      for (const p of named) if (!existsSync(path.join(ROOT, p))) dangling.push(`${guard.id}: ${p}`);
    }
    assert.deepEqual(dangling, [], "a why must point the reader at the owner module or doc, and that file must exist");
  });

  test("the plugin's version moves with every guard, so eslint's content cache cannot serve a stale result", () => {
    const source = readFileSync(path.join(ROOT, "eslint.guards.cjs"), "utf8");
    const versionAfter = (edit: (src: string) => string) => {
      const dir = mkdtempSync(path.join(tmpdir(), "murlan-guards-"));
      try {
        const file = path.join(dir, "guards.cjs");
        writeFileSync(file, edit(source));
        return (require(file) as { plugin: { meta: { version?: string } } }).plugin.meta.version;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const version = plugin.meta.version;
    assert.ok(version, "the plugin has no version, so a guard edit leaves cached results standing");
    assert.equal(versionAfter((src) => src), version);
    assert.notEqual(versionAfter((src) => src.replace("CallExpression[callee.name=/^f(it|describe)$/]", "CallExpression[callee.name=/^f(it)$/]")), version);
    assert.notEqual(versionAfter((src) => src.replace("drop the `.only`", "drop it")), version);
    assert.notEqual(versionAfter((src) => src.replace('reason: "the sign-out, which empties the query cache"', 'reason: "x"')), version);
  });

  test("a stale directive is an error, and npm run lint reads the whole tree as configured", async () => {
    const [result] = await real.lintText("// eslint-disable-next-line no-console\nexport const a = 1;\n", {
      filePath: path.join(ROOT, "lib/sendIntent.ts"),
    });
    assert.ok(
      result!.messages.some((m) => m.severity === 2 && /Unused eslint-disable directive/.test(m.message)),
      "an unused disable directive is not an error, so a stale one outlives what it was for"
    );
    const lint = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts.lint!;
    assert.match(lint, /\blint \. --/, "npm run lint no longer lints the whole tree");
    assert.doesNotMatch(lint, /--(?:no-inline-config|rule|ignore-pattern|no-config-lookup|config|report-unused-disable-directives-severity)\b|\s-c\s/);
  });
});

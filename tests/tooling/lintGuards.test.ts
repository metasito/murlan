// The floor under eslint.guards.cjs: each point is a way a guard can report green without looking.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint, type Linter } from "eslint";
import { directives } from "../helpers/hookSuppression.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

type Guard = { id: string; files: string[]; ignores?: string[]; plant: string[]; spare: string[] };
type Block = { files?: string[]; ignores?: string[]; plugins?: Record<string, unknown>; rules?: Record<string, unknown> };
const { GUARDS, plugin, guardBlocks } = require("../../eslint.guards.cjs") as {
  GUARDS: Guard[];
  plugin: { rules: Record<string, unknown> };
  guardBlocks: () => Block[];
};
const config = require("../../eslint.config.js") as Block[];
const minimatch = require("minimatch") as (file: string, glob: string, opts: { dot: boolean }) => boolean;
const tsParser = require("@typescript-eslint/parser") as Linter.Parser;

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
const matches = (file: string, globs: string[]) => globs.some((glob) => minimatch(file, glob, { dot: true }));
const targets = (guard: Guard) => tracked.filter((f) => matches(f, guard.files) && !(guard.ignores ?? []).includes(f));
const targetOf = (guard: Guard) => {
  const all = targets(guard);
  return all.find((f) => f.endsWith(".tsx")) ?? all[0]!;
};
const ruleOf = (guard: Guard) => `guards/${guard.id}`;
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
    return rules.filter((r) => r.startsWith("guards/")).map((r) => `${file}:${line}: ${keyword} ${r}`);
  });
}

describe("the guard registry's floor", () => {
  test("1. every guard is a rule of the plugin, and eslint.config.js runs it exactly as registered", () => {
    const ids = GUARDS.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length, "two guards share an id");
    assert.deepEqual(Object.keys(plugin.rules).sort(), [...ids].sort());
    assert.ok(config.some((block) => block.plugins?.guards === plugin), "eslint.config.js never registers the plugin");
    const naming = config
      .filter((block) => Object.keys(block.rules ?? {}).some((r) => r.startsWith("guards/")))
      .map(({ files, ignores, rules }) => ({ files, ignores, rules }));
    const registered = guardBlocks()
      .filter((block) => block.rules)
      .map(({ files, ignores, rules }) => ({ files, ignores, rules }));
    assert.deepEqual(naming, registered, "a block outside guardBlocks() sets a guard, or one guard is missing from the config");
  });

  test("2. every guard reports each plant and none of its spares", async () => {
    for (const guard of GUARDS) {
      assert.ok(guard.plant.length > 0 && guard.spare.length > 0, `${guard.id} needs a plant and a spare`);
      const alone = new ESLint({
        cwd: ROOT,
        overrideConfigFile: true,
        overrideConfig: [
          {
            files: ["**/*.{ts,tsx,js,cjs,mjs}"],
            languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
            plugins: { guards: plugin as ESLint.Plugin },
            rules: { [ruleOf(guard)]: "error" },
          },
        ],
      });
      const file = targetOf(guard);
      for (const sample of guard.plant) {
        assert.ok((await reports(alone, sample, file, ruleOf(guard))) > 0, `${guard.id} misses its plant:\n${sample}`);
      }
      for (const sample of guard.spare) {
        assert.equal(await reports(alone, sample, file, ruleOf(guard)), 0, `${guard.id} reports its spare:\n${sample}`);
      }
    }
  });

  test("3. every glob a guard names reads a tracked file, and the real config runs the guard on each", async () => {
    const byFile = new Map<string, Guard[]>();
    for (const guard of GUARDS) {
      for (const glob of guard.files) {
        assert.ok(tracked.some((f) => matches(f, [glob])), `${guard.id}: ${glob} reads nothing`);
      }
      for (const file of targets(guard)) byFile.set(file, [...(byFile.get(file) ?? []), guard]);
      assert.ok(
        (await reports(real, guard.plant[0]!, targetOf(guard), ruleOf(guard))) > 0,
        `eslint.config.js does not report ${guard.id}'s plant at ${targetOf(guard)}`
      );
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

  test("4. an exemption is one tracked file the guard would otherwise read", () => {
    const loose = GUARDS.flatMap((guard) =>
      (guard.ignores ?? [])
        .filter((file) => /[*?{}[\]!]/.test(file) || !tracked.includes(file) || !matches(file, guard.files))
        .map((file) => `${guard.id}: ${file}`)
    );
    assert.deepEqual(loose, [], "a glob, a file that is gone, or one the guard never read is not an exemption");
  });

  test("5. no source switches a guard off, and no directive is bare", () => {
    const switched = tracked
      .filter((f) => /\.(?:[cm]?js|tsx?)$/.test(f))
      .flatMap((file) => guardSwitches(readFileSync(path.join(ROOT, file), "utf8"), file));
    assert.deepEqual(switched, [], "a guard has no inline exemption (D17): change the guard, or change the code");
  });

  test("5b. the directive scan sees each way to switch a guard off", () => {
    assert.equal(guardSwitches("/* eslint-disable */", "a.ts").length, 1);
    assert.equal(guardSwitches("// eslint-disable-next-line -- why", "a.ts").length, 1);
    assert.equal(guardSwitches("// eslint-disable-line guards/no-focused-test", "a.ts").length, 1);
    assert.equal(guardSwitches('/* eslint guards/no-focused-test: "off" */', "a.ts").length, 1);
    assert.equal(guardSwitches("// eslint-disable-next-line no-console, guards/one-modal-element", "a.tsx").length, 1);
    assert.deepEqual(guardSwitches("// eslint-disable-next-line no-console -- why", "a.ts"), []);
    assert.deepEqual(guardSwitches('const s = "/* eslint-disable */";', "a.ts"), []);
  });

  test("5c. the one Modal is components/AppModal.tsx, and the real config holds its orientations", async () => {
    const SHELL = "components/AppModal.tsx";
    const importGuard = GUARDS.find((g) => g.id === "one-modal-import")!;
    const alone = new ESLint({
      cwd: ROOT,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["**/*.{ts,tsx}"],
          languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { guards: plugin as ESLint.Plugin },
          rules: { [ruleOf(importGuard)]: "error" },
        },
      ],
    });
    const importing: string[] = [];
    for (const file of tracked.filter((f) => matches(f, importGuard.files))) {
      if ((await reports(alone, readFileSync(path.join(ROOT, file), "utf8"), file, ruleOf(importGuard))) > 0) importing.push(file);
    }
    assert.deepEqual(importing, [SHELL], "exactly one file reads react-native's Modal, and it is the shell");

    const rule = "guards/modal-keeps-landscape";
    const shell = readFileSync(path.join(ROOT, SHELL), "utf8");
    const portrait = shell.replace(/supportedOrientations=\{[^}]*\}/g, "");
    assert.notEqual(portrait, shell, `${SHELL} no longer declares supportedOrientations`);
    assert.equal(await reports(real, shell, SHELL, rule), 0);
    assert.ok((await reports(real, portrait, SHELL, rule)) > 0, `eslint.config.js does not hold ${SHELL}'s <Modal> to landscape`);
  });

  test("6. a stale directive is an error, and npm run lint reads the whole tree as configured", async () => {
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

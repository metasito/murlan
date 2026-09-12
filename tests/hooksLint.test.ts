// tests/hooksLint.test.ts — the three eslint-plugin-react-hooks 7 rules #891
// adopted, and the shape of what was left exempt.
//
// The rules themselves catch a new violation. What nothing else catches is the
// exemption going quiet: `"off"` put back in eslint.config.js for app code, a
// file-wide `/* eslint-disable */` at the top of a screen, or a bare
// `eslint-disable-next-line` with no reason — each of which reopens the whole
// class with CI green, which is the state #891 started from. A directive naming
// no rule is the worst of the three and the hardest to see, so it is an
// offender here on its own terms rather than for the rules it happens to cover.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Every rule #891 adopted, and the only directory any of them may be off for. */
const ADOPTED = ["react-hooks/set-state-in-effect", "react-hooks/globals", "react-hooks/refs"];
const OFF_ONLY_FOR = "tests/native/**/*.{ts,tsx}";
const ALWAYS_ON = ["react-hooks/set-state-in-effect", "react-hooks/refs"];

type Block = { files?: string[]; rules?: Record<string, unknown> };

function blocksTurningOff(rule: string): Block[] {
  // `defineConfig` flattens as it returns, so what is required here is what runs.
  const config = require("../eslint.config.js") as Block[];
  return config.filter((block) => {
    const level = block.rules?.[rule];
    return level === "off" || level === 0;
  });
}

const SOURCE_DIRS = ["app", "components", "context", "lib"];

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

describe("the react-hooks 7 rules #891 adopted stay adopted", () => {
  for (const rule of ALWAYS_ON) {
    test(`${rule} is off nowhere — the exemptions are per-site instead`, () => {
      assert.deepEqual(
        blocksTurningOff(rule).map((block) => block.files),
        [],
        "a whole directory exempted again; #891 read 21 sites one at a time for this reason"
      );
    });
  }

  test("globals is off for tests/native and nothing else", () => {
    assert.deepEqual(
      blocksTurningOff("react-hooks/globals").flatMap((block) => block.files ?? []),
      [OFF_ONLY_FOR],
      "the test suite's Probe pattern is the only thing this exemption is for"
    );
  });
});

describe("an exemption in app code says what it is for", () => {
  const files = SOURCE_DIRS.flatMap(sourceFiles);

  test("every suppression of an adopted rule is one line wide and carries a reason", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        const directive = /eslint-disable(-next-line|-line)?([^\n]*)/.exec(line);
        if (!directive) return;
        const [, form, rest] = directive;
        const rules = rest.split("--")[0];
        // A directive naming no rule disables every rule, these three with the
        // rest, and names none of them to be found by the check below.
        const named = /[a-z][\w-]*\/[\w-]+/.test(rules)
          ? ADOPTED.some((rule) => rules.includes(rule))
          : true;
        if (!named) return;
        const at = `${file}:${i + 1}`;
        if (!rules.trim()) offenders.push(`${at} — names no rule, so it disables all of them`);
        else if (form !== "-next-line") offenders.push(`${at} — file-wide or trailing, not next-line`);
        else if (!/--\s+\S+\s+\S+/.test(rest)) offenders.push(`${at} — no reason after \`--\``);
      });
    }
    assert.deepEqual(offenders, []);
  });

  test("the directories it scans are the ones the rule covers", () => {
    // A scan that misses a directory passes by construction, so the list comes
    // from the config block that enables the rule rather than from this file.
    const config = require("../eslint.config.js") as Block[];
    const covered = config
      .filter((block) => block.rules?.["react-hooks/set-state-in-effect"] === "error")
      .flatMap((block) => block.files ?? [])
      .map((glob) => glob.split("/")[0]);
    assert.deepEqual(SOURCE_DIRS, covered);
    for (const dir of SOURCE_DIRS) assert.ok(sourceFiles(dir).length > 0, `${dir} is empty`);
  });
});

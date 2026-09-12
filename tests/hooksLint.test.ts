// tests/hooksLint.test.ts — the three eslint-plugin-react-hooks 7 rules #891
// adopted, and the shape of what was left exempt.
//
// The rules themselves catch a new violation. What nothing else catches is the
// exemption going quiet: `"off"` put back in eslint.config.js for app code, a
// file-wide `/* eslint-disable */` at the top of a screen, or a bare
// `eslint-disable-next-line` with no reason — each of which reopens the whole
// class with CI green, which is the state #891 started from.
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
  test("set-state-in-effect is off nowhere — app code has per-site exemptions instead", () => {
    const off = blocksTurningOff("react-hooks/set-state-in-effect");
    assert.deepEqual(
      off.map((block) => block.files),
      [],
      "a whole directory exempted again; #891 audited 21 sites one at a time for this reason"
    );
  });

  for (const rule of ["react-hooks/globals", "react-hooks/refs"]) {
    test(`${rule} is off for tests/native and nothing else`, () => {
      const off = blocksTurningOff(rule);
      assert.deepEqual(
        off.flatMap((block) => block.files ?? []),
        [OFF_ONLY_FOR],
        "the test suite's Probe pattern is the only thing this exemption is for"
      );
    });
  }
});

describe("an exemption in app code says what it is for", () => {
  const files = SOURCE_DIRS.flatMap(sourceFiles);

  test("every suppression of an adopted rule is one line wide and carries a reason", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        const directive = /eslint-disable(-next-line|-line)?\s+([^\n]*)/.exec(line);
        if (!directive) return;
        const rules = directive[2];
        if (!ADOPTED.some((rule) => rules.includes(rule))) return;
        const at = `${file}:${i + 1}`;
        if (directive[1] !== "-next-line") offenders.push(`${at} — file-wide or trailing, not next-line`);
        else if (!/--\s+\S+\s+\S+/.test(rules)) offenders.push(`${at} — no reason after \`--\``);
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

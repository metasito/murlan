// tests/hooksLint.test.ts — the three eslint-plugin-react-hooks 7 rules #891
// adopted stay adopted, and nothing switches one back off.
//
// A suppression of any of them costs its whole file its React Compiler pass, so
// there is no such thing as a local one — `tests/reactCompiler.test.ts` proves
// that against the compiler itself and refuses every suppression under `app/`,
// `components/` and `context/`. Two things that scan cannot see are here:
// `lib/`, which it compiles but does not scan for suppressions, and
// `eslint.config.js`, where a rule can go `"off"` for a whole directory without
// a single source file changing. Either reopens the class with CI green.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Every rule #891 adopted. */
const ADOPTED = ["react-hooks/set-state-in-effect", "react-hooks/globals", "react-hooks/refs"];
/** The one rule left off, and the only directory it may be off for. */
const OFF_FOR_TESTS = "react-hooks/globals";
const OFF_ONLY_FOR = "tests/native/**/*.{ts,tsx}";
const ALWAYS_ON = ADOPTED.filter((rule) => rule !== OFF_FOR_TESTS);

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

/**
 * Why `line` switches an adopted rule off, or null. One function, two callers:
 * the scan runs it over the tree, and the case list runs it over strings — which
 * is how each form it must catch is watched failing without planting one.
 */
function suppressionFault(line: string): string | null {
  // Only a directive opening its own comment counts. Prose *about* a directive —
  // this file is full of it — must not red the gate.
  const inline = /(?:\/\/|\/\*)\s*eslint\s+([^\n]*)/.exec(line);
  if (inline && ADOPTED.some((rule) => inline[1].includes(rule))) {
    return "inline rule config, which sets a level rather than asking for an exemption";
  }
  const directive = /(?:\/\/|\/\*)\s*eslint-disable(-next-line|-line)?\b([^\n]*)/.exec(line);
  if (!directive) return null;
  const rules = directive[2].split("--")[0].replace(/\*\/.*$/, "");
  // A directive naming no rule disables every rule, these three among them, and
  // is the one form that cannot be found by looking for their names.
  if (!rules.trim()) return "names no rule, so it disables all of them";
  if (!ADOPTED.some((rule) => rules.includes(rule))) return null;
  return "switches an adopted rule off, which costs this file its compilation";
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

  test(`${OFF_FOR_TESTS} is off for tests/native and nothing else`, () => {
    assert.deepEqual(
      blocksTurningOff(OFF_FOR_TESTS).flatMap((block) => block.files ?? []),
      [OFF_ONLY_FOR],
      "the test suite's Probe pattern is the only thing this exemption is for"
    );
  });
});

describe("no source file switches an adopted rule off", () => {
  const files = SOURCE_DIRS.flatMap(sourceFiles);

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

  test("each form that would reopen the class is a fault, and prose is not", () => {
    // The scan below cannot go red on a form it has never been shown. A reason
    // after `--` is among them: it reads as a local decision, and there is no
    // such thing when the cost is the whole file's compilation.
    assert.match(suppressionFault("/* eslint-disable */") ?? "", /names no rule/);
    assert.match(
      suppressionFault("/* eslint-disable */ // see docs/agents/RULES.md") ?? "",
      /names no rule/
    );
    assert.match(
      suppressionFault('/* eslint react-hooks/set-state-in-effect: "off" */') ?? "",
      /inline rule config/
    );
    assert.match(
      suppressionFault("/* eslint-disable react-hooks/globals */") ?? "",
      /costs this file its compilation/
    );
    assert.match(
      suppressionFault("// eslint-disable-next-line react-hooks/refs") ?? "",
      /costs this file its compilation/
    );
    assert.match(
      suppressionFault("// eslint-disable-next-line react-hooks/refs -- the reason, stated") ?? "",
      /costs this file its compilation/
    );
    assert.equal(suppressionFault("// a bare `eslint-disable-next-line` reopens the class"), null);
    assert.equal(suppressionFault("// eslint-disable-next-line no-console"), null);
  });

  test("there is no suppression of an adopted rule anywhere the rule is on", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(path.join(ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          const fault = suppressionFault(line);
          if (fault) offenders.push(`${file}:${i + 1} — ${fault}`);
        });
    }
    assert.deepEqual(
      offenders,
      [],
      "a react-hooks suppression stops React Compiler compiling the file it sits in, so the " +
        "effect is rewritten rather than silenced — see tests/reactCompiler.test.ts"
    );
  });
});

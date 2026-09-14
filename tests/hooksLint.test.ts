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
import { ESLint } from "eslint";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Every rule #891 adopted. */
const ADOPTED = ["react-hooks/set-state-in-effect", "react-hooks/globals", "react-hooks/refs"];
/** The one rule left off, and the only files it may be off for. */
const OFF_FOR_TESTS = "react-hooks/globals";
const OFF_ONLY_FOR = [
  "tests/native/bannerMakesRoom.test.tsx",
  "tests/native/gameSettingsSheetRows.test.tsx",
  "tests/native/settingsOverlay.test.tsx",
];
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

// Every comment, every string and every template in one alternation, so that
// whichever opens first consumes the other: a `/*` inside a string is the
// string's, and a quote or backtick inside a comment is the comment's. Both
// directions matter — the second is why a raw `ts.createScanner` is no use
// here, since this repo's prose is full of backticks and it desynced on 50 of
// the 139 files scanned. A real parse loses instead in the direction that
// counts: walking nodes for their comment ranges misses every JSX `{/* */}`
// and every trailing `//`, 84 comments the alternation below finds.
//
// A quoted string stops at its own newline, as JavaScript's does. Nothing here
// knows a regex literal from a division, so `/['"]/` offers a quote that would
// otherwise pair with the next one in the file and swallow every directive
// between — the one way this can be too lax, and the only direction that costs
// anything. A stray backtick still can, because a template really does span
// lines; no source under `SOURCE_DIRS` carries one outside a comment or string.
const COMMENT_OR_STRING =
  /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/**
 * Why each comment in `source` switches an adopted rule off, with the line it
 * sits on. One function, two callers: the scan runs it over the tree, and the
 * case list runs it over strings — which is how each form it must catch is
 * watched failing without planting one.
 *
 * It takes the whole text rather than a line because an `eslint` config comment
 * may name its rule on any line of itself, and because a directive is only a
 * directive outside a string — neither is decidable one line at a time.
 */
function suppressionFaults(source: string): { line: number; why: string }[] {
  const faults: { line: number; why: string }[] = [];
  for (const match of source.matchAll(COMMENT_OR_STRING)) {
    if (!match[0].startsWith("/")) continue;
    const why = commentFault(match[0]);
    if (why) faults.push({ line: source.slice(0, match.index).split("\n").length, why });
  }
  return faults;
}

/** Why `comment` — a whole comment, opener included — switches an adopted rule off. */
function commentFault(comment: string): string | null {
  // Only a directive opening its own comment counts, which is what anchoring
  // buys: prose *about* a directive — this file is full of it — reaches ESLint
  // as prose, and must not red the gate either.
  const inline = /^(?:\/\/|\/\*)\s*eslint\s+([\s\S]*)/.exec(comment);
  if (inline && ADOPTED.some((rule) => inline[1].includes(rule))) {
    return "inline rule config, which sets a level rather than asking for an exemption";
  }
  const directive = /^(?:\/\/|\/\*)\s*eslint-disable(-next-line|-line)?\b([\s\S]*)/.exec(comment);
  if (!directive) return null;
  const rules = directive[2].split("--")[0].replace(/\*\/\s*$/, "");
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

  test(`${OFF_FOR_TESTS} is off for the files on OFF_ONLY_FOR and nothing else`, () => {
    const off = blocksTurningOff(OFF_FOR_TESTS);
    // A block with no `files` applies to every file, which the `?? []` below
    // would read as none — the one shape that turns the rule off repo-wide and
    // still matches an empty list.
    assert.deepEqual(
      off.filter((block) => !block.files),
      [],
      "a block naming no files turns this rule off everywhere"
    );
    assert.deepEqual(
      off.flatMap((block) => block.files ?? []),
      OFF_ONLY_FOR,
      "a Probe whose sibling consumer is the subject is the only thing this exemption is for"
    );
  });

  test(`every file ${OFF_FOR_TESTS} is off for still needs it`, async () => {
    // The list above is a claim about what the rule would say; this asks it.
    // The scan comes from the list too, so an exemption added anywhere is
    // asked about. ESLint reads an empty path list as the whole repository,
    // which is why the empty case is caught here rather than there.
    if (OFF_ONLY_FOR.length === 0) return;
    const lint = new ESLint({ overrideConfig: { rules: { [OFF_FOR_TESTS]: "error" } } });
    const scanned = [...new Set(OFF_ONLY_FOR.map((file) => path.dirname(file)))];
    const reporting = (await lint.lintFiles(scanned))
      .filter((r) => r.messages.some((m) => m.ruleId === OFF_FOR_TESTS))
      .map((r) => path.relative(ROOT, r.filePath).replaceAll(path.sep, "/"))
      .sort();
    assert.deepEqual(reporting, [...OFF_ONLY_FOR].sort());
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
    const why = (source: string) => suppressionFaults(source).map((fault) => fault.why);

    assert.match(why("/* eslint-disable */")[0] ?? "", /names no rule/);
    assert.match(
      why("/* eslint-disable */ // see docs/agents/RULES.md")[0] ?? "",
      /names no rule/
    );
    assert.match(why('/* eslint react-hooks/set-state-in-effect: "off" */')[0] ?? "", /inline rule config/);
    assert.match(
      why("/* eslint-disable react-hooks/globals */")[0] ?? "",
      /costs this file its compilation/
    );
    assert.match(
      why("// eslint-disable-next-line react-hooks/refs")[0] ?? "",
      /costs this file its compilation/
    );
    assert.match(
      why("// eslint-disable-next-line react-hooks/refs -- the reason, stated")[0] ?? "",
      /costs this file its compilation/
    );
    assert.deepEqual(why("// a bare `eslint-disable-next-line` reopens the class"), []);
    assert.deepEqual(why("// eslint-disable-next-line no-console"), []);

    // A config comment names its rule on whichever line it likes, and the one
    // that reads best is rarely the first — a per-line scan sees the opener and
    // the rule name as two lines with no directive between them.
    assert.match(
      why('/* eslint\n   react-hooks/globals: "off" */')[0] ?? "",
      /inline rule config/
    );
    assert.match(
      why("/* eslint-disable\n   react-hooks/refs */")[0] ?? "",
      /costs this file its compilation/
    );

    // Prose is every shape that is not a directive at the head of its own
    // comment, and a directive quoted in a string is not a directive at all.
    assert.deepEqual(why('const s = "/* eslint-disable */";'), []);
    assert.deepEqual(why("const s = '// eslint-disable-next-line react-hooks/refs';"), []);
    assert.deepEqual(why("const s = `/* eslint-disable */`;"), []);
    assert.deepEqual(why("// see the `/* eslint-disable */` above"), []);
    assert.deepEqual(why("/* a block explaining /* eslint-disable */"), []);

    // The quote a regex literal holds is the one thing that can hide a real
    // directive, by pairing with the next quote in the file and swallowing
    // everything between. A string that ends at its own newline cannot.
    assert.match(
      why("const q = /['\"]/;\n// eslint-disable-next-line react-hooks/refs\nconst n = 'x';")[0] ?? "",
      /costs this file its compilation/
    );

    // The line is what makes the scan's offender list actionable, so it is the
    // count of newlines before the comment, not before the file's first fault.
    assert.deepEqual(suppressionFaults('const a = 1;\n\n/* eslint-disable */')[0]?.line, 3);
  });

  test("there is no suppression of an adopted rule anywhere the rule is on", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      for (const fault of suppressionFaults(source)) {
        offenders.push(`${file}:${fault.line} — ${fault.why}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a react-hooks suppression stops React Compiler compiling the file it sits in, so the " +
        "effect is rewritten rather than silenced — see tests/reactCompiler.test.ts"
    );
  });
});

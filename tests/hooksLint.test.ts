// tests/hooksLint.test.ts — the three eslint-plugin-react-hooks 7 rules #891
// adopted stay adopted, and nothing switches one back off.
//
// What a suppression of one of them is refused for is an ESLint matter: which of
// the three is on is `eslint.config.js`'s to say, and a comment taking one out of
// its hands for a single site leaves nothing repo-wide recording that it went.
// Not the React Compiler, which charges for a suppression only of the rules on its
// own list, and none of these three are on it — `tests/reactCompiler.test.ts`
// measures that rather than assuming it (ADR-0005), and refuses every suppression
// under `app/`, `components/` and `context/` on the same ESLint ground. Two things
// that scan cannot see are here:
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
import { ADOPTED } from "./helpers/adoptedHookRules.ts";
import { directives, syntaxErrors, type Directive } from "./helpers/hookSuppression.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

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

/** The one statement of why a suppression is refused; the cases below assert against it. */
const ADOPTED_FAULT = "switches an adopted rule off, which is eslint.config.js's call";

/**
 * Why each comment in `source` switches an adopted rule off, with the line it
 * sits on. Two callers: the scan runs it over the tree, and the case list runs
 * it over strings — which is how each form it must catch is watched failing
 * without planting one.
 *
 * Only the three rules `ADOPTED` names, where `tests/reactCompiler.test.ts`
 * takes every rule under the `react-hooks/` prefix: that gate stands over the
 * directories the compiler builds and refuses a local exemption from any of
 * them. What this one asks is narrower — whether the rules #891 adopted are
 * still on — and a rule nobody adopted going off is not an answer to it.
 */
function suppressionFaults(source: string, file = "scan.tsx"): { line: number; why: string }[] {
  return directives(source, file).flatMap(({ line, keyword, rules }) => {
    const why = faultOf(keyword, rules);
    return why ? [{ line, why }] : [];
  });
}

function faultOf(keyword: Directive["keyword"], rules: string[]): string | null {
  const adopted = rules.some((rule) => ADOPTED.includes(rule));
  if (keyword === "eslint") {
    if (!adopted) return null;
    return "inline rule config, which sets a level rather than asking for an exemption";
  }
  // `/* eslint-disable */` with nothing after it disables every rule from there
  // on, these three among them, and is the one form that cannot be found by
  // looking for their names.
  if (rules.length === 0) return "names no rule, so it disables all of them";
  return adopted ? ADOPTED_FAULT : null;
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
    // after `--` is among them: it reads as a local decision, and whether one of
    // these three is on is not a decision a single site gets to take.
    const why = (source: string) => suppressionFaults(source).map((fault) => fault.why);
    // One fault, not "at least one": a form that also raises a spurious second
    // would otherwise pass here and go on annoying somebody in the scan.
    const only = (source: string) => {
      const faults = why(source);
      assert.equal(faults.length, 1, `expected one fault from ${JSON.stringify(source)}`);
      return faults[0];
    };

    assert.match(only("/* eslint-disable */"), /names no rule/);
    assert.match(only("/* eslint-disable */ // see docs/agents/RULES.md"), /names no rule/);
    assert.match(only('/* eslint react-hooks/set-state-in-effect: "off" */'), /inline rule config/);
    assert.equal(only("/* eslint-disable react-hooks/globals */"), ADOPTED_FAULT);
    assert.equal(only("// eslint-disable-next-line react-hooks/refs"), ADOPTED_FAULT);
    assert.equal(
      only("// eslint-disable-next-line react-hooks/refs -- the reason, stated"),
      ADOPTED_FAULT
    );
    assert.deepEqual(why("// a bare `eslint-disable-next-line` reopens the class"), []);
    assert.deepEqual(why("// eslint-disable-next-line no-console"), []);
    // A rule whose name opens with an adopted one is a different rule. Matching
    // the list's text would read this as `react-hooks/refs`.
    assert.deepEqual(why("// eslint-disable-next-line react-hooks/refs-in-render"), []);

    // A config comment names its rule on whichever line it likes, and the one
    // that reads best is rarely the first — a per-line scan sees the opener and
    // the rule name as two lines with no directive between them.
    assert.match(only('/* eslint\n   react-hooks/globals: "off" */'), /inline rule config/);
    assert.equal(only("/* eslint-disable\n   react-hooks/refs */"), ADOPTED_FAULT);

    // Prose is what does not open its own comment with the directive, and a
    // directive quoted in a string is not a directive at all.
    assert.deepEqual(why('const s = "/* eslint-disable */";'), []);
    assert.deepEqual(why("const s = '// eslint-disable-next-line react-hooks/refs';"), []);
    assert.deepEqual(why("const s = `/* eslint-disable */`;"), []);
    assert.deepEqual(why("// see the `/* eslint-disable */` above"), []);
    assert.deepEqual(why("/* a block explaining /* eslint-disable */"), []);

    // A sentence opening with the directive is faulted whatever it meant. This
    // one ESLint does not honour; the same words with a comma after the rule it
    // does, and that is not a distinction to rest a gate on.
    assert.equal(
      only("// eslint-disable-next-line react-hooks/refs is banned here"),
      ADOPTED_FAULT
    );
    assert.equal(
      only("// eslint-disable-next-line react-hooks/refs, and never do this"),
      ADOPTED_FAULT
    );

    // A backtick inside a regex literal: the case the parse exists for, since
    // nothing reading text can tell it from a template opener, and a template
    // spans lines, so there is no bound to give one.
    assert.equal(
      only("const q = /[`]/;\n// eslint-disable-next-line react-hooks/refs\nconst n = `y`;"),
      ADOPTED_FAULT
    );

    // A comment inside a template substitution is a comment, and ESLint reads a
    // directive there as one.
    assert.equal(only("const s = `a${/* eslint-disable react-hooks/refs */ 1}b`;"), ADOPTED_FAULT);

    // `<string>foo` is a type assertion in a .ts file and an unclosed JSX tag
    // in a .tsx one, which swallows the rest of the file. The name decides, so
    // a `.ts` file gets read as one.
    const assertionThenDirective =
      "const a = <string>foo;\n// eslint-disable-next-line react-hooks/refs\n";
    assert.equal(
      suppressionFaults(assertionThenDirective, "lib/x.ts")[0]?.why ?? "",
      ADOPTED_FAULT
    );

    // The line is what makes the scan's offender list actionable, so it is the
    // count of newlines before the comment, not before the file's first fault.
    assert.deepEqual(suppressionFaults('const a = 1;\n\n/* eslint-disable */')[0]?.line, 3);
  });

  test("every file the scan reads parses, so none of them reads as having no comments", () => {
    // The scan finds comments by parsing, and a parse that gives up part way
    // reports what it managed rather than an error — a file with an unclosed
    // JSX tag in it has no comments after that tag and no complaint about it.
    // Nothing else here would notice, because the scan going quiet and a file
    // holding no suppression look the same from the outside.
    const unparsed = files.flatMap((file) => {
      const errors = syntaxErrors(readFileSync(path.join(ROOT, file), "utf8"), file);
      return errors.length ? [`${file} — ${errors.length} syntax errors`] : [];
    });
    assert.deepEqual(
      unparsed,
      [],
      "the scan reads a file it cannot parse as a file with no comments in it"
    );
  });

  test("a file that does not parse is reported as one, rather than as clean", () => {
    // The check above is only worth its runtime if it can say no, and what it
    // asks is a `?? []` away from answering "none" forever.
    const broken = "const x = <string>y;\n// eslint-disable-next-line react-hooks/refs\n";
    assert.ok(syntaxErrors(broken, "components/X.tsx").length > 0);
    // The same source under the name that makes it a type assertion: this is
    // what `tests/helpers/hookSuppression.ts` keys the ScriptKind off, and it
    // has to stay legal.
    assert.deepEqual(syntaxErrors(broken, "lib/x.ts"), []);
  });

  test("there is no suppression of an adopted rule anywhere the rule is on", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      for (const fault of suppressionFaults(source, file)) {
        offenders.push(`${file}:${fault.line} — ${fault.why}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "which of these three is on is eslint.config.js's to say, so the effect is rewritten " +
        "rather than silenced. React Compiler does not charge for suppressing one of them — " +
        "tests/reactCompiler.test.ts measures which rules it does charge for"
    );
  });
});

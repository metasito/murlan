// tests/tooling/docReferences.test.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../../scripts/lib/commentShape.ts";

// .claude/skills is vendored upstream (the plan's Global Constraints forbid touching it), so a
// code snippet inside it is not a claim this repo's own docs make. A dated plan in docs/plans/ is
// a record of the tree it was written against: a later move leaves its paths stale by design, and
// rewriting them would falsify the record. Excluded here, not silently: this comment is the
// exclusions' record.
const EXCLUDED_DIRS = [".claude/skills/"];
const DATED_PLAN = /^docs\/plans\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const at = (file: string) => join(ROOT, file);

const docs = execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
  .trim().split("\n").filter((f) => !f.startsWith("node_modules/"))
  .filter((f) => !EXCLUDED_DIRS.some((dir) => f.startsWith(dir)))
  .filter((f) => !DATED_PLAN.test(f));
const scripts = new Set(Object.keys(JSON.parse(readFileSync(at("package.json"), "utf8")).scripts));
const RULES = "docs/agents/RULES.md";
const ruleNumbers = new Set(
  [...readFileSync(at(RULES), "utf8").matchAll(/^(\d+)\.\s+\*\*/gm)].map((m) => Number(m[1])),
);

/** `](relative/path.md)` and `](relative/path.md#anchor)`, skipping URLs and bare anchors. */
const LINK = /\]\((?!https?:|mailto:|#)([^)\s#]+)(#[^)\s]*)?\)/g;
/** A repo path inside backticks: `docs/agents/RULES.md`, `lib/game/gameEngine.ts`, `tests/ui-rules/`. */
const CODE_PATH = /`((?:\.?\/)?(?:app|components|context|docs|lib|scripts|server|shared|tests|tools|assets|locales|\.github)\/[\w./@-]+)`/g;
/** `npm run <script>` in prose or a fenced block. */
const NPM_RUN = /npm run ([\w:-]+)/g;
/**
 * A `rule N` citation, in prose or bold. Not backtick-quoted anywhere in the repo, so no
 * backtick requirement here (unlike CODE_PATH) — matching plain text is what the citations are.
 */
const RULE_CITATION = /\b[Rr]ule (\d+)\b/g;

test("every relative link in a doc resolves", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    const body = readFileSync(at(doc), "utf8");
    for (const [, target] of body.matchAll(LINK)) {
      const resolved = normalize(join(dirname(doc), target));
      if (!existsSync(at(resolved))) broken.push(`${doc} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every repo path a doc names in backticks exists", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    const body = readFileSync(at(doc), "utf8");
    for (const [, target] of body.matchAll(CODE_PATH)) {
      if (!existsSync(at(normalize(target.replace(/\/$/, ""))))) broken.push(`${doc} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every npm script a doc names is defined", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    for (const [, name] of readFileSync(at(doc), "utf8").matchAll(NPM_RUN)) {
      if (!scripts.has(name)) broken.push(`${doc} -> npm run ${name}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every rule N citation names a rule that exists in RULES.md", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    for (const [, num] of readFileSync(at(doc), "utf8").matchAll(RULE_CITATION)) {
      if (!ruleNumbers.has(Number(num))) broken.push(`${doc} -> rule ${num}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("the check reads the doc set from git, not from a list", () => {
  assert.ok(docs.length > 10, `expected the tracked doc set, got ${docs.length}`);
});

/**
 * A repo-relative `docs/` mention in a *comment*, backticked or bare, or on any line of a
 * `PROMPT_SOURCES` file, whose prompts are prose held in string literals. `classify()` is what
 * separates this from a runtime path: a fixture directory built with `path.resolve` sits on a
 * `code` line even though it's a string literal, so it is never scanned here — that path already
 * fails its own test if it goes stale, and this check would otherwise flag a live fixture path as
 * if it were a dead prose citation. The lookbehind excludes a URL's own `/docs/...` segment
 * (`https://socket.io/docs/v4/...`): preceded by another path or domain segment, never a citation
 * into this repo.
 */
const SOURCE_DOC_PATH = /(?<![\w./-])docs\/[\w.@-]+(?:\/[\w.@-]+)*\/?/g;
const PROMPT_SOURCES = [".claude/workflows/"];

test("every docs/ path a comment in tracked source, or a workflow prompt, names exists", () => {
  const broken: string[] = [];
  const sourceFiles = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.mjs"], { cwd: ROOT, encoding: "utf8" })
    .trim().split("\n").filter(Boolean)
    .filter((f) => !EXCLUDED_DIRS.some((dir) => f.startsWith(dir)))
  .filter((f) => !DATED_PLAN.test(f));
  for (const file of sourceFiles) {
    const lines = classify(readFileSync(at(file), "utf8"), file);
    for (const line of lines) {
      if (line.kind !== "comment" && !PROMPT_SOURCES.some((dir) => file.startsWith(dir))) continue;
      for (const [raw] of line.text.matchAll(SOURCE_DOC_PATH)) {
        // Trailing sentence punctuation ("...checks.md.") is not part of the path; a bare
        // fragment ("docs/" alone, or a path a line-wrap cut mid-word, with no `.` in its last
        // segment and no trailing `/`) is not one this check can resolve either way, so it is
        // skipped rather than guessed at.
        const target = raw.replace(/\.$/, "");
        const last = target.replace(/\/$/, "").split("/").pop()!;
        if (!target.endsWith("/") && !last.includes(".")) continue;
        if (!existsSync(at(normalize(target.replace(/\/$/, ""))))) broken.push(`${file} -> ${target}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

/** The bold row labels of GAME-RULES.md § Decisions: the one home of each decided rule. */
function decisionRows(rules: string): string[] {
  const section = /^## Decisions$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(rules)?.[1] ?? "";
  return [...section.matchAll(/^\| \*\*([^*|]+)\*\* \|/gm)].map((m) => m[1].trim());
}

test("a decided rule is stated in GAME-RULES.md § Decisions alone, and nothing cites BRIEF.md's old §3.1 table", () => {
  assert.deepEqual(decisionRows("## Decisions\n\n| Rule | Decision |\n| **A row** | x |\n\n## Next\n| **Not one** | y |\n"), ["A row"]);
  const rows = decisionRows(readFileSync(at("docs/GAME-RULES.md"), "utf8"));
  assert.ok(rows.length >= 10 && rows.includes("The offline turn clock"), `read ${rows.length} decision rows: the table is not being parsed`);
  const brief = readFileSync(at("docs/BRIEF.md"), "utf8");
  assert.deepEqual(rows.filter((row) => brief.includes(row)), [], "BRIEF.md restates these decision rows");

  const staleCitation = /BRIEF\.md`?\s*[§#]?\s*3\.1\b/;
  const citing = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .trim().split("\n")
    .filter((f) => !/^docs\/(adr|plans|research|specs|design)\//.test(f) && existsSync(at(f)))
    .filter((f) => staleCitation.test(readFileSync(at(f), "utf8")));
  assert.deepEqual(citing, [], "these still cite the moved §3.1 table by its old address");
});

/** A path, an optional closing backtick, then a quoted title, a parenthesised list of them, or `§ Title`: a citation by heading, which a moved section leaves dangling while the path still resolves. */
const STOP = '[^)\\n,.;|:"`]';
const HEADING_CITATION = new RegExp(
  `(docs\\/[\\w./-]+\\.md)\`?(?:(?:,\\s*|\\s*\\()((?:"[^"\\n]+"(?:,\\s*(?:and\\s+)?)?)+)|\\s*§\\s*"?(${STOP}+)(?:\\n[ \\t]*(?:\\/\\/|\\*|#)?[ \\t]*(${STOP}+))?)`,
  "g",
);
const QUOTED = /"([^"\n]+)"/g;

function headingsOf(file: string): string[] {
  return [...readFileSync(at(file), "utf8").matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => m[1].replace(/`/g, ""));
}

/** Each citation as the candidate titles it could mean: a `§` title may wrap onto the next line. */
type Citation = { doc: string; titles: string[]; form: "quoted" | "section" };
function headingCitations(text: string): Citation[] {
  return [...text.matchAll(HEADING_CITATION)].flatMap(([, doc, quoted, first, wrapped]): Citation[] => {
    if (quoted) return [...quoted.matchAll(QUOTED)].map((m) => ({ doc, titles: [m[1]], form: "quoted" as const }));
    const one = first.trim();
    if (/^[\d.]/.test(one)) return [];
    return [{ doc, titles: [one, wrapped ? `${one} ${wrapped.trim()}` : one], form: "section" as const }];
  });
}

const resolves = (have: string[], title: string) => {
  const t = title.replace(/`/g, "").trim();
  return have.some((h) => h.startsWith(t) || t.startsWith(h));
};

test("every heading a doc, comment or prompt cites by title exists in the doc it cites", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .trim().split("\n").filter((f) => /\.(md|ts|tsx|mjs|js|cjs)$/.test(f) && existsSync(at(f)))
    .filter((f) => !EXCLUDED_DIRS.some((dir) => f.startsWith(dir)) && !DATED_PLAN.test(f));
  assert.ok(files.length > 100, `read ${files.length} files: the tracked set is not being listed`);
  const broken: string[] = [];
  const read = { quoted: 0, section: 0 };
  for (const file of files) {
    for (const { doc, titles, form } of headingCitations(readFileSync(at(file), "utf8"))) {
      if (!existsSync(at(doc))) continue;
      read[form]++;
      const have = headingsOf(doc);
      if (!titles.some((t) => resolves(have, t))) broken.push(`${file} -> ${doc} ${form === "section" ? "§" : ""} ${titles[0]}`);
    }
  }
  assert.ok(read.quoted >= FLOOR.quoted && read.section >= FLOOR.section, `read ${JSON.stringify(read)} heading citations: a form stopped matching`);
  assert.deepEqual(broken, []);
});

const FLOOR = { quoted: 45, section: 80 };

test("the heading-citation scan reads every form of citation and misses a dangling one", () => {
  const join = (...p: string[]) => p.join("");
  const cases: [string, string[]][] = [
    [join("see docs/agents/traps", '.md ("What a green loop does not mean", "Gone")'), ["What a green loop does not mean", "Gone"]],
    [join("see docs/GAME-RULES", ".md § Decisions"), ["Decisions"]],
    [join("(`docs/agents/suites", ".md` § Effect parity)"), ["Effect parity"]],
    [join("`docs/agents/checks", ".md` § Owner decisions, then"), ["Owner decisions"]],
    [join("// docs/agents/checks", ".md § The viewer's own\n// connection: more"), ["The viewer's own", "The viewer's own connection"]],
  ];
  for (const [text, want] of cases) assert.deepEqual(headingCitations(text).flatMap((c) => c.titles).slice(0, want.length), want, text);
  const have = headingsOf("docs/agents/traps.md");
  assert.ok(resolves(have, "What a green loop does not mean"));
  assert.ok(!resolves(have, "Gone"));
  assert.ok(!resolves(have, "Owner decisions"));
});

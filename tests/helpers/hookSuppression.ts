// tests/helpers/hookSuppression.ts — reading TS source for ESLint directive
// comments, and for the parse health that finding them depends on. Shared by the
// gates that refuse a react-hooks suppression: `tests/hooksLint.test.ts` and
// `tests/reactCompiler.test.ts`.
//
// Which rules count is *not* here: the two gates cover deliberately different
// breadths, and that is each caller's to state.
import ts from "typescript";

type Comment = { line: number; text: string };

/**
 * A directive comment: the keyword it opens with, and the rule names it lists.
 *
 * The keyword as written, not a coarser kind, because it is what tells a
 * file-wide disable from a `-next-line` one in an offender list; `eslint` is the
 * inline-config form, and an empty `rules` under a disable means every rule.
 */
export type Directive = {
  keyword: "eslint" | "eslint-disable" | "eslint-disable-line" | "eslint-disable-next-line";
  rules: string[];
};

function parseFile(source: string, file: string): ts.SourceFile {
  // The kind comes from the name because it is not a formality: in TSX,
  // `<string>foo` opens a JSX element rather than asserting a type, and the
  // rest of the file goes inside it — comments and any directive among them.
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/**
 * Every comment in `source`, opener included, with the 1-based line it starts
 * on.
 *
 * A parse rather than a text match, because nothing matching text tells a regex
 * literal from a division: the backtick in ``/[`]/`` pairs with the next
 * backtick and every directive between the two stops looking like source. A
 * quote can be held to its own line the way JavaScript holds one; a template
 * legitimately spans lines, so a backtick cannot be. Losing a directive is the
 * one way this can be too lax and the only direction that costs anything, which
 * is what buys the parser.
 *
 * Leading and trailing ranges both: `getLeadingCommentRanges` starts collecting
 * only after a line break, so on its own it returns no trailing `//` and no
 * same-line JSX `{/* … *\/}` at all.
 */
function comments(source: string, file: string): Comment[] {
  const parsed = parseFile(source, file);
  const ends = new Map<number, number>();
  const visit = (node: ts.Node) => {
    for (const range of ts.getLeadingCommentRanges(source, node.pos) ?? []) {
      ends.set(range.pos, range.end);
    }
    for (const range of ts.getTrailingCommentRanges(source, node.end) ?? []) {
      ends.set(range.pos, range.end);
    }
    for (const child of node.getChildren(parsed)) visit(child);
  };
  visit(parsed);
  return [...ends]
    .sort(([a], [b]) => a - b)
    .map(([pos, end]) => ({
      line: source.slice(0, pos).split("\n").length,
      text: source.slice(pos, end),
    }));
}

/**
 * The syntax errors in `source` — what a parse losing comments looks like.
 *
 * `transpileModule` rather than the `SourceFile`'s own `parseDiagnostics`,
 * which is not on the public type. It takes its `ScriptKind` from the file name
 * as `parseFile` does, so it is the same parse.
 */
export function syntaxErrors(source: string, file: string): readonly ts.Diagnostic[] {
  return ts.transpileModule(source, { fileName: file, reportDiagnostics: true }).diagnostics ?? [];
}

/**
 * The rule names a directive's tail lists, each cut back to the token the rule
 * name is: a list entry carries a `: "off"` level in the inline-config form and
 * carries prose in the form where somebody wrote a sentence after the rule.
 */
function ruleNames(tail: string): string[] {
  return tail
    .split("--")[0]
    .replace(/\*\/\s*$/, "")
    .split(",")
    .flatMap((entry) => /^\s*([^\s:,]+)/.exec(entry)?.[1] ?? []);
}

/**
 * What `comment` — a whole comment, opener included — asks ESLint to do, or
 * `null` for a comment that asks for nothing.
 *
 * Only a directive opening its own comment counts, which is what anchoring buys
 * and is the whole of what it buys: prose that mentions a directive part-way
 * through reaches ESLint as prose too. A comment that *opens* with one is
 * reported whether or not ESLint honours it, because a comma is what decides:
 * `refs, and never do this` suppresses and `refs is banned here` does not.
 */
function directive(comment: string): Directive | null {
  const inline = /^(?:\/\/|\/\*)\s*eslint\s+([\s\S]*)/.exec(comment);
  if (inline) return { keyword: "eslint", rules: ruleNames(inline[1]) };
  const disable = /^(?:\/\/|\/\*)\s*(eslint-disable(?:-next-line|-line)?)(?![\w-])([\s\S]*)/.exec(
    comment
  );
  return disable
    ? { keyword: disable[1] as Directive["keyword"], rules: ruleNames(disable[2]) }
    : null;
}

/**
 * Every directive comment in `source`, with the line it sits on — the scan and
 * a case list over strings share it, which is how each form a gate must catch
 * is watched failing without planting one in a real file.
 */
export function directives(source: string, file: string): (Directive & { line: number })[] {
  return comments(source, file).flatMap(({ line, text }) => {
    const found = directive(text);
    return found ? [{ ...found, line }] : [];
  });
}

// Every style a <TableText> names is measured against every stop of every felt, which is the only
// place the gradient's 2x luminance range can be seen. The styles are the ones the modules
// build: each component is imported under each platform, StyleSheet.create is watched as it runs,
// and a style is read off the sheet it made, so a style built by a spread, a helper or another
// module is read like any other. The source is parsed only to learn which sheet entries each
// <TableText> is given, and a style it cannot follow is a failure, never a skip. A module with a
// .ios, .android, .web or .native variant is loaded as the variant its platform takes, whatever
// project the test runs in.
import * as ts from "typescript";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, jest, test } from "@jest/globals";
import { minimatch } from "minimatch";
import { StyleSheet } from "react-native";
import { Colors, FeltGradients, Gradient } from "../../lib/tokens.ts";
import { contrastRatio } from "../../lib/contrast.ts";
import { NOTICE_FACES } from "../../components/table/noticeModel.ts";
import { loadedAs, loadVariantsAs, OSES, restoreVariants, variantsOf, type OS, type Variants } from "./harness/platformVariants";
import { BODY_MIN, LARGE_MIN, readsOf, resolve, sourceArrays, sourcesRead, withOpacity } from "../helpers/contrastColours.ts";

const repoRoot = path.resolve(__dirname, "..", "..");
const THIS_TEST = "tests/native/tableTextContrast.test.tsx";
const reads = readsOf(repoRoot, THIS_TEST);
const { CLIENT } = require("../../eslint.guards.cjs") as { CLIENT: string[] };
const sourceArray = sourceArrays(repoRoot, reads);
const COMPONENT_FILES = sourcesRead(repoRoot, reads);
const READ = new Set(COMPONENT_FILES.map(([file]) => file));
const parsed = new Map(COMPONENT_FILES.map(([file, src]) => [file, ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)]));


/** What `Platform.select` answers on `os`: the branch a phone or the browser would take. */
const pickFor = (os: OS, spec: Record<string, unknown>) =>
  os === "web" ? (spec.web ?? spec.default) : os === "android" ? (spec.android ?? spec.native ?? spec.default) : (spec.ios ?? spec.native ?? spec.default);

type Sheet = Record<string, object>;
/** Every sheet each of `files` makes when it is imported as `os`, in the order a file made them. */
function sheetsMadeAs(os: OS, files: string[], watch: ReadonlySet<string>, variants: Variants): Map<string, Sheet[]> {
  const created = new Map<string, Sheet[]>();
  jest.isolateModules(() => {
    const rn = require("react-native") as typeof import("react-native");
    const realCreate = rn.StyleSheet.create.bind(rn.StyleSheet);
    jest.spyOn(rn.StyleSheet, "create").mockImplementation(((styles: Sheet) => {
      const sheet = realCreate(styles);
      const caller = (new Error().stack ?? "").split("\n").flatMap((line) => /\(?(\/[^():]+\.tsx?):\d+:\d+\)?$/.exec(line)?.[1] ?? []).map((f) => path.relative(repoRoot, f)).find((f) => watch.has(f));
      if (caller) created.set(caller, [...(created.get(caller) ?? []), sheet]);
      return sheet;
    }) as typeof rn.StyleSheet.create);
    jest.spyOn(rn.Platform, "select").mockImplementation(((spec: Record<string, unknown>) => pickFor(os, spec)) as typeof rn.Platform.select);
    Object.defineProperty(rn.Platform, "OS", { value: os, configurable: true });
    loadVariantsAs(repoRoot, os, variants);
    try {
      for (const file of files) jest.requireActual(path.join(repoRoot, file));
    } finally {
      restoreVariants(repoRoot, variants);
    }
  });
  return created;
}

const nameOf = (n: ts.PropertyName): string | undefined => (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) ? n.text : undefined);

/** `const NAME = StyleSheet.create({ ... })` as written: the name, and the keys the literal declares. */
function declaredSheets(file: string): { name: string; keys: string[] }[] {
  const out: { name: string; keys: string[] }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText() === "StyleSheet.create"
    ) {
      const literal = node.initializer.arguments[0];
      assert.ok(literal && ts.isObjectLiteralExpression(literal), `${file}: ${node.name.text} is not built from an object literal`);
      const keys = literal.properties.map((p) => {
        const key = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) ? nameOf(p.name) : undefined;
        assert.ok(key, `${file}: ${node.name.getText()} has an entry this audit cannot name (${p.getText().slice(0, 40)})`);
        return key;
      });
      out.push({ name: node.name.text, keys });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed.get(file)!);
  return out;
}

type Ref = { file: string; sheet: string; key: string };
type Unread = { kind: "inline colour" | "other"; text: string };
type Found = { refs: Ref[]; unread: Unread[] };
const INLINE_COLOUR_KEYS = new Set(["color", "backgroundColor"]);
const TABLE_NOTICE = "components/table/TableNotice.tsx";
const INLINE_COLOUR_FROM_ELSEWHERE: Record<string, string> = {
  [TABLE_NOTICE]: "the notice palette's inks, measured over every felt stop by contrast.test.ts",
  "components/CardView.tsx": "the suit's ink over the card's own face, which the felt never reaches",
};

/** Whether `name` is the import of `NOTICE_FACES` from noticeModel, and no declaration of the file hides it. */
function isNoticeFaces(source: ts.SourceFile, name: string): boolean {
  const imported = source.statements.some(
    (st) =>
      ts.isImportDeclaration(st) &&
      /(^|\/)noticeModel(\.ts)?$/.test((st.moduleSpecifier as ts.StringLiteral).text) &&
      st.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(st.importClause.namedBindings) &&
      st.importClause.namedBindings.elements.some((e) => e.name.text === name && (e.propertyName ?? e.name).text === "NOTICE_FACES")
  );
  let hidden = false;
  const find = (n: ts.Node) => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n)) && n.name?.getText() === name) hidden = true;
    ts.forEachChild(n, find);
  };
  find(source);
  return imported && !hidden;
}

/** Every sheet entry a style expression can resolve to, and every piece of it this audit cannot follow. */
function styleRefs(file: string, source: ts.SourceFile, expr: ts.Node, out: Found, seen = new Set<string>()): void {
  const unread = (why: string, kind: Unread["kind"] = "other"): void => {
    out.unread.push({ kind, text: `${file}: ${why}: ${expr.getText().slice(0, 60)}` });
  };
  const again = (e: ts.Node) => styleRefs(file, source, e, out, seen);
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr)) return again(expr.expression);
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.forEach(again);
  if (ts.isSpreadElement(expr)) return again(expr.expression);
  if (ts.isConditionalExpression(expr)) return [expr.whenTrue, expr.whenFalse].forEach(again);
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return again(expr.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return [expr.left, expr.right].forEach(again);
    return unread("an operator that is not a choice of style");
  }
  if ((ts.isElementAccessExpression(expr) || ts.isPropertyAccessExpression(expr)) && ts.isIdentifier(expr.expression) && isNoticeFaces(source, expr.expression.text)) return;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return void out.refs.push({ file, sheet: expr.expression.text, key: expr.name.text });
  }
  if (ts.isObjectLiteralExpression(expr)) {
    for (const p of expr.properties) {
      const key = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? nameOf(p.name) : undefined;
      if (key === undefined) unread("an object entry this audit cannot name");
      else if (INLINE_COLOUR_KEYS.has(key)) unread(`an inline ${key}`, "inline colour");
      else if (key === "opacity") unread("an inline opacity");
    }
    return;
  }
  if (ts.isIdentifier(expr)) {
    if (expr.text === "undefined" || seen.has(expr.text)) return;
    const declared: ts.Expression[] = [];
    const find = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === expr.text && n.initializer) declared.push(n.initializer);
      ts.forEachChild(n, find);
    };
    find(source);
    if (declared.length === 0) return unread("a name with no declaration in this file");
    return declared.forEach((d) => styleRefs(file, source, d, out, new Set([...seen, expr.text])));
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword || expr.kind === ts.SyntaxKind.NullKeyword) return;
  unread("a style built by an expression this audit cannot follow");
}

type Graph = { uses: Map<string, Set<string>>; namespace: Set<string> };
const TABLE_TEXT_FILE = "components/table/TableText.tsx";

/** Which files bring `TableText` in, under which local names, following re-exports through `.ts` and `.tsx` files and `@/` or relative paths. */
function tableTextGraph(sources: Map<string, ts.SourceFile>): Graph {
  const resolveFrom = (from: string, spec: string): string | undefined => {
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.posix.join(path.posix.dirname(from), spec) : undefined;
    return base === undefined ? undefined : ["", ".tsx", ".ts", "/index.tsx", "/index.ts"].map((e) => base + e).find((f) => sources.has(f));
  };
  const exported = new Map<string, Set<string>>([[TABLE_TEXT_FILE, new Set(["TableText"])]]);
  const uses = new Map<string, Set<string>>();
  const namespace = new Set<string>();
  const add = (m: Map<string, Set<string>>, file: string, name: string) => {
    const names = m.get(file) ?? new Set<string>();
    if (names.has(name)) return false;
    m.set(file, names.add(name));
    return true;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const [file, source] of sources) {
      for (const st of source.statements) {
        const from = (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier ? resolveFrom(file, (st.moduleSpecifier as ts.StringLiteral).text) : undefined;
        const names = from ? exported.get(from) : undefined;
        if (ts.isImportDeclaration(st)) {
          const bindings = st.importClause?.namedBindings;
          if (!names || !bindings) continue;
          if (ts.isNamespaceImport(bindings)) namespace.add(file);
          else bindings.elements.forEach((e) => names.has((e.propertyName ?? e.name).text) && (changed = add(uses, file, e.name.text) || changed));
        } else if (ts.isExportDeclaration(st)) {
          const clause = st.exportClause;
          if (from && names) {
            if (!clause) names.forEach((n) => (changed = add(exported, file, n) || changed));
            else if (ts.isNamespaceExport(clause)) namespace.add(file);
            else clause.elements.forEach((e) => names.has((e.propertyName ?? e.name).text) && (changed = add(exported, file, e.name.text) || changed));
          } else if (!st.moduleSpecifier && clause && ts.isNamedExports(clause)) {
            clause.elements.forEach((e) => uses.get(file)?.has((e.propertyName ?? e.name).text) && (changed = add(exported, file, e.name.text) || changed));
          }
        }
      }
    }
  }
  return { uses, namespace };
}

/** The names `TableText` is imported or aliased under in one file; any other use of one is unread. */
function tableTextNames(file: string, source: ts.SourceFile, graph: Graph, out: Found): Set<string> {
  const names = new Set(graph.uses.get(file) ?? []);
  if (graph.namespace.has(file)) out.unread.push({ kind: "other", text: `${file}: TableText reached through a namespace import or export` });
  const aliases = (n: ts.Node): void => {
    const init = ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) ? n.initializer : undefined;
    if (init && ts.isIdentifier(init) && names.has(init.text)) names.add((n as ts.VariableDeclaration).name.getText());
    ts.forEachChild(n, aliases);
  };
  for (let size = -1; size !== names.size; ) {
    size = names.size;
    aliases(source);
  }
  const misuse = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && names.has(n.text)) {
      const p = n.parent;
      const asTag = (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === n;
      const declares = asTag || ts.isImportSpecifier(p) || (ts.isVariableDeclaration(p) && (p.name === n || (p.initializer === n && ts.isIdentifier(p.name))));
      if (!declares) out.unread.push({ kind: "other", text: `${file}: TableText used other than as a tag: ${p.getText().slice(0, 60)}` });
    }
    ts.forEachChild(n, misuse);
  };
  misuse(source);
  return names;
}

/** The sheet entries every `<TableText>` of one source names, and what could not be followed. */
function tableTextIn(file: string, source: ts.SourceFile, graph: Graph): Found {
  const out: Found = { refs: [], unread: [] };
  if (file === TABLE_TEXT_FILE) return out;
  const names = tableTextNames(file, source, graph, out);
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      if (ts.isPropertyAccessExpression(tag) && tag.name.text === "TableText") out.unread.push({ kind: "other", text: `${file}: <${tag.getText()}> is not followed to TableText` });
      if (ts.isIdentifier(tag) && names.has(tag.text)) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attr)) {
            let e: ts.Expression = attr.expression;
            while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
            const plain = ts.isObjectLiteralExpression(e) && e.properties.every((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && nameOf(p.name) !== undefined && nameOf(p.name) !== "style");
            if (!plain && !(ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "a11yHidden")) out.unread.push({ kind: "other", text: `${file}: a spread that can carry a style: ${attr.getText().slice(0, 60)}` });
            continue;
          }
          if (attr.name.getText() !== "style" || !attr.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) continue;
          styleRefs(file, source, attr.initializer.expression, out);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** What a scan of one source reports once the files with a stated reason for an inline colour are let through. */
function unreadIn(file: string, found: Found): string[] {
  return found.unread.filter((u) => !(u.kind === "inline colour" && file in INLINE_COLOUR_FROM_ELSEWHERE)).map((u) => u.text);
}

const asSource = (file: string, src: string) => ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const EVERY_SOURCE = new Map(sourcesRead(repoRoot, CLIENT).map(([file, src]) => [file, parsed.get(file) ?? asSource(file, src)]));
const GRAPH = tableTextGraph(EVERY_SOURCE);
const VARIANTS = variantsOf(EVERY_SOURCE.keys());

const FOUND: Found = { refs: [], unread: [] };
for (const [file] of COMPONENT_FILES) {
  const here = tableTextIn(file, parsed.get(file)!, GRAPH);
  FOUND.refs.push(...here.refs);
  FOUND.unread.push(...unreadIn(file, here).map((text) => ({ kind: "other" as const, text })));
}
const TABLE_TEXT = [...new Map(FOUND.refs.map((r) => [`${r.file}:${r.sheet}.${r.key}`, r])).values()];

// A sheet is named by the file that declares it, which is the call site's own for `styles` and the one
// file that declares it for any other name; every file that names a sheet is imported first.
const declaring = (ref: Ref): string => {
  if (ref.sheet === "styles") return ref.file;
  const owners = COMPONENT_FILES.map(([file]) => file).filter((file) => declaredSheets(file).some((s) => s.name === ref.sheet));
  assert.equal(owners.length, 1, `${ref.file}: ${ref.sheet} is declared in ${owners.length} files`);
  return owners[0]!;
};
const owners = new Map(TABLE_TEXT.map((ref) => [`${ref.file}:${ref.sheet}`, declaring(ref)]));
const sheetKey = (file: string, name: string) => (name === "styles" ? `${file}:styles` : name);

const SHEETS = Object.fromEntries(
  OSES.map((os) => {
    const files = [...new Set(owners.values())];
    const made = sheetsMadeAs(os, files, READ, VARIANTS);
    const sheets = new Map<string, Sheet>();
    for (const file of files) {
      const unmatched = [...(made.get(file) ?? [])];
      for (const { name, keys } of declaredSheets(file)) {
        const at = unmatched.findIndex((sheet) => keys.length === Object.keys(sheet).length && keys.every((k) => k in sheet));
        assert.ok(at !== -1, `${file}: importing it as ${os} did not run StyleSheet.create for ${name} (${keys.length} entries)`);
        assert.ok(!sheets.has(sheetKey(file, name)), `${name} is declared twice`);
        sheets.set(sheetKey(file, name), unmatched.splice(at, 1)[0]!);
      }
    }
    return [os, sheets];
  })
) as Record<OS, Map<string, Sheet>>;

function sheetEntry(ref: Ref, os: OS): Record<string, unknown> {
  const sheet = SHEETS[os].get(sheetKey(owners.get(`${ref.file}:${ref.sheet}`)!, ref.sheet))!;
  assert.ok(ref.key in sheet, `${ref.file}: ${ref.sheet}.${ref.key} is not an entry of the sheet the module made`);
  return (StyleSheet.flatten(sheet[ref.key] as object) ?? {}) as Record<string, unknown>;
}

const refOf = (id: string): Ref => {
  const [file, entry] = id.split(":") as [string, string];
  const [sheet, key] = entry.split(".") as [string, string];
  return { file, sheet, key };
};
const asColour = (id: string, what: string, value: unknown): string => {
  assert.ok(typeof value === "string" && /^(#[0-9a-fA-F]{6}|rgba\(.*\))$/.test(value), `${id}: ${what} is ${JSON.stringify(value)}, neither #rrggbb nor rgba()`);
  return value;
};

/** A style's `backgroundColor`, as the module's own sheet holds it on `os`. */
function styleFill(id: string, os: OS): string | null {
  const fill = sheetEntry(refOf(id), os).backgroundColor;
  return fill === undefined ? null : asColour(id, "backgroundColor", fill);
}

/** A style's ink with its own `opacity` folded in, or null for a style that sets neither. */
function inkOf(id: string, entry: Record<string, unknown>): string | null {
  if (entry.color === undefined) {
    assert.ok(entry.opacity === undefined, `${id} sets an opacity but no colour`);
    return null;
  }
  const ink = asColour(id, "color", entry.color);
  return entry.opacity === undefined ? ink : withOpacity(ink, Number(entry.opacity));
}
const styleInk = (id: string, os: OS): string | null => inkOf(id, sheetEntry(refOf(id), os));
const inkedOn = (id: string) => OSES.some((os) => styleInk(id, os) !== null);
const platedOn = (id: string) => OSES.some((os) => styleFill(id, os) !== null);

const idOf = (r: Ref) => `${r.file}:${r.sheet}.${r.key}`;
const ANY_STOP = [0, 1, 2, 3, 4];

/**
 * What each inked `<TableText>` style is painted over, keyed `file:sheet.key`.
 * `plate` is a style whose fill sits between it and the felt; `gradient` is a
 * fill given as `colors`, which no style can name. Neither means bare felt.
 */
type Backdrop = { plate?: string | string[]; gradient?: readonly string[]; stops?: number[]; measuredBy?: string };
const MEASURED = { measuredBy: "tests/e2e/seatNameContrast.spec.ts" };
const GIOCA = [...Gradient.playButton, ...sourceArray("GIOCA_GRADIENT_PRESSED")];
const PASSA = [...Gradient.garnet, ...sourceArray("PASS_GRADIENT_PRESSED")];
const SHEET = sourceArray("SHEET_GRADIENT");
const SCORE_PILL = { gradient: [Colors.scorePillTop, Colors.scorePillFoot] };
const SCORE_ROW = { ...SCORE_PILL, plate: "styles.rowMine" };
const ON_TABLE: Record<string, Backdrop> = {
  "components/table/actions.tsx:styles.playBtnLabel": { gradient: GIOCA },
  "components/table/actions.tsx:styles.playBtnSub": { gradient: GIOCA },
  // PASSA's dim fill is a sibling of its label, not an ancestor; both buttons draw the same one.
  "components/table/actions.tsx:styles.btnDimLabel": { plate: "styles.btnDimFace" },
  "components/table/actions.tsx:styles.passBtnLabel": { gradient: PASSA },
  "components/table/scorePill.tsx:styles.you": SCORE_PILL,
  "components/table/scorePill.tsx:styles.total": SCORE_PILL,
  "components/table/scorePill.tsx:styles.of": SCORE_PILL,
  "components/table/scorePill.tsx:styles.badgeText": { gradient: Gradient.playButton },
  "components/table/scorePill.tsx:styles.head": SCORE_PILL,
  "components/table/scorePill.tsx:styles.sub": SCORE_PILL,
  "components/table/scorePill.tsx:styles.place": SCORE_ROW,
  "components/table/scorePill.tsx:styles.discText": { gradient: [Colors.seatDisc, Colors.seatDiscDeep] },
  "components/table/scorePill.tsx:styles.name": SCORE_ROW,
  "components/table/scorePill.tsx:styles.nameMine": SCORE_ROW,
  "components/table/scorePill.tsx:styles.gain": SCORE_ROW,
  "components/table/scorePill.tsx:styles.gainNone": SCORE_ROW,
  "components/table/scorePill.tsx:styles.rowTotal": SCORE_ROW,
  "components/table/scorePill.tsx:styles.placeWon": SCORE_ROW,
  "components/table/matchBoard.tsx:styles.label": SCORE_PILL,
  "components/table/matchBoard.tsx:styles.name": SCORE_PILL,
  "components/table/matchBoard.tsx:styles.nameMine": SCORE_PILL,
  "components/table/matchBoard.tsx:styles.ratingLine": SCORE_PILL,
  "components/table/matchBoard.tsx:styles.ratingGain": SCORE_PILL,
  "components/table/matchBoard.tsx:styles.ratingLoss": SCORE_PILL,
  "components/table/matchBoard.tsx:styles.btnText": { plate: "styles.btn" },
  "components/table/matchBoard.tsx:styles.btnTextPrimary": { gradient: Gradient.playButton },
  "components/table/rotateOverlay.tsx:portraitOverlayStyles.title": { plate: "portraitOverlayStyles.overlay" },
  "components/table/rotateOverlay.tsx:portraitOverlayStyles.sub": { plate: "portraitOverlayStyles.overlay" },
  // The disc's own gradient is darker than both stand-in stops.
  "components/table/seats.tsx:seatStyles.discInitials": { stops: [3, 4] },
  "components/table/seats.tsx:seatStyles.countBubbleText": { plate: "seatStyles.countBubble" },
  "components/table/seats.tsx:seatStyles.countBubbleTextLast": { plate: "seatStyles.countBubbleLast" },
  "components/table/seats.tsx:seatStyles.oppName": MEASURED,
  "components/table/seats.tsx:seatStyles.oppNameActive": MEASURED,
  "components/table/settingsSheet.tsx:sheetStyles.rowLabel": { gradient: SHEET },
  "components/table/settingsSheet.tsx:sheetStyles.rowHint": { gradient: SHEET },
  "components/table/settingsSheet.tsx:sheetStyles.header": { gradient: SHEET },
  "components/table/settingsSheet.tsx:sheetStyles.foot": { gradient: SHEET },
  "components/table/settingsSheet.tsx:sheetStyles.exitLabel": { gradient: Gradient.garnet },
};

/** A disabled control's label is held to the large-text bar, WCAG's floor for inactive UI. */
const DISABLED = new Set(["components/table/actions.tsx:styles.btnDimLabel"]);

test("every <TableText> style is one this audit can follow to a sheet the modules made", () => {
  assert.deepEqual(FOUND.unread.map((u) => u.text), [], "a style the audit cannot read passes it by not looking: name it through a StyleSheet entry");
  assert.ok(TABLE_TEXT.length > 30, `found only ${TABLE_TEXT.length} <TableText> styles`);
  const read = TABLE_TEXT.filter((ref) => inkedOn(idOf(ref)) || platedOn(idOf(ref)));
  assert.ok(read.length > 30, `read only ${read.length} styles' colours off the modules' sheets`);
});

test("the manifest names what the audit reads: every glob reads a file, every importer of TableText is inside it, and so is every allowance", () => {
  for (const glob of reads) assert.ok(COMPONENT_FILES.some(([file]) => minimatch(file, glob)), `${glob} in tests/native/reads.json reads no tracked file`);
  const outside = [...GRAPH.uses.keys(), ...GRAPH.namespace].filter((file) => file !== TABLE_TEXT_FILE && !READ.has(file));
  assert.deepEqual(outside, [], "a file brings in TableText from outside the globs of tests/native/reads.json, so its text goes unaudited");
  assert.deepEqual(Object.keys(INLINE_COLOUR_FROM_ELSEWHERE).filter((file) => !READ.has(file)), [], "an allowance for a file the audit does not read");
});

test("a notice face sets a family and nothing the contrast audit would need to see", () => {
  for (const [face, style] of Object.entries(NOTICE_FACES)) {
    assert.deepEqual(Object.keys(style).filter((k) => k === "color" || k === "opacity" || k === "backgroundColor"), [], `NOTICE_FACES.${face}`);
  }
});

test("every inked <TableText> style says what it is painted over", () => {
  const unclassified = TABLE_TEXT.filter((ref) => inkedOn(idOf(ref)) && !(idOf(ref) in ON_TABLE)).map(idOf);
  assert.deepEqual(unclassified, [], "add these to ON_TABLE");
  const stale = Object.keys(ON_TABLE).filter((id) => !TABLE_TEXT.some((ref) => idOf(ref) === id));
  assert.deepEqual(stale, [], "no <TableText> names these any more");
});

test("only the seat name's two inks are left to the device to measure", () => {
  const measured = Object.keys(ON_TABLE).filter((id) => ON_TABLE[id]!.measuredBy !== undefined);
  assert.deepEqual(measured, ["components/table/seats.tsx:seatStyles.oppName", "components/table/seats.tsx:seatStyles.oppNameActive"]);
});

test("no <TableText> style paints its own plate: table text sits on the felt or inside a notice", () => {
  assert.deepEqual(TABLE_TEXT.map(idOf).filter(platedOn), []);
});

test("the pile inks no text of its own: its notices are TableNotice's plate, in the palette loop of contrast.test.ts", () => {
  assert.deepEqual(TABLE_TEXT.filter((r) => r.file === "components/table/pile.tsx"), []);
  assert.ok(TABLE_TEXT.some((r) => r.file === TABLE_NOTICE), "TableNotice inks no <TableText> style");
});

function assertClears(id: string, ink: string, fills: string[], backdrop: Backdrop, min: number, os: OS) {
  for (const [felt, gradient] of Object.entries(FeltGradients)) {
    for (const stop of backdrop.stops ?? ANY_STOP) {
      for (const over of backdrop.gradient ?? [gradient[stop]!]) {
        const surface = fills.reduce((under, fill) => resolve(fill, under), resolve(over, gradient[stop]!));
        const ratio = contrastRatio(resolve(ink, surface), surface);
        assert.ok(ratio >= min, `${id} on ${os} over ${felt} stop ${stop} (${over}) is only ${ratio.toFixed(2)}:1, needs >=${min}:1`);
      }
    }
  }
}

describe("a module is loaded as the variant its platform takes", () => {
  const FIXTURE = "tests/native/variants/sheet.ts";
  const inkOn = (os: OS, variants: Variants, watch = new Set([FIXTURE])) => {
    const [sheet] = sheetsMadeAs(os, [FIXTURE], watch, variants).get(FIXTURE)!;
    return (sheet!.label as { color: string }).color;
  };
  const files = sourcesRead(repoRoot, ["tests/native/variants/*.ts"]).map(([file]) => file);

  test("a .android and a .web variant change the ink the sheet is built from, in any project", () => {
    assert.deepEqual(OSES.map((os) => inkOn(os, variantsOf(files))), ["#d4af37", "#2a2a2a", "#3b3b3b"]);
  });

  test("without the variants the plain module is what every platform gets", () => {
    assert.deepEqual(OSES.map((os) => inkOn(os, variantsOf(files.filter((f) => f.endsWith("tone.ts") || f.endsWith("sheet.ts"))))), ["#d4af37", "#d4af37", "#d4af37"]);
  });

  test("the variants of the app sources are found", () => {
    assert.deepEqual([...variantsOf(["a/x.ts", "a/x.web.ts", "a/y.tsx", "a/z.native.tsx", "a/z.tsx"]).keys()], ["a/x.ts", "a/z.tsx"]);
    const v = variantsOf(["a/z.native.tsx", "a/z.android.tsx", "a/z.tsx"]).get("a/z.tsx")!;
    assert.deepEqual(OSES.map((os) => loadedAs(os, v)), ["a/z.native.tsx", "a/z.android.tsx", "a/z.tsx"]);
  });
});

describe("the audit sees what a text scan of `key: {` could not", () => {
  const scan = (file: string, code: string, others: Record<string, string> = {}) => {
    const files = { [TABLE_TEXT_FILE]: "export function TableText() {}", ...others, [file]: code };
    const sources = new Map(Object.entries(files).map(([name, src]) => [name, asSource(name, src)]));
    const found = tableTextIn(file, sources.get(file)!, tableTextGraph(sources));
    return { keys: found.refs.map((r) => r.key), unread: unreadIn(file, found) };
  };
  const PLANT = "components/plant.tsx";
  const IMPORT = 'import { TableText } from "./table/TableText";\n';
  const IMPORT_BESIDE = 'import { TableText } from "./TableText";\n';

  test("an ink built by a spread or a helper is read off the sheet the module made", () => {
    const FACE = { color: "#444444", opacity: 0.5 };
    const faint = () => ({ color: "#555555" });
    const sheet = StyleSheet.create({ spread: { ...FACE }, helper: faint() });
    assert.equal(inkOf("spread", sheet.spread as Record<string, unknown>), "rgba(68,68,68,0.5)");
    assert.equal(inkOf("helper", sheet.helper as Record<string, unknown>), "#555555");
  });

  test("a style it cannot follow to a sheet is reported, not skipped", () => {
    for (const style of ["helper()", "[styles.a, ...more(), { color: c }]", "[styles.a, { ...spread }]", "[styles.a, missing]", "flag ? styles.a : lookup[k]", "{ opacity: 0.2 }"]) {
      assert.ok(scan(PLANT, `${IMPORT}const a = <TableText style={${style}} />;`).unread.length > 0, style);
    }
  });

  test("a style it can follow is not", () => {
    const seen = scan(PLANT, `${IMPORT}const small = { fontSize: 3 };\nconst a = <TableText style={[styles.a, flag && styles.b, cond ? styles.c : undefined, small, { fontSize: 4 }]} />;`);
    assert.deepEqual(seen.unread, []);
    assert.deepEqual(seen.keys, ["a", "b", "c"]);
  });

  test("an inline colour is let through only where a reason is stated, and an inline opacity or an unread style never is", () => {
    const style = (e: string) => `${IMPORT_BESIDE}import { NOTICE_FACES } from "./noticeModel";\nconst a = <TableText style={${e}} />;`;
    assert.deepEqual(scan(TABLE_NOTICE, style("[NOTICE_FACES[run.face], styles.upper, { color: paint.strong }]")).unread, []);
    assert.equal(scan("components/table/seats.tsx", style("{ color: paint.strong }")).unread.length, 1);
    for (const e of ["[washOut()]", "[faint]", "{ opacity: 0.2 }", "[{ color: c, opacity: 0.2 }]", "[...rest]"]) {
      assert.ok(scan(TABLE_NOTICE, style(e)).unread.length > 0, `TableNotice: ${e}`);
      assert.ok(scan("components/CardView.tsx", `${IMPORT}const a = <TableText style={${e}} />;`).unread.length > 0, `CardView: ${e}`);
    }
  });

  test("TableText is followed through an alias, a renamed import and a spread", () => {
    assert.deepEqual(scan(PLANT, `${IMPORT}const Label = TableText;\nconst a = <Label style={styles.viaAlias} />;`).keys, ["viaAlias"]);
    assert.deepEqual(scan(PLANT, 'import { TableText as Small } from "./table/TableText";\nconst a = <Small style={styles.viaRename} />;').keys, ["viaRename"]);
    assert.deepEqual(scan(PLANT, `${IMPORT}const a = <TableText {...a11yHidden()} style={styles.k} />;`).unread, []);
    assert.equal(scan(PLANT, `${IMPORT}const a = <TableText {...{ style: { color: "#2a2a2a" } }} />;`).unread.length, 1);
    assert.equal(scan(PLANT, `${IMPORT}const a = <TableText {...props} />;`).unread.length, 1);
    assert.equal(scan(PLANT, `${IMPORT}const Wrapped = styled(TableText);`).unread.length, 1);
    assert.equal(scan(PLANT, `${IMPORT}const a = <Ui.TableText style={styles.x} />;`).unread.length > 0, true);
  });

  test("TableText is followed through a barrel, whatever it renames it to", () => {
    const barrel = { "components/table/barrel.ts": 'export { TableText as Label } from "./TableText";', "components/deep.ts": 'export * from "./table/barrel";' };
    assert.deepEqual(scan(PLANT, 'import { Label } from "./table/barrel";\nconst a = <Label style={styles.viaBarrel} />;', barrel).keys, ["viaBarrel"]);
    assert.deepEqual(scan(PLANT, 'import { Label as Inner } from "./deep";\nconst a = <Inner style={styles.viaTwo} />;', barrel).keys, ["viaTwo"]);
    assert.equal(scan(PLANT, 'import * as Ui from "./table/barrel";', barrel).unread.length, 1);
    assert.deepEqual(scan(PLANT, 'import { Other } from "./table/barrel";\nconst a = <Other style={styles.no} />;', barrel).keys, []);
  });

  test("NOTICE_FACES is the noticeModel import, not a name a file can reuse", () => {
    const faces = (decl: string) => `${IMPORT_BESIDE}${decl}\nconst a = <TableText style={[NOTICE_FACES.bold]} />;`;
    assert.deepEqual(scan(TABLE_NOTICE, faces('import { NOTICE_FACES } from "./noticeModel";')).unread, []);
    assert.ok(scan(TABLE_NOTICE, faces('const NOTICE_FACES = { bold: { color: "#2a2a2a" } };')).keys.includes("bold"));
    assert.ok(scan(TABLE_NOTICE, faces('import { NOTICE_FACES } from "./noticeModel";\nfunction f() { const NOTICE_FACES = {}; }')).keys.includes("bold"));
    assert.ok(scan(TABLE_NOTICE, faces('import { NOTICE_FACES } from "./elsewhere";')).keys.includes("bold"));
  });

  test("a washed-out ink fails the bar on the felt", () => {
    const black = { gradient: ["#000000"] };
    assert.throws(() => assertClears("plant", "#444444", [], black, BODY_MIN, "ios"), /only .*:1/);
    assert.doesNotThrow(() => assertClears("plant", "#ffffff", [], black, BODY_MIN, "ios"));
  });

  test("a platform's branch is the one it takes", () => {
    const spec = { ios: "i", web: "w", default: "d" };
    assert.deepEqual(OSES.map((os) => pickFor(os, spec)), ["i", "d", "w"]);
    assert.equal(pickFor("android", { native: "n", default: "d" }), "n");
  });
});

for (const ref of TABLE_TEXT) {
  const id = idOf(ref);
  const backdrop = ON_TABLE[id];
  if (!backdrop) continue;
  const min = DISABLED.has(id) ? LARGE_MIN : BODY_MIN;
  const spec = backdrop.measuredBy;
  if (spec) {
    test(`the table's ${ref.sheet}.${ref.key} is measured over the real felt by ${spec}`, () => {
      assert.match(readFileSync(path.join(repoRoot, spec), "utf8"), /seat-name[\s\S]*toBeGreaterThanOrEqual\(BODY_MIN\)/);
    });
    continue;
  }
  test(`the table's ${ref.sheet}.${ref.key} clears ${min}:1 on every felt stop, on every platform`, () => {
    for (const os of OSES) {
      const ink = styleInk(id, os);
      assert.ok(ink, `${id} has no color on ${os}`);
      const fills = [backdrop.plate ?? []].flat().map((plate) => {
        const fill = styleFill(`${ref.file}:${plate}`, os);
        assert.ok(fill, `${plate} no longer paints a background on ${os}`);
        return fill;
      });
      assertClears(id, ink, fills, backdrop, min, os);
    }
  });
}

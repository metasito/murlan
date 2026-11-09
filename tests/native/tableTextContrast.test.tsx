// Every style a <TableText> names is measured against every stop of every felt, which is the only
// place the gradient's 2x luminance range can be seen. The styles are the ones the modules
// build: each component is imported under each platform, StyleSheet.create is watched as it runs,
// and a style is read off the sheet it made, so a style built by a spread, a helper or another
// module is read like any other. The source is parsed only to learn which sheet entries each
// <TableText> is given, and a style it cannot follow is a failure, never a skip.
import * as ts from "typescript";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, jest, test } from "@jest/globals";
import { StyleSheet } from "react-native";
import { Colors, FeltGradients, Gradient } from "../../lib/tokens.ts";
import { contrastRatio } from "../../lib/contrast.ts";
import { NOTICE_FACES } from "../../components/table/noticeModel.ts";
import { BODY_MIN, LARGE_MIN, componentSources, resolve, sourceArrays, withOpacity } from "../helpers/contrastColours.ts";

const repoRoot = path.resolve(__dirname, "..", "..");
const componentsDir = path.join(repoRoot, "components") + path.sep;
const sourceArray = sourceArrays(repoRoot);
const THIS_TEST = "tests/native/tableTextContrast.test.tsx";
const reads = (JSON.parse(readFileSync(path.join(repoRoot, "tests/native/reads.json"), "utf8")) as Record<string, string[]>)[THIS_TEST]!;
const COMPONENT_FILES = componentSources(repoRoot, reads);
const parsed = new Map(COMPONENT_FILES.map(([file, src]) => [file, ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)]));

const OSES = ["ios", "android", "web"] as const;
type OS = (typeof OSES)[number];

/** What `Platform.select` answers on `os`: the branch a phone or the browser would take. */
const pickFor = (os: OS, spec: Record<string, unknown>) =>
  os === "web" ? (spec.web ?? spec.default) : os === "android" ? (spec.android ?? spec.native ?? spec.default) : (spec.ios ?? spec.native ?? spec.default);

type Sheet = Record<string, object>;

/** Every sheet each of `files` makes when it is imported as `os`, in the order a file made them. */
function sheetsMadeAs(os: OS, files: string[]): Map<string, Sheet[]> {
  const created = new Map<string, Sheet[]>();
  jest.isolateModules(() => {
    const rn = require("react-native") as typeof import("react-native");
    const realCreate = rn.StyleSheet.create.bind(rn.StyleSheet);
    jest.spyOn(rn.StyleSheet, "create").mockImplementation(((styles: Sheet) => {
      const sheet = realCreate(styles);
      const caller = (new Error().stack ?? "").split("\n").flatMap((line) => /\(?(\/[^():]+\.tsx?):\d+:\d+\)?$/.exec(line)?.[1] ?? []).find((f) => f.startsWith(componentsDir));
      if (caller) created.set(caller, [...(created.get(caller) ?? []), sheet]);
      return sheet;
    }) as typeof rn.StyleSheet.create);
    jest.spyOn(rn.Platform, "select").mockImplementation(((spec: Record<string, unknown>) => pickFor(os, spec)) as typeof rn.Platform.select);
    Object.defineProperty(rn.Platform, "OS", { value: os, configurable: true });
    for (const file of files) require(path.join(componentsDir, file));
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
const TABLE_NOTICE = "table/TableNotice.tsx";
const INLINE_COLOUR_FROM_ELSEWHERE: Record<string, string> = {
  [TABLE_NOTICE]: "the notice palette's inks, measured over every felt stop by contrast.test.ts",
  "CardView.tsx": "the suit's ink over the card's own face, which the felt never reaches",
};

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
  const faces = (e: ts.Expression) => ts.isIdentifier(e) && e.text === "NOTICE_FACES";
  if ((ts.isElementAccessExpression(expr) || ts.isPropertyAccessExpression(expr)) && faces(expr.expression)) return;
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

/** The names `TableText` is imported or aliased under, found from the import binding; any other use of one is unread. */
function tableTextNames(file: string, source: ts.SourceFile, out: Found): Set<string> {
  const names = new Set<string>();
  source.statements.forEach((st) => {
    if (!ts.isImportDeclaration(st) || !/\/TableText$|^\.\/TableText$/.test((st.moduleSpecifier as ts.StringLiteral).text)) return;
    const bindings = st.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach((e) => (e.propertyName ?? e.name).text === "TableText" && names.add(e.name.text));
  });
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
function tableTextIn(file: string, source: ts.SourceFile): Found {
  const out: Found = { refs: [], unread: [] };
  if (file === "table/TableText.tsx") return out;
  const names = tableTextNames(file, source, out);
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

const FOUND: Found = { refs: [], unread: [] };
for (const [file] of COMPONENT_FILES) {
  const here = tableTextIn(file, parsed.get(file)!);
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
    const made = sheetsMadeAs(os, files);
    const sheets = new Map<string, Sheet>();
    for (const file of files) {
      const unmatched = [...(made.get(path.join(componentsDir, file)) ?? [])];
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
  "table/actions.tsx:styles.playBtnLabel": { gradient: GIOCA },
  "table/actions.tsx:styles.playBtnSub": { gradient: GIOCA },
  // PASSA's dim fill is a sibling of its label, not an ancestor; both buttons draw the same one.
  "table/actions.tsx:styles.btnDimLabel": { plate: "styles.btnDimFace" },
  "table/actions.tsx:styles.passBtnLabel": { gradient: PASSA },
  "table/scorePill.tsx:styles.you": SCORE_PILL,
  "table/scorePill.tsx:styles.total": SCORE_PILL,
  "table/scorePill.tsx:styles.of": SCORE_PILL,
  "table/scorePill.tsx:styles.badgeText": { gradient: Gradient.playButton },
  "table/scorePill.tsx:styles.head": SCORE_PILL,
  "table/scorePill.tsx:styles.sub": SCORE_PILL,
  "table/scorePill.tsx:styles.place": SCORE_ROW,
  "table/scorePill.tsx:styles.discText": { gradient: [Colors.seatDisc, Colors.seatDiscDeep] },
  "table/scorePill.tsx:styles.name": SCORE_ROW,
  "table/scorePill.tsx:styles.nameMine": SCORE_ROW,
  "table/scorePill.tsx:styles.gain": SCORE_ROW,
  "table/scorePill.tsx:styles.gainNone": SCORE_ROW,
  "table/scorePill.tsx:styles.rowTotal": SCORE_ROW,
  "table/scorePill.tsx:styles.placeWon": SCORE_ROW,
  "table/matchBoard.tsx:styles.label": SCORE_PILL,
  "table/matchBoard.tsx:styles.name": SCORE_PILL,
  "table/matchBoard.tsx:styles.nameMine": SCORE_PILL,
  "table/matchBoard.tsx:styles.ratingLine": SCORE_PILL,
  "table/matchBoard.tsx:styles.ratingGain": SCORE_PILL,
  "table/matchBoard.tsx:styles.ratingLoss": SCORE_PILL,
  "table/matchBoard.tsx:styles.btnText": { plate: "styles.btn" },
  "table/matchBoard.tsx:styles.btnTextPrimary": { gradient: Gradient.playButton },
  "table/rotateOverlay.tsx:portraitOverlayStyles.title": { plate: "portraitOverlayStyles.overlay" },
  "table/rotateOverlay.tsx:portraitOverlayStyles.sub": { plate: "portraitOverlayStyles.overlay" },
  // The disc's own gradient is darker than both stand-in stops.
  "table/seats.tsx:seatStyles.discInitials": { stops: [3, 4] },
  "table/seats.tsx:seatStyles.countBubbleText": { plate: "seatStyles.countBubble" },
  "table/seats.tsx:seatStyles.countBubbleTextLast": { plate: "seatStyles.countBubbleLast" },
  "table/seats.tsx:seatStyles.oppName": MEASURED,
  "table/seats.tsx:seatStyles.oppNameActive": MEASURED,
  "table/settingsSheet.tsx:sheetStyles.rowLabel": { gradient: SHEET },
  "table/settingsSheet.tsx:sheetStyles.rowHint": { gradient: SHEET },
  "table/settingsSheet.tsx:sheetStyles.header": { gradient: SHEET },
  "table/settingsSheet.tsx:sheetStyles.foot": { gradient: SHEET },
  "table/settingsSheet.tsx:sheetStyles.exitLabel": { gradient: Gradient.garnet },
};

/** A disabled control's label is held to the large-text bar, WCAG's floor for inactive UI. */
const DISABLED = new Set(["table/actions.tsx:styles.btnDimLabel"]);

test("every <TableText> style is one this audit can follow to a sheet the modules made", () => {
  assert.deepEqual(FOUND.unread.map((u) => u.text), [], "a style the audit cannot read passes it by not looking: name it through a StyleSheet entry");
  assert.ok(TABLE_TEXT.length > 30, `found only ${TABLE_TEXT.length} <TableText> styles`);
  const read = TABLE_TEXT.filter((ref) => inkedOn(idOf(ref)) || platedOn(idOf(ref)));
  assert.ok(read.length > 30, `read only ${read.length} styles' colours off the modules' sheets`);
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
  assert.deepEqual(measured, ["table/seats.tsx:seatStyles.oppName", "table/seats.tsx:seatStyles.oppNameActive"]);
});

test("no <TableText> style paints its own plate: table text sits on the felt or inside a notice", () => {
  assert.deepEqual(TABLE_TEXT.map(idOf).filter(platedOn), []);
});

test("the pile inks no text of its own: its notices are TableNotice's plate, in the palette loop of contrast.test.ts", () => {
  assert.deepEqual(TABLE_TEXT.filter((r) => r.file === "table/pile.tsx"), []);
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

describe("the audit sees what a text scan of `key: {` could not", () => {
  const scan = (file: string, code: string) => {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found = tableTextIn(file, source);
    return { keys: found.refs.map((r) => r.key), unread: unreadIn(file, found) };
  };
  const IMPORT = 'import { TableText } from "./TableText";\n';

  test("an ink built by a spread or a helper is read off the sheet the module made", () => {
    const FACE = { color: "#444444", opacity: 0.5 };
    const faint = () => ({ color: "#555555" });
    const sheet = StyleSheet.create({ spread: { ...FACE }, helper: faint() });
    assert.equal(inkOf("spread", sheet.spread as Record<string, unknown>), "rgba(68,68,68,0.5)");
    assert.equal(inkOf("helper", sheet.helper as Record<string, unknown>), "#555555");
  });

  test("a style it cannot follow to a sheet is reported, not skipped", () => {
    for (const style of ["helper()", "[styles.a, ...more(), { color: c }]", "[styles.a, { ...spread }]", "[styles.a, missing]", "flag ? styles.a : lookup[k]", "{ opacity: 0.2 }"]) {
      assert.ok(scan("plant.tsx", `${IMPORT}const a = <TableText style={${style}} />;`).unread.length > 0, style);
    }
  });

  test("a style it can follow is not", () => {
    const seen = scan("plant.tsx", `${IMPORT}const small = { fontSize: 3 };\nconst a = <TableText style={[styles.a, flag && styles.b, cond ? styles.c : undefined, small, { fontSize: 4 }]} />;`);
    assert.deepEqual(seen.unread, []);
    assert.deepEqual(seen.keys, ["a", "b", "c"]);
  });

  test("an inline colour is let through only where a reason is stated, and an inline opacity or an unread style never is", () => {
    const style = (e: string) => `${IMPORT}const a = <TableText style={${e}} />;`;
    assert.deepEqual(scan(TABLE_NOTICE, style("[NOTICE_FACES[run.face], styles.upper, { color: paint.strong }]")).unread, []);
    assert.equal(scan("table/seats.tsx", style("{ color: paint.strong }")).unread.length, 1);
    for (const e of ["[washOut()]", "[faint]", "{ opacity: 0.2 }", "[{ color: c, opacity: 0.2 }]", "[...rest]"]) {
      assert.ok(scan(TABLE_NOTICE, style(e)).unread.length > 0, `TableNotice: ${e}`);
      assert.ok(scan("CardView.tsx", style(e)).unread.length > 0, `CardView: ${e}`);
    }
  });

  test("TableText is followed through an alias, a renamed import and a spread", () => {
    assert.deepEqual(scan("plant.tsx", `${IMPORT}const Label = TableText;\nconst a = <Label style={styles.viaAlias} />;`).keys, ["viaAlias"]);
    assert.deepEqual(scan("plant.tsx", 'import { TableText as Small } from "./TableText";\nconst a = <Small style={styles.viaRename} />;').keys, ["viaRename"]);
    assert.deepEqual(scan("plant.tsx", `${IMPORT}const a = <TableText {...a11yHidden()} style={styles.k} />;`).unread, []);
    assert.equal(scan("plant.tsx", `${IMPORT}const a = <TableText {...{ style: { color: "#2a2a2a" } }} />;`).unread.length, 1);
    assert.equal(scan("plant.tsx", `${IMPORT}const a = <TableText {...props} />;`).unread.length, 1);
    assert.equal(scan("plant.tsx", `${IMPORT}const Wrapped = styled(TableText);`).unread.length, 1);
    assert.equal(scan("plant.tsx", `${IMPORT}const a = <Ui.TableText style={styles.x} />;`).unread.length > 0, true);
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

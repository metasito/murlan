// Every style a <TableText> names is measured against every stop of every felt, which is the only
// place the gradient's 2x luminance range can be seen. The styles are the ones the modules
// build: each component is imported, StyleSheet.create is watched as it runs, and a style is read
// off the sheet it made, so a style built by a spread, a helper or another module is read like any
// other. The source is parsed only to learn which sheet entries each <TableText> is given, and a
// style it cannot follow is a failure, never a skip.
import * as ts from "typescript";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, jest, test } from "@jest/globals";
import { StyleSheet } from "react-native";
import { Colors, FeltGradients, Gradient } from "../../lib/tokens.ts";
import { contrastRatio } from "../../lib/contrast.ts";
import { BODY_MIN, LARGE_MIN, componentSources, resolve, sourceArrays, withOpacity } from "../helpers/contrastColours.ts";

const repoRoot = path.resolve(__dirname, "..", "..");
const componentsDir = path.join(repoRoot, "components") + path.sep;
const sourceArray = sourceArrays(repoRoot);

type Sheet = Record<string, object>;
const created = new Map<string, Sheet[]>();
const realCreate = StyleSheet.create.bind(StyleSheet);
jest.spyOn(StyleSheet, "create").mockImplementation(((styles: Sheet) => {
  const sheet = realCreate(styles);
  const caller = (new Error().stack ?? "").split("\n").flatMap((line) => /\(?(\/[^():]+\.tsx?):\d+:\d+\)?$/.exec(line)?.[1] ?? []).find((f) => f.startsWith(componentsDir));
  if (caller) created.set(caller, [...(created.get(caller) ?? []), sheet]);
  return sheet;
}) as typeof StyleSheet.create);

const COMPONENT_FILES = componentSources(repoRoot);
const parsed = new Map(COMPONENT_FILES.map(([file, src]) => [file, ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)]));

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

/** The sheets each component file declares, with the real object its module made for each. */
const SHEETS = new Map<string, { file: string; sheet: Sheet }>();
const sheetKey = (file: string, name: string) => (name === "styles" ? `${file}:styles` : name);
function loadSheets(file: string) {
  const unmatched = [...(created.get(path.join(componentsDir, file)) ?? [])];
  for (const { name, keys } of declaredSheets(file)) {
    const at = unmatched.findIndex((s) => keys.length === Object.keys(s).length && keys.every((k) => k in s));
    assert.ok(at !== -1, `${file}: importing it did not run StyleSheet.create for ${name} (${keys.length} entries)`);
    const key = sheetKey(file, name);
    assert.ok(!SHEETS.has(key), `${key} is declared twice`);
    SHEETS.set(key, { file, sheet: unmatched.splice(at, 1)[0] });
  }
}

type Ref = { file: string; sheet: string; key: string };
const INK = new Set(["color", "backgroundColor", "opacity"]);
const TABLE_NOTICE = "table/TableNotice.tsx";
const INKED_ELSEWHERE: Record<string, string> = {
  [TABLE_NOTICE]: "the notice palette's inks, measured over every felt stop by contrast.test.ts",
  "CardView.tsx": "the suit's ink over the card's own face, which the felt never reaches",
};

/** Every sheet entry a style expression can resolve to, and every piece of it this audit cannot follow. */
function styleRefs(file: string, expr: ts.Node, out: { refs: Ref[]; unread: string[] }, seen = new Set<string>()): void {
  const unread = (why: string): void => {
    out.unread.push(`${file}: ${why}: ${expr.getText().slice(0, 60)}`);
  };
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr)) return styleRefs(file, expr.expression, out, seen);
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.forEach((e) => styleRefs(file, e, out, seen));
  if (ts.isSpreadElement(expr)) return styleRefs(file, expr.expression, out, seen);
  if (ts.isConditionalExpression(expr)) return [expr.whenTrue, expr.whenFalse].forEach((e) => styleRefs(file, e, out, seen));
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return styleRefs(file, expr.right, out, seen);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return [expr.left, expr.right].forEach((e) => styleRefs(file, e, out, seen));
    return unread("an operator that is not a choice of style");
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return void out.refs.push({ file, sheet: expr.expression.text, key: expr.name.text });
  }
  if (ts.isObjectLiteralExpression(expr)) {
    for (const p of expr.properties) {
      const key = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? nameOf(p.name) : undefined;
      if (key === undefined) unread("an object entry this audit cannot name");
      else if (INK.has(key)) unread(`an inline ${key}`);
    }
    return;
  }
  if (ts.isIdentifier(expr)) {
    if (expr.text === "undefined") return;
    if (seen.has(expr.text)) return;
    const declared: ts.Expression[] = [];
    const find = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === expr.text && n.initializer) declared.push(n.initializer);
      ts.forEachChild(n, find);
    };
    find(parsed.get(file)!);
    if (declared.length === 0) return unread("a name with no declaration in this file");
    return declared.forEach((d) => styleRefs(file, d, out, new Set([...seen, expr.text])));
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword || expr.kind === ts.SyntaxKind.NullKeyword) return;
  unread("a style built by an expression this audit cannot follow");
}

function tableTextStyles(): { refs: Ref[]; unread: string[] } {
  const out = { refs: [] as Ref[], unread: [] as string[] };
  for (const [file] of COMPONENT_FILES) {
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === "TableText") {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attr)) continue;
          if (attr.name.getText() !== "style" || !attr.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) continue;
          const here = { refs: [] as Ref[], unread: [] as string[] };
          styleRefs(file, attr.initializer.expression, here);
          out.refs.push(...here.refs);
          if (!(file in INKED_ELSEWHERE)) out.unread.push(...here.unread);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed.get(file)!);
  }
  return out;
}

const FOUND = tableTextStyles();
const TABLE_TEXT = [...new Map(FOUND.refs.map((r) => [`${r.file}:${r.sheet}.${r.key}`, r])).values()];

// A sheet is named by the file that declares it, which is the call site's own for `styles` and the one
// file that declares it for any other name; every file that names a sheet is imported first.
const declaring = (ref: Ref): string => {
  if (ref.sheet === "styles") return ref.file;
  const owners = COMPONENT_FILES.map(([file]) => file).filter((file) => declaredSheets(file).some((s) => s.name === ref.sheet));
  assert.equal(owners.length, 1, `${ref.file}: ${ref.sheet} is declared in ${owners.length} files`);
  return owners[0];
};
const owners = new Map(TABLE_TEXT.map((ref) => [`${ref.file}:${ref.sheet}`, declaring(ref)]));
for (const file of new Set(owners.values())) {
  jest.requireActual(path.join(componentsDir, file));
  loadSheets(file);
}

function sheetEntry(ref: Ref): Record<string, unknown> {
  const { sheet } = SHEETS.get(sheetKey(owners.get(`${ref.file}:${ref.sheet}`)!, ref.sheet))!;
  assert.ok(ref.key in sheet, `${ref.file}: ${ref.sheet}.${ref.key} is not an entry of the sheet the module made`);
  return (StyleSheet.flatten(sheet[ref.key] as object) ?? {}) as Record<string, unknown>;
}

const refOf = (id: string): Ref => {
  const [file, entry] = id.split(":");
  const [sheet, key] = entry.split(".");
  return { file, sheet, key };
};
const asColour = (id: string, what: string, value: unknown): string => {
  assert.ok(typeof value === "string" && /^(#[0-9a-fA-F]{6}|rgba\(.*\))$/.test(value), `${id}: ${what} is ${JSON.stringify(value)}, neither #rrggbb nor rgba()`);
  return value;
};

/** A style's `backgroundColor`, as the module's own sheet holds it. */
function styleFill(id: string): string | null {
  const fill = sheetEntry(refOf(id)).backgroundColor;
  return fill === undefined ? null : asColour(id, "backgroundColor", fill);
}

/** A style's ink with its own `opacity` folded in, or null for a style that sets neither. */
const styleInk = (id: string): string | null => inkOf(id, sheetEntry(refOf(id)));
function inkOf(id: string, entry: Record<string, unknown>): string | null {
  if (entry.color === undefined) {
    assert.ok(entry.opacity === undefined, `${id} sets an opacity but no colour`);
    return null;
  }
  const ink = asColour(id, "color", entry.color);
  return entry.opacity === undefined ? ink : withOpacity(ink, Number(entry.opacity));
}

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
  assert.deepEqual(FOUND.unread, [], "a style the audit cannot read passes it by not looking: name it through a StyleSheet entry");
  assert.ok(TABLE_TEXT.length > 30, `found only ${TABLE_TEXT.length} <TableText> styles`);
  const read = TABLE_TEXT.filter((ref) => styleInk(idOf(ref)) !== null || styleFill(idOf(ref)) !== null);
  assert.ok(read.length > 30, `read only ${read.length} styles' colours off the modules' sheets`);
});

test("every inked <TableText> style says what it is painted over", () => {
  const unclassified = TABLE_TEXT.filter((ref) => styleInk(idOf(ref)) !== null && !(idOf(ref) in ON_TABLE)).map(idOf);
  assert.deepEqual(unclassified, [], "add these to ON_TABLE");
  const stale = Object.keys(ON_TABLE).filter((id) => !TABLE_TEXT.some((ref) => idOf(ref) === id));
  assert.deepEqual(stale, [], "no <TableText> names these any more");
});

test("only the seat name's two inks are left to the device to measure", () => {
  const measured = Object.keys(ON_TABLE).filter((id) => ON_TABLE[id].measuredBy !== undefined);
  assert.deepEqual(measured, ["table/seats.tsx:seatStyles.oppName", "table/seats.tsx:seatStyles.oppNameActive"]);
});

test("no <TableText> style paints its own plate: table text sits on the felt or inside a notice", () => {
  assert.deepEqual(TABLE_TEXT.map(idOf).filter((id) => styleFill(id) !== null), []);
});

test("the pile inks no text of its own: its notices are TableNotice's plate, in the palette loop of contrast.test.ts", () => {
  assert.deepEqual(TABLE_TEXT.filter((r) => r.file === "table/pile.tsx"), []);
  assert.ok(TABLE_TEXT.some((r) => r.file === TABLE_NOTICE), "TableNotice inks no <TableText> style");
});

function assertClears(id: string, ink: string, fills: string[], backdrop: Backdrop, min: number) {
  for (const [felt, gradient] of Object.entries(FeltGradients)) {
    for (const stop of backdrop.stops ?? ANY_STOP) {
      for (const over of backdrop.gradient ?? [gradient[stop]]) {
        const surface = fills.reduce((under, fill) => resolve(fill, under), resolve(over, gradient[stop]));
        const ratio = contrastRatio(resolve(ink, surface), surface);
        assert.ok(ratio >= min, `${id} over ${felt} stop ${stop} (${over}) is only ${ratio.toFixed(2)}:1, needs >=${min}:1`);
      }
    }
  }
}

describe("the audit sees what a text scan of `key: {` could not", () => {
  const unreadIn = (code: string) => {
    const out = { refs: [] as Ref[], unread: [] as string[] };
    const file = ts.createSourceFile("plant.tsx", `${code}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    parsed.set("plant.tsx", file);
    const stmt = file.statements[file.statements.length - 1] as ts.ExpressionStatement;
    styleRefs("plant.tsx", stmt.expression, out);
    return out;
  };

  test("an ink built by a spread or a helper is read off the sheet the module made", () => {
    const FACE = { color: "#444444", opacity: 0.5 };
    const sheet = StyleSheet.create({ spread: { ...FACE }, helper: faintInk() });
    function faintInk() {
      return { color: "#555555" };
    }
    assert.equal(inkOf("spread", sheet.spread as Record<string, unknown>), "rgba(68,68,68,0.5)");
    assert.equal(inkOf("helper", sheet.helper as Record<string, unknown>), "#555555");
  });

  test("a style it cannot follow to a sheet is reported, not skipped", () => {
    for (const code of ["f(a);\nstyle(helper())", "x;\n[styles.a, ...more(), { color: c }]", "x;\n[styles.a, { ...spread }]", "x;\n[styles.a, missing]", "x;\nflag ? styles.a : lookup[k]"]) {
      assert.ok(unreadIn(code).unread.length > 0, code);
    }
  });

  test("a style it can follow is not", () => {
    const seen = unreadIn("const small = { fontSize: 3 };\n[styles.a, flag && styles.b, cond ? styles.c : undefined, small, { fontSize: 4 }]");
    assert.deepEqual(seen.unread, []);
    assert.deepEqual(seen.refs.map((r) => r.key), ["a", "b", "c"]);
  });

  test("a washed-out ink fails the bar on the felt", () => {
    const black = { gradient: ["#000000"] };
    assert.throws(() => assertClears("plant", "#444444", [], black, BODY_MIN), /only .*:1/);
    assert.doesNotThrow(() => assertClears("plant", "#ffffff", [], black, BODY_MIN));
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
  test(`the table's ${ref.sheet}.${ref.key} clears ${min}:1 on every felt stop`, () => {
    const ink = styleInk(id);
    assert.ok(ink, `${id} has no color`);
    const fills = [backdrop.plate ?? []].flat().map((plate) => {
      const fill = styleFill(`${ref.file}:${plate}`);
      assert.ok(fill, `${plate} no longer paints a background`);
      return fill;
    });

    assertClears(id, ink, fills, backdrop, min);
  });
}

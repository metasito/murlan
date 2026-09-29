// A seat's place is never a function of a card count: plan 3 of #1259, L1 and L2. A type cannot tell a count
// named `width` from a width, so the vocabulary below is the rule's limit, and adding a name is a reviewed diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..", "..");
const at = (...p: string[]) => path.resolve(root, ...p);
const SEATS = at("components", "seatLayout.ts");
const FRAME = at("components", "tableFrame.ts");
const FLIGHT = at("components", "flightPhysics.ts");
const FAN = at("components", "fanGeometry.ts");
const PROBE = at("tests", "ui-rules", "seatLayoutProbe.ts");
const POSITIONS = ["anchorPoints", "flightOrigin", "seatPoint", "tableGeometry"];
const GEOMETRY = [
  "scale", "backScale", "width", "height", "cardH", "rowRise", "leftInset", "topPad", "bottomPad", "surplus",
  "handCardH", "handZoneH", "windowWidth", "windowHeight", "tableLeft", "tableRight", "tableTop",
  "top", "bottom", "left", "right",
];
const SEAT = ["seat", "viewerSeat", "playerCount", "steps", "total"];
const ALLOWED = new Set([...GEOMETRY, ...SEAT]);
const HAND = new Set(["hand", "handCount"]);

const options = ts.getParsedCommandLineOfConfigFile(path.join(root, "tsconfig.json"), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => assert.fail(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
})!.options;

const PLANTED = `import type { Card } from "../../lib/game/gameEngine.ts";
import { drawnFanBounds, seatFanArc } from "../../components/fanGeometry.ts";
export function plantedN(scale: number, n: number) { return scale * n; }
export function plantedCards(input: { scale: number; cards: number }) { return input.scale * input.cards; }
export function plantedHand(input: { scale: number; hand: readonly Card[] }) { return input.scale; }
export const plantedNested = (input: { at: { sideDisplayedCounts: { left: number } } }) => input.at;
export function plantedMap(scale: number, counts: ReadonlyMap<string, number>) { return scale; }
export function plantedFan(scale: number) { return seatFanArc(3, scale).bounds.h; }
const viaHelper = (scale: number) => seatFanArc(2, scale).bounds.w;
export function plantedViaHelper(scale: number) { return viaHelper(scale); }
export function plantedBand(scale: number) { return drawnFanBounds(scale).topH; }
export function plantedScale(scale: number) { return scale; }
`;

const inLib = (s: ts.Symbol | undefined) =>
  !!s?.declarations?.length && s.declarations.every((d) => d.getSourceFile().isDeclarationFile);

function counted(checker: ts.TypeChecker, type: ts.Type, where: string, depth: number): string[] {
  if (depth > 4) return [];
  if (type.isUnionOrIntersection()) return type.types.flatMap((t) => counted(checker, t, where, depth));
  if (type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    const segments = where.split(".");
    return ALLOWED.has(segments.at(-1)!) && !segments.slice(0, -1).some((s) => /count/i.test(s)) ? [] : [where];
  }
  if (!(type.flags & ts.TypeFlags.Object) || type.getCallSignatures().length > 0) return [];
  const container = (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference && inLib(type.symbol);
  if (checker.isArrayType(type) || checker.isTupleType(type) || container) {
    return checker.getTypeArguments(type as ts.TypeReference).flatMap((t) => counted(checker, t, `${where}[]`, depth + 1));
  }
  return type.getProperties().flatMap((p) => {
    const inner = `${where}.${p.name}`;
    if (HAND.has(p.name)) return [inner];
    if (inLib(p)) return [];
    return counted(checker, checker.getTypeOfSymbol(p), inner, depth + 1);
  });
}

const resolve = (checker: ts.TypeChecker, s: ts.Symbol) => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
const callable = (checker: ts.TypeChecker, s: ts.Symbol) => checker.getTypeOfSymbol(s).getCallSignatures().length > 0;

function takesCount(checker: ts.TypeChecker, fn: ts.Symbol): string[] {
  const params = checker.getTypeOfSymbol(fn).getCallSignatures().flatMap((s) => s.getParameters());
  return params.flatMap((p) => counted(checker, checker.getTypeOfSymbol(p), p.name, 0));
}

function fansReached(checker: ts.TypeChecker, node: ts.Node, seen: Set<ts.Node>, fans: Map<string, ts.Symbol>) {
  if (seen.has(node)) return fans;
  seen.add(node);
  const visit = (n: ts.Node): void => {
    const symbol = ts.isIdentifier(n) ? checker.getSymbolAtLocation(n) : undefined;
    const target = symbol && resolve(checker, symbol);
    const decl = target?.valueDeclaration;
    if (decl && path.resolve(decl.getSourceFile().fileName) === FAN) {
      if (callable(checker, target)) fans.set(target.name, target);
    } else if (decl && !decl.getSourceFile().isDeclarationFile) {
      fansReached(checker, decl, seen, fans);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return fans;
}

type Finding = { where: string[]; fans: string[] };

function scan(files: string[], guarded: (file: string, name: string) => boolean, probe?: string): Map<string, Finding> {
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile;
  host.getSourceFile = (file, ...rest) =>
    probe && path.resolve(file) === PROBE ? ts.createSourceFile(file, probe, ts.ScriptTarget.Latest) : read(file, ...rest);
  const program = ts.createProgram(files, options, host);
  const checker = program.getTypeChecker();
  const found = new Map<string, Finding>();
  for (const file of files) {
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)!)!)) {
      const fn = resolve(checker, exported);
      if (!guarded(file, exported.name) || !fn.valueDeclaration || !callable(checker, fn)) continue;
      const fans = fansReached(checker, fn.valueDeclaration, new Set(), new Map());
      const viaFan = [...fans].flatMap(([name, s]) => takesCount(checker, s).map((w) => `${name}(${w})`));
      found.set(exported.name, { where: [...takesCount(checker, fn), ...viaFan], fans: [...fans.keys()] });
    }
  }
  return found;
}

function imports(file: string, target: string, text = ts.sys.readFile(file)!): boolean {
  return ts.preProcessFile(text, true, true).importedFiles.some((f) => {
    const resolved = ts.resolveModuleName(f.fileName, file, options, ts.sys).resolvedModule?.resolvedFileName;
    return resolved !== undefined && path.resolve(resolved) === target;
  });
}

function namesFrom(file: string, target: string): string[] {
  return ts.createSourceFile(file, ts.sys.readFile(file)!, ts.ScriptTarget.Latest).statements.flatMap((s) => {
    if (!(ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) || !s.moduleSpecifier) return [];
    const spec = (s.moduleSpecifier as ts.StringLiteral).text;
    const resolved = ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (resolved === undefined || path.resolve(resolved) !== target) return [];
    const clause = ts.isImportDeclaration(s) ? s.importClause : undefined;
    const named = ts.isImportDeclaration(s) ? clause?.namedBindings : s.exportClause;
    if (!named || !(ts.isNamedImports(named) || ts.isNamedExports(named)) || clause?.name) return ["*"];
    return named.elements.map((e) => (e.propertyName ?? e.name).text);
  });
}

test("the fan's shape sits above the seats, and the bands reach it only through drawnFanBounds", () => {
  assert.ok(imports(PROBE, FAN, `import { seatFanArc } from "../../components/fanGeometry.ts";`), "the layering check is blind");
  assert.ok(imports(FAN, SEATS), "fanGeometry.ts no longer reads seatLayout.ts, so the direction this pins is gone");
  assert.equal(imports(SEATS, FAN), false, "seatLayout.ts imports fanGeometry.ts: the fan's shape is above the seats");
  assert.deepEqual(namesFrom(FRAME, FAN), ["drawnFanBounds"]);
});

test("a planted count is flagged wherever it hides, and a count-free place is not", () => {
  const found = Object.fromEntries(scan([PROBE], () => true, PLANTED));
  assert.deepEqual(found, {
    plantedN: { where: ["n"], fans: [] },
    plantedCards: { where: ["input.cards"], fans: [] },
    plantedHand: { where: ["input.hand"], fans: [] },
    plantedNested: { where: ["input.at.sideDisplayedCounts.left"], fans: [] },
    plantedMap: { where: ["counts[]"], fans: [] },
    plantedFan: { where: ["seatFanArc(count)"], fans: ["seatFanArc"] },
    plantedViaHelper: { where: ["seatFanArc(count)"], fans: ["seatFanArc"] },
    plantedBand: { where: [], fans: ["drawnFanBounds"] },
    plantedScale: { where: [], fans: [] },
  });
});

test("no seat, band or pile place takes a card count, or reaches the fan's shape through one", () => {
  const found = scan([SEATS, FRAME, FLIGHT], (file, name) => file !== FLIGHT || POSITIONS.includes(name));
  for (const name of [...POSITIONS, "topBandHeight", "sideSlotHeight", "computeTableFrame", "seatGap", "seatDirection"]) {
    assert.ok(found.has(name), `${name} is no longer seen, so this scan checks less than it did`);
  }
  assert.ok(found.get("anchorPoints")!.fans.includes("drawnFanBounds"), "the scan no longer follows a place into the fan");
  assert.deepEqual(Object.fromEntries([...found].filter(([, f]) => f.where.length > 0).map(([n, f]) => [n, f.where])), {});
});

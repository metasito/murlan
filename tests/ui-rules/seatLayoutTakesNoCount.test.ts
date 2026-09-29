// A seat's place is never a function of a card count: plan 3 of #1259, L1 and L2. A type cannot tell a count
// named `width` from a width, so names are the rule's limit: a geometry name passes anywhere, an edge only as an
// `EdgeInsets` field, a seat or player total only where SEATED grants it; widening any of them is a reviewed diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..", "..");
const at = (...p: string[]) => path.resolve(root, ...p);
const key = (file: string, name: string) => `${path.relative(root, file).split(path.sep).join("/")}:${name}`;
const SEATS = at("components", "seatLayout.ts");
const FRAME = at("components", "tableFrame.ts");
const FLIGHT = at("components", "flightPhysics.ts");
const FAN = at("components", "fanGeometry.ts");
const PROBE = at("tests", "ui-rules", "seatLayoutProbe.ts");
const TWIN = at("tests", "ui-rules", "seatLayoutTwin.ts");
const POSITIONS = ["anchorPoints", "flightOrigin", "seatPoint", "tableGeometry"];
const GEOMETRY = new Set([
  "scale", "backScale", "width", "height", "cardH", "rowRise", "leftInset", "topPad", "bottomPad", "surplus",
  "handCardH", "handZoneH", "windowWidth", "windowHeight", "tableLeft", "tableRight", "tableTop",
]);
const EDGES = new Set(["top", "bottom", "left", "right"]);
const SEATED: Record<string, string[]> = {
  [key(SEATS, "getOpponentPosition")]: ["steps", "total"],
  [key(SEATS, "seatDirection")]: ["seat", "viewerSeat", "playerCount"],
  [key(SEATS, "viewerOwnsSeat")]: ["seat", "viewerSeat"],
  [key(SEATS, "arrangeOpponents")]: ["players[]", "viewerSeat"],
};
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
  export function plantedGeneric<T>(scale: number, n: T) { return scale; }
  export function plantedBounded<T extends number>(scale: number, n: T) { return scale * n; }
  export function plantedRecord(scale: number, counts: Record<string, number>) { return scale; }
  export function plantedIndex(scale: number, counts: { [seat: string]: number }) { return scale; }
  export function plantedTotal(scale: number, total: number) { return scale * total; }
  export function plantedSides(scale: number, side: { left: number; right: number }) { return scale * side.left; }
  export function plantedKeyed(scale: number, side: Record<"left" | "right", number>) { return scale * side.left; }
  export const plantedObject = { place(scale: number, n: number) { return scale * n; } };
  export class PlantedClass { place(scale: number, n: number) { return scale * n; } }
`;
const PLANTED_TWIN = `export function plantedScale(scale: number, n: number) { return scale * n; }`;
const PROBES = new Map([[PROBE, PLANTED], [TWIN, PLANTED_TWIN]]);

const host = ts.createCompilerHost(options);
const read = host.getSourceFile;
host.getSourceFile = (file, ...rest) => {
  const probe = PROBES.get(path.resolve(file));
  return probe === undefined ? read(file, ...rest) : ts.createSourceFile(file, probe, ts.ScriptTarget.Latest);
};
const program = ts.createProgram([SEATS, FRAME, FLIGHT, ...PROBES.keys()], options, host);
const checker = program.getTypeChecker();

const inLib = (s: ts.Symbol | undefined) =>
  !!s?.declarations?.length && s.declarations.every((d) => d.getSourceFile().isDeclarationFile);
const isInsets = (type: ts.Type) =>
  type.symbol?.name === "EdgeInsets" &&
  !!type.symbol.declarations?.length &&
  type.symbol.declarations.every((d) => path.resolve(d.getSourceFile().fileName) === FRAME);

function leaf(where: string, granted: readonly string[], edge: boolean): string[] {
  const segments = where.split(".");
  const name = segments.at(-1)!;
  const named = GEOMETRY.has(name) || (edge && EDGES.has(name)) || granted.includes(where);
  return named && !segments.slice(0, -1).some((s) => /count/i.test(s)) ? [] : [where];
}

function counted(type: ts.Type, where: string, depth: number, granted: readonly string[], edge = false): string[] {
  if (depth > 4) return [];
  if (type.isUnionOrIntersection()) return type.types.flatMap((t) => counted(t, where, depth, granted, edge));
  if (type.flags & ts.TypeFlags.Instantiable) {
    const bound = checker.getBaseConstraintOfType(type);
    const fallback = type.isTypeParameter() ? checker.getDefaultFromTypeParameter(type) : undefined;
    const bounded = bound ? counted(bound, where, depth, granted, edge) : leaf(where, granted, edge);
    return [...new Set([...bounded, ...(fallback ? counted(fallback, where, depth, granted, edge) : [])])];
  }
  if (type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return leaf(where, granted, edge);
  if (!(type.flags & ts.TypeFlags.Object) || type.getCallSignatures().length > 0) return [];
  const container = (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference && inLib(type.symbol);
  if (checker.isArrayType(type) || checker.isTupleType(type) || container) {
    return checker.getTypeArguments(type as ts.TypeReference).flatMap((t) => counted(t, `${where}[]`, depth + 1, granted));
  }
  const members = type.getProperties().flatMap((p) => {
    const inner = `${where}.${p.name}`;
    if (HAND.has(p.name)) return [inner];
    if (inLib(p)) return [];
    return counted(checker.getTypeOfSymbol(p), inner, depth + 1, granted, isInsets(type));
  });
  const indexed = checker.getIndexInfosOfType(type).flatMap((i) => counted(i.type, `${where}[]`, depth + 1, granted));
  return [...members, ...indexed];
}

const resolve = (s: ts.Symbol) => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);

function places(type: ts.Type, member: string, depth: number): [string, readonly ts.Symbol[]][] {
  if (depth > 3) return [];
  const own = [...type.getCallSignatures(), ...type.getConstructSignatures()];
  const members = type.flags & ts.TypeFlags.Object ? type.getProperties().filter((p) => !inLib(p)) : [];
  return [
    ...own.map((s): [string, readonly ts.Symbol[]] => [member, s.getParameters()]),
    ...members.flatMap((p) => places(checker.getTypeOfSymbol(p), member ? `${member}.${p.name}` : p.name, depth + 1)),
  ];
}

function takesCount(s: ts.Symbol, granted: readonly string[]): string[] {
  return places(checker.getTypeOfSymbol(s), "", 0).flatMap(([member, params]) =>
    params.flatMap((p) => counted(checker.getTypeOfSymbol(p), p.name, 0, granted).map((w) => (member ? `${member}(${w})` : w))),
  );
}

function fansReached(node: ts.Node, seen: Set<ts.Node>, fans: Map<string, ts.Symbol>) {
  if (seen.has(node)) return fans;
  seen.add(node);
  const visit = (n: ts.Node): void => {
    const symbol = ts.isIdentifier(n) ? checker.getSymbolAtLocation(n) : undefined;
    const target = symbol && resolve(symbol);
    const decl = target?.valueDeclaration;
    if (decl && path.resolve(decl.getSourceFile().fileName) === FAN) {
      if (places(checker.getTypeOfSymbol(target), "", 0).length > 0) fans.set(target.name, target);
    } else if (decl && !decl.getSourceFile().isDeclarationFile) {
      fansReached(decl, seen, fans);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return fans;
}

type Finding = { where: string[]; fans: string[] };

function scan(files: string[], guarded: (file: string, name: string) => boolean, grants = SEATED): Map<string, Finding> {
  const found = new Map<string, Finding>();
  for (const file of files) {
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)!)!)) {
      const value = resolve(exported);
      if (!guarded(file, exported.name) || !value.valueDeclaration) continue;
      const fans = fansReached(value.valueDeclaration, new Set(), new Map());
      const viaFan = [...fans].flatMap(([name, s]) => takesCount(s, []).map((w) => `${name}(${w})`));
      const where = takesCount(value, grants[key(file, exported.name)] ?? []);
      found.set(key(file, exported.name), { where: [...where, ...viaFan], fans: [...fans.keys()] });
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
  const found = Object.fromEntries([...scan([TWIN, PROBE], () => true)].map(([k, f]) => [k.slice(k.lastIndexOf("/") + 1), f]));
  assert.deepEqual(found, {
    "seatLayoutTwin.ts:plantedScale": { where: ["n"], fans: [] },
    "seatLayoutProbe.ts:plantedN": { where: ["n"], fans: [] },
    "seatLayoutProbe.ts:plantedCards": { where: ["input.cards"], fans: [] },
    "seatLayoutProbe.ts:plantedHand": { where: ["input.hand"], fans: [] },
    "seatLayoutProbe.ts:plantedNested": { where: ["input.at.sideDisplayedCounts.left"], fans: [] },
    "seatLayoutProbe.ts:plantedMap": { where: ["counts[]"], fans: [] },
    "seatLayoutProbe.ts:plantedFan": { where: ["seatFanArc(count)"], fans: ["seatFanArc"] },
    "seatLayoutProbe.ts:plantedViaHelper": { where: ["seatFanArc(count)"], fans: ["seatFanArc"] },
    "seatLayoutProbe.ts:plantedBand": { where: [], fans: ["drawnFanBounds"] },
    "seatLayoutProbe.ts:plantedScale": { where: [], fans: [] },
    "seatLayoutProbe.ts:plantedGeneric": { where: ["n"], fans: [] },
    "seatLayoutProbe.ts:plantedBounded": { where: ["n"], fans: [] },
    "seatLayoutProbe.ts:plantedRecord": { where: ["counts[]"], fans: [] },
    "seatLayoutProbe.ts:plantedIndex": { where: ["counts[]"], fans: [] },
    "seatLayoutProbe.ts:plantedTotal": { where: ["total"], fans: [] },
    "seatLayoutProbe.ts:plantedSides": { where: ["side.left", "side.right"], fans: [] },
    "seatLayoutProbe.ts:plantedKeyed": { where: ["side.left", "side.right"], fans: [] },
    "seatLayoutProbe.ts:plantedObject": { where: ["place(n)"], fans: [] },
    "seatLayoutProbe.ts:PlantedClass": { where: ["prototype.place(n)"], fans: [] },
  });
});

test("no seat, band or pile place takes a card count, or reaches the fan's shape through one", () => {
  const found = scan([SEATS, FRAME, FLIGHT], (file, name) => file !== FLIGHT || POSITIONS.includes(name));
  const seen = [
    ...POSITIONS.map((name) => key(FLIGHT, name)),
    ...["topBandHeight", "sideSlotHeight", "computeTableFrame"].map((name) => key(FRAME, name)),
    ...["seatGap", "seatDirection", "FAN_DRAWN_CARDS"].map((name) => key(SEATS, name)),
  ];
  for (const name of seen) assert.ok(found.has(name), `${name} is no longer seen, so this scan checks less than it did`);
  assert.ok(found.get(key(FLIGHT, "anchorPoints"))!.fans.includes("drawnFanBounds"), "the scan no longer follows a place into the fan");
  assert.deepEqual(Object.fromEntries([...found].filter(([, f]) => f.where.length > 0).map(([n, f]) => [n, f.where])), {});
});

test("every seat allowance is still taken, by exactly the function it names", () => {
  const bare = scan([SEATS], (file, name) => key(file, name) in SEATED, {});
  assert.deepEqual(Object.fromEntries([...bare].map(([n, f]) => [n, f.where])), SEATED);
});

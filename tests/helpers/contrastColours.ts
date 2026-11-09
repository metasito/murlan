// What the contrast audits share: the WCAG bars, the palette a token name resolves in, and the
// colour arithmetic. Plain .ts so node --test and jest both load it (docs/agents/checks.md,
// "Node's TypeScript loader").
import ts from "typescript";
import { Colors, Garnet, Gradient, LastCard, Scrim } from "../../lib/tokens.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";

export const BODY_MIN = 4.5;
export const LARGE_MIN = 3.0;

export const PALETTES: Record<string, Record<string, string>> = { Colors, Scrim, Garnet, LastCard };

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

/** Flattens `rgba(r,g,b,a)` onto an opaque hex background: what reaches the screen once React Native composites it. */
export function flattenRgba(rgba: string, bgHex: string): string {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (!m) throw new Error(`Not an rgba() string: ${rgba}`);
  const [, r, g, b, a] = m;
  const alpha = parseFloat(a);
  const [br, bg, bb] = hexToRgb(bgHex);
  const flat: [number, number, number] = [
    Math.round(Number(r) * alpha + br * (1 - alpha)),
    Math.round(Number(g) * alpha + bg * (1 - alpha)),
    Math.round(Number(b) * alpha + bb * (1 - alpha)),
  ];
  return "#" + flat.map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Resolves any Colors.* value (solid hex or rgba string) to an opaque hex, as composited over the given background. */
export function resolve(color: string, bgHex: string): string {
  return color.startsWith("rgba(") ? flattenRgba(color, bgHex) : color;
}

export function withOpacity(color: string, opacity: number): string {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(color);
  const [r, g, b] = m ? [m[1], m[2], m[3]].map(Number) : hexToRgb(color);
  return `rgba(${r},${g},${b},${(m ? Number(m[4]) : 1) * opacity})`;
}

const MAGIC = /[*?[\]{}]/;

/** The directory (or file) a glob starts from: its leading segments that name no pattern. */
export function staticRoot(glob: string): string {
  const segments = glob.split("/");
  const at = segments.findIndex((s) => MAGIC.test(s));
  return (at === -1 ? segments : segments.slice(0, at)).join("/");
}

function filesUnder(root: string, rel: string): string[] {
  const at = path.join(root, rel);
  if (!existsSync(at)) return [];
  if (statSync(at).isFile()) return [rel];
  return readdirSync(at, { recursive: true, encoding: "utf8" })
    .map((f) => `${rel}/${f.split(path.sep).join("/")}`)
    .filter((f) => !f.split("/").includes("node_modules") && statSync(path.join(root, f)).isFile());
}

/** Every source matching `globs`, found by walking the directory each glob starts from, as [path under `root`, text]. A glob that starts from the root itself is refused: a test that reads the whole tree is a different test. */
export function sourcesRead(root: string, globs: string[]): [string, string][] {
  const found = new Set<string>();
  for (const glob of globs.flatMap((g) => minimatch.braceExpand(g))) {
    const from = staticRoot(glob);
    if (from === "") throw new Error(`${glob} starts from the repository root`);
    for (const f of filesUnder(root, from)) if (minimatch(f, glob)) found.add(f);
  }
  return [...found].sort().map((f) => [f, readFileSync(path.join(root, f), "utf8")]);
}

/** The globs `tests/native/reads.json` states for one native test: what it reads by path, which jest's graph cannot see. */
export function readsOf(root: string, test: string): string[] {
  const manifest = JSON.parse(readFileSync(path.join(root, "tests/native/reads.json"), "utf8")) as Record<string, string[]>;
  const globs = manifest[test];
  if (!globs?.length) throw new Error(`${test} states no globs in tests/native/reads.json`);
  return globs;
}

/**
 * A module-level `const NAME = [ ... ]` array declared in component source — a pressed
 * gradient's own stops — resolved to token values. A stop a component adds is
 * covered by construction; nothing here needs to be told about it. The declaration is read
 * off the parsed module, in every platform variant of it, and the stops of all of them count.
 */
export function sourceArrays(root: string, globs: string[]): (name: string) => string[] {
  const modules = sourcesRead(root, globs)
    .filter(([file]) => /\.tsx?$/.test(file))
    .map(([file, src]) => ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  const stop = (name: string, e: ts.Expression): string[] => {
    if (ts.isStringLiteralLike(e)) return [e.text];
    if (ts.isSpreadElement(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.expression.getText() === "Gradient") {
      const spread = (Gradient as Record<string, readonly string[] | undefined>)[e.expression.name.text];
      if (spread) return [...spread];
    }
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const val = PALETTES[e.expression.text]?.[e.name.text];
      if (val) return [val];
    }
    throw new Error(`${name}: a stop this audit cannot resolve to a token or a literal: ${e.getText()}`);
  };
  return (name) => {
    const stops: string[] = [];
    let declared = 0;
    for (const source of modules) {
      for (const st of source.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || d.name.text !== name || !d.initializer) continue;
          let init: ts.Expression = d.initializer;
          while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
          if (!ts.isArrayLiteralExpression(init)) throw new Error(`${name} in ${source.fileName} is not an array literal`);
          declared++;
          stops.push(...init.elements.flatMap((e) => stop(name, e)));
        }
      }
    }
    if (declared === 0) throw new Error(`no component declares an array named ${name}`);
    if (stops.length === 0) throw new Error(`${name} has no gradient stops`);
    return stops;
  };
}

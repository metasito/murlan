// What the contrast audits share: the WCAG bars, the palette a token name resolves in, and the
// colour arithmetic. Plain .ts so node --test and jest both load it (docs/agents/checks.md,
// "Node's TypeScript loader").
import { Colors, Garnet, LastCard, Scrim } from "../../lib/tokens.ts";
import { readdirSync, readFileSync } from "node:fs";
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

/** Every source under `root` matching `globs`, as [path under components/, text]. */
export function componentSources(root: string, globs = ["components/**/*.tsx"]): [string, string][] {
  return readdirSync(path.join(root, "components"), { recursive: true, encoding: "utf8" })
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => globs.some((g) => minimatch(`components/${f}`, g)))
    .map((f) => [f, readFileSync(path.join(root, "components", f), "utf8")]);
}

/**
 * A `NAME = [ ... ]` array literal declared in component source — a pressed
 * gradient's own stops — resolved to token values. A stop a component adds is
 * covered by construction; nothing here needs to be told about it.
 */
export function sourceArrays(root: string): (name: string) => string[] {
  const components = componentSources(root).map(([, src]) => src).join("\n");
  return (name) => {
    const m = new RegExp(String.raw`\b${name}\s*=\s*\[([^\]]*)\]`).exec(components);
    if (!m) throw new Error(`no component declares an array named ${name}`);
    // A stop is either a token reference (Colors.gold) or a raw literal ("#6B5220") slipped in directly:
    // both must be caught, since the second is exactly the shape of a stop nobody meant to leave unresolved.
    const items = m[1].match(/[A-Za-z]+\.[A-Za-z]+|"[^"]+"|'[^']+'/g) ?? [];
    if (items.length === 0) throw new Error(`${name} has no gradient stops`);
    return items.map((item) => {
      if (item.startsWith('"') || item.startsWith("'")) return item.slice(1, -1);
      const [ns, key] = item.split(".");
      const val = PALETTES[ns]?.[key];
      if (!val) throw new Error(`${name}: unresolved token ${item}`);
      return val;
    });
  };
}

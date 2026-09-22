// tests/ui-rules/infiniteAnimations.test.ts — an endless loop is cancelled by its owner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function sources(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.relative(repoRoot, path.join(e.parentPath, e.name)));
}

/** The top-level arguments of the call whose `(` is at `open`, and where it closes. */
function callArgs(src: string, open: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (--depth === 0) return { args: [...args, src.slice(start, i)], end: i };
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return { args, end: src.length };
}

function loopsForever(text: string): boolean {
  return [...text.matchAll(/withRepeat\(/g)].some(
    (m) => callArgs(text, m.index + "withRepeat".length).args[1]?.trim() === "-1"
  );
}

/** Shared values assigned an endless loop, directly or through a local function returning one. */
function endlessValues(src: string): string[] {
  const loopFns = [...src.matchAll(/function (\w+)\(/g)]
    .filter((m) => loopsForever(src.slice(m.index, src.indexOf("\n}", m.index))))
    .map((m) => m[1]);
  const names = new Set<string>();
  for (const m of src.matchAll(/(\w+)\.value\s*=/g)) {
    const rhs = src.slice(m.index, src.indexOf(";", m.index));
    const whole = rhs.includes("(") ? src.slice(m.index, callArgs(src, src.indexOf("(", m.index)).end) : rhs;
    if (loopsForever(whole) || loopFns.some((f) => whole.includes(`${f}(`))) names.add(m[1]);
  }
  return [...names];
}

test("finds loops assigned directly and through a helper", () => {
  const src = `function spin(){\n  return withRepeat(withTiming(1, { a: 1 }), -1, false);\n}\n` +
    `a.value = withRepeat(withSequence(x(1), x(2)), -1, false);\nb.value = spin();\nc.value = withRepeat(t, 3);\n`;
  assert.deepEqual(endlessValues(src).sort(), ["a", "b"]);
});

test("every shared value on an endless loop is cancelled in its file", () => {
  const missing: string[] = [];
  for (const file of ["app", "components", "context", "lib"].flatMap(sources)) {
    const src = blankComments(readFileSync(path.join(repoRoot, file), "utf8"));
    for (const name of endlessValues(src)) {
      if (!src.includes(`cancelAnimation(${name})`)) missing.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});

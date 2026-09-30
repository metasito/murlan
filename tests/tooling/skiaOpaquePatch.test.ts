import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const locked: string = JSON.parse(read("package-lock.json")).packages["node_modules/@shopify/react-native-skia"].version;
const PATCH = `patches/@shopify+react-native-skia+${locked}.patch`;

const EDITS = {
  removal: { file: "apple/MetalWindowContext.mm", shape: /^-\s+_layer\.opaque = false;$/m },
  mount: {
    file: "apple/SkiaUIView.mm",
    shape: /^\+\s+_impl->getLayer\(\)\.opaque = _opaque;\n \s+\[self\.layer addSublayer:_impl->getLayer\(\)\];$/m,
  },
  setter: {
    file: "apple/SkiaUIView.mm",
    shape:
      /^ - \(void\)setOpaque:\(bool\)opaque \{\n {3}_opaque = opaque;\n\+ {2}if \(_impl != nullptr\) \{\n\+ {4}_impl->getLayer\(\)\.opaque = opaque;\n\+ {2}\}\n \}$/m,
  },
};

function missingEdits(patch: string): string[] {
  const sections = new Map(
    patch
      .split(/^(?=diff --git )/m)
      .map((s) => [/^diff --git a\/node_modules\/@shopify\/react-native-skia\/(\S+)/.exec(s)?.[1], s] as const)
  );
  return Object.entries(EDITS)
    .filter(([, { file, shape }]) => !shape.test(sections.get(file) ?? ""))
    .map(([name]) => name);
}

test("the Skia patch is named for the locked version and makes all three edits", () => {
  assert.ok(existsSync(path.join(repoRoot, PATCH)), `${PATCH} is missing; re-derive it for Skia ${locked}`);
  assert.deepEqual(missingEdits(read(PATCH)), []);
});

test("a patch that leaves out any one edit is caught", () => {
  const patch = read(PATCH);
  const planted = {
    removal: patch.replace(/^-(\s+_layer\.opaque = false;)$/m, " $1"),
    mount: patch.replace(/^\+\s+_impl->getLayer\(\)\.opaque = _opaque;\n/m, ""),
    setter: patch.replace(/^\+ {4}_impl->getLayer\(\)\.opaque = opaque;\n/m, ""),
  };
  for (const [name, text] of Object.entries(planted)) {
    assert.notEqual(text, patch, `planting ${name} changed nothing`);
    assert.deepEqual(missingEdits(text), [name]);
  }
});

function canvasTags(source: string): string[] {
  const tags: string[] = [];
  for (const start of source.matchAll(/<Canvas\b/g)) {
    let depth = 0;
    let i = start.index + 1;
    for (; i < source.length && !(depth === 0 && source[i] === ">" && source[i - 1] !== "="); i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") depth -= 1;
    }
    tags.push(source.slice(start.index, i + 1));
  }
  return tags;
}

const asksOpaque = (source: string) =>
  canvasTags(source).some((tag) => /\bopaque\b(?!\s*=\s*\{\s*false\s*\})/.test(tag));

test("an opaque canvas is found in every spelling", () => {
  assert.equal(asksOpaque(`<Canvas style={s} opaque>`), true);
  assert.equal(asksOpaque(`<Canvas onSize={() => {}} opaque={on} />`), true);
  assert.equal(asksOpaque(`<Canvas\n  ref={r}\n  opaque\n/>`), true);
  assert.equal(asksOpaque(`<Canvas opaque={false} />`), false);
  assert.equal(asksOpaque(`// an opaque note\n<Canvas style={s} />`), false);
});

test("only the felt's canvas asks for an opaque layer", () => {
  const walk = (dir: string): string[] =>
    readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) return /^(node_modules|tests|dist|ios|android)$|^\./.test(e.name) ? [] : walk(rel);
      return /\.[jt]sx$/.test(e.name) ? [rel] : [];
    });
  const files = walk("");
  assert.ok(files.includes("components/table/particleLayer.tsx"), "the scan no longer reaches components/");
  assert.deepEqual(
    files.filter((f) => asksOpaque(read(f))),
    ["components/table/feltCanvas.tsx"]
  );
});

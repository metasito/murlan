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

test("only the felt's canvas asks for an opaque layer", () => {
  const dir = path.join(repoRoot, "components");
  const opaque = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx$/.test(f))
    .filter((f) => /<Canvas\b[^>]*\bopaque=/.test(readFileSync(path.join(dir, f), "utf8")))
    .map((f) => f.replaceAll("\\", "/"));
  assert.deepEqual(opaque, ["table/feltCanvas.tsx"]);
  assert.doesNotMatch(read("components/table/particleLayer.tsx"), /opaque/);
});

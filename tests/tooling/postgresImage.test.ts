import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
function walk(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(file);
    return /\.(ya?ml|sh|mjs|js|ts)$/.test(file) ? [file] : [];
  });
}

const POSTGRES_REF = /(?:[\w.-]+\/)*postgres:\d[\w.-]*/g;

// A workflow's `services:` image cannot read a variable, so each one repeats dev-stack.mjs's IMAGE
// and this holds them to it.
test("every Postgres image is dev-stack.mjs's IMAGE, and it is not ECR Public", () => {
  const image = /^const IMAGE = "([^"]+)";$/m.exec(read("scripts/dev-stack.mjs"))?.[1];
  assert.ok(image, "scripts/dev-stack.mjs names no IMAGE");
  const refs = [...walk(".github"), ...walk("scripts")].flatMap((file) =>
    [...read(file).matchAll(POSTGRES_REF)].map(([ref]) => ({ file, ref })),
  );
  const count = (file: string) => refs.filter((r) => r.file === file).length;
  assert.ok(count(".github/workflows/ci.yml") >= 2, "ci.yml: its two Postgres services");
  assert.ok(count(".github/workflows/soak.yml") >= 1, "soak.yml: its Postgres service");
  assert.ok(count("scripts/dev-stack.mjs") >= 1, "dev-stack.mjs: the Postgres it runs");
  assert.deepEqual(
    refs.filter((r) => r.ref !== image).map((r) => `${r.file}: ${r.ref}`),
    [],
  );
  assert.ok(
    !image.startsWith("public.ecr.aws/"),
    `${image}: ECR Public caps anonymous pulls at 500 GB a month, and CI's pulls got "toomanyrequests: Data limit exceeded"`,
  );
});

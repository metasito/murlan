import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

const root = path.resolve(import.meta.dirname, "..", "..");
const files = [
  ...readdirSync(path.join(root, ".github/workflows")).map((f) => `.github/workflows/${f}`),
  ...readdirSync(path.join(root, ".github/actions")).map((a) => `.github/actions/${a}/action.yml`),
].filter((f) => /\.ya?ml$/.test(f));

test("every workflow and action parses as YAML", () => {
  assert.ok(files.length > 1);
  const broken = files.flatMap((f) => parseDocument(readFileSync(path.join(root, f), "utf8")).errors.map((e) => `${f}: ${e.message.split("\n")[0]}`));
  assert.deepEqual(broken, []);
});

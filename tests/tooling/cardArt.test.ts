// tests/tooling/cardArt.test.ts — the committed card art is exactly what scripts/bake-card-art.mjs
// renders (#1418): a missing, stale or orphaned WebP fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CardBacks } from "../../lib/tokens.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const committedDir = path.join(repoRoot, "assets", "images", "cards");
const webps = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".webp")).sort();

test("every committed card WebP is byte-identical to a fresh bake, and none is missing", () => {
  const out = mkdtempSync(path.join(tmpdir(), "card-art-"));
  try {
    execFileSync(process.execPath, [path.join(repoRoot, "scripts", "bake-card-art.mjs"), out], { stdio: "pipe" });
    const baked = webps(out);
    const expected = [
      ...Object.keys(CardBacks).flatMap((id) => [`back_${id}`, `foil_${id}`]),
      "stock",
    ].flatMap((name) => ["", "@2x", "@3x"].map((s) => `${name}${s}.webp`)).sort();
    assert.deepEqual(baked, expected);
    assert.deepEqual(webps(committedDir), baked);
    for (const f of baked) {
      assert.ok(readFileSync(path.join(out, f)).equals(readFileSync(path.join(committedDir, f))), `${f} is stale`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

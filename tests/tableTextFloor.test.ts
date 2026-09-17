import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cardScale, tableFontSize } from "../components/cardFaceModel.ts";

const tableDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../components/table");

function rawScaledSizes(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\b(?:\w+_FS|FontSize\.\w+)\s*\*\s*\w*scale\b/gi)) {
    out.push(`${file}:${src.slice(0, m.index).split("\n").length} ${m[0]}`);
  }
  return out;
}

test("no table text size is scaled without the floor", () => {
  const files = readdirSync(tableDir, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f));
  const offenders = files.flatMap((f) => rawScaledSizes(f, readFileSync(path.join(tableDir, f), "utf8")));
  assert.deepEqual(offenders, [], `use tableFontSize(base, scale):\n${offenders.join("\n")}`);
  assert.equal(rawScaledSizes("x.tsx", "{ fontSize: SEAT_BADGE_FS * scale }").length, 1);
  assert.equal(rawScaledSizes("x.tsx", "{ fontSize: FontSize.xxs * scale }").length, 1);
});

test("an SE's table text stays at 10px or more", () => {
  const se = cardScale(320);
  assert.ok(se < 0.85);
  assert.equal(tableFontSize(9.5, se), 10);
  assert.equal(tableFontSize(20, 1), 20);
});

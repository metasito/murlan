import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withEntry } from "../helpers/appendOnly.ts";
import { lowered } from "../helpers/waitInventory.ts";
import { MEASURED_ROWS, mergedRecord } from "../e2e/helpers/onlineTableRecord.ts";
import { measuredRows, outputs } from "../../scripts/regen.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

test("a version's hash is appended to main's history, and nothing main records is written over", () => {
  const main = { "1": "a", "2": "b" };
  assert.deepEqual(withEntry(main, 3, "c"), { record: { "1": "a", "2": "b", "3": "c" } });
  assert.deepEqual(withEntry(main, 2, "b"), { record: main });
  assert.deepEqual(withEntry(main, 2, "x"), { refused: "origin/main already records b for version 2" });
});

test("the record is main's history and this version only: an entry only the branch wrote never shipped", () => {
  assert.deepEqual(withEntry({ "1": "a" }, 3, "c"), { record: { "1": "a", "3": "c" } });
});

test("the wait inventory is only ever lowered, and a wait it does not explain is left for a person", () => {
  const why = "the reason this wait is real time";
  const inventory = { "a.ts": { n: 3, why }, "b.ts": { n: 1, why }, "c.ts": { n: 1, why } };
  const found = new Map([["a.ts", 2], ["c.ts", 2], ["d.ts", 1]]);
  assert.deepEqual(lowered(inventory, found), {
    inventory: { "a.ts": { n: 2, why }, "c.ts": { n: 1, why } },
    unlisted: ["c.ts: 2 found, 1 listed", "d.ts: 1 found, 0 listed"],
  });
});

test("measured online-table rows replace their own key and leave the other deal's row standing", () => {
  const row = (mode: string, vp: string, cards: number, band: number) =>
    [mode, vp, "vp=1x1", "table=1x1", "handSlot=1x1", `emptyBand=${band}`, `cards=${cards}`, "hand=1x1@1", "wide="].join("\t");
  const record = [row("ONLINE", "phone-se", 14, 94), row("ONLINE", "phone-se", 13, 95), row("ONLINE", "watch", 13, 1)].join("\n") + "\n";
  assert.equal(
    mergedRecord(record, [row("ONLINE", "phone-se", 13, 99)]),
    [row("ONLINE", "phone-se", 14, 94), row("ONLINE", "phone-se", 13, 99)].join("\n") + "\n"
  );
});

test("a CI run's measured rows are found wherever its artifacts nest them", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "regen-test-"));
  try {
    for (const [sub, text] of [["playwright-test-results-2/b", "B\n"], ["playwright-test-results-1/a", "A1\nA2\n"], ["other", "C\n"]]) {
      mkdirSync(path.join(dir, sub), { recursive: true });
      writeFileSync(path.join(dir, sub, sub === "other" ? "online-table.txt" : MEASURED_ROWS), text);
    }
    assert.deepEqual(measuredRows(dir), ["A1", "A2", "B"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("on a tree whose checks pass, regen writes every output byte for byte as committed", () => {
  for (const out of outputs()) {
    if ("refused" in out) {
      assert.ok(!process.env.CI && /origin\/main cannot be read/.test(out.refused), `${out.file}: ${out.refused}`);
      continue;
    }
    assert.equal(out.next, readFileSync(path.join(root, out.file), "utf8"), `${out.file} differs from what \`npm run regen\` writes: run it`);
  }
});

test("`npm run regen` runs scripts/regen.ts", () => {
  const scripts: Record<string, string> = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.match(scripts.regen ?? "", /^node (?:--\S+ )*scripts\/regen\.ts$/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withEntry } from "../helpers/appendOnly.ts";
import { lowered } from "../helpers/waitInventory.ts";
import { allSteps, loadWorkflow } from "../helpers/workflow.ts";
import {
  CAPTURES,
  captureName,
  MEASURED_ROWS,
  measuredText,
  mergedRecord,
  ONLINE_TABLE,
  RESULTS_ARTIFACT,
} from "../e2e/helpers/onlineTableRecord.ts";
import { fromMeasured } from "../../scripts/regen.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

test("a version's hash is appended to main's history, and nothing main records is written over", () => {
  const main = { "1": "a", "2": "b" };
  assert.deepEqual(withEntry(main, main, 3, "c"), { record: { "1": "a", "2": "b", "3": "c" }, dropped: [] });
  assert.deepEqual(withEntry(main, main, 2, "b"), { record: main, dropped: [] });
  assert.deepEqual(withEntry(main, main, 2, "x"), { refused: "origin/main already records b for version 2" });
});

test("an entry only the branch wrote never shipped, so the record drops it and says so", () => {
  const branch = { "1": "a", "2": "written-then-bumped-past", "3": "stale" };
  assert.deepEqual(withEntry({ "1": "a" }, branch, 3, "c"), { record: { "1": "a", "3": "c" }, dropped: ["2"] });
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

const row = (mode: string, vp: string, cards: number, band: number) =>
  [mode, vp, "vp=1x1", "table=1x1", "handSlot=1x1", `emptyBand=${band}`, `cards=${cards}`, "hand=1x1@1", "wide="].join("\t");

test("measured online-table rows replace their own key and leave the other deal's row standing", () => {
  const record = [row("ONLINE", "phone-se", 14, 94), row("ONLINE", "phone-se", 13, 95), row("ONLINE", "watch", 13, 1)].join("\n") + "\n";
  assert.equal(
    mergedRecord(record, [row("ONLINE", "phone-se", 13, 99)]),
    [row("ONLINE", "phone-se", 14, 94), row("ONLINE", "phone-se", 13, 99)].join("\n") + "\n"
  );
});

function artifact(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "regen-test-"));
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a run's rows and captures, measured on this tree, are applied wherever its artifacts nest them", () => {
  const se = "playwright-test-results-1/survey-phone-se";
  const tablet = "playwright-test-results-2/survey-tablet";
  artifact(
    {
      [`${se}/${MEASURED_ROWS}`]: measuredText("t1", [row("ONLINE", "phone-se", 13, 99)]),
      [`${se}/${captureName("phone-se")}`]: "se-png",
      [`${tablet}/${MEASURED_ROWS}`]: measuredText("t1", [row("ONLINE", "tablet", 14, 50)]),
      [`${tablet}/${captureName("tablet")}`]: "tablet-png",
      "playwright-test-results-3/survey-phone-12/online-table__phone-12.png": "went red before measuring",
    },
    (dir) => {
      const out = fromMeasured(dir, "t1", row("ONLINE", "phone-se", 13, 95) + "\n");
      assert.deepEqual(
        out.map((o) => ("refused" in o ? o : { file: o.file, next: o.next.toString() })),
        [
          { file: ONLINE_TABLE, next: [row("ONLINE", "phone-se", 13, 99), row("ONLINE", "tablet", 14, 50)].join("\n") + "\n" },
          { file: `${CAPTURES}/${captureName("phone-se")}`, next: "se-png" },
          { file: `${CAPTURES}/${captureName("tablet")}`, next: "tablet-png" },
        ]
      );
    }
  );
});

test("rows measured on another tree, as a pull request's merge with a moved main is, are refused", () => {
  const files = {
    [`a/${MEASURED_ROWS}`]: measuredText("t1", [row("ONLINE", "phone-se", 13, 99)]),
    [`b/${MEASURED_ROWS}`]: measuredText("merge", [row("ONLINE", "tablet", 14, 50)]),
  };
  artifact(files, (dir) => {
    const [out, ...rest] = fromMeasured(dir, "t1", "");
    assert.ok("refused" in out && /tree merge, not this checkout's t1: merge main, then rerun/.test(out.refused), JSON.stringify(out));
    assert.deepEqual(rest, []);
  });
  artifact({ [`a/${MEASURED_ROWS}`]: row("ONLINE", "phone-se", 13, 99) + "\n" }, (dir) => {
    const [out] = fromMeasured(dir, "t1", "");
    assert.ok("refused" in out && /merge main/.test(out.refused), "rows that name no tree are not this tree's");
  });
  artifact({}, (dir) => {
    const [out] = fromMeasured(dir, "t1", "");
    assert.ok("refused" in out && out.refused.includes(MEASURED_ROWS));
  });
});

test("ci.yml keeps the survey's output dir as the artifact regen downloads", () => {
  const uploads = allSteps(loadWorkflow("ci.yml")).filter((s) => s.uses?.startsWith("actions/upload-artifact@"));
  const kept = uploads.filter((s) => s.with?.name === `${RESULTS_ARTIFACT.prefix}\${{ matrix.shard }}`);
  assert.ok(kept.length > 0, `no upload names ${RESULTS_ARTIFACT.prefix}<shard>: rename RESULTS_ARTIFACT with it`);
  for (const step of kept) assert.equal(step.with?.path, RESULTS_ARTIFACT.path, String(step.name));
  const outputDir = /\boutputDir:\s*"([^"]+)"/.exec(readFileSync(path.join(root, "tests/e2e/playwright.config.ts"), "utf8"))?.[1];
  assert.equal(`tests/e2e/${outputDir}/`, RESULTS_ARTIFACT.path, "the upload keeps a dir Playwright does not write to");
});

test("`npm run regen` runs scripts/regen.ts", () => {
  const scripts: Record<string, string> = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.match(scripts.regen ?? "", /^node (?:--\S+ )*scripts\/regen\.ts$/);
});

// tests/tooling/textMetrics.test.ts — components/table/textMetrics.generated.ts still holds the
// width every table notice string shapes to, in every locale.
//
// The table's layout sizes a notice from that file before the notice renders, so a string edited
// without regenerating it lays out at its old width, and a key dropped from it lays out at nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OUT, TABLE_TEXT, renderTextMetrics, textMetrics } from "../../scripts/build-text-metrics.mjs";
import { TEXT_METRICS } from "../../components/table/textMetrics.generated.ts";
import { NOTICES } from "../../components/table/noticeModel.ts";
import { CHIP_KEYS } from "../../components/turnTimerUi.ts";
import { COMBO_NAME_KEYS } from "../../lib/comboName.ts";
import { SUPPORTED_LOCALES, catalogs } from "../../shared/i18n.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fresh = textMetrics();
const specKeys = Object.values(TABLE_TEXT).flatMap((roles) => Object.values(roles).flat());

/** Every path at which `a` and `b` differ, a key one side lacks included. */
function drift(a: unknown, b: unknown, at = ""): string[] {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return Object.is(a, b) ? [] : [at];
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap((k) =>
    k in left && k in right ? drift(left[k], right[k], `${at}/${k}`) : [`${at}/${k}`]
  );
}

test("the committed metrics are what the fonts and locales shape to now", () => {
  assert.deepEqual(drift(fresh, TEXT_METRICS), [], "run `node scripts/build-text-metrics.mjs`");
  assert.equal(readFileSync(OUT, "utf8"), renderTextMetrics(fresh), "run `node scripts/build-text-metrics.mjs`");
});

test("every locale is measured for every key the spec names, and the spec is not empty", () => {
  assert.deepEqual(Object.keys(TEXT_METRICS.runs).sort(), [...SUPPORTED_LOCALES].sort());
  for (const kind of Object.keys(TABLE_TEXT)) assert.ok(kind in NOTICES, `${kind} is not a notice kind`);
  const floor = new Set([...Object.values(COMBO_NAME_KEYS), ...Object.values(CHIP_KEYS)]).size;
  assert.ok(new Set(specKeys).size >= floor, `the spec names ${specKeys.length} keys, under the ${floor} its owners export`);
  for (const locale of SUPPORTED_LOCALES) {
    const byKind: Record<string, Record<string, { units: number }>> = TEXT_METRICS.runs[locale];
    const runs = Object.values(byKind).flatMap((byKey) => Object.entries(byKey));
    assert.equal(runs.length, specKeys.length, `${locale} measures ${runs.length} of ${specKeys.length} keys`);
    for (const [key, run] of runs) assert.ok(run.units > 0, `${locale} ${key} shaped to no width`);
  }
  for (const [name, face] of Object.entries(TEXT_METRICS.faces)) assert.ok(face.widestGlyph > 0, `${name} has no glyph`);
});

test("a locale missing a key the table draws stops the generator rather than falling back", () => {
  const [key] = specKeys;
  const { [key]: _dropped, ...sq } = catalogs.sq as Record<string, string>;
  assert.throws(
    () => textMetrics({ root: repoRoot, locales: { ...catalogs, sq } }),
    new RegExp(`locales/sq\\.ts has no "${key.replace(/\./g, "\\.")}"`)
  );
});

test("a key removed from the committed metrics is reported at its path", () => {
  const planted = structuredClone(TEXT_METRICS) as { runs: Record<string, Record<string, Record<string, unknown>>> };
  delete planted.runs.en.turn["onlineGame.reconnecting"];
  assert.deepEqual(drift(fresh, planted), ["/runs/en/turn/onlineGame.reconnecting"]);
});

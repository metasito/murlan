// tests/tooling/textMetrics.test.ts — components/table/textMetrics.generated.ts still holds the
// width every table notice string shapes to, in every locale, and its spec names every string a
// notice draws.
//
// The table's layout sizes a notice from that file before the notice renders, so a string edited
// without regenerating it lays out at its old width, and a key the spec never named lays out at
// nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DYNAMIC_TEXT,
  OUT,
  SERVED_PAYLOADS,
  TABLE_TEXT,
  renderTextMetrics,
  textMetrics,
} from "../../scripts/build-text-metrics.mjs";
import { WEB_FONTS } from "../../scripts/fontSubsetChars.mjs";
import { TEXT_METRICS } from "../../components/table/textMetrics.generated.ts";
import { NOTICES, noticeBox, type NoticeKind } from "../../components/table/noticeModel.ts";
import { CHIP_KEYS } from "../../components/turnTimerUi.ts";
import { COMBO_NAME_KEYS } from "../../lib/comboName.ts";
import { SUPPORTED_LOCALES, catalogs } from "../../shared/i18n.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
const fresh = await textMetrics();
const specKeys = Object.values(TABLE_TEXT).flatMap((roles) => Object.values(roles).flat());
const spec = new Set(specKeys);

type Run = { units: number; fallback: readonly string[] };
const runsOf = (metrics: { runs: unknown }, locale: string) =>
  Object.entries((metrics.runs as Record<string, Record<string, Record<string, Run>>>)[locale]!).flatMap(([kind, byKey]) =>
    Object.entries(byKey).map(([key, run]) => [`${kind}/${key}`, run] as const)
  );

/** Every path at which `a` and `b` differ, a key one side lacks included. */
function drift(a: unknown, b: unknown, at = ""): string[] {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return Object.is(a, b) ? [] : [at];
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap((k) =>
    k in left && k in right ? drift(left[k], right[k], `${at}/${k}`) : [`${at}/${k}`]
  );
}

/** The `{…}` that opens at or after `marker`, braces balanced. */
function braced(src: string, marker: string): string {
  const start = src.indexOf("{", src.indexOf(marker));
  assert.ok(src.includes(marker) && start >= 0, `${marker} is gone`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    depth += src[i] === "{" ? 1 : src[i] === "}" ? -1 : 0;
    if (depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${marker} never closes`);
}

const NOTICES_DIR = "components/table/notices";
/** Where the words a notice draws are chosen: the notice components, the models that pick their keys, and the table's connection notes. */
const SOURCES: Record<string, string> = {
  ...Object.fromEntries(readdirSync(path.join(repoRoot, NOTICES_DIR)).map((f) => [`${NOTICES_DIR}/${f}`, read(`${NOTICES_DIR}/${f}`)])),
  "components/table/exchangeModel.ts": read("components/table/exchangeModel.ts"),
  "components/table/useTableFloat.ts": read("components/table/useTableFloat.ts"),
  "components/turnTimerUi.ts": read("components/turnTimerUi.ts"),
  "lib/comboName.ts": read("lib/comboName.ts"),
  "comboLabel in components/table/spokenLabels.ts": braced(read("components/table/spokenLabels.ts"), "export function comboLabel("),
  "connection= in app/(online)/game.tsx": braced(read("app/(online)/game.tsx"), "connection={"),
  "connectionNote in components/GameTable.tsx": braced(read("components/GameTable.tsx"), "const connectionNote"),
};

/** Keys the scanned sources name that no notice draws, and what each is for instead. */
const UNDRAWN: Record<string, string> = {
  "onlineGame.leftTableLeave": "a BoardButton label under the left-table panel",
  "onlineGame.leftTableReclaim": "a BoardButton label under the left-table panel",
  "roundOverOverlay.waitingA11yLabel": "the round vote's accessible name",
  "roundOverOverlay.nextRoundA11yLabel": "the round vote's accessible name",
  "game.endMatchVoteHint": "the end-match vote's accessibility hint",
  "game.endMatchVoteTally": "the end-match vote's accessible name",
  "game.endMatchVoteTallyVoted": "the end-match vote's accessible name",
  "game.endMatchWithdrawButton": "the end-match vote's accessible name once voted",
  "gameTable.a11yMatchOver": "the turn chip's spoken label",
  "gameTable.a11yRoundOver": "the turn chip's spoken label",
  "gameTable.a11yDealing": "the turn chip's spoken label",
  "gameTable.a11yYourTurn": "the turn chip's spoken label",
  "gameTable.a11yTurnOf": "the turn chip's spoken label",
};

const keysIn = (src: string) => [...src.matchAll(/["'`]([A-Za-z]\w*\.[\w.]+)["'`]/g)].map((m) => m[1]!).filter((k) => k in catalogs.en);
const scanned = Object.fromEntries(Object.entries(SOURCES).map(([file, src]) => [file, new Set(keysIn(src))]));
const everyScanned = new Set(Object.values(scanned).flatMap((keys) => [...keys]));

test("the committed metrics are what the served fonts and locales shape to now", () => {
  assert.deepEqual(drift(fresh, TEXT_METRICS), [], "run `node scripts/build-text-metrics.mjs`");
  assert.equal(readFileSync(OUT, "utf8"), renderTextMetrics(fresh), "run `node scripts/build-text-metrics.mjs`");
});

test("every locale is measured for every key the spec names, and the spec is not empty", () => {
  assert.deepEqual(Object.keys(TEXT_METRICS.runs).sort(), [...SUPPORTED_LOCALES].sort());
  const floor = new Set([...Object.values(COMBO_NAME_KEYS), ...Object.values(CHIP_KEYS)]).size;
  assert.ok(spec.size >= floor, `the spec names ${spec.size} keys, under the ${floor} its owners export`);
  for (const locale of SUPPORTED_LOCALES) {
    const runs = runsOf(TEXT_METRICS, locale);
    assert.equal(runs.length, specKeys.length, `${locale} measures ${runs.length} of ${specKeys.length} runs`);
    for (const [key, run] of runs) assert.ok(run.units > 0, `${locale} ${key} shaped to no width`);
  }
  for (const [name, face] of Object.entries(TEXT_METRICS.faces)) assert.ok(face.widestGlyph > 0, `${name} has no glyph`);
});

test("every notice kind is measured, or is dynamic with a bound it has", () => {
  for (const kind of Object.keys(NOTICES)) {
    const measured = kind in TABLE_TEXT;
    const dynamic = kind in DYNAMIC_TEXT;
    assert.ok(measured !== dynamic, `${kind} must be in exactly one of TABLE_TEXT and DYNAMIC_TEXT`);
  }
  for (const kind of [...Object.keys(TABLE_TEXT), ...Object.keys(DYNAMIC_TEXT)]) assert.ok(kind in NOTICES, `${kind} is not a notice kind`);
  for (const [kind, bound] of Object.entries(DYNAMIC_TEXT)) {
    if (bound === "name") continue;
    assert.equal(bound, "box", `${kind}: unknown bound ${bound}`);
    const box = noticeBox(kind as NoticeKind, 1);
    assert.ok(Number.isFinite(box.maxWidth) && box.lines >= 1, `${kind} is bounded by its box, which has no maxWidth`);
  }
});

test("every key a notice's source names is measured, or is named here as drawn elsewhere", () => {
  const drawnFiles = Object.entries(scanned).filter(([, keys]) => keys.size > 0);
  assert.ok(drawnFiles.length >= 10, `only ${drawnFiles.length} sources yielded a key: the scan has stopped seeing them`);
  const viaPayload = new Set(Object.values(SERVED_PAYLOADS).flat().map((code) => `server.${code}`));
  for (const key of spec) assert.ok(everyScanned.has(key) || viaPayload.has(key), `${key} is in the spec but no scanned source names it`);
  for (const [file, keys] of Object.entries(scanned)) {
    for (const key of keys) assert.ok(spec.has(key) || key in UNDRAWN, `${file} names ${key}, which the spec does not measure`);
  }
  for (const key of Object.keys(UNDRAWN)) {
    assert.ok(everyScanned.has(key), `UNDRAWN lists ${key}, which no scanned source names`);
    assert.ok(!spec.has(key), `${key} is both measured and UNDRAWN`);
  }
  for (const [file, src] of Object.entries(SOURCES)) {
    for (const [element] of src.matchAll(/<(Notice\w+)\b[\s\S]*?<\/\1>/g)) {
      for (const key of keysIn(element)) assert.ok(spec.has(key), `${file} draws ${key} inside a notice element, but the spec does not measure it`);
    }
  }
});

test("every server payload a connection note translates is measured", () => {
  const notes = SOURCES["connection= in app/(online)/game.tsx"]! + SOURCES["connectionNote in components/GameTable.tsx"]!;
  const args = [...notes.matchAll(/translateServerPayload\(([^)]+)\)/g)].map((m) => m[1]!.trim());
  assert.ok(args.length >= 1, "the connection notes translate no server payload: the scan has stopped seeing them");
  const served: Record<string, readonly string[]> = SERVED_PAYLOADS;
  const server = readdirSync(path.join(repoRoot, "server"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => read(`server/${f}`))
    .join("\n");
  for (const arg of args) {
    assert.ok(served[arg]?.length, `translateServerPayload(${arg}) is drawn but SERVED_PAYLOADS lists none of its codes`);
    for (const code of served[arg]!) {
      assert.ok(server.includes(`payload("${code}"`), `no server source emits ${code}`);
      assert.ok(spec.has(`server.${code}`), `server.${code} is not measured`);
    }
  }
});

test("a glyph the served font lacks is listed by codepoint, not measured as nothing", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const [key, run] of runsOf(TEXT_METRICS, locale)) {
      for (const cp of run.fallback) assert.match(cp, /^U\+[0-9A-F]{4,6}$/, `${locale} ${key} lists ${cp}`);
    }
  }
  assert.ok(
    SUPPORTED_LOCALES.some((l) => runsOf(TEXT_METRICS, l).some(([, run]) => run.fallback.length > 0)),
    "no run lists a fallback glyph, yet the combo names carry emoji Rajdhani has none of"
  );
});

test("the served subsets shape like the full fonts wherever they have the glyph", async () => {
  const require = createRequire(import.meta.url);
  const full = await textMetrics({
    fontFile: (family) => {
      const font = WEB_FONTS.find((f) => f.family === family)!;
      return require.resolve(`${font.pkg}/${font.weight}/${family}.ttf`);
    },
  });
  let compared = 0;
  for (const locale of SUPPORTED_LOCALES) {
    const served = new Map(runsOf(fresh, locale));
    for (const [key, run] of runsOf(full, locale)) {
      const subset = served.get(key)!;
      if (subset.fallback.join() !== run.fallback.join()) continue;
      compared++;
      assert.equal(subset.units, run.units, `${locale} ${key}: the served subset shapes to ${subset.units}, the full font to ${run.units}`);
    }
  }
  assert.ok(compared >= specKeys.length * SUPPORTED_LOCALES.length - 10, `only ${compared} runs compared`);
});

test("a locale missing a key the table draws stops the generator rather than falling back", async () => {
  const [key] = specKeys;
  const { [key!]: _dropped, ...sq } = catalogs.sq as Record<string, string>;
  await assert.rejects(
    () => textMetrics({ root: repoRoot, locales: { ...catalogs, sq } }),
    new RegExp(`locales/sq\\.ts has no "${key!.replace(/\./g, "\\.")}"`)
  );
});

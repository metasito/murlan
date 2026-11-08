// tests/tooling/textMetrics.test.ts — components/table/textMetrics.generated.ts still holds the
// width every table notice string shapes to, in every locale. That its spec is what the notices
// draw is tests/native/noticeText.test.tsx's.
//
// The table's layout sizes a notice from that file before the notice renders, so a string edited
// without regenerating it lays out at its old width.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OUT, TABLE_TEXT, renderTextMetrics, textMetrics } from "../../scripts/build-text-metrics.mjs";
import { WEB_FONTS } from "../../scripts/fontSubsetChars.mjs";
import { TEXT_METRICS } from "../../components/table/textMetrics.generated.ts";
import { RECONNECT_CODES } from "../../components/table/connectionNote.ts";
import { CHIP_KEYS } from "../../components/turnTimerUi.ts";
import { COMBO_NAME_KEYS } from "../../lib/comboName.ts";
import { SUPPORTED_LOCALES, catalogs } from "../../shared/i18n.ts";
import { CLOCK_CEILING_MS, clockDigits } from "../../shared/clock.ts";
import { TURN_TIMEOUT_MS } from "../../lib/game/gameEngine.ts";
import { CLOCK_DEMO_SECONDS } from "../../lib/tutorial/beats.ts";
import { afkTimeoutMs, voteDeadlineMs } from "../../server/game/gameTimers.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
const generated = textMetrics().catch((error: unknown) => error);
async function fresh() {
  const metrics = await generated;
  assert.ok(!(metrics instanceof Error), `the generator failed: ${String(metrics)}`);
  return metrics as Awaited<ReturnType<typeof textMetrics>>;
}
const specKeys = Object.values(TABLE_TEXT).flatMap((roles) => Object.values(roles).flat());
const spec = new Set(specKeys);

type Run = { units: number; fallback: readonly string[] };
const runsOf = (metrics: { runs: unknown }, locale: string) => {
  const byKind = (metrics.runs as Record<string, Record<string, Record<string, Run>> | undefined>)[locale];
  assert.ok(byKind, `no runs for ${locale}`);
  return Object.entries(byKind).flatMap(([kind, byKey]) => Object.entries(byKey).map(([key, run]) => [`${kind}/${key}`, run] as const));
};

/** Every path at which `a` and `b` differ, a key one side lacks included. */
function drift(a: unknown, b: unknown, at = ""): string[] {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return Object.is(a, b) ? [] : [at];
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap((k) =>
    k in left && k in right ? drift(left[k], right[k], `${at}/${k}`) : [`${at}/${k}`]
  );
}

test("the committed metrics are what the served fonts and locales shape to now", async () => {
  const metrics = await fresh();
  assert.deepEqual(drift(metrics, TEXT_METRICS), [], "run `node scripts/build-text-metrics.mjs`");
  assert.equal(readFileSync(OUT, "utf8"), renderTextMetrics(metrics), "run `node scripts/build-text-metrics.mjs`");
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

test("every code a reconnected note translates is what the server emits, and is measured", () => {
  const server = readdirSync(path.join(repoRoot, "server"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.includes("test"))
    .map((f) => read(`server/${f}`))
    .join("\n");
  const emits = [...server.matchAll(/emit\("game:player_reconnected",[\s\S]*?\n\s*\}\);/g)].map((m) => m[0]);
  assert.equal(emits.length, 1, `the server emits game:player_reconnected from ${emits.length} places`);
  const emitted = [...emits[0]!.matchAll(/payload\("(\w+)"/g)].map((m) => m[1]);
  assert.ok(emitted.length >= 1, "the game:player_reconnected emit carries no payload code: the scan has stopped seeing it");
  assert.deepEqual([...new Set(emitted)].sort(), [...RECONNECT_CODES].sort());
  for (const code of RECONNECT_CODES) {
    assert.ok(`server.${code}` in catalogs.en, `locales/en.ts has no server.${code}`);
    assert.ok(spec.has(`server.${code}`), `server.${code} is not measured`);
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
  const metrics = await fresh();
  let compared = 0;
  for (const locale of SUPPORTED_LOCALES) {
    const served = new Map(runsOf(metrics, locale));
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

test("no clock a seat is given counts from more digits than the turn chip reserves for its ceiling", () => {
  assert.deepEqual(TEXT_METRICS.dynamic.turn.strong.bound, { chars: clockDigits(CLOCK_CEILING_MS) });
  for (const [name, ms] of [["an offline turn", TURN_TIMEOUT_MS], ["the tutorial's clock", CLOCK_DEMO_SECONDS * 1000]] as const)
    assert.ok(ms <= CLOCK_CEILING_MS, `${name} counts from ${ms} ms, over the clock's ${CLOCK_CEILING_MS} ms ceiling`);
  const envs = ["MURLAN_AFK_TIMEOUT_MS", "MURLAN_VOTE_DEADLINE_MS"] as const;
  const saved = envs.map((env) => [env, process.env[env]] as const);
  try {
    for (const raw of [undefined, String(CLOCK_CEILING_MS * 10)]) {
      for (const env of envs) {
        if (raw === undefined) delete process.env[env];
        else process.env[env] = raw;
      }
      for (const [name, ms] of [["afkTimeoutMs", afkTimeoutMs()], ["voteDeadlineMs", voteDeadlineMs()]] as const)
        assert.ok(ms <= CLOCK_CEILING_MS, `${name} gives ${ms} ms with the environment ${raw ?? "unset"}, over the ${CLOCK_CEILING_MS} ms ceiling`);
    }
  } finally {
    for (const [env, value] of saved) {
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
  }
});

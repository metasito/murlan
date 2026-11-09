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
import ts from "typescript";
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

const COMPILER_OPTIONS = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, "tsconfig.json"), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => {
    throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  },
})!.options;

/** Every tracked source the notice renderers reach by import or re-export, as TypeScript resolves them. */
function reachedFrom(entries: string[], added: Record<string, string> = {}): Record<string, string> {
  const rel = (abs: string) => path.relative(repoRoot, abs).split(path.sep).join("/");
  const host: ts.ModuleResolutionHost = { ...ts.sys, fileExists: (f) => rel(f) in added || ts.sys.fileExists(f) };
  const load = (file: string) => added[file] ?? read(file);
  const sources: Record<string, string> = {};
  for (const queue = [...entries]; queue.length; ) {
    const file = queue.pop()!;
    if (file in sources) continue;
    sources[file] = load(file);
    const source = ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const st of source.statements) {
      if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier) continue;
      const found = ts.resolveModuleName((st.moduleSpecifier as ts.StringLiteral).text, path.join(repoRoot, file), COMPILER_OPTIONS, host).resolvedModule;
      if (!found || found.isExternalLibraryImport) continue;
      const target = rel(found.resolvedFileName);
      if (!target.startsWith("..") && !target.split("/").includes("node_modules") && /\.tsx?$/.test(target) && !target.endsWith(".d.ts")) queue.push(target);
    }
  }
  return sources;
}

const NOTICE_ENTRIES = readdirSync(path.join(repoRoot, "components", "table", "notices"))
  .filter((f) => f.endsWith(".tsx") && f !== "gallery.tsx")
  .map((f) => `components/table/notices/${f}`);

/** A file a notice imports that translates, and draws no notice run with it. */
const NOT_NOTICE_TEXT: Record<string, string> = {
  "components/table/matchBoard.tsx": "the match board's own words, its BoardButton imported by the vote notices",
  "components/CardView.tsx": "a card's spoken hint",
  "lib/cardNames.ts": "spoken card names",
  "lib/i18n.ts": "the translator itself",
};

/** Words a notice's source translates that are not a Text run it draws, with what carries them instead. */
const NOT_A_RUN: Record<string, string> = {
  "onlineGame.leftTableLeave": "a BoardButton's label, a control beside the notice",
  "onlineGame.leftTableReclaim": "a BoardButton's label, a control beside the notice",
  "game.endMatchVoteHint": "the vote's accessibility hint",
  "game.endMatchVoteTally": "A11yStatus, spoken",
  "game.endMatchVoteTallyVoted": "A11yStatus, spoken",
  "game.endMatchWithdrawButton": "the vote's accessibility label",
};
/** A `t(...)` whose key the source cannot show, and the owner's export the spec takes it from. */
const KEY_FROM_OWNER: Record<string, string> = {
  "components/turnTimerUi.ts": "CHIP_KEYS",
};

/** Every catalogue key `text` passes to `t`/`tn` as a literal or a choice of literals, and each call whose key it cannot read. */
function translated(file: string, text: string): { keys: Set<string>; opaque: string[] } {
  const keys = new Set<string>();
  const opaque: string[] = [];
  const literals = (e: ts.Expression): string[] | null => {
    if (ts.isParenthesizedExpression(e)) return literals(e.expression);
    if (ts.isStringLiteralLike(e)) return [e.text];
    if (ts.isConditionalExpression(e)) {
      const arms = [literals(e.whenTrue), literals(e.whenFalse)];
      return arms.every((a) => a !== null) ? arms.flat() as string[] : null;
    }
    return null;
  };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : ts.isIdentifier(n.expression) ? n.expression.text : "";
      if ((callee === "t" || callee === "tn") && n.arguments[0]) {
        const found = literals(n.arguments[0]);
        if (found) found.forEach((k) => keys.add(k));
        else opaque.push(n.getText().slice(0, 60));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return { keys, opaque };
}

/** What in `sources` a notice translates and the spec does not measure, and every exemption and opaque call that has gone stale. */
function unmeasured(sources: Record<string, string>): string[] {
  const found = new Map<string, string>();
  const stale: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const { keys, opaque } = translated(file, text);
    if (file in NOT_NOTICE_TEXT) {
      if (!keys.size && !opaque.length) stale.push(`${file} is listed as "${NOT_NOTICE_TEXT[file]}" and translates nothing`);
      continue;
    }
    for (const key of keys) found.set(key, file);
    const owner = KEY_FROM_OWNER[file];
    if (opaque.length && !owner) stale.push(`${file}: ${opaque[0]} passes a key this scan cannot read`);
    if (!opaque.length && owner) stale.push(`${file}: no longer passes an unreadable key, so ${owner} is not its to carry`);
  }
  const problems = [...found].flatMap(([key, file]) => (spec.has(key) || /a11y/i.test(key) || key in NOT_A_RUN ? [] : [`${file}: t("${key}") is not measured`]));
  for (const [key, why] of Object.entries(NOT_A_RUN)) {
    if (spec.has(key)) stale.push(`${key} is measured, so it is not "${why}"`);
    else if (!found.has(key)) stale.push(`${key} is listed as "${why}" and no notice source translates it`);
  }
  for (const file of Object.keys(NOT_NOTICE_TEXT)) if (!(file in sources)) stale.push(`${file} is listed as not notice text and no notice reaches it`);
  return [...problems, ...stale];
}

const noticeSources = (added: Record<string, string> = {}) => reachedFrom(NOTICE_ENTRIES, added);

test("every key a table notice translates is measured, or named as words it does not draw as a run", () => {
  const sources = noticeSources();
  assert.ok(Object.keys(sources).length >= 8, "the scan has stopped finding the notice sources");
  assert.deepEqual(unmeasured(sources), []);
  const seen = new Set(Object.entries(sources).flatMap(([f, text]) => [...translated(f, text).keys]));
  for (const key of ["common.retry", "offlineBanner.text", "gameShared.emptyHand", "game.seatLeft", "onlineGame.leftTableTitle"])
    assert.ok(seen.has(key), `the scan no longer reads ${key}`);
});

test("a key a notice starts translating that nobody measured fails the scan", () => {
  const sources = noticeSources();
  sources["components/table/notices/tableLines.tsx"] += '\nexport const planted = (t: (k: string) => string) => t("game.newlyAdded");\n';
  assert.deepEqual(unmeasured(sources), ['components/table/notices/tableLines.tsx: t("game.newlyAdded") is not measured']);
});

test("a model a notice starts importing is scanned for the keys it translates", () => {
  const model = "components/table/pileModel.ts";
  const entry = "components/table/notices/pileNotices.tsx";
  const sources = noticeSources({
    [model]: 'export const pileWords = (t: (k: string) => string) => t("game.pileX");',
    [entry]: `${read(entry)}\nimport { pileWords } from "../pileModel";\nexport const planted = pileWords;\n`,
  });
  assert.ok(model in sources, "the scan did not follow the notice's import to the new model");
  assert.deepEqual(unmeasured(sources), [`${model}: t("game.pileX") is not measured`]);
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

test("every fallback glyph a run lists has an assumed width, and no other does", () => {
  const listed = new Set(SUPPORTED_LOCALES.flatMap((l) => runsOf(TEXT_METRICS, l).flatMap(([, run]) => run.fallback)));
  assert.ok(listed.size > 0, "no run lists a fallback glyph: the check has stopped seeing the emoji");
  assert.deepEqual(Object.keys(TEXT_METRICS.fallbackEm).sort(), [...listed].sort());
});

test("a letter the served font lacks stops the generator rather than being given a width", async () => {
  const key = specKeys[0]!;
  const en = { ...catalogs.en, [key]: "Ж" } as Record<string, string>;
  await assert.rejects(() => textMetrics({ root: repoRoot, locales: { ...catalogs, en } }), /U\+0416 \(Ж\).*no width to assume for a letter/);
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
  const knobs = [["MURLAN_AFK_TIMEOUT_MS", afkTimeoutMs], ["MURLAN_VOTE_DEADLINE_MS", voteDeadlineMs]] as const;
  const saved = knobs.map(([env]) => [env, process.env[env]] as const);
  try {
    for (const [env, read] of knobs) {
      delete process.env[env];
      assert.ok(read() <= CLOCK_CEILING_MS, `${env} unset gives ${read()} ms, over the ${CLOCK_CEILING_MS} ms ceiling`);
      process.env[env] = String(CLOCK_CEILING_MS);
      assert.equal(read(), CLOCK_CEILING_MS);
      process.env[env] = String(CLOCK_CEILING_MS + 1);
      assert.throws(read, new RegExp(`${env}=${CLOCK_CEILING_MS + 1} is over its ${CLOCK_CEILING_MS} ms ceiling`));
    }
  } finally {
    for (const [env, value] of saved) {
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
  }
});

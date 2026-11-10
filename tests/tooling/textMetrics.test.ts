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

/** A file a notice, or the table that composes it, imports that translates, the keys it is excused for (neither measured nor spoken-only by name), and the calls whose key it cannot read. */
const NOT_NOTICE_TEXT: Record<string, { why: string; keys: string[]; opaque: string[] }> = {
  "components/table/matchBoard.tsx": {
    why: "the match board's own words; its BoardButton is imported by the vote notices",
    keys: [
      "matchBoard.notRecorded", "matchBoard.provisional", "matchBoard.ratingLabel", "matchBoard.tooManyBots", "matchBoard.wins", "matchBoard.youWon",
      "roundOverOverlay.newMatchA11yLabel", "roundOverOverlay.waitingA11yLabel", "result.home", "result.matchDrawTitle", "result.matchOverTitle", "result.newMatch", "result.tableStops", "matchBoard.notRecordedSpoken", "matchBoard.ratingSpoken",
    ],
    opaque: [],
  },
  "components/CardView.tsx": { why: "a card's spoken hint", keys: ["cardView.selectedA11yHint"], opaque: [] },
  "lib/cardNames.ts": { why: "spoken card names", keys: ["cardView.jokerBlack", "cardView.jokerColored", "cards.nameFormat"], opaque: ["rankSpokenName: t(key)", "suitSpokenName: t(key)"] },
  "lib/game/scorePill.ts": { why: "the score pill's rows, which are no notice kind", keys: ["lobby.team", "result.singleRoundFormat", "scorePill.race"], opaque: [] },
  "lib/table/playRefusal.ts": { why: "RejectFloat's words, a runtime run bounded by noticeBox", keys: [], opaque: ['playRefusalLabel: t(key, { rank: card ? getCardDisplayRank(card.rank) : "", suit: card ? getSuitSymbol(card.suit) : "", card: card ? cardSpokenName(card, t) : "", })'] },
  "components/table/hand.tsx": { why: "the hand's spoken move actions", keys: ["gameTable.moveCardLeft", "gameTable.moveCardRight"], opaque: [] },
  "app/tutorial.tsx": {
    why: "the tutorial's own card words; its chip text is CHIP_KEYS, measured through its owner",
    keys: [
      "tutorial.progressText", "tutorial.skip", "tutorial.cardTitleComplete", "tutorial.cardTitleQuickGuide", "tutorial.onTable", "tutorial.yourHand", "tutorial.pass",
      "tutorial.playCombination", "tutorial.continue", "tutorial.yourHandAfterReceiving", "tutorial.justReceived", "tutorial.giveback", "tutorial.rereadRules", "tutorial.backToHome", "tutorial.backA11yLabel", "tutorial.skipA11yLabel", "gameTable.a11yYourTurn",
    ],
    opaque: ["renderBody: t(CHIP_KEYS.yourTurn)"],
  },
  "lib/i18n.ts": { why: "the translator itself", keys: ["common.unknownError"], opaque: ["tn: t(pluralKey(base, count), { count, ...params })"] },
};

/** Words a notice's source translates that are not a Text run it draws, with what carries them instead. */
const NOT_A_RUN: Record<string, string> = {
  "onlineGame.leftTableLeave": "a BoardButton's label, a control beside the notice",
  "onlineGame.leftTableReclaim": "a BoardButton's label, a control beside the notice",
  "game.endMatchVoteHint": "the vote's accessibility hint",
  "game.endMatchVoteTally": "A11yStatus, spoken",
  "game.endMatchVoteTallyVoted": "A11yStatus, spoken",
  "game.endMatchWithdrawButton": "the vote's accessibility label",
  "gameTable.a11yCardMoved": "spoken to a screen reader, never drawn",
  "gameTable.a11yDealing": "spoken to a screen reader, never drawn",
  "gameTable.a11yEmptyTable": "spoken to a screen reader, never drawn",
  "gameTable.a11yExchangeGive": "spoken to a screen reader, never drawn",
  "gameTable.a11yExchangeWait": "spoken to a screen reader, never drawn",
  "gameTable.a11yHandCount": "spoken to a screen reader, never drawn",
  "gameTable.a11yHandSelected": "spoken to a screen reader, never drawn",
  "gameTable.a11yLastPlayBomb": "spoken to a screen reader, never drawn",
  "gameTable.a11yLastPlayPair": "spoken to a screen reader, never drawn",
  "gameTable.a11yLastPlayRoyalStraight": "spoken to a screen reader, never drawn",
  "gameTable.a11yLastPlayStraight": "spoken to a screen reader, never drawn",
  "gameTable.a11yLastPlayTriple": "spoken to a screen reader, never drawn",
  "gameTable.a11yMatchOver": "spoken to a screen reader, never drawn",
  "gameTable.a11yOpponentCards": "spoken to a screen reader, never drawn",
  "gameTable.a11yPlayerPlayed": "spoken to a screen reader, never drawn",
  "gameTable.a11yRoundOver": "spoken to a screen reader, never drawn",
  "gameTable.a11ySecondsLeft": "spoken to a screen reader, never drawn",
  "gameTable.a11yTurnOf": "spoken to a screen reader, never drawn",
  "gameTable.a11yYouPlayed": "spoken to a screen reader, never drawn",
  "gameTable.a11yYourCards": "spoken to a screen reader, never drawn",
  "gameTable.a11yYourTurn": "spoken to a screen reader, never drawn",
  "gameTable.passA11yLabel": "spoken to a screen reader, never drawn",
  "gameTable.settingsA11yLabel": "spoken to a screen reader, never drawn",
  "roundOverOverlay.nextRoundA11yLabel": "spoken to a screen reader, never drawn",
  "roundOverOverlay.waitingA11yLabel": "spoken to a screen reader, never drawn",
  "seat.finishedA11yLabel": "spoken to a screen reader, never drawn",
};
/** A `t(...)` whose key the source cannot show, and the owner's export the spec takes it from. */
const KEY_FROM_OWNER: Record<string, { owner: string; calls: string[] }> = {
  "lib/comboName.ts": { owner: "COMBO_NAME_KEYS", calls: ["comboName: t(COMBO_NAME_KEYS[type])"] },
  "components/turnTimerUi.ts": { owner: "CHIP_KEYS", calls: ["say: i.t(key)", "say: i.t(key, { name: i.onMoveName })"] },
};

/** The nearest named function or variable around `n`, so a call is pinned to where it is made, not to an expression another function could share. */
function enclosingName(n: ts.Node): string {
  for (let p = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  }
  return "(module)";
}

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
        else opaque.push(`${enclosingName(n)}: ${n.getText().replace(/\s+/g, " ")}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return { keys, opaque };
}

/** Each `t()` whose key the scan cannot read, by its expression, against the ones the file is allowed; a swapped expression is both a new call and a vanished one. */
function opaqueDrift(file: string, actual: string[], allowed: string[]): string[] {
  const left = [...allowed];
  const extra = actual.filter((call) => {
    const at = left.indexOf(call);
    if (at === -1) return true;
    left.splice(at, 1);
    return false;
  });
  return [
    ...extra.map((call) => `${file}: ${call} passes a key this scan cannot read`),
    ...left.map((call) => `${file} is allowed ${call} and no longer makes it`),
  ];
}

/** What in `sources` a notice translates and the spec does not measure, and every exemption and opaque call that has gone stale. */
function unmeasured(sources: Record<string, string>): string[] {
  const found = new Map<string, string>();
  const stale: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const { keys, opaque } = translated(file, text);
    const excused = NOT_NOTICE_TEXT[file];
    if (excused) {
      for (const key of keys) if (!spec.has(key) && !excused.keys.includes(key)) stale.push(`${file}: t("${key}") is not measured, and ${file} is excused only for ${excused.why}`);
      for (const key of excused.keys) {
        if (!keys.has(key)) stale.push(`${file} is excused for ${key} and no longer translates it`);
        else if (spec.has(key)) stale.push(`${file}: ${key} is measured, so it is not excused`);
      }
      stale.push(...opaqueDrift(file, opaque, excused.opaque));
      continue;
    }
    for (const key of keys) found.set(key, file);
    const owner = KEY_FROM_OWNER[file];
    stale.push(...opaqueDrift(file, opaque, owner?.calls ?? []));
  }
  const problems = [...found].flatMap(([key, file]) => (spec.has(key) || key in NOT_A_RUN ? [] : [`${file}: t("${key}") is not measured`]));
  for (const [key, why] of Object.entries(NOT_A_RUN)) {
    if (spec.has(key)) stale.push(`${key} is measured, so it is not "${why}"`);
    else if (!found.has(key)) stale.push(`${key} is listed as "${why}" and no notice source translates it`);
  }
  for (const file of Object.keys(NOT_NOTICE_TEXT)) if (!(file in sources)) stale.push(`${file} is excused as not notice text and no notice reaches it`);
  return [...problems, ...stale];
}

/** Every file under the shipped source roots that imports a notice renderer, `TableNotice` or a file that re-exports one, whatever it passes it. */
function importersOfNotices(added: Record<string, string>): Record<string, string> {
  const rel = (abs: string) => path.relative(repoRoot, abs).split(path.sep).join("/");
  const host: ts.ModuleResolutionHost = { ...ts.sys, fileExists: (f) => rel(f) in added || ts.sys.fileExists(f) };
  const files: Record<string, string> = {};
  for (const root of ["app", "components", "context", "lib"]) {
    for (const f of readdirSync(path.join(repoRoot, root), { recursive: true, encoding: "utf8" })) {
      const file = `${root}/${f.split(path.sep).join("/")}`;
      if (!/\.tsx?$/.test(file) || file.endsWith(".d.ts") || file.startsWith("components/table/notices/")) continue;
      files[file] = added[file] ?? read(file);
    }
  }
  for (const file of Object.keys(added)) if (/^(app|components|context|lib)\//.test(file) && !file.startsWith("components/table/notices/")) files[file] ??= added[file]!;
  const imports = (file: string, reached: (target: string) => boolean) => {
    const source = ts.createSourceFile(file, files[file]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return source.statements.some((st) => {
      if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier) return false;
      const hit = ts.resolveModuleName((st.moduleSpecifier as ts.StringLiteral).text, path.join(repoRoot, file), COMPILER_OPTIONS, host).resolvedModule;
      return !!hit && reached(rel(hit.resolvedFileName));
    });
  };
  const found: Record<string, string> = {};
  let reached = (target: string) => target.startsWith("components/table/notices/") || target === "components/table/TableNotice.tsx";
  for (let grew = true; grew; ) {
    grew = false;
    for (const file of Object.keys(files)) {
      if (file in found || !imports(file, reached)) continue;
      found[file] = files[file]!;
      grew = true;
    }
    const barrels = new Set(Object.keys(found).filter((file) => /\bexport\s+(\*|\{[^}]*\})\s+from\b/.test(found[file]!)));
    const before = reached;
    reached = (target) => before(target) || barrels.has(target);
  }
  return found;
}

/** The notice renderers' closure, the `.ts` models the table composes, and every file that hands a notice its words as props. */
const noticeSources = (added: Record<string, string> = {}) => {
  const composed = Object.entries(reachedFrom(["components/GameTable.tsx", "components/table/pile.tsx"], added)).filter(([file]) => file.endsWith(".ts"));
  return { ...Object.fromEntries(composed), ...importersOfNotices(added), ...reachedFrom(NOTICE_ENTRIES, added) };
};

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

test("a key named for accessibility is not exempt by its name", () => {
  const sources = noticeSources();
  sources["components/table/notices/tableLines.tsx"] += '\nexport const planted = (t: (k: string) => string) => t("game.newA11yLabel");\n';
  assert.deepEqual(unmeasured(sources), ['components/table/notices/tableLines.tsx: t("game.newA11yLabel") is not measured']);
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

test("words a table model computes and passes down to a notice are scanned too", () => {
  const labels = "components/table/spokenLabels.ts";
  assert.ok(labels in noticeSources(), "the scan does not reach the table's models");
  const planted = noticeSources({ [labels]: `${read(labels)}\nexport const comboNote = (t: (k: string) => string) => t("gameShared.comboNote");\n` });
  assert.deepEqual(unmeasured(planted), [`${labels}: t("gameShared.comboNote") is not measured`]);
});

test("a file that hands a notice its words as a prop is scanned, .tsx included", () => {
  const seats = "components/table/seats.tsx";
  const real = noticeSources();
  for (const file of [seats, "components/GameTable.tsx", "components/table/hand.tsx", "components/table/pile.tsx"]) assert.ok(file in real, `${file} imports a notice and is not scanned`);
  const mark = 'scale={scale} />}';
  assert.ok(read(seats).includes(`<PassedMark side={place === "top" ? "top" : "side"} disc={disc} ${mark}`), "the plant found no PassedMark");
  const planted = noticeSources({ [seats]: read(seats).replace(`disc={disc} ${mark}`, `disc={disc} label={t("game.passedShort")} ${mark}`) });
  assert.deepEqual(unmeasured(planted), [`${seats}: t("game.passedShort") is not measured`]);
});

test("a caller that reaches a notice through a re-export barrel is scanned", () => {
  const barrel = "components/table/noticeBarrel.ts";
  const caller = "components/table/barrelCaller.tsx";
  const planted = noticeSources({
    [barrel]: 'export * from "./notices/tableLines";\n',
    [caller]: 'import { TableLines } from "./noticeBarrel";\nexport const planted = (t: (k: string) => string) => t("game.viaBarrel");\n',
  });
  assert.ok(caller in planted, "the scan stopped at the barrel");
  assert.deepEqual(unmeasured(planted), [`${caller}: t("game.viaBarrel") is not measured`]);
});

test("a file that renders TableNotice directly, outside notices/, is scanned", () => {
  const caller = "components/table/directNotice.tsx";
  assert.ok("components/BenchScreen.tsx" in noticeSources(), "BenchScreen renders TableNotice and is not scanned");
  const planted = noticeSources({
    [caller]: 'import { TableNotice } from "./TableNotice";\nexport const planted = (t: (k: string) => string) => t("game.viaDirect");\n',
  });
  assert.deepEqual(unmeasured(planted), [`${caller}: t("game.viaDirect") is not measured`]);
});

test("a runtime-keyed call is pinned by its expression, so a swap fails", () => {
  const chips = "components/turnTimerUi.ts";
  const sameName = noticeSources({ "lib/cardNames.ts": read("lib/cardNames.ts").replace("return key ? t(key) : rank;", "return key ? t(key) : rank;\n}\nfunction elsewhere(t: (k: string) => string, key: string) {\n  return t(key);") });
  assert.deepEqual(unmeasured(sameName), ["lib/cardNames.ts: elsewhere: t(key) passes a key this scan cannot read"]);
  const swapped = noticeSources({ [chips]: read(chips).replace("i.t(key, { name: i.onMoveName })", "i.t(otherKey, { name: i.onMoveName })") });
  assert.deepEqual(unmeasured(swapped).sort(), [`${chips} is allowed say: i.t(key, { name: i.onMoveName }) and no longer makes it`, `${chips}: say: i.t(otherKey, { name: i.onMoveName }) passes a key this scan cannot read`].sort());
});

test("an excused file is excused for its listed keys only", () => {
  const board = "components/table/matchBoard.tsx";
  const planted = noticeSources({ [board]: `${read(board)}\nexport const voteLine = (t: (k: string) => string) => t("matchBoard.voteLine");\n` });
  assert.equal(unmeasured(planted).length, 1);
  assert.match(unmeasured(planted)[0]!, /t\("matchBoard.voteLine"\) is not measured, and components\/table\/matchBoard.tsx is excused only for/);
  const gone = noticeSources({ [board]: read(board).replace('t("matchBoard.wins"', 't("matchBoard.winsNow"') });
  assert.deepEqual(unmeasured(gone).sort(), [
    `${board} is excused for matchBoard.wins and no longer translates it`,
    `${board}: t("matchBoard.winsNow") is not measured, and ${board} is excused only for the match board's own words; its BoardButton is imported by the vote notices`,
  ].sort());
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

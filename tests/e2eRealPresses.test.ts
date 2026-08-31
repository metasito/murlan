// tests/e2eRealPresses.test.ts — a check asserts that the harness really
// performed the action, not that it was asked to.
//
// Here that is a duration. `locator.click()` puts the pointer down and up in
// the same frame, which no finger does, so it cannot tell a tap from a hold —
// and a card in the hand answers both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E = path.join(repoRoot, "tests", "e2e");

/**
 * The surfaces where a press has a duration that means something. The hand is
 * the one that answers both a tap and a hold; GIOCA and PASSA are here because
 * they are the thumb's other two targets on the same screen and a spec driving
 * a hand drives them in the same breath. A menu button is not here — nothing
 * about it changes with how long it is held, so a click on one is honest.
 */
const GESTURE_TESTIDS = ["card-box", "btn-gioca", "btn-passa"];

/**
 * A press that is deliberately instantaneous, with the reason. An entry is a
 * claim about one file, and the test below fails on one that no longer matches
 * anything — an allowance nobody needs is an allowance nobody has checked.
 */
const INSTANT_ON_PURPOSE: [string, string][] = [];

/**
 * Every file that can press something: the specs and the helpers they press
 * through. `helpers/bot.ts` is the suite's busiest presser of cards by a wide
 * margin, so a walk over `*.spec.ts` alone reads past almost every press there
 * is.
 */
function pressingFiles(): string[] {
  const helpers = path.join(E2E, "helpers");
  return [
    ...readdirSync(E2E)
      .filter((f) => f.endsWith(".spec.ts"))
      .map((f) => path.join(E2E, f)),
    ...readdirSync(helpers)
      .filter((f) => f.endsWith(".ts") && f !== "press.ts")
      .map((f) => path.join(helpers, f)),
  ];
}

/**
 * The names the suite reaches a gesture surface through, spelled out.
 *
 * A card carries no testID of its own — it is reached by what a screen reader
 * says of it, scoped by one of these selectors or named by a `…_SPOKEN`
 * constant. So a testID-only scan sees the action buttons and misses every
 * press on a card, which is the surface the rule was written for.
 *
 * Listed rather than resolved: following the constants transitively binds
 * `click` itself, because `bot.ts` wraps its presses in a local function of
 * that name — after which every `.click(` in the suite reads as a card.
 */
const GESTURE_SELECTORS = ["HAND_ZONE", "HAND_CARDS", "GIOCA_BTN", "giveCandidates", "cardByLabel"];

const idPattern = GESTURE_TESTIDS.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

const namesGestureSurface = (text: string): boolean =>
  new RegExp(String.raw`["'\`](?:${idPattern})`).test(text) ||
  new RegExp(String.raw`\b(?:${GESTURE_SELECTORS.join("|")}|\w*_SPOKEN)\b`).test(text);

/**
 * Names bound to a gesture surface in this file, so `const knob = …("btn-gioca")`
 * makes `knob.click()` a press on one. One hop, and only `const`/`let`: chasing
 * the names any further binds `click` itself, because `bot.ts` wraps its presses
 * in a local function of that name, after which every `.click(` in the suite
 * reads as a card.
 */
function gestureLocals(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*([^;]{0,400})/g)) {
    if (namesGestureSurface(m[2])) out.add(m[1]);
  }
  return out;
}

/** Every instantaneous press on a gesture surface, as `file:line`. */
function syntheticPresses(): string[] {
  const out: string[] = [];
  for (const file of pressingFiles()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const source = blankComments(readFileSync(file, "utf8"));
    const locals = gestureLocals(source);
    const localPattern =
      locals.size > 0 ? new RegExp(String.raw`\b(?:${[...locals].join("|")})\b`) : null;
    source.split(/\r?\n/).forEach((line, i) => {
      // `page.mouse.click()` presses for zero milliseconds at a coordinate and
      // names no target at all, so it can never be judged by what it presses.
      // Nothing in this suite has a use for one.
      if (/\bmouse\.click\(/.test(line)) {
        out.push(`${rel}:${i + 1}`);
        return;
      }
      if (!/\.(?:click|tap)\(/.test(line)) return;
      if (namesGestureSurface(line) || (localPattern?.test(line) ?? false)) {
        out.push(`${rel}:${i + 1}`);
      }
    });
  }
  return out;
}

test("a press on a gesture surface takes time", () => {
  const allowed = new Set(INSTANT_ON_PURPOSE.map(([file]) => file));
  const offenders = syntheticPresses().filter((at) => !allowed.has(at.split(":")[0]));
  assert.deepEqual(
    offenders,
    [],
    "these press a card or an action button with a zero-duration click, which is not a press: " +
      "the pointer goes down and up in the same frame, so nothing that reads how long a finger " +
      "stayed can tell them apart (#663). Use `tap`, `holdPast` or `tapPoint` from " +
      "tests/e2e/helpers/press.ts, or add the file to INSTANT_ON_PURPOSE with the reason:\n  " +
      offenders.join("\n  ")
  );
});

test("no allowance outlives the press it was written for", () => {
  const live = new Set(syntheticPresses().map((at) => at.split(":")[0]));
  const stale = INSTANT_ON_PURPOSE.filter(([file]) => !live.has(file)).map(([file]) => file);
  assert.deepEqual(stale, [], `no synthetic press left here, so drop the entry: ${stale.join(", ")}`);
});

// The floor. Every assertion above passes on a scan that reads nothing, so the
// predicates and the walk are what have to be proven.
test("the scan recognises a synthetic press and leaves an honest one alone", () => {
  assert.ok(namesGestureSurface('page.getByTestId("btn-gioca").click()'));
  assert.ok(namesGestureSurface('page.getByTestId("card-box-3").click()'), "the id is a prefix");
  assert.ok(!namesGestureSurface('page.getByRole("button", { name: "Impostazioni" }).click()'));

  assert.ok(namesGestureSurface("page.locator(`${HAND_ZONE} [aria-label=…]`)"), "a card");

  // The shapes the scan first read past: a card named by its spoken name, and
  // one reached through a selector built somewhere else.
  assert.ok(namesGestureSurface('getByRole("button", { name: FIVE_SPOKEN })'), "a spoken card");
  assert.ok(namesGestureSurface("giveCandidates(page).nth(i)"), "a card the bot presses");
});

// The other half of the floor: a name renamed out from under either list takes
// its presses out of the guard, and every assertion above still passes.
test("every gesture selector is still a name the suite uses", () => {
  const tree = pressingFiles()
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const gone = GESTURE_SELECTORS.filter((n) => !new RegExp(String.raw`\b${n}\b`).test(tree));
  assert.deepEqual(gone, [], `named here but nowhere in tests/e2e/: ${gone.join(", ")}`);
});

test("every gesture testID is one the app actually sets", () => {
  const source = ["app", "components"]
    .flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => readFileSync(path.join(repoRoot, dir, f), "utf8"))
    )
    .join("\n");
  const invented = GESTURE_TESTIDS.filter((id) => !source.includes(id));
  assert.deepEqual(invented, [], `no component sets these testIDs: ${invented.join(", ")}`);
});

/**
 * The hold threshold is written down twice — `hand.tsx` keeps its own copy
 * module-local, so the harness cannot import it. A drift makes every "held past
 * the threshold" press land short, and the specs go green on a hold that never
 * happened.
 */
test("the harness holds for at least as long as the app calls a hold", () => {
  const appSource = readFileSync(path.join(repoRoot, "components", "table", "hand.tsx"), "utf8");
  const app = /\bHOLD_MS\s*=\s*(\d+)/.exec(appSource);
  assert.ok(app, "components/table/hand.tsx no longer declares HOLD_MS");

  const pressSource = readFileSync(path.join(E2E, "helpers", "press.ts"), "utf8");
  const harness = /\bHOLD_MS\s*=\s*(\d+)/.exec(pressSource);
  assert.ok(harness, "tests/e2e/helpers/press.ts no longer declares HOLD_MS");

  assert.equal(
    Number(harness[1]),
    Number(app[1]),
    "the app's hold threshold and the harness's copy of it have drifted apart"
  );
});

test("the scan reads every spec and every helper, not a handful", () => {
  const files = pressingFiles().map((f) => path.basename(f));
  assert.ok(files.length > 30, `only ${files.length} file(s); the walk is not reaching tests/e2e/`);
  assert.ok(files.includes("bot.ts"), "the busiest presser in the suite is not being read");
});

// tests/e2eRealPresses.test.ts — a check asserts that the harness really
// performed the action, not that it was asked to.
//
// This is the browser suite's instance of that rule, and the instance is a
// duration: `locator.click()` puts the pointer down and up in the same frame,
// which no finger does. So a synthetic click cannot tell a tap from a hold, and
// on the surfaces where that difference decides what happens — the hand, the
// rail, the action buttons — it is not a press at all.
//
// #663 is the bill. The reorder hold fired at 500ms, inside the length of an
// ordinary thumb tap, and broke the tap that selects a card to play. "A plain
// tap still only selects" went on passing, because its tap was a `click()`.
//
// The rule is wider than this file. The same defect turned up the same day in
// the device harness, where Maestro reported COMPLETED for taps Expo Go's
// dev-menu window had swallowed (#627) — a different mechanism, the same shape:
// the harness reported an action it never performed, and the suite stayed green.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E = path.join(repoRoot, "tests", "e2e");

/**
 * The surfaces where a press has a duration that means something: a card can be
 * tapped to select or held to drag, and the action buttons and rail knobs sit
 * under the same thumb. A menu button is not here — nothing about it changes
 * with how long it is held, so a click on one is an honest click.
 */
const GESTURE_TESTIDS = [
  "card-box",
  "btn-gioca",
  "btn-passa",
  "rail-knob",
  "settings-knob",
];

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

/** Every instantaneous press on a gesture surface, as `file:line`. */
function syntheticPresses(): string[] {
  const out: string[] = [];
  for (const file of pressingFiles()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const lines = blankComments(readFileSync(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/\.(?:click|tap)\(/.test(line)) return;
      // The locator can sit on an earlier line than the `.click(` that presses
      // it, so the statement is what gets read, not the line.
      const stmt = lines.slice(Math.max(0, i - 4), i + 1).join(" ");
      if (namesGestureSurface(stmt)) out.push(`${rel}:${i + 1}`);
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
    "these press a card, an action button or a rail knob with a zero-duration click, which " +
      "is not a press: the pointer goes down and up in the same frame, so nothing that reads " +
      "how long a finger stayed can tell them apart (#663). Use `tap` or `holdPast` from " +
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

// The other half of the floor: a selector renamed out of the list takes its
// presses out of the guard, and every assertion above still passes.
test("every gesture selector is still a name the suite uses", () => {
  const tree = pressingFiles()
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const gone = GESTURE_SELECTORS.filter((n) => !new RegExp(String.raw`\b${n}\b`).test(tree));
  assert.deepEqual(gone, [], `named here but nowhere in tests/e2e/: ${gone.join(", ")}`);
});

test("the scan reads every spec and every helper, not a handful", () => {
  const files = pressingFiles().map((f) => path.basename(f));
  assert.ok(files.length > 30, `only ${files.length} file(s); the walk is not reaching tests/e2e/`);
  assert.ok(files.includes("bot.ts"), "the busiest presser in the suite is not being read");
});

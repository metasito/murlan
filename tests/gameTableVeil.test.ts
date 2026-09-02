import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments } from "./helpers/sourceScan.ts";

/**
 * #408 withdrew everything behind the settings sheet from the accessibility
 * tree, and its check asks what is left reachable rather than naming regions —
 * but it can only see what is on screen when it runs. A sibling rendered only
 * once a match is ending, or for the 2.6s after a refused GIOCA, is never on
 * screen for it.
 *
 * So the root's children are read from the source instead, where a conditional
 * one is as visible as a permanent one. The default is that a child must be
 * veiled; anything new fails here until someone says which of the reasons
 * below lets it stay reachable.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(repoRoot, "components", "GameTable.tsx");

/**
 * Why a root child may stay in the tree while the sheet is open. Each is a
 * property of the child rather than a promise about it, so a rename cannot
 * quietly move something onto this list.
 */
const REACHABLE_ON_PURPOSE: Record<string, string> = {
  GameSettingsSheet: "is the sheet",
  StartReasonBanner:
    "is the layer holding the table rather than something behind it — its own " +
    "words reach a reader through an A11yStatus sibling, and the gate itself is " +
    "a11yHidden",
  ExchangeAnnouncement: "is a pointer-transparent layer with nothing to reach",
  RotateOverlay: "replaces the table rather than sitting over it",
  Sweep: "is a decoration with nothing to reach",
};

/**
 * A child that answers to some of the reasons to veil and deliberately not all of them, with
 * the exact spelling that says which. This is the decision itself, not a note about it: the
 * table's own veil below would satisfy any looser check, and here it is the wrong answer.
 */
const VEILED_ON_ITS_OWN_TERMS: Record<string, { spelling: RegExp; why: string }> = {
  "game-hud-stack": {
    spelling: /\{\.\.\.clockVeil\}/,
    why:
      "carries the turn countdown, and answers to everything that takes the table away except " +
      "the opening gate — online that clock is the server's and keeps running under the hold, " +
      "so a reader losing it would be charged for time it could not hear",
  },
  ControlRail: {
    spelling: /veiled=\{behindCoverOnly\}/,
    why:
      "answers to a cover that paints over it and deliberately not to the settings sheet — " +
      "the sheet is closed by the knob this rail carries, so the table's own veil would shut " +
      "a screen reader inside the sheet with no way out",
  },
};

/** A child already withdrawn whatever the sheet is doing needs no veil. */
const ALWAYS_HIDDEN = /\{\.\.\.a11yHidden\(\)\}/;
/**
 * The veil, however it is spelled: spread onto a host view, passed down as a
 * prop, or handed to a slot whose caller decides which of its own layers is
 * behind it. Every alternative is an exact literal: matching a prefix would
 * accept `veiled={settingsOpen && focusMode}`, which is a narrowing of the
 * veil rather than a spelling of it.
 */
const VEILED =
  /\{\.\.\.behindVeil\}|veiled=\{behindVeil\}|veiled=\{tableWithdrawn\}|\(behindSheetOnly\)/;

export interface RootChild {
  name: string;
  line: number;
  source: string;
}

/** A child opens at eight spaces; the same depth closing one is that child's end. */
function isChildStart(line: string): boolean {
  return /^ {8}[<{]/.test(line) && !/^ {8}<\//.test(line);
}

/**
 * The direct children of the layer the game is rendered into, which the source
 * marks out by indentation: it opens at six spaces and its children at eight.
 *
 * That layer rather than the root: the root's other child is the felt, which
 * carries no control and never leaves the window (#101), and every reachable
 * thing on the table is inside the layer the landing displaces.
 *
 * Comments are blanked first — one naming `behindVeil` next to a child that
 * does not carry it would answer for that child.
 */
export function rootChildren(raw: string): RootChild[] {
  const lines = blankComments(raw).split("\n");
  const open = lines.findIndex((l) => /^ {6}<Animated\.View style=\{\[styles\.kick/.test(l));
  assert.ok(open >= 0, "GameTable's game layer is no longer where this test looks for it");
  const close = lines.findIndex((l, i) => i > open && /^ {6}<\/Animated\.View>/.test(l));
  assert.ok(close > open, "GameTable's game layer never closes");

  const children: RootChild[] = [];
  for (let i = open + 1; i < close; i++) {
    if (!isChildStart(lines[i])) continue;
    const next = lines.findIndex((l, j) => j > i && j < close && isChildStart(l));
    const stop = next === -1 ? close : next;
    const text = lines.slice(i, stop).join("\n");
    // Blanking a `{/* … */}` leaves its braces, which are not a child.
    if (/^[\s{}]*$/.test(text)) continue;
    children.push({
      // Its testID where it has one: two of the root's children are plain
      // `Animated.View`s, and a rule written against the tag name would answer
      // for whichever of them it reached first.
      name:
        /testID="([^"]+)"/.exec(text)?.[1] ??
        /<([A-Za-z][\w.]*)/.exec(text)?.[1] ??
        lines[i].trim(),
      line: i + 1,
      source: text,
    });
  }
  return children;
}

describe("every child of the game table's root answers to the veil", () => {
  const source = readFileSync(SOURCE, "utf8");
  const children = rootChildren(source);

  test("the root's children are found at all", () => {
    // Against a rewrite that changes the indentation this test reads: finding
    // nothing would otherwise pass every assertion below.
    assert.ok(children.length >= 10, `found ${children.length} children of the root`);
    assert.ok(
      children.some((c) => c.name === "GameSettingsSheet"),
      "the sheet itself was not among the root's children, so the scan is looking in the wrong place"
    );
  });

  test("the root holds exactly the felt and the layer the kick moves", () => {
    // #101's fix is that the felt never moves while the kick displaces
    // everything else. That only holds while the root has these two children
    // and no other: a third would ride neither rule, and whichever side of the
    // kick it landed on, the window it uncovered would show through again.
    // The scan above reads the kick layer's children, so nothing else here
    // would notice a new root child.
    const lines = blankComments(source).split("\n");
    const open = lines.findIndex((l) => /^ {4}<View style=\{\[styles\.root/.test(l));
    assert.ok(open >= 0, "GameTable's root is no longer where this test looks for it");
    const close = lines.findIndex((l, i) => i > open && /^ {4}<\/View>/.test(l));
    assert.ok(close > open, "GameTable's root never closes");

    const kids = lines
      .slice(open + 1, close)
      .filter((l) => /^ {6}</.test(l) && !/^ {6}<\//.test(l));

    assert.equal(
      kids.length,
      2,
      `the root has ${kids.length} direct children; #101 needs exactly two — the felt, ` +
        `which never moves, and the layer the kick displaces`
    );
    assert.ok(
      kids.some((l) => /styles\.kick/.test(l)),
      "the layer the kick moves is no longer a direct child of the root"
    );
    assert.ok(
      /^ {6}<View\b/.test(kids.find((l) => !/styles\.kick/.test(l)) ?? ""),
      "the root's other child is no longer a plain View, so the felt may now be animated"
    );
  });

  for (const child of children) {
    const reason = REACHABLE_ON_PURPOSE[child.name];
    const own = VEILED_ON_ITS_OWN_TERMS[child.name];
    test(`${child.name} (line ${child.line})`, () => {
      if (own) {
        assert.ok(
          own.spelling.test(child.source),
          `${child.name} ${own.why} — it no longer carries that veil`
        );
        assert.ok(
          !VEILED.test(child.source),
          `${child.name} carries the table's own veil, which reverses the decision above: it ${own.why}`
        );
        return;
      }
      if (reason) {
        assert.ok(
          !VEILED.test(child.source),
          `${child.name} ${reason}, yet it is veiled — one of the two is wrong`
        );
        return;
      }
      assert.ok(
        VEILED.test(child.source) || ALWAYS_HIDDEN.test(child.source),
        `${child.name} is reachable by a screen reader while a layer covers the table. ` +
          `Give it the veil, or say in REACHABLE_ON_PURPOSE why it may stay.`
      );
    });
  }
});

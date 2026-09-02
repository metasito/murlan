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

/** A child opens at six spaces; the same depth closing one is that child's end. */
function isChildStart(line: string): boolean {
  return /^ {6}[<{]/.test(line) && !/^ {6}<\//.test(line);
}

/**
 * The direct children of the root element, which the source marks out by
 * indentation: the root opens at four spaces and its children at six.
 *
 * Comments are blanked first — one naming `behindVeil` next to a child that
 * does not carry it would answer for that child.
 */
export function rootChildren(raw: string): RootChild[] {
  const lines = blankComments(raw).split("\n");
  const open = lines.findIndex((l) => /^ {4}<Animated\.View style=\{\[styles\.root/.test(l));
  assert.ok(open >= 0, "GameTable's root element is no longer where this test looks for it");
  const close = lines.findIndex((l, i) => i > open && /^ {4}<\/Animated\.View>/.test(l));
  assert.ok(close > open, "GameTable's root element never closes");

  const children: RootChild[] = [];
  for (let i = open + 1; i < close; i++) {
    if (!isChildStart(lines[i])) continue;
    const next = lines.findIndex((l, j) => j > i && j < close && isChildStart(l));
    const stop = next === -1 ? close : next;
    const text = lines.slice(i, stop).join("\n");
    // Blanking a `{/* … */}` leaves its braces, which are not a child.
    if (/^[\s{}]*$/.test(text)) continue;
    children.push({
      name: /<([A-Za-z][\w.]*)/.exec(text)?.[1] ?? lines[i].trim(),
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

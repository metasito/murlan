// tests/ui-rules/tableRects.test.ts — the table's rects, from `tableRects`, keep the rules in
// TABLE_RULES on every viewport, safe area, locale and state. Pure math over the solver; that the
// solver is where the browser draws things is tests/e2e/tableRects.spec.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ALL_CAPTURE_STATES } from "../../lib/captureStates.ts";
import { SUPPORTED_LOCALES } from "../../shared/i18n.ts";
import { brokenRules, intersects, RECT_NAMES, TABLE_RULES, tableRects, type TableState } from "../../components/tableRects.ts";
import type { EdgeInsets } from "../../components/tableFrame.ts";
import { capturedTable, comboScene, exchangeScenes, turnScenes } from "../helpers/tableScenes.ts";

const VIEWPORTS = [
  { name: "iPhone SE", width: 568, height: 320 },
  { name: "iPhone 12", width: 844, height: 390 },
  { name: "iPhone Pro Max", width: 956, height: 440 },
  { name: "4:3 tablet", width: 1024, height: 768 },
  { name: "iPad Pro", width: 1366, height: 1024 },
];

const INSETS: Record<string, EdgeInsets> = {
  none: { top: 0, bottom: 0, left: 0, right: 0 },
  "island and home bar": { top: 0, left: 62, bottom: 21, right: 62 },
  island: { top: 0, left: 62, bottom: 0, right: 0 },
  "status bar and notch": { top: 24, left: 47, right: 34, bottom: 0 },
};

const captured = () => ALL_CAPTURE_STATES.map((state) => ({ id: state.id, ...capturedTable(state) }));
const longest = (names: string[]) => names.reduce((a, b) => ([...b].length > [...a].length ? b : a));

const LONGEST_BOT = longest(captured().flatMap((s) => s.game.players.map((p) => p.name)));
const FULL = { top: { name: LONGEST_BOT, cards: 13 }, left: { name: LONGEST_BOT, cards: 13 }, right: { name: LONGEST_BOT, cards: 13 } };
const EXTREMES: { id: string; base: Omit<TableState, "chips"> }[] = [];
for (const hand of [0, 1, 13, 18])
  for (const pile of [0, 1, 5, 12, 13])
    EXTREMES.push({ id: `hand ${hand}, pile ${pile}`, base: { seats: FULL, hand: { cards: hand, onTurn: true, faceDown: false, raised: true }, pile } });
/** The exchange is announced over a fresh deal: every seat full, the pile empty. */
const DEALT: Omit<TableState, "chips"> = { seats: FULL, hand: { cards: 13, onTurn: true, faceDown: false, raised: true }, pile: 0 };

interface Case { label: string; width: number; height: number; insets: EdgeInsets; locale: (typeof SUPPORTED_LOCALES)[number]; state: TableState }

function* cases(): Generator<Case> {
  const states = captured();
  for (const vp of VIEWPORTS)
    for (const [inset, insets] of Object.entries(INSETS))
      for (const locale of SUPPORTED_LOCALES) {
        const at = `${vp.name} (${vp.width}x${vp.height}), ${inset}, ${locale}`;
        for (const s of states) {
          const name = longest(s.game.players.map((p) => p.name));
          for (const turn of turnScenes(name)) {
            const combo = comboScene(s.game.lastPlayedCombination, { you: false, name });
            yield { label: `${at}, ${s.id}, ${turn.name}`, ...vp, insets, locale, state: { ...s.base, chips: { combo, turn: turn.turn } } };
          }
        }
        const [onMove] = turnScenes(LONGEST_BOT).filter((t) => t.name.includes("turnOf"));
        for (const e of EXTREMES) {
          yield { label: `${at}, ${e.id}, ${onMove.name}`, ...vp, insets, locale, state: { ...e.base, chips: { combo: comboScene(null, { you: false, name: LONGEST_BOT }), turn: onMove.turn } } };
        }
        for (const scene of exchangeScenes(LONGEST_BOT)) {
          yield { label: `${at}, exchange ${scene.name}`, ...vp, insets, locale, state: { ...DEALT, chips: { combo: scene.combo, turn: scene.turn } } };
        }
      }
}

interface Known { defect: string; rules: readonly string[]; where: RegExp }

/**
 * What the table on main breaks, each found by this test and none fixed here: a break outside them
 * is red, and so is an entry nothing breaks any more, so the list only shrinks.
 */
const KNOWN: readonly Known[] = [
  {
    defect: "a side name's line runs onto the top back of its own fan once sideNameInset slides it inboard",
    rules: ["nameLeft overlaps fanLeft", "nameRight overlaps fanRight"],
    where: /^iPhone (SE|12|Pro Max) /,
  },
  {
    defect: "a straight of twelve or more on a tablet is laid across the side fans: fieldRoomW does not leave them room",
    rules: ["fanLeft overlaps pile", "fanRight overlaps pile"],
    where: /^(4:3 tablet|iPad Pro) .*, pile 1[23], /,
  },
  {
    defect: "the exchange's pills are wider than the chip row: nothing keeps the turn chip clear of its neighbours",
    rules: ["hudCombo overlaps hudTurn", "hudTurn overlaps scorePill"],
    where: /, exchange /,
  },
  {
    defect: "Albanian's bomb pill meets the turn chip on the smallest phone behind an island",
    rules: ["hudCombo overlaps hudTurn"],
    where: /^iPhone SE .*, island( and home bar)?, sq, bomb-landed, /,
  },
];

describe("the table keeps its rules", () => {
  test("the matrix covers what it says", () => {
    const all = [...cases()];
    assert.ok(all.length > 5000, `only ${all.length} cases`);
    assert.equal(new Set(all.map((c) => c.locale)).size, 3);
    assert.equal(new Set(all.map((c) => c.width)).size, 5);
    assert.ok(captured().length >= 13, "the capture list shrank");
    const seen = new Set<string>();
    for (const c of all.slice(0, 400)) for (const name of RECT_NAMES) if (tableRects(c).rects[name]) seen.add(name);
    assert.deepEqual([...seen].sort(), [...RECT_NAMES].sort());
  });

  test("on every viewport, safe area, locale and state", () => {
    const unknown: string[] = [];
    const seen = new Set<Known>();
    for (const c of cases()) {
      for (const rule of brokenRules(tableRects(c))) {
        const known = KNOWN.find((k) => k.rules.includes(rule) && k.where.test(c.label));
        if (known) seen.add(known);
        else unknown.push(`${c.label}: ${rule}`);
      }
    }
    assert.deepEqual(unknown.slice(0, 20), [], `${unknown.length} broken`);
    assert.deepEqual(KNOWN.filter((k) => !seen.has(k)).map((k) => k.defect), [], "fixed: delete its entry");
  });
});

describe("the rules see what they are for", () => {
  const tablet = { width: 1024, height: 768, insets: INSETS.none, locale: "it" as const };
  const state: TableState = {
    seats: FULL,
    hand: { cards: 13, onTurn: true, faceDown: false, raised: true },
    pile: 5,
    chips: { combo: [], turn: [] },
  };
  const solved = () => tableRects({ ...tablet, state });

  test("a clean table is clean, and every rule names rects that exist", () => {
    const t = solved();
    assert.deepEqual(brokenRules(t), []);
    for (const name of new Set([...TABLE_RULES.inside, ...TABLE_RULES.apart.flat()])) assert.ok(t.rects[name], name);
  });

  test("an overlap goes red", () => {
    const t = solved();
    const pile = t.rects.pile!;
    t.rects.hudTurn = { ...pile };
    assert.ok(intersects(t.rects.hudTurn, pile));
    assert.ok(brokenRules(t).includes("hudTurn overlaps pile"));
  });

  test("a rect off the window goes red", () => {
    const t = solved();
    t.rects.passa = { ...t.rects.passa!, x: -10 };
    assert.ok(brokenRules(t).includes("passa leaves the window"));
  });

  test("a hand that bleeds past its crop goes red", () => {
    const t = solved();
    const hand = t.rects.hand!;
    t.rects.hand = { ...hand, h: hand.h + 20 };
    assert.ok(brokenRules(t).includes("hand leaves the window"));
  });

  test("touching edges are not an overlap, a sliver is", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    assert.equal(intersects(a, { x: 10, y: 0, w: 10, h: 10 }), false);
    assert.equal(intersects(a, { x: 9.9, y: 0, w: 10, h: 10 }), true);
  });

  test("a chip too wide for its row is an overlap", () => {
    const wide = Array.from({ length: 4 }, () => ({ run: "text:exchange.pileGives", slots: ["w".repeat(30), "w".repeat(30), "w".repeat(30)] }));
    const t = tableRects({ ...tablet, state: { ...state, chips: { combo: wide, turn: [] } } });
    assert.ok(brokenRules(t).some((m) => m.startsWith("hudCombo overlaps")), brokenRules(t).join("; "));
  });
});

// tests/ui-rules/tableRects.test.ts — the table's rects, from `tableRects`, keep the rules in
// TABLE_RULES on every viewport, safe area, locale and state. Pure math over the solver; that the
// solver is where the browser draws things is tests/e2e/tableRects.spec.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ALL_CAPTURE_STATES } from "../../lib/captureStates.ts";
import { SUPPORTED_LOCALES } from "../../shared/i18n.ts";
import { USERNAME_MAX } from "../../shared/username.ts";
import { brokenRules, intersects, RECT_NAMES, TABLE_RULES, tableRects, type SeatBadgeState, type TableState } from "../../components/tableRects.ts";
import type { EdgeInsets } from "../../components/tableFrame.ts";
import { SEAT_BADGE_SLOT_W } from "../../components/seatLayout.ts";
import { noticeWidth } from "../../components/table/noticeWidth.ts";
import { TEXT_METRICS } from "../../components/table/textMetrics.generated.ts";
import type { NoticeContent } from "../../components/table/noticeWidth.ts";
import { PHONES } from "../e2e/helpers/phones.ts";
import { INSETS } from "../helpers/phoneTable.ts";
import { capturedTable, comboScene, exchangeScenes, TABLETS, turnScenes } from "../helpers/tableScenes.ts";

const VIEWPORTS = [...PHONES, ...TABLETS];

const captured = () => ALL_CAPTURE_STATES.map((state) => ({ id: state.id, ...capturedTable(state) }));
const longest = (names: string[]) => names.reduce((a, b) => ([...b].length > [...a].length ? b : a));

const LONGEST_BOT = longest(captured().flatMap((s) => s.game.players.map((p) => p.name)));
const FULL = { top: { name: LONGEST_BOT, cards: 13 }, left: { name: LONGEST_BOT, cards: 13 }, right: { name: LONGEST_BOT, cards: 13 } };
const EXTREMES: Omit<TableState, "chips">[] = [];
for (const hand of [0, 1, 13, 18])
  for (const pile of [0, 1, 5, 12, 13]) EXTREMES.push({ seats: FULL, hand: { cards: hand, onTurn: true, faceDown: false }, pile });
/** The widest name an account may take, on the move. */
const LONGEST_USERNAME = "W".repeat(USERNAME_MAX);
/** The exchange is announced over a fresh deal: every seat full, the pile empty. */
const DEALT: Omit<TableState, "chips"> = { seats: FULL, hand: { cards: 13, onTurn: true, faceDown: false }, pile: 0 };
/** Every online seat's badge, the countdown at its widest: the server's default grace is 60 seconds. */
const BADGES: readonly SeatBadgeState[] = [{ kind: "vacated" }, { kind: "reconnecting", seconds: 60 }];
const badgedSeats = (badge: SeatBadgeState): TableState["seats"] => ({ top: { ...FULL.top, badge }, left: { ...FULL.left, badge }, right: { ...FULL.right, badge } });

/** A pill's content as the keys and slots it reads, the opponent's name as `⟨name⟩`. */
const tagOf = (content: NoticeContent) =>
  content
    .map((p) => ("runs" in p ? p.runs.map((r) => `⟦${r.run.slice(r.run.indexOf(":") + 1)}⟧${(r.slots ?? []).map((v) => `⟨${v}⟩`).join("")}`).join("") : "runtime" in p ? "⟨name⟩" : ""))
    .join("");

/** The side chairs as the fans and names they draw: `cards name` from the left, the top, the right. */
const seatsOf = (seats: TableState["seats"]) =>
  (["left", "top", "right"] as const).map((dir) => (seats[dir] ? `${seats[dir].cards} ${seats[dir].name}` : "empty")).join(" / ");

interface Case { label: string; width: number; height: number; insets: EdgeInsets; locale: (typeof SUPPORTED_LOCALES)[number]; state: TableState }

function* cases(): Generator<Case> {
  const states = captured();
  for (const vp of VIEWPORTS)
    for (const [inset, insets] of Object.entries(INSETS))
      for (const locale of SUPPORTED_LOCALES) {
        const at = (scene: string, state: TableState): Case => ({
          label: `${vp.name} (${vp.width}x${vp.height}), ${inset}, ${locale}, ${scene}, seats ${seatsOf(state.seats)}, hand ${state.hand.cards}, pile ${state.pile}, combo ${tagOf(state.chips.combo)}, turn ${tagOf(state.chips.turn)}`,
          ...vp,
          insets,
          locale,
          state,
        });
        for (const s of states) {
          const name = longest(s.game.players.map((p) => p.name));
          const combo = comboScene(s.game.lastPlayedCombination, { you: false, name });
          for (const turn of turnScenes(name)) yield at(s.id, { ...s.base, chips: { combo, turn: turn.turn } });
        }
        const [onMove] = turnScenes(LONGEST_BOT).filter((t) => t.name.includes("turnOf"));
        const empty = comboScene(null, { you: false, name: LONGEST_BOT });
        for (const base of EXTREMES) yield at("extreme", { ...base, chips: { combo: empty, turn: onMove.turn } });
        const [onMoveLong] = turnScenes(LONGEST_USERNAME).filter((t) => t.name.includes("turnOf"));
        yield at("longest username", { ...DEALT, chips: { combo: empty, turn: onMoveLong.turn } });
        for (const scene of exchangeScenes(LONGEST_BOT)) yield at(`exchange ${scene.name}`, { ...DEALT, chips: { combo: scene.combo, turn: scene.turn, note: scene.note ?? undefined } });
        for (const badge of BADGES) yield at(`badged ${badge.kind}`, { ...DEALT, seats: badgedSeats(badge), chips: { combo: empty, turn: onMove.turn } });
      }
}

interface Known {
  defect: string;
  /** Where it is tracked: `#1988 item N`. */
  ticket: `#1988 item ${number}`;
  /** Each rule with the number of cases that break it today. */
  breaks: Readonly<Record<string, number>>;
  /** The cases it covers, each of which breaks one of its rules. */
  where: readonly RegExp[];
}

/** The cases on `viewport`, in `locale`, at `inset`, each a regex alternation, whose label goes on with `rest`. */
const on = (viewport: string, locale: string, inset: string, rest: string) =>
  new RegExp(`^(?:${viewport}) \\(\\d+x\\d+\\), (?:${inset}), (?:${locale}), ${rest}`);

/**
 * What the table on main breaks, each found by this test and none fixed here. A break outside an
 * entry is red; so is a case an entry covers that keeps all its rules, and a rule of an entry broken
 * more or fewer times than it says, so a fix has to narrow the entry and the list only shrinks.
 */
const KNOWN: readonly Known[] = [
  {
    defect: "the exchange's choice sentence is wider than the chip row on an iPhone SE: Italian's longest, or any of them between a notch's insets",
    ticket: "#1988 item 123",
    breaks: { "hudTurn cuts its words": 15 },
    where: [
      on("iPhone SE", "it", "0/0", "exchange give as watcher, choice,"),
      on("iPhone SE", "it", "62/21/62|62/0", "exchange give as (?:winner|loser|watcher), choice,"),
      on("iPhone SE", "en|sq", "62/21/62|62/0", "exchange give as (?:winner|watcher), choice,"),
    ],
  },
];

describe("the table keeps its rules", () => {
  test("the matrix covers what it says", () => {
    const all = [...cases()];
    assert.ok(all.length > 5000, `only ${all.length} cases`);
    assert.equal(new Set(all.map((c) => c.locale)).size, 3);
    assert.deepEqual(new Set(all.map((c) => `${c.width}x${c.height}`)), new Set(VIEWPORTS.map((v) => `${v.width}x${v.height}`)));
    assert.ok(captured().length >= 13, "the capture list shrank");
    const seen = new Set<string>();
    for (const c of all.slice(0, 400)) for (const name of RECT_NAMES) if (tableRects(c).rects[name]) seen.add(name);
    assert.deepEqual([...seen].sort(), [...RECT_NAMES].sort());
  });

  test("on every viewport, safe area, locale and state", () => {
    const unknown: string[] = [];
    const kept: string[] = [];
    const counted = new Map(KNOWN.map((k) => [k, Object.fromEntries(Object.keys(k.breaks).map((rule) => [rule, 0]))]));
    const used = new Set<RegExp>();
    for (const c of cases()) {
      const broken = brokenRules(tableRects(c));
      for (const k of KNOWN) {
        const where = k.where.find((w) => w.test(c.label));
        if (!where) continue;
        used.add(where);
        if (!broken.some((rule) => rule in k.breaks)) kept.push(`${k.ticket} ${where}: ${c.label}`);
      }
      for (const rule of broken) {
        const known = KNOWN.find((k) => rule in k.breaks && k.where.some((w) => w.test(c.label)));
        if (known) counted.get(known)![rule]++;
        else unknown.push(`${c.label}: ${rule}`);
      }
    }
    assert.deepEqual(unknown.slice(0, 20), [], `${unknown.length} broken`);
    assert.deepEqual(kept.slice(0, 20), [], `${kept.length} cases an entry covers keep its rules`);
    assert.deepEqual(KNOWN.flatMap((k) => k.where.filter((w) => !used.has(w)).map(String)), [], "an entry covers no case");
    for (const k of KNOWN) assert.deepEqual(counted.get(k), k.breaks, `${k.ticket}: ${k.defect}`);
  });
});

describe("the rules see what they are for", () => {
  const tablet = { width: TABLETS[0].width, height: TABLETS[0].height, insets: INSETS["0/0"], locale: "it" as const };
  const state: TableState = {
    seats: FULL,
    hand: { cards: 13, onTurn: true, faceDown: false },
    pile: 5,
    chips: { combo: [{ runs: [{ run: "text:gameShared.emptyTable" }] }], turn: [], note: [{ runs: [{ run: "text:exchange.pillNothing" }] }] },
  };
  const solved = () => tableRects({ ...tablet, state });

  test("a clean table is clean, and every rule names rects that exist", () => {
    const t = solved();
    const badged = tableRects({ ...tablet, state: { ...state, seats: badgedSeats(BADGES[0]) } });
    assert.deepEqual(brokenRules(t), []);
    for (const name of new Set([...TABLE_RULES.inside, ...TABLE_RULES.apart.flat()])) assert.ok(t.rects[name] ?? badged.rects[name], name);
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

  test("a chip too wide for its row is an overlap, and a note cut is named", () => {
    const sentence = { runs: [{ run: "text:exchange.pileGives", slots: ["w".repeat(30), "w".repeat(30), "w".repeat(30)] }] };
    const empty = { runs: [{ run: "text:gameShared.emptyTable" }] };
    const choice = { runs: [{ run: "text:exchange.watching", slots: ["w".repeat(30), "w".repeat(30)] }] };
    const long = turnScenes("w".repeat(30)).find((s) => s.name.includes("turnOf"))!.turn;
    const named = tableRects({ ...tablet, state: { ...state, chips: { combo: [], turn: long } } });
    assert.deepEqual(brokenRules(named), [], "a turn chip is held to its band whatever it holds");
    const cut = tableRects({ ...tablet, state: { ...state, chips: { combo: Array(40).fill(empty), turn: [] } } });
    assert.ok(brokenRules(cut).includes("hudCombo cuts its words"), brokenRules(cut).join("; "));
    const noteCut = tableRects({ ...tablet, state: { ...state, chips: { combo: [], turn: [], note: [sentence, sentence, sentence, sentence] } } });
    assert.ok(brokenRules(noteCut).includes("pileNote cuts its words"), brokenRules(noteCut).join("; "));
    const asked = tableRects({ ...tablet, state: { ...state, chips: { combo: [], turn: [{ dot: true }, choice, choice, { runtime: "strong" }] } } });
    assert.ok(brokenRules(asked).includes("hudTurn cuts its words"), brokenRules(asked).join("; "));
    const t = tableRects({ ...tablet, state: { ...state, chips: { combo: [], turn: long } } });
    const combo = t.rects.hudCombo ?? { x: 0, y: t.rects.hudTurn!.y, w: 0, h: t.rects.hudTurn!.h };
    t.rects.hudCombo = { ...combo, w: t.rects.hudTurn!.x + 1 - combo.x };
    assert.ok(brokenRules(t).some((m) => m.startsWith("hudCombo overlaps")), brokenRules(t).join("; "));
  });
});

describe("a seat's badge is drawn whole", () => {
  const cases = VIEWPORTS.flatMap((vp) => SUPPORTED_LOCALES.flatMap((locale) => BADGES.map((badge) => ({ vp, locale, badge }))));
  const solve = (c: (typeof cases)[number], seconds = 60) =>
    tableRects({ ...c.vp, insets: INSETS["0/0"], locale: c.locale, state: { ...DEALT, seats: badgedSeats(c.badge.kind === "reconnecting" ? { kind: "reconnecting", seconds } : c.badge), chips: { combo: [], turn: [] } } });

  test("its strip is wider than the widest badge, so no seat's is cut at a label's width", () => {
    for (const c of cases)
      for (const name of ["badgeTop", "badgeLeft", "badgeRight"] as const) {
        const t = solve(c);
        assert.ok(t.rects[name]!.w <= SEAT_BADGE_SLOT_W * t.layout.scale, `${c.vp.name}, ${c.locale}, ${c.badge.kind}: ${name} ${t.rects[name]!.w} wide`);
        assert.equal(t.capped[name], undefined, `${name} is held to a width`);
      }
  });

  test("a countdown is priced at its widest digits, since the face sets none tabular", () => {
    const face = TEXT_METRICS.faces.bold;
    assert.notEqual(new Set(Object.values(face.tabularDigits)).size, 1, "the face now sets tabular digits: price the digit, not the widest");
    for (const c of cases.filter((x) => x.badge.kind === "reconnecting")) {
      const at = (seconds: number) => solve(c, seconds);
      for (const digits of [[10, 60], [1, 9]])
        for (let seconds = digits[0]; seconds <= digits[1]; seconds++) {
          const [now, widest] = [at(seconds), at(digits[1])];
          assert.equal(now.rects.badgeTop!.w, widest.rects.badgeTop!.w, `${c.vp.name}, ${c.locale}: ${seconds} s is priced narrower than ${digits[1]} s`);
          const typed = noticeWidth("reconnecting", c.locale, now.layout.scale, [{ runs: [{ run: "text:gameTable.seatReconnecting", slots: [String(seconds)] }] }], "linear");
          assert.ok(Math.abs(now.rects.badgeTop!.w - now.overcount.badgeTop! - typed) < 1e-9, `${c.vp.name}, ${c.locale}: ${seconds} s overcount is not the words as typed`);
        }
    }
  });
});

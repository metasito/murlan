// tests/engine/turnSchedule.test.ts — who acts next, after which gates, and against which deadline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMove, buildCombination, createDeck, startRound, type GameState } from "../../lib/game/gameEngine.ts";
import { BOT_THINK_MS, turnSchedule, type Gate, type TableKind, type TurnAction } from "../../lib/game/turnSchedule.ts";
import { aThreePlayed } from "../support/game.ts";

const SEATS = [0, 1, 2, 3].map((i) => ({ name: `S${i}`, type: "human" as const, id: `player_${i}` }));

const dealt = (): GameState => startRound(SEATS, "free_for_all");

function exchangeDealt(loserHoldsBothJokers: boolean): GameState {
  const deck = createDeck();
  const jokers = deck.filter((c) => c.isJoker);
  const rest = loserHoldsBothJokers ? deck.filter((c) => !c.isJoker) : deck;
  const hands = SEATS.map((_, s) => rest.filter((_, i) => i % SEATS.length === s));
  if (loserHoldsBothJokers) hands[3].push(...jokers);
  return startRound(SEATS, "free_for_all", { opening: { kind: "exchange", winnerSeat: 0, loserSeat: 3 }, dealt: hands });
}

function played(): GameState {
  const s = dealt();
  const seat = (s.currentTurnIndex + 1) % SEATS.length;
  const trick = buildCombination([s.players[s.currentTurnIndex].hand[0]]);
  return { ...s, currentTurnIndex: seat, lastPlayedCombination: trick, lastPlayedBy: seat - 1, playedRanks: aThreePlayed(), lastMove: { seq: 1, kind: "play", seat: seat - 1 } };
}

function passedClosingTrick(): GameState {
  const s = played();
  return { ...s, lastPlayedCombination: null, lastMove: { seq: 2, kind: "pass", seat: 0, closedTrick: true } };
}

function passedInTrick(): GameState {
  const s = played();
  return { ...s, lastMove: { seq: 2, kind: "pass", seat: 0, closedTrick: false } };
}

function gaveBack(): GameState {
  const s = exchangeDealt(false);
  const phase = s.exchangePhase;
  assert.ok(phase?.kind === "open");
  const gave = applyMove(s, phase.winnerIdx, { kind: "giveback", cardId: s.players[phase.winnerIdx].hand[0].id });
  assert.ok(gave.ok);
  return gave.state;
}

interface Row {
  name: string;
  state: () => GameState;
  table: TableKind;
  bot: boolean;
  action: TurnAction;
  gates: Gate[];
  timed: boolean;
  think: boolean;
}

const row = (name: string, state: () => GameState, action: TurnAction, bot: Gate[], human: Gate[], offlineTimed: boolean, thinks = true): Row[] =>
  (["online", "offline"] as const).flatMap((table) => [
    { name, state, table, bot: true, action, gates: bot, timed: false, think: thinks },
    { name, state, table, bot: false, action, gates: human, timed: table === "online" || offlineTimed, think: false },
  ]);

const ROWS: Row[] = [
  ...row("deal, the opening card leads", dealt, "lead", ["deal"], ["opening"], false),
  ...row("play", played, "follow", [], [], true),
  ...row("pass closing the trick", passedClosingTrick, "lead", [], [], false),
  ...row("pass inside the trick", passedInTrick, "follow", [], [], true),
  ...row("giveback, the opener leads", gaveBack, "lead", ["ceremony"], ["opening"], false),
  ...row("deal into an open exchange, the winner gives", () => exchangeDealt(false), "give", ["deal", "receive"], [], false),
  ...row("deal holding both Jokers", () => exchangeDealt(true), "lead", ["deal", "ceremony"], ["opening"], false),
];

for (const r of ROWS) {
  test(`${r.name} — ${r.table}, ${r.bot ? "bot" : "human"}`, () => {
    const state = r.state();
    const slot = turnSchedule(state, r.table, () => r.bot);
    assert.ok(slot);
    const seat = state.exchangePhase?.kind === "open" ? state.exchangePhase.winnerIdx : state.currentTurnIndex;
    assert.deepEqual(
      { ...slot, gates: [...slot.gates] },
      { seat, bot: r.bot, action: r.action, gates: r.gates, timed: r.timed, thinkMs: r.think ? BOT_THINK_MS : 0 }
    );
  });
}

test("every lastMove kind has a row", () => {
  const kinds = new Set(ROWS.map((r) => r.state().lastMove.kind));
  assert.deepEqual([...kinds].sort(), ["deal", "giveback", "pass", "play"]);
});

test("both Jokers is the round that holds no exchange to give", () => {
  assert.equal(exchangeDealt(true).exchangePhase?.kind, "twoJokers");
});

test("a round that is over has nobody on move", () => {
  assert.equal(turnSchedule({ ...played(), roundOver: true }, "online", () => true), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { card as c, mulberry32, rng, seat, state as makeState } from "../support/game.ts";
import { givenBack, passed, played, playRoundOut, refusalOf } from "../support/moves.ts";
import { appendReplayMove } from "../../server/game/replayShape.ts";
import {
  applyMove,
  buildCombination,
  startRound,
  type Card,
  type GameState,
  type LastMove,
  type SeatSetup,
} from "../../lib/game/gameEngine.ts";
import { replayStateAt, type ReplayDto, type ReplayMove } from "../../lib/game/replay.ts";

const SEATS: SeatSetup[] = [0, 1, 2, 3].map((i) => ({ name: `p${i}`, type: "human" }));
const combo = (...cards: Card[]) => buildCombination(cards)!;
const exchangeDeal = () =>
  startRound(SEATS, "free_for_all", { random: rng(1).source, opening: { kind: "exchange", winnerSeat: 0, loserSeat: 3 } });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test("both openings record the deal as move 0", () => {
  assert.deepEqual(startRound(SEATS, "free_for_all").lastMove, { seq: 0, kind: "deal" });
  const exchange = exchangeDeal();
  assert.equal(exchange.exchangePhase?.kind, "open");
  assert.deepEqual(exchange.lastMove, { seq: 0, kind: "deal" });
});

test("a two-Joker deal records the deal and nothing else", () => {
  const deck = startRound(SEATS, "free_for_all").players.flatMap((p) => p.hand);
  const jokers = deck.filter((card) => card.isJoker);
  const rest = deck.filter((card) => !card.isJoker);
  const size = deck.length / 4;
  const dealt = [rest.slice(0, size), rest.slice(size, 2 * size), rest.slice(2 * size, 3 * size), [...jokers, ...rest.slice(3 * size)]];
  const state = startRound(SEATS, "free_for_all", { dealt, opening: { kind: "exchange", winnerSeat: 0, loserSeat: 3 } });
  assert.equal(state.exchangePhase?.kind, "twoJokers");
  assert.deepEqual(state.lastMove, { seq: 0, kind: "deal" });
});

test("the giveback is move 1, by the exchange winner", () => {
  const state = exchangeDeal();
  const winnerHand = state.players[0].hand;
  const offered = winnerHand.find((card) => ["3", "4", "5", "6", "7", "8", "9", "10"].includes(card.rank) && !(state.exchangePhase?.kind === "open" && card.id === state.exchangePhase.cardFromLoser.id))!;
  assert.deepEqual(givenBack(state, offered.id).lastMove, { seq: 1, kind: "giveback", seat: 0 });
});

const trick = (): GameState =>
  makeState({
    players: [
      seat(0, [c("5", "hearts"), c("9", "hearts")]),
      seat(1, [c("6", "hearts"), c("K", "clubs")]),
      seat(2, [c("7", "hearts"), c("Q", "clubs")]),
    ],
    currentTurnIndex: 0,
    lastPlayedBy: 0,
    openingCard: null,
    lastMove: { seq: 4, kind: "play", seat: 1 },
  });

test("a play, a pass that keeps the trick and the pass that closes it each count one", () => {
  const afterPlay = played(trick(), combo(c("5", "hearts")));
  assert.deepEqual(afterPlay.lastMove, { seq: 5, kind: "play", seat: 0 });
  const kept = passed(afterPlay);
  assert.deepEqual(kept.lastMove, { seq: 6, kind: "pass", seat: 2, closedTrick: false });
  const closed = passed(kept);
  assert.deepEqual(closed.lastMove, { seq: 7, kind: "pass", seat: 1, closedTrick: true });
  assert.equal(closed.lastPlayedBy, 0, "the trick's winner stays named");
});

test("the play that goes out is recorded like any other", () => {
  const state = makeState({
    players: [seat(0, [c("5", "hearts")]), seat(1, [c("6", "hearts")])],
    currentTurnIndex: 0,
    openingCard: null,
    lastMove: { seq: 2, kind: "pass", seat: 1, closedTrick: true },
  });
  const out = played(state, combo(c("5", "hearts")));
  assert.equal(out.roundOver, true);
  assert.deepEqual(out.lastMove, { seq: 3, kind: "play", seat: 0 });
});

test("a refused move leaves its input whole, its record included", () => {
  const leading = deepFreeze(trick());
  assert.equal(refusalOf(leading, { kind: "pass" }), "mustLead");
  assert.equal(refusalOf(leading, { kind: "play", cardIds: ["A_spades"] }), "notHeld");
  assert.deepEqual(leading.lastMove, { seq: 4, kind: "play", seat: 1 });

  const exchange = deepFreeze(
    exchangeDeal()
  );
  const offList = exchange.players[0].hand.find((card) => card.rank === "2" || card.isJoker || card.rank === "A");
  assert.ok(offList, "seed 1 deals the winner a card off the giveback list");
  assert.equal(refusalOf(exchange, { kind: "giveback", cardId: offList.id }), "notGiveable");
  assert.equal(applyMove(exchange, 1, { kind: "giveback", cardId: "3_hearts" }).ok, false);
  assert.deepEqual(exchange.lastMove, { seq: 0, kind: "deal" });
});

test("a replay records the move it stands on", () => {
  const replay: ReplayDto = {
    id: "r",
    finishedAt: "",
    gameMode: "free_for_all",
    seats: [0, 1, 2].map((i) => ({ seatIndex: i, userId: null, name: `p${i}` })),
    moves: [
      { seat: 0, combo: combo(c("5", "hearts")), handCounts: [1, 2, 2] },
      { seat: 2, combo: null, handCounts: [1, 2, 2] },
      { seat: 1, combo: null, handCounts: [1, 2, 2] },
    ],
    opening: null,
    finishingOrder: [],
  };
  const records: LastMove[] = [-1, 0, 1, 2].map((at) => replayStateAt(replay, at).lastMove);
  assert.deepEqual(records, [
    { seq: 0, kind: "deal" },
    { seq: 1, kind: "play", seat: 0 },
    { seq: 2, kind: "pass", seat: 2, closedTrick: false },
    { seq: 3, kind: "pass", seat: 1, closedTrick: true },
  ]);
});

for (const [name, start] of [
  ["an exchange round", exchangeDeal],
  ["a start-card round", () => startRound(SEATS, "free_for_all", { random: rng(3).source })],
] as const) {
  test(`${name} replays the record live play wrote, step by step`, () => {
    const live = playRoundOut(start(), mulberry32(7));
    const log: { moveLog: ReplayMove[] | null; replayOpening?: LastMove } = { moveLog: [] };
    live.slice(1).forEach((next, i) => {
      const move = next.lastMove;
      if (move.kind === "play" || move.kind === "pass") {
        appendReplayMove(log, move.seat, move.kind === "play" ? next.lastPlayedCombination : null, live[i], next);
      }
    });
    const replay: ReplayDto = {
      id: "r",
      finishedAt: "",
      gameMode: "free_for_all",
      seats: SEATS.map((s, i) => ({ seatIndex: i, userId: null, name: s.name })),
      moves: log.moveLog!,
      opening: log.replayOpening ?? null,
      finishingOrder: [],
    };
    const shown = live.slice(live.findIndex((s) => s.lastMove.kind === "play") - 1);
    assert.equal(shown.length, replay.moves.length + 1);
    assert.deepEqual(
      shown.map((_, i) => replayStateAt(replay, i - 1).lastMove),
      shown.map((s) => s.lastMove)
    );
  });
}

type HoldsCard<T> = T extends Card ? true : T extends object ? { [K in keyof T]-?: HoldsCard<T[K]> }[keyof T] : false;
const cardFree: HoldsCard<LastMove> extends false ? true : never = true;
const caught: HoldsCard<LastMove | { seq: number; kind: "play"; cards: Card[] }> extends false ? false : true = true;

test("LastMove holds no Card, and the check would see one", () => {
  assert.equal(cardFree, true);
  assert.equal(caught, true);
});

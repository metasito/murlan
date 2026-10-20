// Where a thrown card starts, from the seat that threw it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fanPoint } from "../../components/fanGeometry.ts";
import { arrangeOpponents } from "../../components/seatLayout.ts";
import { readThrownPlay } from "../../components/table/throws.ts";
import { tableLayout } from "../../components/tableLayout.ts";
import type { Card, Combination, Player } from "../../lib/game/gameEngine.ts";

describe("readThrownPlay", () => {
  const card = (id: string) =>
    ({ id, suit: "clubs", rank: "5", isJoker: false }) as Card;
  const seat = (id: string, cards: number) =>
    ({
      id,
      name: id,
      type: "bot",
      hand: Array.from({ length: cards }, (_, i) => card(`${id}_${i}`)),
    }) as unknown as Player;

  const PAIR = { type: "pair", cards: [card("x"), card("y")], strength: 5 } as Combination;
  const BOMB = { type: "bomb", cards: [card("b")], strength: 9 } as Combination;

  /** Four seats, the viewer at 0, everyone still holding cards. */
  const table = (thrower: number, throwerCards = 6) => {
    const players = [seat("me", 5), seat("right", 6), seat("top", 7), seat("left", 8)];
    players[thrower] = seat(["me", "right", "top", "left"][thrower]!, throwerCards);
    return players;
  };

  const layout = tableLayout({ width: 844, height: 390, insets: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 1 });
  const { frame } = layout;
  const read = (players: Player[], playedBy: number, combo = PAIR) =>
    readThrownPlay({ combo, playedBy }, layout, { viewerSeat: 0, players, opponents: arrangeOpponents(players, 0) });

  test("the cards are the combination's own, thrown from the seat that played it", () => {
    const thrown = read(table(2), 2);
    assert.deepEqual(thrown.cards, PAIR.cards);
    assert.equal(thrown.dir, "top");
  });

  test("every throw lands on the pile's one centre, midway between the table's edges", () => {
    const [right, left] = [read(table(1), 1).pile, read(table(3), 3).pile];
    assert.deepEqual(right, left);
    assert.equal(right.x, frame.tableLeft + (844 - frame.tableLeft - frame.tableRight) / 2);
    assert.ok(
      right.y > frame.tableTop && right.y < 390 - layout.handCardH,
      `pile centre ${right.y} outside the band between the top seat and the hand`
    );
  });

  test("a bomb and a royal straight land heavier than anything else", () => {
    assert.equal(read(table(2), 2, BOMB).heavy, true);
    assert.equal(
      read(table(2), 2, { type: "royal_straight", cards: [card("r")], strength: 9 } as Combination)
        .heavy,
      true
    );
    assert.equal(read(table(2), 2).heavy, false);
  });

  test("the going-out catch is owed only when the throw left the hand empty", () => {
    assert.equal(read(table(2, 0), 2).emptiedHand, true, "the thrower has nothing left");
    assert.equal(read(table(2, 1), 2).emptiedHand, false, "one card is not none");
  });

  const ringFromPile = (thrown: ReturnType<typeof read>, count: number) => {
    const fan = fanPoint({ dx: 0, dy: 0 }, thrown.dir as "top" | "left" | "right", 1, count);
    return { x: thrown.from[0]!.x - fan.x, y: thrown.from[0]!.y - fan.y };
  };
  const samePlace = (a: { x: number; y: number }, b: { x: number; y: number }, what: string) =>
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, `${what}: ${JSON.stringify(a)} is not ${JSON.stringify(b)}`);

  test("the top seat's ring does not move with that seat's own count", () => {
    const at = (count: number) => ringFromPile(read(table(2, count), 2), count);
    for (const count of [1, 2, 5, 13]) samePlace(at(count), at(0), `${count} cards`);
  });

  test("a side seat's ring does not move with that seat's own count", () => {
    for (const seat of [1, 3]) {
      const at = (count: number) => ringFromPile(read(table(seat, count), seat), count);
      for (const count of [1, 2, 4, 13]) samePlace(at(count), at(0), `seat ${seat}, ${count} cards`);
    }
  });

  test("the pile does not move with the top seat's count", () => {
    const pile = (topCards: number) => {
      const players = table(1);
      players[2] = seat("top", topCards);
      return read(players, 1).pile;
    };
    for (const count of [0, 1, 3, 13]) assert.deepEqual(pile(count), pile(7), `the top seat holding ${count}`);
  });

  test("each seat throws from its own side", () => {
    const players = table(1);
    const origins = [1, 2, 3].map((s) => ({
      dir: read(players, s).dir,
      dx: read(players, s).from[0]!.x,
    }));
    assert.deepEqual(
      origins.map((o) => o.dir),
      ["right", "top", "left"]
    );
    assert.ok(origins[0]!.dx > 0, "the right seat throws from the right");
    assert.ok(origins[2]!.dx < 0, "the left seat throws from the left");
    assert.equal(origins[1]!.dx, 0, "the top seat throws straight down the middle");
  });
});

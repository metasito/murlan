// What one opponent seat shows, derived once from the table for all three places.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { seatView, type SeatTable } from "../../components/table/seatView.ts";
import type { WirePlayer } from "../../shared/protocol.ts";

const wire = (handCount: number, vacated = false) => ({ id: "p", name: "Besi", handCount, vacated }) as unknown as WirePlayer;
const quiet: SeatTable = { onMoveSeat: null, passed: [], disconnectedSeats: {}, exchangeLit: [], exchangeShift: new Map() };

describe("seatView", () => {
  test("a quiet seat: its count, nothing lit, nothing marked", () => {
    assert.deepEqual(seatView(2, wire(7), quiet), {
      seat: 2,
      isActive: false,
      cardCount: 7,
      passed: false,
      vacated: false,
      reconnecting: undefined,
      marked: false,
    });
  });

  test("on move, passed, vacated and marked are each this seat's own", () => {
    const table: SeatTable = { ...quiet, onMoveSeat: 2, passed: [1, 2], exchangeLit: [2] };
    const view = seatView(2, wire(7, true), table);
    assert.equal(view.isActive, true);
    assert.equal(view.passed, true);
    assert.equal(view.vacated, true);
    assert.equal(view.marked, true);
    assert.equal(seatView(3, wire(7), table).isActive, false);
    assert.equal(seatView(3, wire(7), table).marked, false);
  });

  test("a card crossing in the exchange counts against the seat it left", () => {
    assert.equal(seatView(1, wire(13), { ...quiet, exchangeShift: new Map([[1, -1]]) }).cardCount, 12);
  });

  test("the reconnect countdown is the table's own object, so the memoized seat keeps its props", () => {
    const countdown = { seconds: 30, resetKey: "k" };
    assert.equal(seatView(1, wire(5), { ...quiet, disconnectedSeats: { 1: countdown } }).reconnecting, countdown);
  });
});

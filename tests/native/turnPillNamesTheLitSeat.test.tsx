import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { act, render, within } from "@testing-library/react-native";
import type { RenderResult } from "@testing-library/react-native";
import type { Combination } from "@/lib/game/gameEngine";
import { bootFeedback } from "./helpers/feedback";
import { card, PAIR, tableAfter } from "./helpers/landing";

const SINGLE: Combination = { type: "single", cards: [card("c", "4", "hearts")], strength: 4 };
const SEATS = ["side-seat-left", "top-seat", "side-seat-right"];

const litSeats = (view: RenderResult) =>
  SEATS.filter(
    (seat) => within(view.getByTestId(seat)).getByTestId("seat-ring").props.dataSet?.seatLit === "true"
  ).map((seat) => String(within(view.getByTestId(seat)).getByTestId("seat-name").props.children));

const pill = (view: RenderResult) =>
  within(view.getByTestId("game-hud-stack")).getByText(/'s turn$/, { includeHiddenElements: true }).props.children;

describe("the turn pill", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("names the seat whose ring is lit on every frame of a bot's hand-off", async () => {
    const view = await render(tableAfter({ by: 3, combo: PAIR, turn: 1 }));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(litSeats(view)).toEqual(["P1"]);
    await act(async () => view.rerender(tableAfter({ by: 1, combo: SINGLE, turn: 2 })));

    const seen: string[] = [];
    let handOff = -1;
    for (let f = 0; f < 120 && (handOff < 0 || performance.now() < handOff + 250); f++) {
      const [lit] = litSeats(view);
      seen.push(lit);
      expect([litSeats(view), pill(view)]).toEqual([[lit], `${lit}'s turn`]);
      if (handOff < 0 && lit === "P2") handOff = performance.now();
      await act(async () => {
        jest.advanceTimersByTime(16);
      });
    }
    expect([seen[0], seen.at(-1)]).toEqual(["P1", "P2"]);
    expect([litSeats(view), pill(view)]).toEqual([["P2"], "P2's turn"]);
    await view.unmount();
  });

  it("starts the viewer's clock when the pill turns to them, not when the state does", async () => {
    const view = await render(tableAfter({ by: 2, combo: PAIR, turn: 3, turnSeconds: 30 }));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => view.rerender(tableAfter({ by: 3, combo: SINGLE, turn: 0, turnSeconds: 30 })));
    const counting = () => view.queryByTestId("turn-chip-count", { includeHiddenElements: true }) !== null;
    expect([pill(view), counting()]).toEqual(["P3's turn", false]);
    for (let f = 0; f < 120 && litSeats(view).length > 0; f++) {
      expect([pill(view), counting()]).toEqual(["P3's turn", false]);
      await act(async () => {
        jest.advanceTimersByTime(16);
      });
    }
    expect(litSeats(view)).toEqual([]);
    expect(counting()).toBe(true);
    await view.unmount();
  });
});

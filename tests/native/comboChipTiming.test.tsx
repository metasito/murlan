// tests/native/comboChipTiming.test.tsx — the combination chip names the play
// from the moment it lands, not from the end of the settle spring (#828). The
// chip reads `comboLabel` alone, so it may run ahead of cards still in the air.
import { describe, it, expect } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import type { Card, Combination } from "@/lib/game/gameEngine";
import { flightOf, pileOf } from "./helpers/landing";

const CARD: Card = { id: "3_clubs", suit: "clubs", rank: "3", isJoker: false };
const COMBO: Combination = { type: "single", cards: [CARD], strength: 3 };
const PLAY = flightOf("k", [CARD], [{ x: 0, y: 160, rot: 0, scale: 1.4 }]);

describe("the combo chip can show before the cards do (#828)", () => {
  it("names the play while its cards are still in the air", async () => {
    const r = await render(pileOf({ plays: [PLAY], flights: [PLAY], comboLabel: COMBO }));

    expect(screen.getByText("Single")).toBeTruthy();

    await r.unmount();
  });

  it("says nothing when no combination is named, even with the cards at rest", async () => {
    const r = await render(pileOf({ plays: [PLAY] }));

    expect(screen.queryByText("Single")).toBeNull();

    await r.unmount();
  });

  it("names the play with its cards at rest", async () => {
    const r = await render(pileOf({ plays: [PLAY], comboLabel: COMBO }));

    expect(screen.getByText("Single")).toBeTruthy();

    await r.unmount();
  });
});

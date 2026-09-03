// tests/native/comboChipTiming.test.tsx — the combination chip names the play
// from the moment it lands, not from the end of the settle spring, while the
// cards themselves stay off the felt until the flight's own `flyInfo` gate
// clears (#828). `current` and `comboLabel` are deliberately two separate
// props: `current` protects the once-only card render, `comboLabel` may run
// ahead of it.
import { describe, it, expect } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { PlayedPile } from "@/components/table/pile";
import type { Card, Combination } from "@/lib/gameEngine";

const CARD: Card = { id: "3_clubs", suit: "clubs", rank: "3", isJoker: false };
const COMBO: Combination = { type: "single", cards: [CARD], strength: 3 };

describe("the combo chip can show before the cards do (#828)", () => {
  it("names the play while `current` is still null — the mid-flight case", async () => {
    const r = await render(
      <PlayedPile
        prev={null}
        current={null}
        comboLabel={COMBO}
        roundWinner={null}
        roomW={400}
        scale={1}
      />
    );

    expect(screen.getByText("Single")).toBeTruthy();

    await r.unmount();
  });

  it("says nothing when neither prop names a combination", async () => {
    const r = await render(
      <PlayedPile prev={null} current={null} roundWinner={null} roomW={400} scale={1} />
    );

    expect(screen.queryByText("Single")).toBeNull();

    await r.unmount();
  });

  it("still names the play from `current` alone, with no flight up", async () => {
    const r = await render(
      <PlayedPile prev={null} current={COMBO} roundWinner={null} roomW={400} scale={1} />
    );

    expect(screen.getByText("Single")).toBeTruthy();

    await r.unmount();
  });
});

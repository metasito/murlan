// tests/native/cardHitBox.test.tsx — a hand card is tapped on its strip, and
// on nothing else.
//
// The card's ink is wider than the strip and overflows it. Left alone the two
// platforms settle that overflow differently — the web hit-tests it and lets
// paint order pick a winner, UIKit does not hit-test outside a view's bounds —
// so which card a tap belongs to would be a property of the renderer.
import { describe, it, expect } from "@jest/globals";
import { render } from "@testing-library/react-native";

import { CardView } from "@/components/CardView";
import type { Card } from "@/lib/gameEngine";

const CARD = { id: "3_spades", rank: "3", suit: "spades" } as Card;

describe("a card's hit box", () => {
  it("is the pressable's strip, not the card's own width", async () => {
    const view = await render(<CardView card={CARD} onPress={() => {}} hitWidth={40} />);

    const box = view.getByTestId("card-box");
    expect(box.props.pointerEvents).toBe("none");
    expect(box.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: expect.any(Number) })])
    );

    await view.unmount();
  });

  it("takes no hits even when the two boxes are the same size", async () => {
    // Everywhere but a hand — a pile, a picker — `hitWidth` is absent and the
    // boxes coincide. The rule is the same one either way.
    const view = await render(<CardView card={CARD} onPress={() => {}} />);
    expect(view.getByTestId("card-box").props.pointerEvents).toBe("none");
    await view.unmount();
  });
});

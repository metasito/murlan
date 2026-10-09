// tests/native/cardEdgeAntialiasing.test.tsx — every view drawing a card's outline asks iOS to
// antialias its edges; ios.yml's edgePixels step is the pixel proof (#1402).
import { describe, it, expect } from "@jest/globals";
import { Platform, StyleSheet, type ViewStyle } from "react-native";
import { render } from "@testing-library/react-native";

import { CardView } from "@/components/CardView";
import type { Card } from "@/lib/game/gameEngine";

const CARD = { id: "3_spades", rank: "3", suit: "spades" } as Card;

type Node = { type: string; props?: { style?: unknown }; children?: unknown };

const views = (node: unknown): ViewStyle[] => {
  if (Array.isArray(node)) return node.flatMap(views);
  if (!node || typeof node !== "object") return [];
  const { type, props, children } = node as Node;
  const own = type === "View" ? [StyleSheet.flatten(props?.style as ViewStyle) ?? {}] : [];
  return [...own, ...views(children)];
};

async function outlines(faceDown: boolean) {
  const view = await render(<CardView card={CARD} faceDown={faceDown} />);
  const box = StyleSheet.flatten(view.getByTestId(faceDown ? "card-box-back" : "card-box").props.style);
  const sized = views(view.toJSON()).filter(
    (s) => s.width === box.width && s.height === box.height && (s.backgroundColor ?? s.borderWidth) !== undefined
  );
  await view.unmount();
  return sized;
}

describe("a card's outline layers", () => {
  it.each([false, true])("carry a perspective on iOS only (face down: %s)", async (faceDown) => {
    const sized = await outlines(faceDown);
    expect(sized.length).toBeGreaterThanOrEqual(faceDown ? 1 : 2);
    for (const style of sized)
      expect(style.transform).toEqual(Platform.OS === "ios" ? [{ perspective: expect.any(Number) }] : undefined);
  });
});

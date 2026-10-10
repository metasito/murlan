// tests/native/cardBackHostViews.test.tsx — a face-down card is a baked image, not a drawing
// (#1418): it builds fewer host views than the SVG back did.
import { describe, it, expect } from "@jest/globals";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";

import { CardView } from "@/components/CardView";
import type { Card } from "@/lib/game/gameEngine";

const CARD = { id: "3_spades", rank: "3", suit: "spades" } as Card;
const SVG_BACK_HOST_VIEWS = Platform.select({ ios: 9, default: 10 });

type Node = { type: string; children?: unknown };

const hosts = (node: unknown): Node[] => {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!node || typeof node !== "object") return [];
  const n = node as Node;
  return [n, ...hosts(n.children)];
};

describe("a face-down card", () => {
  it("builds fewer host views than the SVG back", async () => {
    const view = await render(<CardView card={CARD} faceDown />);
    const count = hosts(view.toJSON()).length;
    await view.unmount();
    expect(count).toBeLessThan(SVG_BACK_HOST_VIEWS);
  });
});

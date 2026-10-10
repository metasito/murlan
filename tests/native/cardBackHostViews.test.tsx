// tests/native/cardBackHostViews.test.tsx — a face-down card is a baked image, not a drawing
// (#1418): it builds fewer host views than the SVG back did.
import { describe, it, expect } from "@jest/globals";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";

import { CardView } from "@/components/CardView";
import type { Card } from "@/lib/game/gameEngine";
import { CARD_BACK_IDS } from "@/lib/cosmetics";

const CARD = { id: "3_spades", rank: "3", suit: "spades" } as Card;
const SVG_BACK_HOST_VIEWS = Platform.select({ ios: 9, default: 10 });

type Node = { type: string; props?: Record<string, unknown>; children?: unknown };

const hosts = (node: unknown): Node[] => {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!node || typeof node !== "object") return [];
  const n = node as Node;
  return [n, ...hosts(n.children)];
};

const imagesIn = (tree: unknown, testID: string): unknown[] => {
  const box = hosts(tree).find((n) => n.props?.testID === testID);
  return hosts(box?.children)
    .filter((n) => n.type === "Image")
    .map((n) => (n.props?.source as { testUri?: string } | undefined)?.testUri);
};

describe("a face-down card", () => {
  it("builds fewer host views than the SVG back", async () => {
    const view = await render(<CardView card={CARD} faceDown />);
    const count = hosts(view.toJSON()).length;
    await view.unmount();
    expect(count).toBeLessThan(SVG_BACK_HOST_VIEWS);
  });

  it.each(CARD_BACK_IDS)("draws the %s back's own art", async (id) => {
    const view = await render(<CardView card={CARD} faceDown backId={id} />);
    expect(imagesIn(view.toJSON(), "card-box-back")).toEqual([expect.stringMatching(new RegExp(`back_${id}\\.webp$`))]);
    await view.unmount();
  });
});

describe("a face-up card", () => {
  it("is laid on the baked stock", async () => {
    const view = await render(<CardView card={CARD} />);
    expect(imagesIn(view.toJSON(), "card-box")).toContainEqual(expect.stringMatching(/stock\.webp$/));
    await view.unmount();
  });
});

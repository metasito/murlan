import { describe, it, expect } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { pileOf } from "./helpers/landing";

async function tagHeightAt(scale: number) {
  const r = await render(pileOf({ trickWinner: "Ana", scale }));
  const style = StyleSheet.flatten(screen.getByTestId("notice-trickWinner").props.style) as { height?: number };
  await r.unmount();
  return style.height!;
}

describe("the trick-winner tag is drawn at the table's scale", () => {
  it("is 1.6 times as tall at scale 1.6 as at scale 1", async () => {
    expect(await tagHeightAt(1.6)).toBeCloseTo((await tagHeightAt(1)) * 1.6, 5);
  });
});

// tests/native/cardArtWarm.test.tsx — the court, back, stock and gloss bitmaps are fetched
// once, from the table's own mount, rather than on each card's first render
// (#838). `warmCardArt` is exported from CardView.tsx because it is the only
// module that knows the keys — this pins that the warm-up actually reaches all
// of them, without keeping a second list of filenames here.
import { describe, it, expect, jest } from "@jest/globals";

import { CARD_BACK_IDS } from "@/lib/cosmetics";

const COURT_FIGURES = 12;
const STOCK = 1;
const GLOSS_SPOT = 1;

describe("warmCardArt", () => {
  it("fetches every court figure, every back, the stock and the gloss spot, once per session", () => {
    const loadAsync = jest.fn((_modules: unknown[]) => Promise.resolve([]));
    let warm!: () => void;
    jest.isolateModules(() => {
      jest.doMock("expo-asset", () => ({ Asset: { loadAsync } }));
      ({ warmCardArt: warm } = require("@/components/CardView"));
    });

    warm();
    warm();

    expect(loadAsync).toHaveBeenCalledTimes(1);
    const [modules] = loadAsync.mock.calls[0];
    expect(new Set(modules).size).toBe(COURT_FIGURES + CARD_BACK_IDS.length + STOCK + GLOSS_SPOT);
  });

  it("swallows a rejected load instead of throwing into the table", async () => {
    const loadAsync = jest.fn(() => Promise.reject(new Error("offline")));
    let warm!: () => void;
    jest.isolateModules(() => {
      jest.doMock("expo-asset", () => ({ Asset: { loadAsync } }));
      ({ warmCardArt: warm } = require("@/components/CardView"));
    });

    expect(() => warm()).not.toThrow();
    // Let the rejection settle so it does not surface as an unhandled one.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

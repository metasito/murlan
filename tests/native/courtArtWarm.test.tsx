// tests/native/courtArtWarm.test.tsx — the twelve court bitmaps are fetched
// once, from the table's own mount, rather than on each card's first render
// (#838). `warmCourtArt` is exported from CardView.tsx because it is the only
// module that knows the twelve keys — this pins that the warm-up actually
// reaches all of them, without keeping a second list of filenames here.
import { describe, it, expect, jest } from "@jest/globals";

describe("warmCourtArt", () => {
  it("fetches all twelve court bitmaps, once per session", () => {
    const loadAsync = jest.fn((_modules: unknown[]) => Promise.resolve([]));
    let warm!: () => void;
    jest.isolateModules(() => {
      jest.doMock("expo-asset", () => ({ Asset: { loadAsync } }));
      ({ warmCourtArt: warm } = require("@/components/CardView"));
    });

    warm();
    warm();

    expect(loadAsync).toHaveBeenCalledTimes(1);
    const [modules] = loadAsync.mock.calls[0];
    expect(modules).toHaveLength(12);
  });

  it("swallows a rejected load instead of throwing into the table", async () => {
    const loadAsync = jest.fn(() => Promise.reject(new Error("offline")));
    let warm!: () => void;
    jest.isolateModules(() => {
      jest.doMock("expo-asset", () => ({ Asset: { loadAsync } }));
      ({ warmCourtArt: warm } = require("@/components/CardView"));
    });

    expect(() => warm()).not.toThrow();
    // Let the rejection settle so it does not surface as an unhandled one.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

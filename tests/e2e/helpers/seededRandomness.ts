import type { Page } from "@playwright/test";
import { mulberry32 } from "../../support/game.ts";

/**
 * Every deal and every bot choice in the page from one `mulberry32(seed)` stream, so a spec that
 * plays a round plays the same round on every run. A match simulated in Node passes `rng(seed).source`
 * to the deal instead (tests/helpers/offlineMatch.ts). Must run before the first navigation.
 */
export async function seedRandomness(page: Page, seed: number): Promise<void> {
  const install = (generator: typeof mulberry32, seed: number) => {
    const next = generator(seed);
    Math.random = next;
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: <T extends ArrayBufferView>(buf: T): T => {
        const view = buf as unknown as { length: number; BYTES_PER_ELEMENT: number; [i: number]: number };
        for (let i = 0; i < view.length; i++) view[i] = Math.floor(next() * 2 ** (8 * view.BYTES_PER_ELEMENT));
        return buf;
      },
    });
  };
  await page.addInitScript({ content: `(${String(install)})(${String(mulberry32)}, ${seed});` });
}

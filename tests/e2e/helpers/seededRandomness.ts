import type { Page } from "@playwright/test";

/**
 * Every deal and every bot choice in the page from one `mulberry32(seed)` stream, so a spec that
 * plays a hand plays the same hand on every run. `withSeededDeals` (tests/helpers/offlineMatch.ts)
 * is the same swap for a match simulated in Node. Must run before the first navigation.
 */
export async function seedRandomness(page: Page, seed: number): Promise<void> {
  await page.addInitScript((seed) => {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    Math.random = next;
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: <T extends ArrayBufferView>(buf: T): T => {
        const view = buf as unknown as { length: number; BYTES_PER_ELEMENT: number; [i: number]: number };
        for (let i = 0; i < view.length; i++) view[i] = Math.floor(next() * 2 ** (8 * view.BYTES_PER_ELEMENT));
        return buf;
      },
    });
  }, seed);
}

// The handsets the layout suite runs on, in one place.
//
// Free of any `@playwright/test` import on purpose: `tests/handTurnScale.test.ts`
// checks the same geometry under `node --test`, and two copies of this list are
// two things to remember when the next handset arrives.

/** Landscape logical sizes, smallest and largest phone the app supports. */
export const PHONES = [
  { name: "iPhone SE", width: 568, height: 320 },
  { name: "iPhone 12", width: 844, height: 390 },
  { name: "iPhone 16 Pro", width: 874, height: 402 },
  { name: "iPhone 17 Pro Max", width: 956, height: 440 },
] as const;

export type Phone = (typeof PHONES)[number];

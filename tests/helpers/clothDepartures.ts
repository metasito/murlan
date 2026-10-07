// Free of `import.meta`, unlike lanternFixture.ts, so Playwright's CommonJS transform can load it.

/** The mockup's `FS` lines the app departs from, and the app's (plan 3 Task 8, the owner's G1 answers). */
export const CLOTH_DEPARTURES: readonly (readonly [mockup: string, app: string])[] = [
  ["t=clamp(d/(420.+uFlare*120.),0.,1.);", "t=clamp(d/(uPoolR+uFlare*120.),0.,1.);"],
  ["col*=1.-.72*smoothstep(160.,540.,length(p-vec2(457.,210.)));", "col*=1.-.45*smoothstep(uVigR*16./54.,uVigR,length(p-uLamp));"],
];

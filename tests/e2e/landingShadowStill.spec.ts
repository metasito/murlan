// tests/e2e/landingShadowStill.spec.ts — a landed card's shadow holds still through its wobble, so
// the felt rebuilds no shadow cluster holding it from contact to contact + LAND_WOBBLE_MS (#1414),
// while the card itself still wobbles. With motion on: reduced motion has no wobble to hold.
import { test, expect } from "./fixtures";
import { heldTurnTable, newSidePage, playLowest } from "./helpers/mockupParity";
import { stepThen, stepUntil } from "./helpers/virtualClock";
import { STEP_MS } from "./helpers/traceDiff";
import { LAND_WOBBLE_MS } from "../../components/flightPhysics";

type ThrowFrame = {
  t: number;
  cards: { key: string; tx: number; ty: number; scale: number }[];
  wobble: { scale: number; rot: number } | null;
  clusters: Record<string, number>;
  builds: number;
};

const THROW_FRAME = `(() => {
  const m = (el) => {
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return { a: 1, b: 0, e: 0, f: 0 };
    const [a, b, , , e, f] = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
    return { a, b, e, f };
  };
  const cards = [...document.querySelectorAll('[data-testid="flying-card"]')].map((el) => {
    const { a, b, e, f } = m(el);
    return { key: el.id.replace(/^card-/, ""), tx: e, ty: f, scale: Math.hypot(a, b) };
  });
  const group = document.querySelector('[data-testid="flying-cards"]');
  const w = group && m(group);
  return {
    t: performance.now(),
    cards,
    wobble: w && { scale: Math.hypot(w.a, w.b), rot: (Math.atan2(w.b, w.a) * 180) / Math.PI },
    clusters: { ...(globalThis.murlanShadowClusterBuilds ?? {}) },
    builds: globalThis.murlanShadowBuilds ?? 0,
  };
})()`;

const FLIGHT_FRAMES = 300;

test("a thrown card's shadow holds still through its landing wobble, while the card wobbles", async ({ browser, baseURL }, info) => {
  test.setTimeout(3 * 60_000);
  const page = await newSidePage(browser, baseURL);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await heldTurnTable(page, baseURL!);
  await stepUntil(page, () => page.evaluate(() => ((globalThis as { murlanShadowBuilds?: number }).murlanShadowBuilds ?? 0) > 0), "the Skia felt's shadows");
  await stepUntil(page, () => page.locator('[data-hand-state] [data-testid="card-box"]').first().isVisible(), "the viewer's hand");
  await playLowest(1)(page);

  const frames: ThrowFrame[] = [];
  for (let i = 0; i < FLIGHT_FRAMES; i++) {
    const f = await stepThen<ThrowFrame>(page, STEP_MS, THROW_FRAME);
    frames.push(f);
    if (frames.some((g) => g.cards.length > 0) && f.cards.length === 0) break;
  }
  const thrown = frames.find((f) => f.cards.length > 0)?.cards.map((c) => c.key) ?? [];
  expect(thrown, "one card thrown").toHaveLength(1);
  // `contactMs`'s own test, read off each flying card's transform.
  const touching = (f: ThrowFrame) => f.cards.length > 0 && f.cards.every((c) => Math.hypot(c.tx, c.ty) <= 1 && Math.abs(c.scale - 1) <= 0.01);
  const contact = frames.findIndex(touching);
  expect(contact, "the throw reached its contact").toBeGreaterThan(0);
  const landing = frames.filter((f) => f.t >= frames[contact].t && f.t <= frames[contact].t + LAND_WOBBLE_MS);
  const withThrown = (f: ThrowFrame) =>
    Object.entries(f.clusters)
      .filter(([cluster]) => thrown.some((key) => cluster.split("|")[1].split(",").includes(key)))
      .reduce((n, [, builds]) => n + builds, 0);

  expect(
    landing.some((f) => f.wobble !== null && (Math.abs(f.wobble.scale - 1) > 0.005 || Math.abs(f.wobble.rot) > 0.1)),
    "the card itself wobbles after contact"
  ).toBe(true);
  const perThrow = { clusterBuilds: withThrown(frames.at(-1)!) - withThrown(frames[0]), shadowBuilds: frames.at(-1)!.builds - frames[0].builds };
  info.annotations.push({ type: "shadow builds per single throw", description: JSON.stringify(perThrow) });
  console.log(`shadow builds per single throw: ${JSON.stringify(perThrow)}`);
  // The felt counts a frame's build on the next frame, so the contact frame's own shows one on.
  const [from, to] = [frames[contact + 1], frames[contact + landing.length]];
  expect(to, "frames past the wobble window").toBeDefined();
  expect(withThrown(to) - withThrown(from), "builds of a shadow cluster holding the thrown card, contact to contact + LAND_WOBBLE_MS").toBe(0);
  await page.context().close();
});

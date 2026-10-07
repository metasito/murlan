// tests/e2e/lampSeats.spec.ts — the lamp hangs over the seat on move, and the table stays legible.
//
// The light sits straight inside the seat the table laid out, as the owner's G1 answers place it
// (`settledLight`), measured off the rings and the hand zone at every phone; the states come from
// `lib/captureStates.ts`, so this run and the iOS capture `app/capture.tsx` takes are of the same
// states. Chromium is the only renderer this spec reaches; `docs/agents/checks.md` has what that
// does and does not prove.
import { test, expect, type Page } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { PHONES, type Phone } from "./helpers/phones";
import { setSafeArea } from "./helpers/safeArea";
import { feltPixels, seatAnchor, settledLight, skiaOnSoftware, tracedLamp, untilSkiaFelt } from "./helpers/tableTrace";
import { CAPTURE_STATES, CAPTURE_VIEWER_SEAT, captureGameState, type CaptureState } from "../../lib/captureStates";

/** "To the nearest point." */
const NEAREST_PT = 0.5;

/** locales/it.ts `gameShared.turnOf` — the chip the lamp's own seat writes. */
const turnOf = (name: string) => `Turno di ${name}`;
const YOUR_TURN = "Il tuo turno";

const stateById = (id: string) => CAPTURE_STATES.find((s) => s.id === id)!;

/** Reduced motion: the light snaps to its pool and does not sway, so its point is exact, and there is no deal to wait out. */
async function openStill(page: Page, baseURL: string, phone: Phone, state: CaptureState): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: phone.width, height: phone.height });
  await openCaptureState(page, baseURL, state);
}

async function lampOff(page: Page, side: CaptureState["side"]): Promise<{ x: number; y: number }> {
  const [lamp, want] = await Promise.all([tracedLamp(page), settledLight(page, side)]);
  return { x: lamp.x - want.x, y: lamp.y - want.y };
}

async function expectLampOver(page: Page, side: CaptureState["side"], where: string): Promise<void> {
  const worst = async () => Math.max(...Object.values(await lampOff(page, side)).map(Math.abs));
  await expect
    .poll(worst, { message: `${where}: the lamp is not over the ${side} seat's light`, timeout: 10_000 })
    .toBeLessThanOrEqual(NEAREST_PT);
}

for (const phone of PHONES) {
  for (const state of CAPTURE_STATES) {
    test(`${phone.name}: the lamp hangs over the seat on move, and every seat and hand stay on screen: ${state.id}`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(120_000);
      await openStill(page, baseURL!, phone, state);

      const seededName = captureGameState(state).players[state.turn].name;
      await expect(page.getByTestId("game-hud-stack")).toContainText(
        state.turn === CAPTURE_VIEWER_SEAT ? YOUR_TURN : turnOf(seededName)
      );

      await expectLampOver(page, state.side, `${phone.name}, ${state.id}`);

      const boxes = await page.evaluate(() => {
        const rects = (sel: string) =>
          [...document.querySelectorAll(sel)].map((el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width };
          });
        return {
          seats: rects(
            '[data-testid="top-seat"], [data-testid="side-seat-left"], [data-testid="side-seat-right"]'
          ),
          cards: rects('[data-hand-state] [data-testid="card-box"]'),
        };
      });

      expect(boxes.cards.length, "the viewer's own hand did not render").toBeGreaterThan(0);
      for (const c of boxes.cards) {
        expect(c.right, `a hand card sits off the left edge`).toBeGreaterThan(0);
        expect(c.left, `a hand card sits off the right edge`).toBeLessThan(phone.width);
        expect(c.top, `a hand card sits below the bottom edge`).toBeLessThan(phone.height);
      }
      expect(boxes.seats, "a four-player table draws three opponents").toHaveLength(3);
      for (const s of boxes.seats) {
        expect(s.w, "a seat rendered with no width").toBeGreaterThan(0);
        expect(s.right).toBeGreaterThan(0);
        expect(s.left).toBeLessThan(phone.width);
      }
    });
  }
}

test("the lamp re-aims when the window changes under it", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const [small, , , large] = PHONES;
  await openStill(page, baseURL!, small, stateById("lamp-right"));
  await expectLampOver(page, "right", small.name);
  const before = await tracedLamp(page);

  await page.setViewportSize({ width: large.width, height: large.height });
  await expectLampOver(page, "right", `${small.name}, then ${large.name}`);
  expect((await tracedLamp(page)).x - before.x, "the floor: the right seat moved, and the lamp with it").toBeGreaterThan(100);
});

/** Plan 3 L9 as left/bottom/right: the Dynamic Island alone, then with the home bar. */
const ISLAND_INSETS = [[62, 0, 0], [62, 21, 62]] as const;

test("under the device's insets the light aims by the table's own box, not the window's, at every seat", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const phone = PHONES.find((p) => p.name === "iPhone 16 Pro")!;
  for (const side of ["bottom", "right", "top", "left"] as const) {
    await openStill(page, baseURL!, phone, stateById(`lamp-${side}`));
    for (const [left, bottom, right] of ISLAND_INSETS) {
      const where = `${side} under ${left}/${bottom}/${right} insets`;
      const before = await seatAnchor(page, "pile");
      await setSafeArea(page, left, bottom, right);
      await expect.poll(async () => (await seatAnchor(page, "pile")).x, { message: `the floor: the insets moved the table, ${where}` }).not.toBeCloseTo(before.x, 0);
      await expectLampOver(page, side, where);
      if (side !== "bottom") continue;
      const [lamp, pile] = await Promise.all([tracedLamp(page), seatAnchor(page, "pile")]);
      expect(Math.abs(lamp.x - pile.x), `${where}: the light at ${lamp.x.toFixed(1)}, the pile at ${pile.x.toFixed(1)}`).toBeLessThanOrEqual(NEAREST_PT);
    }
  }
});

test("under the device's insets the felt's light sits over the pile (D4 #9)", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await skiaOnSoftware(page);
  await openStill(page, baseURL!, PHONES.find((p) => p.name === "iPhone 16 Pro")!, stateById("lamp-bottom"));
  const bare = await seatAnchor(page, "pile");
  await setSafeArea(page, 62, 21, 62);
  await expect.poll(async () => (await seatAnchor(page, "pile")).x, { message: "the floor: the insets moved the table" }).not.toBeCloseTo(bare.x, 0);
  await expectLampOver(page, "bottom", "under 62/21/62 insets");
  await untilSkiaFelt(page);

  const pile = await seatAnchor(page, "pile");
  // Only the pool: the vignette's tail runs to the table's far edge and pulls a whole-felt centroid towards the box's middle.
  const { pixels, perPt, origin } = await feltPixels(page);
  const lums = Array.from({ length: pixels.data.length / 4 }, (_, p) => 0.2126 * pixels.data[p * 4] + 0.7152 * pixels.data[p * 4 + 1] + 0.0722 * pixels.data[p * 4 + 2]);
  const pool = lums.reduce((a, b) => Math.max(a, b), 0) / 2;
  let [sum, weight] = [0, 0];
  lums.forEach((lum, p) => {
    if (lum < pool) return;
    sum += (p % pixels.width) * lum * lum;
    weight += lum * lum;
  });
  const centroid = { x: origin.x + (sum / weight + 0.5) / perPt, weight };
  console.log(`light centroid x ${centroid.x.toFixed(1)}, pile centre x ${pile.x.toFixed(1)}`);
  expect(centroid.weight, "the felt drew no light").toBeGreaterThan(0);
  expect(Math.abs(centroid.x - pile.x), `the light's centroid ${centroid.x.toFixed(1)} against the pile's ${pile.x.toFixed(1)}`).toBeLessThanOrEqual(2);
});

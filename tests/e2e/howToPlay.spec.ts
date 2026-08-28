// The tutorial offer is the first thing on How to play, and the rules are
// readable under it without another tap. react-test-renderer never runs
// flexbox, so only a browser can say whether the offer and the first rules
// section are both actually on screen — in either orientation.
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";

const VIEWPORTS = [
  { name: "portrait", width: 390, height: 844 },
  { name: "landscape", width: 844, height: 390 },
];

for (const vp of VIEWPORTS) {
  test(`how to play — the tutorial is offered above readable rules in ${vp.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openApp(page, baseURL!);
    await page.goto(`${baseURL}/rules`);

    const cta = page.getByRole("button", { name: "Inizia il tutorial, una mano guidata" });
    await expect(cta).toBeInViewport();

    // The offer names itself once. Its visible copy is the control's own face,
    // so it must not be a second stop.
    await expect(page.getByText("Inizia il tutorial", { exact: true })).toHaveCount(1);

    const ctaBox = (await cta.boundingBox())!;
    expect(ctaBox.height).toBeGreaterThanOrEqual(44);

    // Readable below without another tap: the rank reference is already laid
    // out, and it sits under the offer rather than above it.
    const ranks = page.getByText("FORZA CARTE", { exact: false }).first();
    const ranksBox = (await ranks.boundingBox())!;
    expect(ranksBox.y).toBeGreaterThan(ctaBox.y);

    await ranks.scrollIntoViewIfNeeded();
    await expect(ranks).toBeInViewport();
  });
}

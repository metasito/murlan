// tests/e2e/rulesScroll.spec.ts — /rules is far taller than any window it is
// shown in and used to give no sign of it, while its card-strength row ran off
// the side of a phone (#587).
//
// Only a browser can answer either. react-test-renderer never runs flexbox, so
// a native test cannot say how wide anything ended up — and width is the whole
// question here: React Native defaults `flexShrink` to 0, so a row wider than
// its parent overflows rather than shrinking, and the audit measured /rules
// reaching x=612 in a 390px window (docs/design/57-polish-audit/content.txt).
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";

/** The ticket's own list — real devices, both orientations, phone and tablet. */
const VIEWPORTS = [
  { name: "iPhone SE portrait", width: 375, height: 667 },
  { name: "iPhone 12 portrait", width: 390, height: 844 },
  { name: "iPhone 14 Pro Max portrait", width: 430, height: 932 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "iPad portrait", width: 834, height: 1112 },
];

for (const vp of VIEWPORTS) {
  test(`/rules stays inside ${vp.name} and says it continues`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openApp(page, baseURL!);
    await page.goto(`${baseURL}/rules`);
    await expect(page.getByText("GUIDA AL GIOCO")).toBeVisible();

    // Every element's right edge against the window's. Elements inside a
    // horizontal scroller are exempt by construction — they are meant to be
    // out of view and reachable — so the question is only ever asked of things
    // no scroller is carrying.
    const overflowing = await page.evaluate(() => {
      const scrollers = [...document.querySelectorAll<HTMLElement>("*")].filter(
        (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible",
      );
      const inScroller = (el: Element) => scrollers.some((s) => s !== el && s.contains(el));

      return [...document.querySelectorAll<HTMLElement>("*")]
        .filter((el) => !inScroller(el))
        .map((el) => ({
          right: el.getBoundingClientRect().right,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 40),
        }))
        .filter((n) => n.right > window.innerWidth + 1);
    });

    expect(
      overflowing,
      `nothing on /rules may reach past ${vp.width}px; a row that needs the room scrolls in a container that says so`,
    ).toEqual([]);

    // The page is taller than the window at every viewport in this list, so the
    // hint is owed at every one of them. Asserting it is *present* rather than
    // merely rendered: `MenuLayout` mounts it only once it has measured both
    // heights, so a hint that never appears is the regression.
    const doc = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
    }));
    expect(doc.scrollH, `/rules should overflow ${vp.name}; if it no longer does, this test is checking nothing`)
      .toBeGreaterThan(doc.innerH);

    await expect(page.getByTestId("menu-more-below")).toBeAttached();
  });
}

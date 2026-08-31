// A menu screen has to use the height it is given.
//
// #585: several screens rendered their content to a byte-identical bottom
// pixel whether the window was 390px tall or 834px, so a tablet got a void.
// The honest form of that finding is the measurement itself — the same screen
// at two heights, and where its content ends in each.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { goToOnlineLobby, createRoom } from "./helpers/online";

// Real handsets and a real tablet, in logical points, per the ticket.
const PHONE_LANDSCAPE = { width: 844, height: 390 };
const TABLET_LANDSCAPE = { width: 1112, height: 834 };
const PHONE_PORTRAIT = { width: 390, height: 844 };
const TABLET_PORTRAIT = { width: 834, height: 1112 };

interface Screen {
  name: string;
  /**
   * The share of the tall window the content has to reach. Stated per screen
   * rather than once, because a list that grows and a short form that centres
   * are both right answers and one bar cannot ask for both: a radio group
   * stretched to 800px is padding pretending to be design.
   */
  fill: number;
  open: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  // Two short forms in two columns: they centre, so the divider between them
  // spans a composition rather than a void.
  {
    name: "/(online)",
    fill: 0.6,
    open: async (page) => {
      await goToOnlineLobby(page);
    },
  },
  // Already elastic before this ticket — the seat list takes the slack. Here
  // to keep it that way, and because a suite where nothing passes proves
  // nothing about the ones that fail.
  {
    name: "/(online)/room",
    fill: 0.9,
    open: async (page) => {
      await goToOnlineLobby(page);
      await createRoom(page, { playerCount: 4, gameMode: "free_for_all" });
    },
  },
  // Two list bands that share the slack. The bar is short of the others'
  // because the lowest thing measured here is *text* centred inside the
  // pending band, and the band's own floor is further down than that.
  {
    name: "/friends",
    fill: 0.85,
    open: async (page) => {
      await page.goto("/friends");
      await page.getByText("Amici", { exact: true }).first().waitFor();
    },
  },
  // The card reaches the floor and Indietro sits on it.
  {
    name: "/leaderboard",
    fill: 0.9,
    open: async (page) => {
      await page.goto("/leaderboard");
      await page.getByText("Classifica", { exact: true }).first().waitFor();
    },
  },
];

/**
 * The bottom edge of the lowest piece of *content*: text and controls, never a
 * background. The felt is full-bleed, so a box that counted it would report
 * every screen as using its whole viewport and no screen as having any slack.
 *
 * `NotificationBanner` never returns null — it parks off the top edge with
 * nothing to say — which is why anything at or above zero is discarded.
 */
async function contentBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    let low = 0;
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const paints =
        el.childElementCount === 0 &&
        ((el.textContent ?? "").trim() !== "" ||
          ["INPUT", "IMG", "SVG", "TEXTAREA"].includes(el.tagName));
      if (!paints) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.bottom <= 0) continue;
      low = Math.max(low, box.bottom);
    }
    return Math.round(low);
  });
}

/** Re-lays the screen out at `size` and reports where its content ends. */
async function bottomAt(
  page: Page,
  size: { width: number; height: number }
): Promise<number> {
  await page.setViewportSize(size);
  // A resize reflows on the next frame; two settle even a layout that reads
  // its own measured width back in.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  );
  return contentBottom(page);
}

for (const screen of SCREENS) {
  for (const [orientation, short, tall] of [
    ["landscape", PHONE_LANDSCAPE, TABLET_LANDSCAPE],
    ["portrait", PHONE_PORTRAIT, TABLET_PORTRAIT],
  ] as const) {
    test(`${screen.name} uses the height a tablet gives it, in ${orientation}`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(short);
      await openApp(page, baseURL!);
      await registerNewAccount(page, uniqueUsername("h"));
      await screen.open(page);

      const onPhone = await bottomAt(page, short);
      const onTablet = await bottomAt(page, tall);
      // `MENU_HEIGHT_CAPTURE=<dir>` photographs what the numbers describe.
      // docs/design/585-menu-height/README.md is what it produced.
      if (process.env.MENU_HEIGHT_CAPTURE) {
        const slug = screen.name.replace(/[^a-z]+/gi, "-").replace(/^-|-$/g, "");
        await page.screenshot({
          path: `${process.env.MENU_HEIGHT_CAPTURE}/${slug}__tablet-${orientation}.png`,
        });
      }
      const owed = Math.round(tall.height * screen.fill);
      console.log(
        `HEIGHT\t${screen.name}\t${orientation}\t${short.height}px→y=${onPhone}\t` +
          `${tall.height}px→y=${onTablet}\towed=${owed}`
      );

      // A screen with more content than the tall window holds scrolls; it has
      // no slack to strand, and an identical bottom there means "the same
      // content", not "a void" (/rules, /profile).
      test.skip(
        onTablet > tall.height,
        `content is ${onTablet}px tall — taller than the ${tall.height}px window, so it scrolls`
      );

      expect(
        onTablet,
        `${screen.name} ended at y=${onPhone} in a ${short.height}px window and y=${onTablet} in a ` +
          `${tall.height}px one; it has to reach y=${owed} to have used the height it was given`
      ).toBeGreaterThanOrEqual(owed);
    });
  }
}

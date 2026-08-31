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
import { settled } from "./helpers/settle";
import { PHONES } from "./helpers/phones";

// The handset comes from the one list that holds them; the iPad has no entry
// there because that file is the phones the *table* is laid out for.
const PHONE_LANDSCAPE = PHONES.find((p) => p.name === "iPhone 12")!;
const PHONE_PORTRAIT = { width: PHONE_LANDSCAPE.height, height: PHONE_LANDSCAPE.width };
const TABLET_LANDSCAPE = { width: 1112, height: 834 };
const TABLET_PORTRAIT = { width: 834, height: 1112 };

/** Long enough for a resize to reach a commit on a loaded runner. */
const SETTLE_CEILING_MS = 2_000;

interface Screen {
  name: string;
  /**
   * The share of the tall window the content has to reach. Stated per screen
   * rather than once, because a list that grows and a short form that centres
   * are both right answers and one bar cannot ask for both: a radio group
   * stretched to 800px is padding pretending to be design.
   *
   * Each sits well under what its screen actually reaches, and far above what
   * the defect did — the numbers are in docs/design/585-menu-height/README.md.
   * A bar set just under the passing value would go red on a font-metric
   * change rather than on the defect coming back, and a check that goes red at
   * random gets disabled and then lies (#118).
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
    fill: 0.8,
    open: async (page) => {
      await page.goto("/friends");
      await page.getByText("Amici", { exact: true }).first().waitFor();
    },
  },
  // The card reaches the floor and Indietro sits on it.
  {
    name: "/leaderboard",
    fill: 0.85,
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
      // Upper-cased before comparing: `tagName` is case-preserving inside SVG,
      // so an inline `<svg>` answers "svg" and an icon drawn by
      // react-native-svg would go unmeasured.
      const paints =
        el.childElementCount === 0 &&
        ((el.textContent ?? "").trim() !== "" ||
          ["INPUT", "IMG", "SVG", "TEXTAREA"].includes(el.tagName.toUpperCase()));
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
  // A resize reaches the layout through a `resize` listener, `setState` and the
  // React scheduler, so a frame or two is not a settle: measured early, this
  // reads the *old* layout and reports a void the screen has not got.
  await settled(page, SETTLE_CEILING_MS);
  return contentBottom(page);
}

/**
 * Whether anything on the screen can actually be scrolled to.
 *
 * A box extending past the viewport is not the same question: `MenuCard` is
 * `overflow: 'hidden'`, so a card that grew past the window would report a
 * bottom far below it while silently clipping its own tail — and skipping on
 * that reading would excuse the one failure `grow` can cause.
 */
async function scrolls(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("*")).some((el) => {
      const overflowY = getComputedStyle(el).overflowY;
      return (
        (overflowY === "auto" || overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 1
      );
    })
  );
}

// The other half of the same rule, and the one a share-of-the-window check
// cannot see: making a region take the slack must not cost the screen its
// scroll. `flexShrink: 0` on a ScrollView is exactly that mistake — the
// scroller grows to its content instead of scrolling it, and on a short window
// the last control is below the fold with no way to reach it.
test("the online lobby still scrolls when its content does not fit", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  // Shorter than any handset in `phones.ts`, which is the point: the assertion
  // is that overflow scrolls, not that this window is one anybody has.
  await page.setViewportSize({ width: 320, height: 480 });
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("h"));
  await goToOnlineLobby(page);
  await settled(page, SETTLE_CEILING_MS);

  expect(await scrolls(page), "nothing on the lobby scrolls at 320x480").toBe(true);

  const join = page.getByRole("button", { name: "Inserisci codice stanza" });
  await join.scrollIntoViewIfNeeded();
  await expect(join).toBeVisible();
});

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

      // `MENU_HEIGHT_CAPTURE=<dir>` photographs what the numbers describe.
      // docs/design/585-menu-height/README.md is what it produced.
      const capture = process.env.MENU_HEIGHT_CAPTURE;
      const slug = screen.name.replace(/[^a-z]+/gi, "-").replace(/^-|-$/g, "");
      const shoot = async (at: string) => {
        if (capture) await page.screenshot({ path: `${capture}/${slug}__${at}.png` });
      };

      const onPhone = await bottomAt(page, short);
      await shoot(`phone-${orientation}`);
      const onTablet = await bottomAt(page, tall);
      await shoot(`tablet-${orientation}`);
      const owed = Math.round(tall.height * screen.fill);
      console.log(
        `HEIGHT\t${screen.name}\t${orientation}\t${short.height}px→y=${onPhone}\t` +
          `${tall.height}px→y=${onTablet}\towed=${owed}`
      );

      // A screen with more content than the tall window holds scrolls; it has
      // no slack to strand, and an identical bottom there means "the same
      // content", not "a void" (/rules, /profile).
      test.skip(
        await scrolls(page),
        `the screen scrolls at ${tall.height}px, so it has no slack to strand`
      );

      expect(
        onTablet,
        `${screen.name} ended at y=${onPhone} in a ${short.height}px window and y=${onTablet} in a ` +
          `${tall.height}px one; it has to reach y=${owed} to have used the height it was given`
      ).toBeGreaterThanOrEqual(owed);
    });
  }
}

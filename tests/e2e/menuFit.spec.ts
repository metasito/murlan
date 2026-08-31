// Every control on a menu screen has to be reachable on the smallest handset
// the app claims to support.
//
// This is the opposite bound to `menuHeight.spec.ts`, which asks whether a
// screen *fills* a tall window. Nothing asked whether it *fits* a short one,
// and on an iPhone SE in landscape the online hub's Crea Stanza button — the
// screen's entire purpose — sat below the bottom edge with nothing to scroll
// (#621). A screen can answer this two ways and both are correct: fit inside
// the window, or overflow it and scroll. What is never correct is the third.
//
// Reachability, not visibility-on-arrival, is what is asserted. A control the
// player has to scroll to is a design question; a control they cannot get to
// at all is a correctness floor, and only the floor belongs in a check that
// must never go red at random.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { goToOnlineLobby, createRoom } from "./helpers/online";
import { settled } from "./helpers/settle";
import { PHONES } from "./helpers/phones";

/** The smallest handset the layout suite claims, read rather than restated. */
const SMALLEST = PHONES.reduce((a, b) => (a.width * a.height <= b.width * b.height ? a : b));

const SETTLE_CEILING_MS = 2_000;

interface Screen {
  name: string;
  open: (page: Page) => Promise<void>;
}

// The `scrollable={false}` screens, which are the ones whose overflow had no
// answer. `/(online)/quickmatch` is the fourth and is not here: reaching it
// needs a live matchmaking queue with a second client in it, which is a
// harness this check does not justify — it shares `MenuLayout`'s fallback
// with the three below and nothing about it is screen-specific.
// `app/+not-found.tsx` is a title and one button.
const SCREENS: Screen[] = [
  {
    name: "/lobby",
    open: async (page) => {
      await page.getByRole("button", { name: "Offline" }).click();
      await page.getByRole("button", { name: "Inizia Partita" }).waitFor();
    },
  },
  {
    name: "/(online)",
    open: async (page) => {
      await goToOnlineLobby(page);
    },
  },
  {
    name: "/(online)/room",
    open: async (page) => {
      await goToOnlineLobby(page);
      await createRoom(page, { playerCount: 4, gameMode: "free_for_all" });
    },
  },
];

/**
 * Radios and textboxes count, not only buttons: a screen that puts its primary
 * button inside the window and its player-count picker below it is just as
 * broken. The hub's own defect happened to reach both.
 */
const CONTROL_SELECTOR =
  'button:not([disabled]), [role="button"], [role="radio"], input, textarea';

interface Control {
  label: string;
  top: number;
  bottom: number;
  /** Whether some ancestor can scroll it the rest of the way in. */
  reachable: boolean;
}

/**
 * Every control, where it sits on arrival, and whether anything could bring it
 * the rest of the way in.
 *
 * One `evaluate`, deliberately: a per-control round trip that asks the browser
 * to scroll to each one in turn leaves the page at a different offset for
 * every measurement, and a control counted from a scrolled page is not being
 * measured in the state the player arrives in.
 *
 * `NotificationBanner` never returns null — it parks off the top edge with
 * nothing to say (CLAUDE.md) — so a control whose whole box is above zero is
 * not on the screen at all and is discarded, the same way
 * `menuHeight.spec.ts`'s own `contentBottom` discards it.
 */
async function survey(page: Page): Promise<Control[]> {
  return page.evaluate((selector) => {
    const scrollableUnder = (el: Element): boolean => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const overflowY = getComputedStyle(p).overflowY;
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          p.scrollHeight > p.clientHeight + 1
        ) {
          return true;
        }
      }
      return false;
    };

    const out = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.bottom <= 0) continue;
      const inside = box.top >= -1 && box.bottom <= window.innerHeight + 1;
      out.push({
        label:
          el.getAttribute("aria-label") ?? (el.textContent ?? "").trim() ?? "unnamed",
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        reachable: inside || scrollableUnder(el),
      });
    }
    return out;
  }, CONTROL_SELECTOR);
}

test.describe(`every control is reachable on an ${SMALLEST.name}`, () => {
  for (const screen of SCREENS) {
    test(`${screen.name} — nothing is stranded below the fold`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: SMALLEST.width, height: SMALLEST.height });
      await openApp(page, baseURL!);
      await registerNewAccount(page, uniqueUsername("fit"));
      await screen.open(page);
      await settled(page, SETTLE_CEILING_MS);

      // The ticket's own first finding: the capture the original report linked
      // was never in the repo, so the measurement had no artefact behind it.
      await test.info().attach(`${screen.name.replace(/\W+/g, "-")}__se-landscape.png`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });

      const controls = await survey(page);
      expect(controls.length, `${screen.name} rendered no controls at all`).toBeGreaterThan(0);

      const stranded = controls.filter((c) => !c.reachable);
      const where = (c: Control) => `${c.label} (top ${c.top}, bottom ${c.bottom})`;
      expect(
        stranded.map(where),
        `${SMALLEST.width}x${SMALLEST.height} — these are outside the window and nothing ` +
          `scrolls, so the player can never operate them. Every control, for context:\n  ` +
          controls.map(where).join("\n  ")
      ).toEqual([]);
    });
  }
});

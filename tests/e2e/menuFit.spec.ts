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
  /**
   * A control this screen pins, which must be on the window **without
   * scrolling** — not merely reachable.
   *
   * Reachability alone cannot tell a fix from a regression here. Put a scroller
   * over the whole layout and every control on every screen becomes reachable
   * by construction, including the Start button that used to sit fixed at the
   * foot and now rides the content off the bottom. That is the defect #585
   * fixed, and this is what would catch it coming back.
   */
  pinned?: string;
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
    pinned: "Inizia Partita",
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
    // Its Start button is disabled until the room fills, so it reads as a wait.
    // Fixed at the foot, and the one control this screen must not let scroll.
    name: "/(online)/room",
    pinned: "In attesa di giocatori",
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
  /** Fully inside the window with no scrolling at all. */
  inside: boolean;
  /** …or a scroller below it can bring it the rest of the way down. */
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
 * Three things this has to get right, each of which it got wrong first:
 *
 * - The parked banner is excluded **by identity, not by position**.
 *   `NotificationBanner` never returns null; it parks off the top edge with
 *   nothing to say (CLAUDE.md). Discarding everything above y=0 would hide it,
 *   but it would also hide a real top-stranding — and the hub uses two
 *   shrinkable spacers rather than `justifyContent: "center"` precisely
 *   because "centring a block taller than its box pushes the top of it off the
 *   screen, and the shortest phone in landscape is exactly that case"
 *   (`app/(online)/index.tsx`). A control above the fold is the known failure
 *   mode here, so it must not be filtered out by where it happens to sit.
 * - A scroller only reaches **downwards**. Content above a scroll container's
 *   own content box cannot be scrolled back to, so a control whose top is off
 *   the screen is stranded whatever scrollers sit over it.
 * - `MenuCard` is `overflow: hidden`, so a box can report an in-window
 *   rectangle while its own painted tail is clipped away. `getBoundingClientRect`
 *   has no opinion about that; the ancestor's does.
 *   `menuHeight.spec.ts` names this hole as the one it avoids, and reopening
 *   it here would excuse exactly the failure this check exists for.
 */
async function survey(page: Page): Promise<Control[]> {
  return page.evaluate((selector) => {
    /** The clipped box: what an ancestor's `overflow: hidden` actually leaves. */
    const visibleBox = (el: Element): DOMRect => {
      const box = el.getBoundingClientRect();
      let top = box.top;
      let bottom = box.bottom;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).overflow === "visible") continue;
        const clip = p.getBoundingClientRect();
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      return new DOMRect(box.x, top, box.width, Math.max(0, bottom - top));
    };

    /** A scroller with room left below `el`, which is the only way in. */
    const canScrollDownTo = (el: Element): boolean => {
      const box = el.getBoundingClientRect();
      for (let p = el.parentElement; p; p = p.parentElement) {
        const overflowY = getComputedStyle(p).overflowY;
        if (overflowY !== "auto" && overflowY !== "scroll") continue;
        if (p.scrollHeight <= p.clientHeight + 1) continue;
        // The scroller itself has to be on the screen, or scrolling it moves
        // the control within a box the player still cannot see.
        const clip = p.getBoundingClientRect();
        if (clip.bottom <= 0 || clip.top >= window.innerHeight) continue;
        if (box.top >= clip.top - 1) return true;
      }
      return false;
    };

    const out = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (el.closest('[data-testid="notification-banner"]')) continue;
      const box = visibleBox(el);
      if (box.width === 0 || box.height === 0) continue;
      const inside = box.top >= -1 && box.bottom <= window.innerHeight + 1;
      // How much of it the player can actually see right now. A control whose
      // box overhangs an edge but still shows a usable part of itself is a
      // *size* question, which `tapTargets.spec.ts` already owns — the floor
      // here is only whether the thing can be got at at all. Measured: room's
      // back button hangs 13px over the top edge and shows 31 of its 44pt
      // target, and calling that unreachable reported a screen as broken that
      // the capture beside it shows working.
      const onScreen =
        Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0) > 0;
      out.push({
        label: el.getAttribute("aria-label") || (el.textContent ?? "").trim() || "unnamed",
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        inside,
        // A scroller only reaches downwards, so it rescues a control below the
        // fold and never one clipped above it.
        reachable: onScreen || (box.top >= -1 && canScrollDownTo(el)),
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

      const where = (c: Control) => `${c.label} (top ${c.top}, bottom ${c.bottom})`;
      const context = `Every control, for context:\n  ` + controls.map(where).join("\n  ");

      const stranded = controls.filter((c) => !c.reachable);
      expect(
        stranded.map(where),
        `${SMALLEST.width}x${SMALLEST.height} — these cannot be reached by scrolling, so ` +
          `the player can never operate them. ${context}`
      ).toEqual([]);

      if (screen.pinned !== undefined) {
        const pin = controls.find((c) => c.label === screen.pinned);
        expect(pin, `${screen.name} never rendered "${screen.pinned}". ${context}`).toBeDefined();
        expect(
          pin!.inside,
          `${screen.name} pins "${screen.pinned}" at the foot, and it has to be on the ` +
            `window without scrolling — it is at top ${pin!.top}, bottom ${pin!.bottom} ` +
            `in a ${SMALLEST.height}px window. ${context}`
        ).toBe(true);
      }
    });
  }
});

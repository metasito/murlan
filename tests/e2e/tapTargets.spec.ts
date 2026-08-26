// Every control a player can see must be a control they can actually press.
//
// This exists because of a bug screenshots could not settle: on the online
// lobby in portrait, the "oppure" divider came to rest on top of the create-room
// button and swallowed its taps. The button was visible, enabled, correctly
// labelled and had pointer-events auto — it simply could not be pressed, so no
// room could be created on a phone at all. Nothing in the unit, native or
// existing e2e suites could see it; `document.elementFromPoint` could, in one
// call.
//
// The check is deliberately narrow. Controls legitimately overlap each other —
// the hand fans its cards so that only the last is fully exposed, and that is
// the design, not a defect. What is never legitimate is a control covered at
// its own centre by something inert: a label, a divider, a decorative gradient.
// That is always either a layout mistake or a dead control.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, startOfflineGame } from "./helpers/navigation";
import { createRoom, goToOnlineLobby } from "./helpers/online";
import { settled } from "./helpers/settle";
import { TOUCH_TARGET_MIN } from "../../lib/tokens";

interface Blocked {
  label: string;
  role: string;
  blockedBy: string;
  /** Both rects, so a failure says where the collision is without a rerun. */
  at: string;
  by: string;
}

interface Sweep {
  blocked: Blocked[];
  /** How many controls were actually examined. */
  considered: number;
}

/**
 * Controls whose centre point belongs to an inert element outside themselves.
 *
 * Runs entirely in the page so it costs one round trip regardless of how many
 * controls a screen has.
 */
async function sweepControls(page: Page): Promise<Sweep> {
  return page.evaluate(() => {
    const INTERACTIVE = new Set(["button", "radio", "switch", "tab", "link", "checkbox"]);

    const roleOf = (el: Element): string =>
      el.getAttribute("role") ?? (el.tagName === "BUTTON" ? "button" : "");

    const isInteractive = (el: Element | null): boolean => {
      for (let n = el; n; n = n.parentElement) {
        if (INTERACTIVE.has(roleOf(n))) return true;
      }
      return false;
    };

    const nameOf = (el: Element): string =>
      (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 50);

    /**
     * Where the element is actually on screen, after every scroll container
     * above it has had its say. An element scrolled below its own list still
     * reports a rect inside the window — it is simply not visible, and probing
     * its centre lands on whatever is drawn there instead.
     */
    const visibleRect = (el: Element): DOMRect | null => {
      let r = el.getBoundingClientRect();
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowY === "visible" && cs.overflowX === "visible") continue;
        const c = n.getBoundingClientRect();
        const left = Math.max(r.left, c.left);
        const top = Math.max(r.top, c.top);
        const right = Math.min(r.right, c.right);
        const bottom = Math.min(r.bottom, c.bottom);
        if (right <= left || bottom <= top) return null;
        r = new DOMRect(left, top, right - left, bottom - top);
      }
      return r;
    };

    const out: Blocked[] = [];
    let considered = 0;
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], [role="switch"]')
    );

    for (const el of controls) {
      if (el.getAttribute("aria-disabled") === "true") continue;
      const r = visibleRect(el);
      // Fully clipped by a scroll container, or off the window: a player
      // cannot see it, so it is not this check's business.
      if (!r || r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.right < 0 || r.left > window.innerWidth) continue;
      // A control nested inside another (an icon inside a labelled row) is
      // covered by its own ancestor by construction.
      if (el.parentElement && isInteractive(el.parentElement)) continue;
      considered++;

      const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || el.contains(hit) || hit.contains(el)) continue;
      // Another control on top is the fanned hand, or a deliberate overlay.
      if (isInteractive(hit)) continue;
      // A screen deliberately covering another — the tutorial pushed over the
      // home menu, the "rotate your device" prompt over the landscape-locked
      // table — buries every control beneath it on purpose. Anything spanning
      // most of the viewport is that, not a stray label sitting on a button.
      const h = hit.getBoundingClientRect();
      const covers = (h.width * h.height) / (window.innerWidth * window.innerHeight);
      if (covers >= 0.5) continue;

      const box = (b: DOMRect) =>
        `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`;
      out.push({
        label: nameOf(el) || "(unnamed)",
        role: roleOf(el) || el.tagName,
        blockedBy: `${hit.tagName}:${nameOf(hit) || "(no text)"}`,
        at: box(r),
        by: box(h),
      });
    }
    return { blocked: out, considered };
  });
}

/**
 * Asserts nothing on this screen is buried — and that there was something to
 * check. A screen that failed to render, or whose controls stopped matching the
 * selector, would otherwise sweep zero elements and pass for the wrong reason.
 *
 * The floors are measured, not guessed: the first three were set too high and
 * this assertion is what said so. They are deliberately below the real count,
 * since the point is "this screen rendered its controls", not "this screen has
 * exactly N of them" — which would go red every time one is added.
 */
async function expectNoBuriedControls(page: Page, where: string, minControls: number) {
  const { blocked, considered } = await sweepControls(page);
  expect(blocked, where).toEqual([]);
  expect(considered, `${where}: swept ${considered} controls, expected at least ${minControls}`)
    .toBeGreaterThanOrEqual(minControls);
}

/**
 * Controls smaller than the 44pt floor, measured rather than declared.
 *
 * react-native-web reads `hitSlop` on nothing but the legacy Touchable, so on
 * this platform a control's own box is the whole target.
 */
async function sweepSizes(page: Page, allow: string[]): Promise<string[]> {
  // The floor crosses into the page as an argument: this callback runs in the
  // browser, where nothing this file imports exists.
  return page.evaluate(({ allowed, MIN }) => {
    const out: string[] = [];
    const nameOf = (el: Element): string =>
      (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 50);

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], [role="switch"]')
    );

    for (const el of controls) {
      if (el.getAttribute("aria-disabled") === "true") continue;
      // A control nested inside another is part of that control's target.
      if (el.parentElement?.closest('button, [role="button"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.right < 0 || r.left > window.innerWidth) continue;

      const { width, height } = r;
      const name = nameOf(el) || "(unnamed)";
      if (allowed.some((a) => name.includes(a))) continue;
      if (width >= MIN && height >= MIN) continue;
      out.push(`${name} — ${Math.round(width)}x${Math.round(height)}`);
    }
    return out;
  }, { allowed: allow, MIN: TOUCH_TARGET_MIN });
}

/**
 * The hand's cards: the fan exposes `step` pixels of each card, and 44pt at 14
 * cards needs ~630px of hand width the table does not have. components/
 * handLayout.ts holds them at WCAG 2.2 SC 2.5.8's 24px instead.
 *
 * Matched against the Italian labels the whole suite is written against and
 * playwright.config.ts pins.
 */
const UNDERSIZED_BY_DESIGN = ["di Fiori", "di Cuori", "di Quadri", "di Picche", "Jolly"];

const SIZES = [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "tablet landscape", width: 1280, height: 720 },
];

for (const size of SIZES) {
  test(`no control is buried on the menus — ${size.name}`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: size.width, height: size.height });

    await openApp(page, baseURL!);
    await settled(page, 2500);
    await expectNoBuriedControls(page, "home", 6);
    expect(await sweepSizes(page, UNDERSIZED_BY_DESIGN), "home").toEqual([]);

    await page.getByRole("button", { name: "Offline" }).click();
    await settled(page, 1500);
    await expectNoBuriedControls(page, "offline lobby, 2 players", 8);

    await page.getByRole("radio", { name: "4 giocatori" }).click();
    await settled(page, 1200);
    await expectNoBuriedControls(page, "offline lobby, 4 players", 10);

    expect(await sweepSizes(page, UNDERSIZED_BY_DESIGN), "offline lobby").toEqual([]);
  });

  // The table forces landscape (components/GameTable.tsx), so in portrait the
  // only thing on screen is the rotate-your-device prompt. Declaring the test
  // only for landscape says that, where a runtime skip would just look like
  // coverage nobody reads.
  if (size.height > size.width) continue;

  test(`no control is buried on the game table — ${size.name}`, async ({ page, baseURL }) => {
    test.setTimeout(2 * 60_000);
    await page.setViewportSize({ width: size.width, height: size.height });

    await openApp(page, baseURL!);
    await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all", format: "single" });
    await expect(page.locator('[data-testid="game-table"]')).toBeVisible();
    await settled(page, 5000);

    await expectNoBuriedControls(page, "game table, 4 players", 10);
    expect(await sweepSizes(page, UNDERSIZED_BY_DESIGN), "game table").toEqual([]);
  });
}

// The screen this check was written for. Its two sections carry `flex: 1` for
// the landscape row where they sit side by side; stacked in the portrait
// ScrollView that made them overlap, and the "oppure" divider settled on top of
// the create-room button and ate its taps.
for (const size of SIZES) {
  test(`no control is buried on the online lobby — ${size.name}`, async ({ page, baseURL }) => {
    test.setTimeout(2 * 60_000);
    await page.setViewportSize({ width: size.width, height: size.height });

    await openApp(page, baseURL!);
    await registerNewAccount(
      page,
      `tap${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`
    );
    await goToOnlineLobby(page);
    await settled(page, 2500);
    await expectNoBuriedControls(page, "online lobby", 6);

    // The waiting room carries the most controls of any menu screen — format,
    // bot fill, five personality pills, the code actions and the start button —
    // and it lays them out differently in each orientation.
    await createRoom(page, { playerCount: 4, gameMode: "free_for_all" });
    await settled(page, 2500);
    await expectNoBuriedControls(page, "room, waiting for players", 4);
  });

  test(`no control is buried on the profile and ladder — ${size.name}`, async ({ page, baseURL }) => {
    test.setTimeout(2 * 60_000);
    await page.setViewportSize({ width: size.width, height: size.height });

    await openApp(page, baseURL!);
    await registerNewAccount(
      page,
      `tapp${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`
    );
    await page.getByRole("button", { name: "Il mio profilo" }).click();
    await settled(page, 3000);
    await expectNoBuriedControls(page, "profile", 2);

    await page.getByRole("button", { name: /classifica/i }).first().click();
    await settled(page, 2500);
    await expectNoBuriedControls(page, "leaderboard", 2);
  });
}

// UI-01: a plain View with no ScrollView/maxHeight overflowed the backdrop on
// any viewport shorter than ~725pt — every phone in landscape, an iPhone SE
// in portrait, a laptop browser window. 568pt is inside that range.
test("settings scrolls to the delete-account button at a short viewport", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1200, height: 568 });
  await openApp(page, baseURL!);
  await page.getByRole("button", { name: "Impostazioni" }).click();

  const deleteBtn = page.getByRole("button", { name: "Elimina account" });
  await deleteBtn.scrollIntoViewIfNeeded();
  await expect(deleteBtn).toBeInViewport();
});

// UI-03: the portrait home menu had no ScrollView, so `justifyContent:
// "center"` split the overflow across both edges — on a 375x667 iPhone SE
// three of the seven destinations, including the last, were off-screen with
// no way to reach them.
test("the home menu scrolls to its last row", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 667 });
  await openApp(page, baseURL!);

  const lastRow = page.getByRole("button", { name: "Regole & FAQ" });
  await lastRow.scrollIntoViewIfNeeded();
  await expect(lastRow).toBeInViewport();
});

// UI-06: MenuLayout capped its content at 800pt (components/MenuLayout.tsx
// MENU_MAX_W) so a 1920-wide desktop browser does not stretch a menu row a
// metre wide. Swept across the three screens the finding measured directly.
test("every menu screen stays capped at 1920 wide", async ({ page, baseURL }) => {
  test.setTimeout(2 * 60_000);
  await page.setViewportSize({ width: 1920, height: 1080 });

  const assertCapped = async (where: string) => {
    // expo-router keeps prior screens mounted (display:none) during a
    // transition, so more than one menu-content node can exist at once —
    // the visible one is the current screen's.
    const content = page.getByTestId("menu-content").locator("visible=true").last();
    await expect(content, where).toBeVisible();
    const box = await content.boundingBox();
    expect(box, where).not.toBeNull();
    expect(box!.width, `${where}: ${box!.width}px wide`).toBeLessThanOrEqual(840);
  };

  await openApp(page, baseURL!);
  await page.goto(`${baseURL!}/this-route-does-not-exist`);
  await assertCapped("not-found");

  await openApp(page, baseURL!);
  await registerNewAccount(
    page,
    `capw${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`
  );

  // Profile and leaderboard are reached from the home menu, before ever
  // visiting the online lobby.
  await page.getByRole("button", { name: "Il mio profilo" }).click();
  await settled(page, 1500);
  await page.getByRole("button", { name: /classifica/i }).first().click();
  await settled(page, 1500);
  await assertCapped("leaderboard");

  await openApp(page, baseURL!);
  await goToOnlineLobby(page);
  await assertCapped("online lobby");
});

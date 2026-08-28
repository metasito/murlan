// tests/e2e/ariaTwins.spec.ts — the `aria-*` half of lib/a11y.tsx, read off the DOM.
//
// react-native-web forwards accessibility props one at a time, so which of them
// survives is a per-attribute fact about the library and not something the source
// can state. A helper that emitted nothing at all would satisfy any scan of
// lib/a11y.tsx; only a browser knows.
import { test, expect } from "@playwright/test";
import { openApp } from "./helpers/navigation";
import { openSeededGame } from "./helpers/offlineSeed";

const BOOLEAN = /^(true|false)$/;

test.describe("the aria twins reach the DOM", () => {
  test("the settings modal carries every twin its controls declare", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 900, height: 800 });
    await openApp(page, baseURL!);
    await page.getByRole("button", { name: "Impostazioni" }).first().click();

    // Named controls rather than a count: an attribute that arrived on something
    // else entirely would satisfy a count and prove nothing about this helper.
    const logout = page.getByRole("button", { name: "Esci da questo account" });
    await expect(logout).toBeVisible();
    await expect(logout).toHaveAttribute("aria-busy", BOOLEAN);

    const reportBug = page.getByRole("button", { name: "Segnala un problema" });
    await expect(reportBug).toHaveAttribute("aria-expanded", BOOLEAN);

    await expect(page.getByRole("radio").first()).toHaveAttribute("aria-checked", BOOLEAN);
    await expect(page.getByRole("button", { name: "Italiano" })).toHaveAttribute(
      "aria-pressed",
      BOOLEAN
    );

    const slider = page.getByRole("slider").first();
    for (const attr of ["aria-valuenow", "aria-valuemin", "aria-valuemax", "aria-valuetext"]) {
      await expect(slider, `${attr} never reached the DOM`).toHaveAttribute(attr, /.+/);
    }
  });

  test("a control that stays operable is not announced as disabled", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await openSeededGame(page, baseURL!, 4);
    const gioca = page.locator('[data-testid="btn-gioca"]');
    const passa = page.locator('[data-testid="btn-passa"]');
    await expect(gioca).toBeVisible();

    // PASSA is genuinely inoperable when it cannot be pressed, and says so.
    await expect(passa).toHaveAttribute("aria-disabled", "true");

    // GIOCA answers an illegal play with a shake and a spoken reason, so it is
    // operable and reachable, and the refusal is in its name. `aria-disabled`
    // here would be a false claim — and unreachable anyway: react-native-web's
    // Pressable overwrites the attribute with its own `disabled` prop, and that
    // prop would also make the DOM button really disabled.
    await expect(gioca).not.toHaveAttribute("aria-disabled", /.*/);
    await expect(gioca).toHaveAttribute("tabindex", "0");
    await expect(gioca).toHaveAttribute("aria-label", /non disponibile: /);
  });
});

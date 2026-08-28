// tests/e2e/homeArena.spec.ts — the home screen's composition, which is the
// half of #394 no unit test can decide.
//
// `tests/homeMenuModel.test.ts` settles *which* ways to play are offered and
// which are promoted; that is a set, and a set is decidable from source. Where
// they land is not: `@testing-library/react-native` runs on
// `react-test-renderer`, which never runs flexbox, so "one hero", "the quiet
// row is against the bottom edge" and "the account block is never one line"
// are true or false only in a browser.
import { test, expect, type Page } from "@playwright/test";
import { openApp } from "./helpers/navigation";
import { offlineGameSave } from "./helpers/offlineSeed";
// The suite runs the app in Italian. Read from the locale rather than restated
// here: a spec holding its own copy of the copy goes stale on the next rename
// and fails naming a string nobody changed.
import { it as copy } from "../../locales/it";

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

const HERO = '[data-testid="home-hero"]';
const TILE = '[data-testid="home-mode-tile"]';
const HOW_TO_PLAY = '[data-testid="home-how-to-play"]';

/** Opens home with a game already saved, without resuming it. */
async function openWithSave(page: Page, baseURL: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: "@murlan_offline_game", value: JSON.stringify(offlineGameSave(4, 13)) }
  );
  await openApp(page, baseURL);
}

const box = (page: Page, selector: string) => page.locator(selector).first().boundingBox();

test("no save: one hero, and it says where it leads", async ({ page, baseURL }) => {
  await page.setViewportSize(PORTRAIT);
  await openApp(page, baseURL!);

  await expect(page.locator(HERO), "the screen drew more than one hero, or none").toHaveCount(1);

  // Signed out, and the silent redirect to /auth is the defect being fixed:
  // the hero has to say so on its face.
  const name = await page.locator(HERO).getAttribute("aria-label");
  expect(name, "the hero is not the online one").toContain(copy["home.playOnline"]);
  expect(
    name,
    "the signed-out hero does not say it leads to signing in"
  ).toContain(copy["home.playOnlineSignedOut"]);

  await expect(
    page.getByRole("button", { name: copy["home.resumeGame"] }),
    "Resume was offered with nothing to resume"
  ).toHaveCount(0);
});

test("a save promotes Resume, and Online drops out of the grid it now leads", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize(PORTRAIT);
  await openWithSave(page, baseURL!);

  await expect(page.locator(HERO)).toHaveCount(1);
  expect(await page.locator(HERO).getAttribute("aria-label")).toContain(copy["home.resumeGame"]);

  // Four with a save, three without — and never the hero twice.
  await expect(page.locator(TILE), "the grid does not hold the four ways to play").toHaveCount(4);
  const tiles = await page.locator(TILE).evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  );
  expect(
    tiles.filter((l) => l.includes(copy["home.resumeGame"])),
    "Resume is both hero and tile"
  ).toHaveLength(0);
});

test("no save: the grid loses the way to play the hero became", async ({ page, baseURL }) => {
  await page.setViewportSize(PORTRAIT);
  await openApp(page, baseURL!);

  await expect(page.locator(TILE)).toHaveCount(3);
  const tiles = await page.locator(TILE).evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  );
  expect(
    tiles.filter((l) => l === copy["home.modeOnline"]),
    "Online is the hero and is offered again as a tile"
  ).toHaveLength(0);
});

test("How to play sits against the bottom edge, not trailing the tiles", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize(PORTRAIT);
  await openApp(page, baseURL!);

  const row = await box(page, HOW_TO_PLAY);
  const lastTile = await page.locator(TILE).last().boundingBox();
  expect(row && lastTile).toBeTruthy();

  expect(row!.y, "How to play is above the tiles").toBeGreaterThan(lastTile!.y);

  // Trailing the tiles means it starts where they end. Pinned means the space
  // is above it, not below — so the gap under it is a padding, and the gap
  // over it is whatever is left of the screen.
  const below = PORTRAIT.height - (row!.y + row!.height);
  const above = row!.y - (lastTile!.y + lastTile!.height);
  expect(below, `${below}px of dead screen under the bottom row`).toBeLessThan(above);
});

test("signed out, the account-only tiles are refused rather than redirected", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize(PORTRAIT);
  await openApp(page, baseURL!);

  const labels = await page.locator(TILE).evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  );
  for (const name of [copy["home.modePlayWithFriends"], copy["home.modeOnline"]]) {
    const label = labels.find((l) => l.startsWith(name));
    expect(label, `${name} is not offered at all`).toBeTruthy();
    expect(label, `${name} is offered with no reason it cannot be taken`).toContain(
      copy["home.requiresAccount"]
    );
  }

  // The redirect is the defect: clicking a refused tile must leave the player
  // where they are.
  await page.locator(TILE).nth(1).click({ force: true });
  await expect(page.locator(HERO), "a disabled tile navigated away from home").toHaveCount(1);
});

test("landscape composes the account block down the column, never along one line", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize(LANDSCAPE);
  await openApp(page, baseURL!);

  // Signed out it collapses to two entries and there is no pair to check.
  const pair = page.locator('[data-testid="home-account-pair"]');
  if ((await pair.count()) === 0) {
    test.skip(true, "signed out: the account block has no avatar and no pair");
  }

  const avatar = (await box(page, '[data-testid="home-account-avatar"]'))!;
  const settings = (await box(page, '[data-testid="home-account-settings"]'))!;
  const pills = await pair.locator('[role="button"]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left };
    })
  );

  expect(pills.length, "Friends and Ranking are not a pair").toBe(2);
  expect(pills[0].top, "the pair is stacked rather than sharing a line").toBeCloseTo(pills[1].top, 0);
  expect(pills[0].left, "the pair overlaps itself").not.toBeCloseTo(pills[1].left, 0);

  expect(avatar.y + avatar.height, "the avatar is not above the pair").toBeLessThanOrEqual(
    pills[0].top + 1
  );
  expect(settings.y, "Settings shares the pair's line").toBeGreaterThan(pills[0].top);
});

// The owner asked for these to survive the rebuild by name. A regression here
// is silent: the screen still works, and the thing that made it feel like
// something is gone.
test("the floating cards survive the rebuild, in both orientations", async ({ page, baseURL }) => {
  await page.setViewportSize(PORTRAIT);
  await openApp(page, baseURL!);
  await expect(page.locator('[data-testid="floating-card"]')).toHaveCount(6);

  await page.setViewportSize(LANDSCAPE);
  await expect(page.locator('[data-testid="floating-card"]')).toHaveCount(4);
});

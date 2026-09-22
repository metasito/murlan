// The leaderboard's Friends view, laid out by a real browser: a renderer that
// never runs flexbox cannot tell a row on screen from one pushed off it.

import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { it as copy } from "../../locales/it";

test("the Friends view ranks the viewer alone, then beside an accepted friend, on screen", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(2 * 60_000);
  const username = uniqueUsername("e2eladder");

  await openApp(page, baseURL!);
  await registerNewAccount(page, username);
  await page.goto(`${baseURL}/leaderboard`);

  const friendsTab = page.getByRole("tab", { name: copy["ladder.scopeFriends"] });
  await expect(page.getByRole("tab", { name: copy["ladder.scopeGlobal"] })).toHaveAttribute("aria-selected", "true");
  await friendsTab.click();
  await expect(friendsTab).toHaveAttribute("aria-selected", "true");

  const rows = page.getByTestId("ladder-rows-friends");
  await expect(rows).toBeInViewport();
  await expect(rows.getByText(username, { exact: true })).toBeInViewport();
  await expect(rows.getByText(username, { exact: true })).toHaveCount(1);

  const findFriends = page.getByRole("button", { name: copy["ladder.friendsEmptyAction"] });
  await expect(findFriends).toBeVisible();

  const other = await browser.newContext({ locale: "it-IT" });
  try {
    const otherPage = await other.newPage();
    const friend = uniqueUsername("e2eladderf");
    await openApp(otherPage, baseURL!);
    await registerNewAccount(otherPage, friend);
    expect((await otherPage.request.post(`${baseURL}/api/friends/add`, { data: { username } })).status()).toBe(200);
    const incoming = (await (await page.request.get(`${baseURL}/api/friends/requests`)).json()) as { id: string }[];
    expect(incoming).toHaveLength(1);
    expect((await page.request.post(`${baseURL}/api/friends/accept/${incoming[0].id}`)).status()).toBe(200);

    await page.reload();
    await friendsTab.click();
    await expect(rows.getByText(friend, { exact: true })).toBeInViewport();
    await expect(rows.getByText(username, { exact: true })).toBeInViewport();
    await expect(findFriends).toBeHidden();
  } finally {
    await other.close();
  }
});

test("a friendless viewer's empty state leads to the friends screen", async ({ page, baseURL }) => {
  test.setTimeout(2 * 60_000);
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("e2eladdere"));
  await page.goto(`${baseURL}/leaderboard`);
  await page.getByRole("tab", { name: copy["ladder.scopeFriends"] }).click();
  await page.getByRole("button", { name: copy["ladder.friendsEmptyAction"] }).click();
  await page.waitForURL(/\/friends/);
});

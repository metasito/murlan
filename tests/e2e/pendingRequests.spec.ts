// The PENDING section on the friends screen, in the browser's own tree.
//
// No unit test can stand in for this one: whether a section renders when its
// lists are empty is exactly the thing a `react-test-renderer` snapshot will
// happily agree with while the real screen shows nothing.

import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { it as copy } from "../../locales/it";

const FRIENDS_BUTTON = /^Amici/;

async function openFriends(page: Page): Promise<void> {
  await page.getByRole("button", { name: FRIENDS_BUTTON }).first().click();
  await page.waitForURL(/\/friends/);
  await expect(page.getByRole("heading", { name: copy["friends.sectionPending"] })).toBeVisible();
}

/** Searches for `username` and sends them a request, from the friends screen. */
async function sendRequestTo(page: Page, username: string): Promise<void> {
  await page.getByRole("textbox", { name: copy["friends.searchA11yLabel"] }).fill(username);
  await page.getByRole("button", { name: copy["friends.searchA11yLabel"] }).click();
  const send = page.getByRole("button", {
    name: copy["friends.sendRequestA11yLabel"].replace("{{username}}", username),
  });
  await send.click();
  await expect(send).toBeHidden();
}

test("pending requests — the section is there when empty, and names both directions when not", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(3 * 60_000);

  const contextA = await browser.newContext({ locale: "it-IT" });
  const contextB = await browser.newContext({ locale: "it-IT" });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const userA = uniqueUsername("e2ependa");
    const userB = uniqueUsername("e2ependb");

    await openApp(pageA, baseURL!);
    await registerNewAccount(pageA, userA);
    await openApp(pageB, baseURL!);
    await registerNewAccount(pageB, userB);

    // 1. A brand-new account has nothing pending in either direction, and the
    //    section still says so rather than rendering nothing at all.
    await openFriends(pageA);
    const emptyLine = copy["friends.emptyPending"].split("\n")[0];
    await expect(pageA.getByText(emptyLine)).toBeVisible();
    await expect(pageA.getByText(copy["friends.pendingIncoming"])).toBeHidden();
    await expect(pageA.getByText(copy["friends.pendingOutgoing"])).toBeHidden();

    // 2. A sends to B. A's own copy moves under "waiting for them", and says
    //    how long it has been waiting rather than only that it is.
    await sendRequestTo(pageA, userB);
    await expect(pageA.getByText(copy["friends.pendingOutgoing"])).toBeVisible();
    await expect(pageA.getByText(userB, { exact: true })).toBeVisible();
    await expect(
      pageA.getByText(copy["friends.awaitingSince"].replace("{{time}}", copy["friends.timeJustNow"]))
    ).toBeVisible();
    await expect(pageA.getByText(emptyLine)).toBeHidden();
    await expect(pageA.getByText(copy["friends.pendingIncoming"])).toBeHidden();

    // 3. The same request, from the other side: incoming, and actionable.
    await openFriends(pageB);
    await expect(pageB.getByText(copy["friends.pendingIncoming"])).toBeVisible();
    await expect(pageB.getByText(copy["friends.pendingOutgoing"])).toBeHidden();
    await expect(pageB.getByTestId("section-count")).toHaveText("1");
    const accept = pageB.getByRole("button", {
      name: copy["friends.acceptRequestA11yLabel"].replace("{{username}}", userA),
    });
    await expect(accept).toBeVisible();

    // 4. Accepting empties both directions, and the section survives it.
    await accept.click();
    await expect(pageB.getByText(emptyLine)).toBeVisible();
    await expect(pageB.getByText(userA, { exact: true })).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("pending requests — the badge counts incoming only", async ({ browser, baseURL }) => {
  test.setTimeout(3 * 60_000);

  const contextA = await browser.newContext({ locale: "it-IT" });
  const contextB = await browser.newContext({ locale: "it-IT" });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const userA = uniqueUsername("e2ebadga");
    const userB = uniqueUsername("e2ebadgb");

    await openApp(pageA, baseURL!);
    await registerNewAccount(pageA, userA);
    await openApp(pageB, baseURL!);
    await registerNewAccount(pageB, userB);

    await openFriends(pageA);
    await sendRequestTo(pageA, userB);

    // A holds one outgoing request. It is not a task A owes anyone, so neither
    // the section header nor the home entry point may count it. A has no
    // friends either, so every count badge on this screen would be a wrong one.
    await expect(pageA.getByText(copy["friends.pendingOutgoing"])).toBeVisible();
    await expect(pageA.getByTestId("section-count")).toHaveCount(0);

    await pageA.getByRole("button", { name: copy["common.back"] }).click();
    await expect(
      pageA.getByRole("button", { name: copy["home.friendsLabel"], exact: true }).first()
    ).toBeVisible();

    // B holds the matching incoming request, which does count — on the home
    // button's own name, which is where the count is spoken.
    await pageB.reload();
    await expect(
      pageB.getByRole("button", {
        name: copy["home.friendsA11yLabel_one"].replace("{{count}}", "1"),
      }).first()
    ).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

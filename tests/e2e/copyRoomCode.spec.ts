// The confirmation is a rename of the button itself, so this is the only
// place the claim is true or false: a source scan can see that
// `common.copied` is read, not that a player ever sees it, and no unit test
// renders this screen.
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { createRoom, goToOnlineLobby } from "./helpers/online";

// Chromium grants clipboard writes to a focused page on its own, but only
// sometimes; an ungranted write rejects inside the handler and the button
// would never rename itself, which is a fixture failure rather than a
// finding.
test.use({ permissions: ["clipboard-write", "clipboard-read"] });

test("copying the room code says so, and goes back to offering", async ({
  page,
  baseURL,
  consoleErrors,
}) => {
  test.setTimeout(60_000);
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("e2ecopy"));
  await goToOnlineLobby(page);
  const code = await createRoom(page, { playerCount: 2, gameMode: "free_for_all" });

  const copy = page.getByRole("button", { name: "Copia" });
  await expect(copy).toBeVisible();
  await copy.click();

  await expect(copy.getByText("Copiato!")).toBeVisible();
  await expect(page.getByRole("status", { name: "Copiato!" })).toBeAttached();
  // The control keeps its name throughout: it is still a button that copies,
  // and a name that turns into a past-tense status is one nothing can ask for.
  await expect(copy).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  // The offer has to come back, or a second copy has nothing to confirm.
  await expect(copy.getByText("Copia")).toBeVisible({ timeout: 5_000 });

  expect(consoleErrors.entries, "no console errors while copying the room code").toEqual([]);
});

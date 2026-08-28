// The room code's copy button is the only feedback a copy has: nothing else
// on the screen changes, and the haptic it fires is silent on web. The
// confirmation is a rename of the button, so this is also the only place it
// can be checked — a source scan can see that `common.copied` is read, not
// that a player ever sees it.
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount } from "./helpers/navigation";
import { createRoom, goToOnlineLobby } from "./helpers/online";

// Chromium grants clipboard writes to a focused page on its own, but only
// sometimes; an ungranted write rejects inside the handler and the button
// would never rename itself, which is a fixture failure rather than a
// finding.
test.use({ permissions: ["clipboard-write", "clipboard-read"] });

function uniqueUsername(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
}

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

  await expect(page.getByRole("button", { name: "Copiato!" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  // The offer has to come back, or a second copy has nothing to confirm.
  await expect(page.getByRole("button", { name: "Copia" })).toBeVisible({ timeout: 5_000 });

  expect(consoleErrors.entries, "no console errors while copying the room code").toEqual([]);
});

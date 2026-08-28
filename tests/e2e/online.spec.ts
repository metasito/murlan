// Plays real online games through the server-authoritative socket flow:
// register, create/join a room, and drive the same rendered <GameTable> the
// offline suite drives — the same bot works unmodified because both
// screens share one component and the same accessibility contract.

import type { Page } from "@playwright/test";
import { test, expect, isExpectedNoise } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { createRoom, fillWithBotsAndStart, goToOnlineLobby, joinRoom, startRoom } from "./helpers/online";
import { driveGameToCompletion } from "./helpers/bot";

const LEAVE_BUTTON = { role: "button" as const, name: "Esci dalla partita" };

async function isOnlineGameOver(page: Page): Promise<boolean> {
  return page.getByRole(LEAVE_BUTTON.role, { name: LEAVE_BUTTON.name }).isVisible();
}

test("online — host fills the room with bots and plays a real server-authoritative game", async ({
  page,
  baseURL,
  consoleErrors,
}) => {
  test.setTimeout(6 * 60_000);
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("e2ehost"));
  await goToOnlineLobby(page);
  await createRoom(page, { playerCount: 2, gameMode: "free_for_all" });
  await fillWithBotsAndStart(page);

  await driveGameToCompletion(page, {
    isFinished: isOnlineGameOver,
    log: (line) => test.info().annotations.push({ type: "move", description: line }),
  });

  await expect(page.getByRole(LEAVE_BUTTON.role, { name: LEAVE_BUTTON.name })).toBeVisible();
  await page.getByRole(LEAVE_BUTTON.role, { name: LEAVE_BUTTON.name }).click();

  expect(consoleErrors.entries, "no console errors/warnings during the online game").toEqual([]);
});

test("online — two real browsers play a live 2-player game against each other", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(7 * 60_000);

  const contextA = await browser.newContext({ locale: "it-IT" });
  const contextB = await browser.newContext({ locale: "it-IT" });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await pageA.emulateMedia({ reducedMotion: "reduce" });
  await pageB.emulateMedia({ reducedMotion: "reduce" });

  const errorsA: string[] = [];
  const errorsB: string[] = [];
  for (const [p, sink] of [[pageA, errorsA], [pageB, errorsB]] as const) {
    p.on("console", (msg) => {
      if (msg.type() !== "error" && msg.type() !== "warning") return;
      if (isExpectedNoise(msg.text(), msg.location().url)) return;
      sink.push(`console.${msg.type()}: ${msg.text()}`);
    });
    p.on("pageerror", (err) => sink.push(`pageerror: ${err.message}`));
  }

  try {
    await openApp(pageA, baseURL!);
    await registerNewAccount(pageA, uniqueUsername("e2ea"));
    await openApp(pageB, baseURL!);
    await registerNewAccount(pageB, uniqueUsername("e2eb"));

    await goToOnlineLobby(pageA);
    const code = await createRoom(pageA, { playerCount: 2, gameMode: "free_for_all" });

    await goToOnlineLobby(pageB);
    await joinRoom(pageB, code);

    await startRoom(pageA);
    await pageB.waitForURL(/\/game/);

    await Promise.all([
      driveGameToCompletion(pageA, {
        isFinished: isOnlineGameOver,
        log: (line) => test.info().annotations.push({ type: "move-A", description: line }),
      }),
      driveGameToCompletion(pageB, {
        isFinished: isOnlineGameOver,
        log: (line) => test.info().annotations.push({ type: "move-B", description: line }),
      }),
    ]);

    await expect(pageA.getByRole(LEAVE_BUTTON.role, { name: LEAVE_BUTTON.name })).toBeVisible();
    await expect(pageB.getByRole(LEAVE_BUTTON.role, { name: LEAVE_BUTTON.name })).toBeVisible();

    expect(errorsA, "no console errors/warnings for player A").toEqual([]);
    expect(errorsB, "no console errors/warnings for player B").toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

// Watch navigates on the server's answer, never on the emit. An unknown code is
// refused, so no state ever arrives, and a game screen with nothing to draw is
// a blank page with no text and no control whose only exit is the browser's
// back button.
test("online — watching a room that does not exist keeps the player in the lobby", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(2 * 60_000);
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("e2ewatch"));
  await goToOnlineLobby(page);

  await page.getByRole("button", { name: "Inserisci codice stanza" }).click();
  await page.getByRole("textbox", { name: "Codice stanza" }).fill("ZZZZZZ");
  await page.getByRole("button", { name: "Guarda" }).click();

  // Announced, not just drawn — and by text, because NotificationBanner and
  // OfflineBanner are always mounted and both carry role="alert".
  await expect(
    page.getByRole("alert").filter({ hasText: "Stanza non trovata" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Crea Stanza" })).toBeVisible();
  expect(page.url()).not.toMatch(/\/game/);
});

// A phone in portrait, which is how most people hold one, and the narrowest
// layout the online lobby has.
//
// The two sections carry `flex: 1` for the landscape row where they sit side by
// side. Stacked in the portrait ScrollView that made them fight over the
// container's height instead of sizing to content, and they overlapped: the
// "oppure" divider came to rest on top of the create button and swallowed its
// taps. Nothing looked broken — the button was visible, enabled and correctly
// labelled — it simply could not be pressed, so no room could be created on a
// phone at all. Only a real click finds that.
test("online — a room can be created on a phone in portrait", async ({ page, baseURL }) => {
  test.setTimeout(2 * 60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("e2eport"));
  await goToOnlineLobby(page);

  const code = await createRoom(page, { playerCount: 4, gameMode: "free_for_all" });
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  // UI-02: the portrait waiting room is taller than the viewport with all
  // four seats and the invite panel present — both must be reachable by
  // scrolling, not just present in the DOM off-screen. The room screen
  // renders both its landscape and portrait branches at once (shown/hidden
  // by CSS), so more than one copy of each can match.
  const lastSeat = page.getByText("In attesa…").locator("visible=true").last();
  await lastSeat.scrollIntoViewIfNeeded();
  await expect(lastSeat).toBeInViewport();

  const invitePanel = page.getByText("INVITA AMICI").locator("visible=true").last();
  await invitePanel.scrollIntoViewIfNeeded();
  await expect(invitePanel).toBeInViewport();

  // The start button stays pinned outside the scroll area regardless — still
  // "waiting for players" with three empty seats, not yet "Inizia Partita".
  // The room screen renders both its landscape and portrait branches at
  // once (shown/hidden by CSS), so more than one copy can match.
  await expect(
    page.getByRole("button", { name: "In attesa di giocatori" }).locator("visible=true").last()
  ).toBeInViewport();
});

// A bare absolutely-positioned sheet covers the lobby's pixels and nothing
// else — every control behind it stays focusable and announced. Only a real
// browser can say whether the <Modal> that replaced it carries the three
// things a Modal is here for, so the source scan in
// tests/blockingOverlays.test.ts is not enough on its own (#474).
test("online — the join sheet is a modal dialog with a name, and Escape closes it", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(2 * 60_000);
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("e2ejoin"));
  await goToOnlineLobby(page);

  await page.getByRole("button", { name: "Inserisci codice stanza" }).click();
  const sheet = page.getByRole("dialog", { name: "Entra in una stanza" });
  await expect(sheet).toBeVisible();
  // What tells assistive technology to ignore everything outside the dialog.
  await expect(sheet).toHaveAttribute("aria-modal", "true");

  // Closing by any route clears the code, so a half-typed one from a previous
  // attempt is not waiting in the field the next time the sheet opens.
  await page.getByRole("textbox", { name: "Codice stanza" }).fill("ABCD12");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.getByRole("button", { name: "Inserisci codice stanza" }).click();
  await expect(page.getByRole("textbox", { name: "Codice stanza" })).toHaveValue("");
});

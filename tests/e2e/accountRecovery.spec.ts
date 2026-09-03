// #893 — the account-recovery screens, driven end to end: register, verify
// the address, sign out, and recover a forgotten password — the one thing a
// source scan cannot tell apart from a rendered, wired control (design doc,
// docs/design/2026-09-03-account-recovery-screens.md).
import { test, expect } from "./fixtures";
import { openApp, uniqueUsername } from "./helpers/navigation";
import { readMailToken } from "./helpers/mailSink";

test("account recovery — verify a fresh address, then reset a forgotten password", async ({
  page,
  baseURL,
  consoleErrors,
}) => {
  test.setTimeout(3 * 60_000);

  const username = uniqueUsername("e2erecover");
  const email = `${username}@example.test`;
  const originalPassword = "e2e-test-pw";
  const newPassword = "e2e-recovered-pw";

  await openApp(page, baseURL!);

  // ── register, then verify from the "check your email" interstitial ──────
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await page.waitForURL(/\/auth/);
  await page.getByRole("tab", { name: "Registrati" }).click();
  await page.getByRole("textbox", { name: "Nome utente" }).fill(username);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(originalPassword);
  await page.getByRole("button", { name: "Crea account" }).click();

  await page.getByRole("button", { name: "Inserisci il codice ora" }).click();
  await page.waitForURL(/\/verify-email/);

  const verifyToken = await readMailToken(email, "Verify your Murlan email");
  await page.getByRole("textbox", { name: "Codice di verifica" }).fill(verifyToken);
  await page.getByRole("button", { name: "Verifica" }).click();
  await expect(page.getByText("Email verificata")).toBeVisible();
  await page.getByRole("button", { name: "Fatto" }).click();

  // Back on the interstitial, which now reads the account rather than the
  // state it was created in: registration signed this device in (a fresh,
  // unclaimed address), so it offers "Continua".
  await page.waitForURL(/\/auth/);
  await expect(page.getByText("Il tuo indirizzo è confermato.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Continua" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"));

  // ── sign out ──────────────────────────────────────────────────────────
  await page.goto(baseURL!);
  await page.getByRole("button", { name: "Impostazioni" }).first().click();
  await page.getByRole("button", { name: "Esci da questo account" }).click();
  await page.getByTestId("confirm-accept").click();
  await page.waitForURL(/\/auth/);

  // ── forgot password ───────────────────────────────────────────────────
  await page.getByRole("button", { name: "Password dimenticata?" }).click();
  await page.waitForURL(/\/recover/);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Invia codice" }).click();

  const resetToken = await readMailToken(email, "Reset your Murlan password");
  await page.getByRole("textbox", { name: "Codice di reimpostazione" }).fill(resetToken);
  await page.getByRole("textbox", { name: "Nuova password" }).fill(newPassword);
  await page.getByRole("button", { name: "Reimposta password" }).click();

  // reset-password mints no session (design doc) — back to sign-in, with the
  // notice, never straight into the app.
  await page.waitForURL(/\/auth/);
  await expect(page.getByText("Password reimpostata. Accedi con la nuova password.")).toBeVisible();

  // ── sign in with the new password ────────────────────────────────────
  await page.getByRole("textbox", { name: "Nome utente" }).fill(username);
  await page.getByRole("textbox", { name: "Password" }).fill(newPassword);
  await page.getByRole("button", { name: "Entra", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"));

  expect(consoleErrors.entries, "no console errors/warnings during account recovery").toEqual([]);
});

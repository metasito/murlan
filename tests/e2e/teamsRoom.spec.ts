// The online lobby's teams path end to end: `createRoom` picks the teams chip by whichever
// name the lobby gives it, and the room it opens is a teams room.

import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { goToOnlineLobby, createRoom } from "./helpers/online";
import { it } from "../../locales/it.ts";

test("a room created with teams chosen opens as a teams room", async ({ page, baseURL }) => {
  await openApp(page, baseURL!);
  await registerNewAccount(page, uniqueUsername("teams"));
  await goToOnlineLobby(page);
  const code = await createRoom(page, { playerCount: 4, gameMode: "teams" });
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await expect(page.getByText(new RegExp(`^${it["term.mode.teams"]} · 4`))).toBeVisible();
});

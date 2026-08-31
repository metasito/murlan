// tests/e2e/smokeFlowCopy.spec.ts — the device flows select on copy, and copy
// moves. `smoke.yaml` waited for "Online" on the home screen for five days after
// #343 promoted the online action into the hero, where it renders
// `home.playOnline` instead and `home.modeOnline` is rendered nowhere (#620).
//
// Nothing caught it because both device loops are `workflow_dispatch` only and
// nobody dispatched them; when someone finally did, it cost a twenty-minute
// emulator run to learn that a string had moved. The strings are read out of the
// flow itself rather than restated here, so a flow edited to expect something new
// is checked by this spec on the next pull request rather than on the next
// dispatch.
//
// What this cannot check: that the *device* renders them. It checks that the copy
// exists on this screen in this state, which is the half that goes stale.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openApp } from "./helpers/navigation";

const FLOW = path.join(__dirname, "..", "..", ".maestro", "smoke.yaml");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Everything `smoke.yaml` asserts visible while it is on the home screen: after
 * the tutorial-skip block, and before it opens the settings modal.
 */
function homeAssertions(): string[] {
  const flow = readFileSync(FLOW, "utf8");
  const start = flow.indexOf("notVisible: \"GUIDA RAPIDA\"");
  const end = flow.indexOf("tapOn: \"Impostazioni\"");
  expect(start, "the tutorial-skip block moved; this slice no longer means home").toBeGreaterThan(0);
  expect(end, "the flow no longer opens settings; this slice no longer means home").toBeGreaterThan(start);
  return [...flow.slice(start, end).matchAll(/^- assertVisible: "([^"]+)"$/gm)].map((m) => m[1]);
}

test.describe("the copy smoke.yaml waits for on home", () => {
  test("is all on the home screen, signed out and with no saved game", async ({ page, baseURL }) => {
    // The state both device loops are always in: `clearState: true` means no
    // account and no saved game, so `homeMenu` promotes `online` to the hero.
    await openApp(page, baseURL!);

    const expected = homeAssertions();
    expect(expected.length, "no assertions found between the tutorial and settings").toBeGreaterThan(0);

    const missing: string[] = [];
    for (const text of expected) {
      // Case-sensitively, because that is what Maestro does and the difference is
      // the whole bug: `getByText(s, { exact: false })` is case-INsensitive, so
      // "Online" matches "Gioca online" here and this spec passes while the device
      // fails. A RegExp locator is unanchored and case-sensitive — Maestro's own
      // matching — and it is what makes this test able to fail.
      const count = await page.getByText(new RegExp(escapeRegExp(text))).count();
      if (count === 0) missing.push(text);
    }

    expect(
      missing,
      `smoke.yaml waits for copy the home screen does not render: ${missing.join(", ")}. ` +
        "Either the flow is stale or the screen regressed - both are real, and both cost a " +
        "device dispatch to find otherwise.",
    ).toEqual([]);
  });
});

// tests/e2e/smokeFlowCopy.spec.ts — the device flows select on copy, and this is
// the only layer that can tell them the copy moved. The strings are read out of
// the flow rather than restated, so a flow edited to expect something new is
// checked here rather than on the next hand-dispatched device run.
//
// It models Maestro's matching, which is **the whole element, case-insensitively**,
// against a node's accessibility label or its text — not a substring, and not the
// DOM's text alone. A substring check passes "Online" against "Gioca online" and a
// text-only check passes strings that iOS, which exposes labels and no text nodes,
// can never match.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openApp } from "./helpers/navigation";

const FLOW = path.join(__dirname, "..", "..", ".maestro", "smoke.yaml");

/**
 * Everything `smoke.yaml` asserts visible while it is on the home screen: after
 * the tutorial-skip block, and before it opens the settings modal.
 *
 * Only the inline `- assertVisible: "…"` form. The object form (`text:`, `id:`)
 * and assertions nested in a `runFlow` are deliberately out of reach, so the count
 * is asserted below rather than left to shrink silently.
 */
function homeAssertions(): string[] {
  const flow = readFileSync(FLOW, "utf8");
  const start = flow.indexOf('notVisible: "GUIDA RAPIDA"');
  const end = flow.indexOf('tapOn: "Impostazioni"');
  expect(start, "the tutorial-skip block moved; this slice no longer means home").toBeGreaterThan(0);
  expect(end, "the flow no longer opens settings; this slice no longer means home").toBeGreaterThan(start);
  return [...flow.slice(start, end).matchAll(/^- assertVisible: "([^"]+)"$/gm)].map((m) => m[1]);
}

// Portrait, because that is what both device loops render. At the default desktop
// width the home screen lays itself out differently and puts strings on screen as
// text that a phone only ever exposes as a label — which would pass this spec for
// a composition no device draws.
test.use({ viewport: { width: 390, height: 844 } });

test("every string smoke.yaml waits for on home is rendered there", async ({ page, baseURL }) => {
  // The state both device loops are always in: `clearState: true` means no account
  // and no saved game, so `homeMenu` promotes `online` into the hero.
  await openApp(page, baseURL!);

  const expected = homeAssertions();
  expect(expected.length, "no assertions found between the tutorial and settings").toBe(3);

  const rendered = await page.evaluate(() => {
    const labels: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      const aria = el.getAttribute("aria-label");
      if (aria) labels.push(aria);
      // Leaf text only: a container's concatenated text is not a node anything
      // could match, and would make almost any string appear present.
      if (el.children.length === 0 && el.textContent) labels.push(el.textContent);
    }
    return labels;
  });

  const missing = expected.filter(
    (want) => !rendered.some((got) => got.trim().toLowerCase() === want.toLowerCase()),
  );

  expect(
    missing,
    `smoke.yaml waits for copy no node on the home screen carries: ${missing.join(", ")}. ` +
      "Either the flow is stale or the screen regressed - both are real, and both otherwise " +
      "cost a device dispatch to find.",
  ).toEqual([]);
});

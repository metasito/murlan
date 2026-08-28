// A labelled control must be a leaf: the words and glyphs it draws itself with
// are its face, not extra stops a reader walks past.
//
// `tests/a11yOneNode.test.ts` reads the props. This reads what the browser
// built from them, which is the only place the property is actually true or
// false. Neither string query gets there: `page.getByText()` counts a DOM node
// whether or not it is `aria-hidden`, and `toMatchAriaSnapshot` prints a
// button's contents either way — #393 seeded an unhidden child against both
// and both stayed green. The full tree distinguishes them exactly.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";
import { openSeededGame } from "./helpers/offlineSeed";

/** Roles whose contents are the control's own face rather than content. */
const WIDGETS = new Set(["button", "radio", "link", "checkbox", "switch", "tab"]);

const SCREENS = ["/", "/lobby", "/rules"];

interface AxNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  ignored?: boolean;
  childIds?: string[];
}

async function axTree(page: Page): Promise<AxNode[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };
  return nodes;
}

/**
 * Names ARIA will not announce: `generic` is the implicit role of a `<div>`,
 * and a name is prohibited on it. A container labelled with `accessible` alone
 * lands here, because react-native-web forwards that prop nowhere.
 *
 * Asserted on the menu screens only. The game table carries one deliberately —
 * `game-table`'s label is a channel `tests/e2e/helpers/bot.ts` reads as an
 * attribute rather than a name, which its own call site says (#505).
 */
function namedGenerics(nodes: AxNode[]): string[] {
  return nodes
    .filter((n) => !n.ignored && n.role?.value === "generic" && n.name?.value?.trim())
    .map((n) => `generic "${n.name!.value}"`);
}

for (const screen of SCREENS) {
  test(`every control on ${screen} is one accessible node`, async ({ page, baseURL }) => {
    await openApp(page, baseURL!);
    await page.goto(`${baseURL}${screen}`);
    await page.waitForSelector('[role="button"]');

    const nodes = await axTree(page);
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));

    const widgets = nodes.filter((n) => !n.ignored && WIDGETS.has(n.role?.value ?? ""));
    // A screen with no control would pass every assertion below by having
    // nothing to assert about.
    expect(widgets.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const widget of widgets) {
      const stack = [...(widget.childIds ?? [])];
      while (stack.length) {
        const child = byId.get(stack.pop()!);
        if (!child) continue;
        if (!child.ignored && child.name?.value?.trim()) {
          offenders.push(
            `${widget.role?.value} "${widget.name?.value}" -> ${child.role?.value} "${child.name.value}"`
          );
        }
        stack.push(...(child.childIds ?? []));
      }
    }

    expect(offenders).toEqual([]);
    expect(namedGenerics(nodes)).toEqual([]);
  });
}

// The other half of the same rule, stated positively, on a screen that carries
// a grouped container: `a11yGroup` is only worth anything if the role it adds
// survives react-native-web, and a name on a `group` is one ARIA allows.
test("a grouped container reaches the browser as a named group", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await openSeededGame(page, baseURL!, 4);
  await page.locator('[data-testid="game-top-bar"]').waitFor({ timeout: 30_000 });

  const nodes = await axTree(page);
  const groups = nodes.filter(
    (n) => !n.ignored && n.role?.value === "group" && n.name?.value?.trim()
  );

  expect(groups.length, "the table's top bar is a named group").toBeGreaterThan(0);
});

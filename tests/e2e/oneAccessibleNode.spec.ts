// A labelled control must be a leaf: the words and glyphs it draws itself with
// are its face, not extra stops a reader walks past.
//
// `tests/a11yOneNode.test.ts` reads the props. This reads what the browser
// built from them, which is the only place the property is actually true or
// false. Neither string query gets there: `page.getByText()` counts a DOM node
// whether or not it is `aria-hidden`, and `toMatchAriaSnapshot` prints a
// button's contents either way — #393 seeded an unhidden child against both
// and both stayed green. The full tree distinguishes them exactly.
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";

/** Roles whose contents are the control's own face rather than content. */
const WIDGETS = new Set(["button", "radio", "link", "checkbox", "switch", "tab"]);

/**
 * A live region is announced, never landed on, so a control inside one is
 * unreachable by the reader it interrupts (#495).
 *
 * This does not fire on the screens below: both live regions in the app render
 * over the game table, and one of them is veiled until a notification arrives.
 * It is a guard against the shape coming back, not a check of it — that half is
 * `tests/native/exchangeAnnounceBothWays.test.tsx`.
 */
const LIVE = new Set(["alert", "status", "log"]);

const SCREENS = ["/", "/lobby", "/rules"];

interface AxNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  ignored?: boolean;
  childIds?: string[];
}

for (const screen of SCREENS) {
  test(`every control on ${screen} is one accessible node`, async ({ page, baseURL }) => {
    await openApp(page, baseURL!);
    await page.goto(`${baseURL}${screen}`);
    await page.waitForSelector('[role="button"]');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Accessibility.enable");
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };
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

    for (const region of nodes.filter((n) => !n.ignored && LIVE.has(n.role?.value ?? ""))) {
      const stack = [...(region.childIds ?? [])];
      while (stack.length) {
        const child = byId.get(stack.pop()!);
        if (!child) continue;
        if (!child.ignored && WIDGETS.has(child.role?.value ?? "")) {
          offenders.push(
            `${region.role?.value} "${region.name?.value}" encloses ${child.role?.value} "${child.name?.value}"`
          );
        }
        stack.push(...(child.childIds ?? []));
      }
    }

    expect(offenders).toEqual([]);
  });
}

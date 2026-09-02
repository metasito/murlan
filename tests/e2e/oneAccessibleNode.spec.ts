// A labelled control must be a leaf: the words and glyphs it draws itself with
// are its face, not extra stops a reader walks past. A grouped container is the
// same claim with a role in front of it, and the role is what the browser
// settles.
//
// `tests/a11yOneNode.test.ts` reads the props. This reads what the browser
// built from them, which is the only place the property is actually true or
// false. Neither string query gets there: `page.getByText()` counts a DOM node
// whether or not it is `aria-hidden`, and `toMatchAriaSnapshot` prints a
// button's contents either way — #393 seeded an unhidden child against both
// and both stayed green. The full tree distinguishes them exactly.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, registerNewAccount, uniqueUsername } from "./helpers/navigation";
import { openSeededGame } from "./helpers/offlineSeed";
import { fillWithBotsAndStart, goToOnlineLobby } from "./helpers/online";
import { TABLE } from "./helpers/selectors";

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
  const topBar = page.locator('[data-testid="game-top-bar"]');
  await topBar.waitFor({ timeout: 30_000 });

  // Read off the element rather than restated, so a copy change cannot make
  // this pass by matching a sentence nothing renders any more.
  const spoken = (await topBar.getAttribute("aria-label")) ?? "";
  expect(spoken, "the top bar has to carry a name at all").not.toEqual("");

  const nodes = await axTree(page);
  const named = nodes.filter(
    (n) => !n.ignored && n.role?.value === "group" && n.name?.value === spoken
  );
  expect(named, "the top bar reaches the tree as a named group").toHaveLength(1);

  // Its chips draw the same words, and a group announces its name and then
  // whatever is still live beneath it.
  const inside: string[] = [];
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const stack = [...(named[0].childIds ?? [])];
  while (stack.length) {
    const child = byId.get(stack.pop()!);
    if (!child) continue;
    if (!child.ignored && child.name?.value?.trim()) inside.push(child.name.value);
    stack.push(...(child.childIds ?? []));
  }
  expect(inside, "a group speaks once, like any other one node").toEqual([]);

  expect(namedGenerics(nodes)).toEqual([]);
});

// #793: a revisited room screen's "CODICE STANZA" caption reads as two
// matches under `page.getByText("CODICE STANZA")` (`createRoom`,
// helpers/online.ts) — not because the caption is duplicated, but because
// the default substring match also catches "Inserisci codice stanza", the
// lobby's join-by-code button. React Navigation's Stack (app/(online)/_layout.tsx)
// keeps a screen it navigated away from mounted rather than tearing it down,
// so the lobby the room was pushed from is still in the DOM underneath,
// `aria-hidden="true"`. Settled here from the browser's own tree, not from
// reading the component.
test("a revisited room screen carries the room code on exactly one accessible node", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);

  async function reachRoom(username: string) {
    await openApp(page, baseURL!);
    await registerNewAccount(page, uniqueUsername(username));
    await goToOnlineLobby(page);
    await page.getByRole("radio", { name: "2 giocatori" }).click();
    await page.getByRole("button", { name: "Crea Stanza" }).click();
    await page.waitForURL(/\/room/);
  }

  await reachRoom("onenodea");

  // Start and leave the game — "Impostazioni" lives on the game screen, not
  // the room lobby — then sign into a fresh account and create a second room,
  // so the lobby this second room was pushed from is a screen the session has
  // already left once.
  await fillWithBotsAndStart(page);
  await page.locator(TABLE).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Impostazioni" }).first().click();
  await page.getByTestId("settings-exit").click();
  await page.getByTestId("confirm-accept").click();
  await page.getByRole("button", { name: "Crea Stanza" }).waitFor();
  await page.goto(baseURL!);
  await page.getByRole("button", { name: "Impostazioni" }).first().click();
  await page.getByRole("button", { name: "Esci da questo account" }).click();
  await page.getByTestId("confirm-accept").click();
  await page.waitForURL(/\/auth/);

  await reachRoom("onenodeb");

  // Exactly one DOM element carries the caption's own text, matched without
  // relying on which copy happens to be CSS-visible.
  expect(await page.getByText("CODICE STANZA", { exact: true }).count()).toBe(1);

  // The lobby's look-alike button is in the DOM (a substring match still
  // finds two) but is inert: it never appears in the accessibility tree at
  // all, not merely marked ignored on it.
  expect(await page.getByText("CODICE STANZA").count()).toBe(2);
  const nodes = await axTree(page);
  expect(nodes.filter((n) => n.name?.value === "Inserisci codice stanza")).toEqual([]);

  // The caption itself is a single reachable node — `StaticText`, Chrome's
  // own role for one run of text; its `InlineTextBox` child carries the same
  // name and is that one run's glyphs, not a second copy of it.
  const caption = nodes.filter(
    (n) => !n.ignored && n.name?.value === "CODICE STANZA" && n.role?.value === "StaticText"
  );
  expect(caption).toHaveLength(1);
});

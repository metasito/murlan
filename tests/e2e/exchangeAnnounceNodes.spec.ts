// tests/e2e/exchangeAnnounceNodes.spec.ts — the exchange announcement speaks
// and is never landed on.
//
// It used to be a dialog whose alert, close button and panel shared one
// `Pressable` (#495). It sits on the felt now, with no scrim and no control at
// all, which makes the alert the only node it has — and the thing that must
// still hold is that a reader hears it rather than walking into it. Nothing in
// the string-matching half of the suite can see that: a widget sealed inside a
// live region answers `getByRole` exactly as a sibling does. So this reads
// Chromium's own accessibility tree, the instrument `oneAccessibleNode.spec.ts`
// uses and for the same reason.
import { test, expect } from "./fixtures";
import { resumeSaved } from "./helpers/offlineSeed";

/** Roles a reader lands on. An announcement must hold none of them. */
const WIDGETS = new Set(["button", "radio", "link", "checkbox", "switch", "tab"]);

const GIVEBACK_SPOKEN = "5 di Cuori";

interface AxNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  ignored?: boolean;
  childIds?: string[];
}

/**
 * A two-seat hand mid-exchange with the viewer as the winner, about to choose
 * a giveback. Written out rather than derived from `offlineGameSave` because
 * the card clicked below has to be a known one in the 3–10 giveback range —
 * and the King beside it has to be one that is not.
 */
function midExchangeSave() {
  const card = (id: string, rank: string, suit: string) => ({ id, rank, suit, isJoker: false });
  return {
    version: 2,
    gameState: {
      players: [
        {
          id: "player_0",
          name: "Ana",
          hand: [card("5_hearts", "5", "hearts"), card("K_spades", "K", "spades")],
          type: "human",
        },
        {
          id: "player_1",
          name: "Bea",
          hand: [card("J_hearts", "J", "hearts"), card("Q_diamonds", "Q", "diamonds")],
          type: "ai",
        },
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
      exchangePhase: {
        active: true,
        winnerIdx: 0,
        loserIdx: 1,
        cardFromLoser: card("2_spades", "2", "spades"),
        bothJokersException: false,
      },
    },
    match: {
      length: "match",
      target: 21,
      scores: {},
      hands: [],
      over: false,
      winners: [],
      isDraw: false,
    },
    rematchAnswers: {},
    players: [
      { name: "Ana", type: "human" },
      { name: "Bea", type: "ai", personality: "luan" },
    ],
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
}

test("the exchange announcement speaks without becoming a control", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await resumeSaved(page, baseURL!, midExchangeSave());

  const prompt = page.getByTestId("exchange-prompt");
  await expect(prompt, "the exchange asks on the felt, not in a dialog").toBeVisible({
    timeout: 15_000,
  });
  // The hand stays on the table and the table's own key is the confirm, so both
  // clicks land on controls that were already there.
  await page.getByRole("button", { name: GIVEBACK_SPOKEN, exact: true }).click();
  await page.getByTestId("btn-gioca").click();

  // The sentence is on screen before the tree is read; it clears itself on a
  // timer, so an unwaited read races it.
  const announcement = page.getByRole("alert", { name: /Ana dà .+ a Bea/ });
  await expect(announcement).toBeVisible({ timeout: 15_000 });
  const spoken = (await announcement.getAttribute("aria-label")) ?? "";

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const live = nodes.filter(
    (n) => !n.ignored && n.role?.value === "alert" && n.name?.value === spoken
  );

  // Vacuity floor: everything below is about a node, and a tree without one
  // would satisfy all of it.
  expect(live, "the announcement has to reach the browser as an alert").toHaveLength(1);

  const inside: string[] = [];
  const stack = [...(live[0].childIds ?? [])];
  while (stack.length) {
    const child = byId.get(stack.pop()!);
    if (!child) continue;
    if (!child.ignored && WIDGETS.has(child.role?.value ?? "")) {
      inside.push(`${child.role?.value} "${child.name?.value}"`);
    }
    stack.push(...(child.childIds ?? []));
  }
  expect(inside, "an announcement is spoken, never landed on and walked").toEqual([]);

  // Nor is anything in it a tab stop: react-native-web gives every Pressable
  // one by default, so a control smuggled back into this layer would be
  // reachable by keyboard before it was ever announced.
  await expect(page.getByTestId("exchange-announce").locator('[tabindex="0"]')).toHaveCount(0);
});

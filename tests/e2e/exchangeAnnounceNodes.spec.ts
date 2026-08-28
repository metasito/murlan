// tests/e2e/exchangeAnnounceNodes.spec.ts — the exchange announcement is three
// nodes, not one: a live region that speaks, a button that closes, and a panel
// that is neither.
//
// The three roles used to sit on a single `Pressable` (#495). Nothing in the
// string-matching half of the suite can see the difference — the close button
// answers `getByRole("button")` whether it is a sibling of the announcement or
// sealed inside it — so this reads Chromium's own accessibility tree, the same
// instrument `oneAccessibleNode.spec.ts` uses and for the same reason.
import { test, expect } from "./fixtures";
import { resumeSaved } from "./helpers/offlineSeed";

/** Roles a reader lands on. An announcement must hold none of them. */
const WIDGETS = new Set(["button", "radio", "link", "checkbox", "switch", "tab"]);

const CLOSE_LABEL = "Chiudi annuncio scambio";
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
 * the card clicked below has to be a known one in the 3–10 giveback range.
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

test("the exchange announcement speaks without swallowing its own close button", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await resumeSaved(page, baseURL!, midExchangeSave());

  const picker = page.getByRole("dialog", { name: "Scambio di carte" });
  await expect(picker, "the exchange modal has to open").toBeVisible({ timeout: 15_000 });
  await picker.getByRole("button", { name: GIVEBACK_SPOKEN, exact: true }).click();
  await picker.getByTestId("exchange-confirm").click();

  // The panel is up and the sentence is on screen before the tree is read;
  // it dismisses itself on a timer, so an unwaited read races it.
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

  const close = nodes.filter(
    (n) => !n.ignored && n.role?.value === "button" && n.name?.value === CLOSE_LABEL
  );
  expect(close, "the close button stays a control of its own").toHaveLength(1);

  // The panel carries neither role nor name, so it must not be a tab stop
  // either — react-native-web gives every Pressable one by default.
  await expect(page.getByTestId("exchange-announce-panel")).toHaveAttribute("tabindex", "-1");
});

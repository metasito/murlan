// tests/e2e/suitDefs.spec.ts — every suit symbol used to re-emit its own paths
// at each call site: a pip field, plus the two index marks, all inline. Hearts
// cost about 25 SVG nodes a card and clubs about 61, and a full table is 54
// cards, all of it real DOM on web.
//
// The shape is now declared once per card face inside <Defs> and referenced
// with <Use>. Only a browser can see this: react-native-svg emits real <svg>
// on web and goes through the native renderer elsewhere, and no unit test in
// this repo runs either.
import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";

const TABLE = '[data-testid="game-table"]';
const HAND_CARDS = `${TABLE} [aria-label^="La tua mano"] [role="button"]`;

interface FaceStats {
  label: string;
  total: number;
  uses: number;
  defsChildren: number;
  /** Suit geometry still emitted outside <defs> — the thing being removed. */
  loosePaths: number;
}

test("a card's suit shape is declared once and referenced, not re-emitted", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(3 * 60_000);

  await openApp(page, baseURL!);
  await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all" });
  await page.locator(HAND_CARDS).first().waitFor({ timeout: 60_000 });

  const faces: FaceStats[] = await page.locator(HAND_CARDS).evaluateAll((cards) =>
    cards.flatMap((card) => {
      const svg = card.querySelector("svg");
      if (!svg) return [];
      const inDefs = (el: Element) => el.closest("defs") !== null;
      return [
        {
          label: card.getAttribute("aria-label") ?? "",
          total: svg.querySelectorAll("*").length,
          uses: svg.querySelectorAll("use").length,
          defsChildren: svg.querySelectorAll("defs > *").length,
          loosePaths: [...svg.querySelectorAll("path, circle")].filter((el) => !inDefs(el))
            .length,
        },
      ];
    })
  );

  // The measurement the issue asks to be stated rather than assumed. It rides
  // in the run's own output so the numbers come from the browser, not a guess.
  console.log(`[suit-defs] ${faces.length} card faces:`, JSON.stringify(faces));

  expect(faces.length).toBeGreaterThan(4);

  const suited = faces.filter((f) => f.uses > 0);
  expect(
    suited.length,
    "no card face referenced a suit definition — the hoist is not in effect"
  ).toBeGreaterThan(4);

  for (const face of suited) {
    expect(face.defsChildren, `${face.label} declares its suit more than once`).toBe(1);
    expect(
      face.loosePaths,
      `${face.label} still emits ${face.loosePaths} suit nodes outside <defs>`
    ).toBe(0);
    // Measured in this same browser before the hoist: a six of clubs cost 40
    // nodes and a ten of spades 24, against 14 and 14 after it. 25 sits above
    // every post-hoist face and below the suited faces that cost most.
    expect(face.total, `${face.label} renders ${face.total} SVG nodes`).toBeLessThan(25);
  }
});

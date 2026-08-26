// tests/e2e/handParity.spec.ts — the viewer's own hand, at the sizes the game
// actually deals and on the handsets it actually runs on.
//
// Every other visual check in this suite runs at Playwright's Desktop Chrome
// default, 1280x720. A landscape phone is 874x402, and the hand behaves
// differently there: it is the one part of the table whose width is solved
// against the screen rather than fixed, so the desktop viewport exercises a
// branch no player ever reaches. A hand that reached past its share, right-
// aligned itself and scrolled shipped for weeks against a green suite because
// nothing here was ever narrow enough to produce it.
//
// The numbers come from the design prototype, measured at the same viewport:
// the hand centres on the play area (the box between the rail and the right
// safe inset, not the raw screen), spans about 0.56 of the screen whatever it
// holds, and runs off the bottom edge — the crop is what buys the table its
// height and takes the upside-down index at the card's foot out of the picture.
import { test, expect } from "@playwright/test";
import { DEAL_SIZE, openSeededGame } from "./helpers/offlineSeed";
import { HAND_SCALE, HAND_SCALE_ON_TURN } from "../../components/cardFaceModel";

/** Landscape logical sizes, smallest and largest phone the app supports. */
const PHONES = [
  { name: "iPhone SE", width: 568, height: 320 },
  { name: "iPhone 12", width: 844, height: 390 },
  { name: "iPhone 16 Pro", width: 874, height: 402 },
  { name: "iPhone 17 Pro Max", width: 956, height: 440 },
];

const SEATS = [2, 3, 4] as const;

/**
 * The hand is a different size depending on whose turn it is (#344), and every
 * budget below has to hold in both. Seat 1 is a bot, so seeding it holds the
 * table off the viewer's turn — `openSeededGame` suspends the AI for it.
 */
const TURNS = [
  { what: "on turn", seat: 0 },
  { what: "off turn", seat: 1 },
] as const;

/** How much nearer the hand comes on the viewer's own turn — components/cardFaceModel.ts. */
const NEAR = HAND_SCALE_ON_TURN / HAND_SCALE;

/** How far the hand's own centre may sit from the middle of the screen. */
const CENTRE_TOLERANCE = 45;

interface HandGeometry {
  cards: number;
  /** The widest card box drawn — the hand's own size, whoever is on move. */
  cardW: number;
  left: number;
  right: number;
  centre: number;
  screenCentre: number;
  top: number;
  /** How far the lowest card falls past the bottom edge. */
  crop: number;
  offscreen: number;
  docScrollW: number;
}

/**
 * The hand's laid-out box. Found by shape rather than by a testid: a hand card
 * is the only control that is card-tall and sits in the bottom half, and
 * reading the DOM the way this does is the point — a testid would still be
 * attached to a card that had been laid out off the screen.
 */
async function handGeometry(page: import("@playwright/test").Page): Promise<HandGeometry> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const boxes = [...document.querySelectorAll("*")].map((el) => ({
      el,
      r: el.getBoundingClientRect(),
    }));
    // A card is taller than it is wide; PASSA and GIOCA are square keys of
    // very nearly the same height, and on the shortest phone the two heights
    // are three points apart — the shape is what separates them, not the size.
    const cards = boxes.filter(
      ({ el, r }) =>
        el.getAttribute("role") === "button" &&
        r.top > vh * 0.5 &&
        r.height > vh * 0.15 &&
        r.height < vh * 0.45 &&
        r.width < r.height * 0.85
    );
    const rects = cards.map((c) => c.r);
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    return {
      cards: cards.length,
      cardW: Math.max(...rects.map((r) => r.width)),
      left,
      right,
      centre: (left + right) / 2,
      screenCentre: vw / 2,
      top: Math.min(...rects.map((r) => r.top)),
      crop: Math.max(...rects.map((r) => r.bottom)) - vh,
      offscreen: boxes.filter(({ r }) => r.width > 8 && (r.left >= vw || r.right <= 0)).length,
      docScrollW: document.documentElement.scrollWidth,
    };
  });
}

test.describe("the hand a player holds", () => {
  for (const phone of PHONES) {
    for (const seats of SEATS) {
      const dealt = DEAL_SIZE[seats];
      for (const turn of TURNS) {
      test(`${phone.name}, ${seats} seats, ${dealt} cards, ${turn.what}`, async ({ page, baseURL }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: phone.width, height: phone.height });
        await openSeededGame(page, baseURL!, seats, dealt, turn.seat);
        // Past the deal: every card flies in from the middle of the table, so
        // until the stagger has run the row is a pack rather than a hand.
        await page.waitForTimeout(2_500);

        const hand = await handGeometry(page);

        expect(hand.cards, "every dealt card is laid out").toBe(dealt);

        // Centred on the play area. The rail eats the left edge, so the exact
        // middle is a few points right of the screen's — the tolerance is that
        // offset, not slack.
        expect(
          Math.abs(hand.centre - hand.screenCentre),
          `hand centred at ${hand.centre.toFixed(1)}, screen centre ${hand.screenCentre}`
        ).toBeLessThan(CENTRE_TOLERANCE);

        // Cropped by the bottom edge, and not by so much that the rank goes
        // with it. A hand that sits entirely on screen is one the table has
        // given its own height away to.
        expect(hand.crop, "the hand runs past the bottom edge").toBeGreaterThan(4);
        expect(hand.top, "the hand stays in the bottom third").toBeGreaterThan(phone.height * 0.5);

        // Nothing laid out past either edge, and the page itself does not
        // scroll — a table wider than the window is one a tap can slide away.
        expect(hand.offscreen, "nothing is laid out off the screen").toBe(0);
        expect(hand.docScrollW, "the document does not scroll sideways").toBe(phone.width);
      });
      }
    }
  }

  // The point of the two states, and the one thing the budgets above cannot
  // say: the hand is actually nearer on the viewer's own turn. Measured on the
  // card rather than on the row, so a fan that happened to lay out differently
  // cannot be mistaken for the hand coming closer.
  test("the hand comes closer when the turn is the viewer's own", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const phone = PHONES[2];
    await page.setViewportSize({ width: phone.width, height: phone.height });

    await openSeededGame(page, baseURL!, 4, DEAL_SIZE[4], 1);
    await page.waitForTimeout(2_500);
    const away = await handGeometry(page);

    await openSeededGame(page, baseURL!, 4, DEAL_SIZE[4], 0);
    await page.waitForTimeout(2_500);
    const near = await handGeometry(page);

    const grew = near.cardW / away.cardW;
    expect(
      grew,
      `a hand card is ${away.cardW.toFixed(1)}px off turn and ${near.cardW.toFixed(1)}px on it ` +
        `— ${((grew - 1) * 100).toFixed(1)}% nearer, not the ${((NEAR - 1) * 100).toFixed(1)}% ` +
        `components/cardFaceModel.ts asks for`
    ).toBeCloseTo(NEAR, 2);
  });
});

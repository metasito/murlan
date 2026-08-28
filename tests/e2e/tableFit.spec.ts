// tests/e2e/tableFit.spec.ts — the game table stays inside the screen.
//
// A side seat's card fan is deliberately wider than the column that holds it:
// it leans in over the felt the way a real player's hand does. That only works
// if the overflow points inward. It used to be centred, so half of it hung off
// the side of the screen — at every viewport, since the fan is a fixed size —
// taking the avatar and the player's name with it. Nothing in the unit suite
// can see that: it is a property of the laid-out box, so it is measured in a
// real browser here, next to the tap-target sweep for the same reason.
import { test, expect, type Page } from "@playwright/test";
import { openApp, startOfflineGame } from "./helpers/navigation";
import { openSeededGame, offlineGameSave, resumeSaved, DEAL_SIZE } from "./helpers/offlineSeed";
import { buildCombination } from "../../lib/gameEngine";
import { GIOCA_VALID_LABEL, YOUR_TURN_PREFIX } from "./helpers/labels";
import { HAND_ZONE, TABLE_STATE } from "./helpers/selectors.ts";

const VIEWPORTS = [
  { name: "small phone landscape", width: 667, height: 375 },
  { name: "large phone landscape", width: 844, height: 390 },
  { name: "tablet landscape", width: 1112, height: 834 },
];

// Four seats is the only arrangement that fills both side columns, and two is
// the only one that fills neither — between them every side slot is exercised.
const SEATS = [4, 2] as const;

test.describe("the table fits the screen", () => {
  for (const vp of VIEWPORTS) {
    for (const playerCount of SEATS) {
      test(`${vp.name}, ${playerCount} players`, async ({ page, baseURL }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // Seeded rather than played through the lobby: this measures a laid-out
        // table, and four clicks and a deal animation are not part of that. On
        // a loaded runner they were the whole test budget (#152).
        await openSeededGame(page, baseURL!, playerCount);
        await page.waitForTimeout(2_000);

        // Laid-out boxes only, and only ones nothing clips. An SVG's bounding
        // box can be far wider than the ink it paints, and a big hand's card
        // row is deliberately wider than the screen inside a horizontal
        // ScrollView — neither is visible overflow.
        const escaping = await page.evaluate((viewportWidth) => {
          const table = document.querySelector('[data-testid="game-table"]');
          if (!table) throw new Error("the table never rendered");
          const out: { label: string; left: number; right: number }[] = [];
          const isClipped = (el: Element) => {
            for (let a = el.parentElement; a && a !== table; a = a.parentElement) {
              if (getComputedStyle(a).overflowX !== "visible") return true;
            }
            return false;
          };

          for (const el of table.querySelectorAll("div")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.left >= -0.5 && r.right <= viewportWidth + 0.5) continue;
            if (isClipped(el)) continue;
            out.push({
              label: el.getAttribute("aria-label") ?? el.className ?? "div",
              left: Math.round(r.left),
              right: Math.round(r.right),
            });
          }
          return out;
        }, vp.width);

        expect(
          escaping,
          `these parts of the table render off the side of a ${vp.width}px screen: ` +
            escaping.map((e) => `${e.label} (${e.left}…${e.right})`).join("; ")
        ).toEqual([]);
      });
    }
  }
});

// ─── The top-left chip's player name ──────────────────────────────────────────
//
// The chip is a fixed-width band by design — anything wider is chrome drawn
// where a card lands. `numberOfLines={1}` alone truncates nothing unless the
// name's own run is width-capped, so an unbounded username either widens the
// band or overflows it — neither is visible to react-test-renderer, which
// never runs flexbox. Only a browser sees whether the band held its width and
// the overrun name actually clips.
test.describe("the top-left chip's player name", () => {
  // Both well past any reasonable cap, and of deliberately different lengths —
  // a band that is actually capped renders both at the same width; a band that
  // merely grows to fit its content renders the longer of the two wider.
  const LONG_NAME_A = "Konstantinopolitanosovicka Maximilliana Alexandreea";
  const LONG_NAME_B = LONG_NAME_A + " " + LONG_NAME_A;

  /** A 2-seat offline save with `name`'s play already on the felt. */
  function nameSave(name: string): object {
    const save: any = offlineGameSave(2, DEAL_SIZE[2], 0);
    const pileCard = save.gameState.players[1].hand.shift();
    save.gameState.players[1].name = name;
    save.players[1].name = name;
    save.gameState.lastPlayedCombination = buildCombination([pileCard]);
    save.gameState.lastPlayedBy = 1;
    return save;
  }

  async function topBar(page: Page, baseURL: string, name: string) {
    await resumeSaved(page, baseURL, nameSave(name));
    await page.waitForTimeout(1_000);
    return page.locator('[data-testid="game-top-bar"]');
  }

  for (const vp of VIEWPORTS) {
    test(`a long username truncates within the band, not the band — ${vp.name}`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });

      const boxA = await (await topBar(page, baseURL!, LONG_NAME_A)).boundingBox();
      const chipB = await topBar(page, baseURL!, LONG_NAME_B);
      const boxB = await chipB.boundingBox();
      if (!boxA || !boxB) throw new Error("the top bar never rendered");

      // The floor: a chip that laid out as an empty box would satisfy the
      // equality below having drawn nothing on both runs.
      expect(boxA.width, "the top bar has no width at all").toBeGreaterThan(0);
      expect(
        boxB.width,
        `the chip is ${Math.round(boxA.width)}px wide for one long username and ` +
          `${Math.round(boxB.width)}px for a longer one — the band grew to fit the content ` +
          `instead of clipping it`
      ).toBeLessThan(boxA.width + 2);

      // The band held its width; now confirm the name itself is what gave —
      // an element inside the chip whose content overflows its own box, with
      // the ellipsis CSS this depends on actually applied.
      const clipped = await chipB.evaluate((el) => {
        const search = (node: Element): Element | null => {
          if (node.scrollWidth > node.clientWidth + 1) return node;
          for (const child of Array.from(node.children)) {
            const found = search(child);
            if (found) return found;
          }
          return null;
        };
        const hit = search(el);
        return hit ? getComputedStyle(hit).textOverflow : null;
      });

      expect(
        clipped,
        "nothing inside the chip clips its content — the long name rendered in full"
      ).toBe("ellipsis");
    });
  }
});

// ─── The felt has no frame ────────────────────────────────────────────────────
//
// The cloth runs edge to edge and the lamp is what shapes it. A framed table —
// a rounded box inset from the screen with a gold border round it — draws a lit
// rectangle in a dark room, which is the one thing a single overhead lamp
// cannot produce. Whether the paint reaches the device's own corners is a
// property of the composited page, so only a browser can answer it.

test.describe("the felt", () => {
  test("reaches all four screen edges, with no frame drawn round it", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const vp = { width: 844, height: 390 };
    await page.setViewportSize(vp);
    await openSeededGame(page, baseURL!, 4);
    await page.waitForTimeout(2_000);

    const felt = await page.locator('[data-testid="table-felt"]').boundingBox();
    if (!felt) throw new Error("the felt never rendered");

    // The floor: a felt that laid out as an empty box would sit at 0,0 and
    // satisfy any check that only looked at its origin.
    expect(felt.width, "the felt has no width").toBeGreaterThan(0);
    expect(felt.height, "the felt has no height").toBeGreaterThan(0);

    for (const [edge, actual, want] of [
      ["left", felt.x, 0],
      ["top", felt.y, 0],
      ["right", felt.x + felt.width, vp.width],
      ["bottom", felt.y + felt.height, vp.height],
    ] as const) {
      expect(
        Math.round(actual),
        `the felt's ${edge} edge is at ${Math.round(actual)}, not the screen's ${want}`
      ).toBe(want);
    }

    // …and nothing over it draws a frame. A border on the play area is the
    // boxed-diagram look the full-bleed felt replaced, and it would pass every
    // measurement above while still being visible.
    const framed = await page.evaluate(() => {
      const table = document.querySelector('[data-testid="game-table"]');
      if (!table) throw new Error("the table never rendered");
      const out: string[] = [];
      for (const el of [table, ...table.querySelectorAll("div")]) {
        const s = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        // Only the big surfaces: a chip, a card and a seat all carry a rule of
        // their own, and are meant to.
        if (box.width < innerWidth * 0.8 || box.height < innerHeight * 0.8) continue;
        if (parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0) {
          out.push(`${el.className || "div"} (${s.borderTopWidth} ${s.borderTopColor})`);
        }
      }
      return out;
    });
    expect(framed, `these full-table surfaces draw a border: ${framed.join("; ")}`).toEqual([]);
  });
});

// ─── The bands the table is built from ───────────────────────────────────────
//
// The top seat is the tallest thing on the table after the hand, and it sizes
// itself: its name floats above the avatar and its fan hangs below, so the
// column's height is a property of the laid-out boxes rather than a number
// anyone wrote down. What is left between it and the hand is the field's, by
// construction — which only holds if the three never overlap and none of them
// leaves the felt. A fixed box and its content are two laid-out boxes, so only
// a browser can tell you they disagree.
//
// Four seats with bots is the worst case: the top seat carries a name and a
// bot badge at once, which is the tallest the column ever gets short of also
// having passed.

test.describe("the table's bands", () => {
  test("the top seat, the field and the hand share the felt without overlapping", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await openSeededGame(page, baseURL!, 4);
    await page.waitForTimeout(1_000);

    const table = await page.locator('[data-testid="game-table"]').boundingBox();
    const seat = await page.locator('[data-testid="top-seat"]').boundingBox();
    const hand = await page.locator('[data-testid="btn-gioca"]').boundingBox();
    if (!table || !seat || !hand) throw new Error("the table never rendered");

    expect(
      seat.y,
      `the top seat (${Math.round(seat.y)}) starts above the felt (${Math.round(table.y)})`
    ).toBeGreaterThanOrEqual(table.y - 0.5);

    expect(
      seat.y + seat.height,
      `the top seat (${Math.round(seat.y)}…${Math.round(seat.y + seat.height)}) runs into ` +
        `the hand row (${Math.round(hand.y)}…), leaving the field nothing`
    ).toBeLessThanOrEqual(hand.y + 0.5);

    // The floor: a top seat that rendered as an empty box would satisfy both
    // bounds above having reserved nothing.
    expect(seat.height, "the top seat has no height at all").toBeGreaterThan(40);
    expect(
      hand.y - (seat.y + seat.height),
      "no band is left between the top seat and the hand for the field"
    ).toBeGreaterThan(0);
  });
});

// ─── The banner over the table ────────────────────────────────────────────────
//
// The notification banner is a sibling of the whole navigator at zIndex 9999
// and the table's top bar is at the same origin at zIndex 10, so the banner
// used to cover the billboard, the countdown and the hand count — at exactly
// the moments they matter, since an auto-pass is what raises it. That is a
// property of two laid-out boxes, which only a browser can measure.

/** locales/it.ts `game.autoPassTitle` — the offline clock expiring. */
const AUTO_PASS_TITLE = "Passaggio automatico";
/** locales/it.ts `gameTable.a11yPlayerPlayed`. */
const OPPONENT_PLAYED = " ha giocato ";
/** app/game.tsx HUMAN_TURN_SECONDS, which EXPO_PUBLIC_E2E_FAST does not shorten. */
const OFFLINE_CLOCK_MS = 20_000;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The element's box once it has stopped moving. The banner slides in over
 * 320ms from off the top of the screen, so a box read the moment its text
 * appears is a box mid-flight — reading until two consecutive samples agree
 * waits for the animation itself rather than for a guessed duration.
 */
async function settledBox(page: Page, selector: string): Promise<Box> {
  const locator = page.locator(selector);
  let previous: Box | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const box = await locator.boundingBox();
    if (box && previous && box.y === previous.y && box.height === previous.height) return box;
    previous = box;
    await page.waitForTimeout(100);
  }
  throw new Error(`${selector} never settled into a stable position`);
}

/**
 * Plays on until an opponent's combination is on the table and it is the
 * viewer's turn — the only state in which the offline countdown runs
 * (`turnTimerActive`, includeNewRound false). Leading is compulsory, so a lead
 * has to be played rather than waited out; GIOCA is the only judge of which
 * card is legal, exactly as in tests/e2e/helpers/bot.ts.
 */
async function waitForAnswerableTurn(page: Page): Promise<void> {
  const table = page.locator('[data-testid="game-table"]');
  const gioca = page.locator('[data-testid="btn-gioca"]');
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const desc = (await table.getAttribute(TABLE_STATE)) ?? "";
    if (desc.startsWith(YOUR_TURN_PREFIX) && desc.includes(OPPONENT_PLAYED)) return;

    if (desc.startsWith(YOUR_TURN_PREFIX)) {
      const cards = page.locator(`${HAND_ZONE} [role="button"]`);
      const labels = await cards.evaluateAll((els) =>
        els.map((el) => el.getAttribute("aria-label") ?? "")
      );
      for (const label of labels) {
        const card = page.locator(
          `${HAND_ZONE} [aria-label="${label.replace(/"/g, '\\"')}"]`
        );
        await card.click({ timeout: 4_000 }).catch(() => {});
        if ((await gioca.getAttribute("aria-label")) === GIOCA_VALID_LABEL) {
          await gioca.click({ timeout: 4_000 }).catch(() => {});
          break;
        }
        await card.click({ timeout: 4_000 }).catch(() => {});
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error("never reached a turn with a combination to answer");
}

test.describe("the notification banner over the game table", () => {
  test("does not cover the top bar it is explaining", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await openApp(page, baseURL!);
    await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all" });
    await page.locator('[data-testid="game-table"]').waitFor({ timeout: 60_000 });

    await waitForAnswerableTurn(page);

    // Letting the clock run out is the one notification an offline game raises.
    const banner = page.locator('[data-testid="notification-banner"]');
    await expect(banner).toContainText(AUTO_PASS_TITLE, {
      timeout: OFFLINE_CLOCK_MS + 20_000,
    });

    const bannerBox = await settledBox(page, '[data-testid="notification-banner"]');
    const topBarBox = await settledBox(page, '[data-testid="game-top-bar"]');

    expect(
      bannerBox.y,
      `the banner (${bannerBox.y}…${bannerBox.y + bannerBox.height}) overlaps the table's top bar ` +
        `(${topBarBox.y}…${topBarBox.y + topBarBox.height}), which carries the turn billboard, ` +
        `the countdown and the hand count`
    ).toBeGreaterThanOrEqual(topBarBox.y + topBarBox.height);
  });
});

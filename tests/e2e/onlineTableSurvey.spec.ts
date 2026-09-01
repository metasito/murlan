// The online table, measured and photographed at the same real device sizes as
// every other screen in the #57 audit — the one row that survey had to leave
// blank (#590).
//
// It measures the *offline* table beside it at each size, because both screens
// render one `<GameTable>` and the table's scale comes from the window's own
// short edge: at a given viewport and seat count the two must lay out to the
// same numbers. Recording only the online row would say what the online table
// does; recording both says whether it does anything the offline one does not,
// which is the claim the audit could not make and the one that keeps the online
// screen from drifting away unwatched.
//
// The captures and `online-table.txt` land in `docs/design/57-polish-audit/`
// beside the rest of the survey, so a finding can be re-measured rather than
// re-argued — and the run is held to that record, so a table that lays out
// differently has to say so rather than leaving the audit quietly wrong.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openSeededGame } from "./helpers/offlineSeed";
import { openOnlineTable } from "./helpers/onlineTable";
import { settled } from "./helpers/settle";
import { HAND_CARDS, HAND_ZONE, TABLE, TABLE_STATE } from "./helpers/selectors";
import { YOUR_TURN_PREFIX } from "./helpers/labels";

/** The audit's own four, named as `content.txt` and `table.txt` name them. */
const VIEWPORTS = [
  { name: "phone-se", width: 568, height: 320 },
  { name: "phone-12", width: 844, height: 390 },
  { name: "phone-max", width: 956, height: 440 },
  { name: "tablet", width: 1112, height: 834 },
] as const;

/** Four seats fills the top seat and both side columns — the arrangement with the most to measure. */
const SEATS = 4;

const AUDIT_DIR = path.resolve(__dirname, "../../docs/design/57-polish-audit");
const RECORD = path.join(AUDIT_DIR, "online-table.txt");
/** Set to rewrite the record instead of being held to it. */
const UPDATING = process.env.AUDIT_UPDATE === "1";

const keyOf = (row: string) => row.split("\t").slice(0, 2).join("\t");

/**
 * The record by `MODE\tviewport`, so a shard is held to the rows it measured.
 * CI does write a whole one — the split is by spec file, so one shard runs all
 * four — but onto a runner nothing commits from, so the checked-in copy only
 * ever moves when someone runs the survey locally.
 */
function recorded(): Map<string, string> {
  try {
    const lines = readFileSync(RECORD, "utf8").split("\n").filter(Boolean);
    return new Map(lines.map((l) => [keyOf(l), l]));
  } catch {
    return new Map();
  }
}
const SETTLE_CEILING_MS = 8_000;
/** Past `SWEEP_MS` (components/table/moments.tsx), the longest of the moment overlays. */
const MOMENT_CEILING_MS = 1_600;

/** How far the two tables' seat-to-hand gaps may differ, as a fraction of a hand card. */
const PARITY_TOLERANCE = 0.02;

interface Measurement {
  table: { width: number; height: number };
  /**
   * The slot the fan gives one hand card — its full height, and only as much
   * width as the card beside it leaves uncovered. Not `table.txt`'s `card`,
   * which is a card on the felt at its own size.
   */
  handSlot: { width: number; height: number };
  /**
   * The gap between the lowest seat plate and the top of the hand zone.
   *
   * Unrounded, unlike everything else here, because it is the one number two
   * measurements are subtracted from each other: rounding first makes the
   * comparison depend on which side of a boundary each landed on, which is a
   * property of the boundary rather than of either table.
   */
  emptyBand: number;
  /** Content that reaches past the viewport's own width, named. */
  wide: string[];
  cards: number;
  hand: { width: number; height: number; top: number };
}

/**
 * A table's numbers, with `wide` narrowed to what overflows *steadily*.
 *
 * The moment overlays a played hand raises — the flush's own light pass is
 * 2.2x the table's width by construction (`Sweep`, components/table/moments.tsx)
 * — are drawn wider than the screen on purpose and are gone again inside two
 * seconds. Reading twice and keeping only what both readings hold measures the
 * laid-out table rather than whatever a bot happened to play, which is what the
 * audit's own `wide` column means. It caught one on two runs in about
 * twenty-five before this.
 */
async function measure(page: Page): Promise<Measurement> {
  const first = await readTable(page);
  await page.waitForTimeout(MOMENT_CEILING_MS);
  const second = await readTable(page);
  return { ...second, wide: second.wide.filter((node) => first.wide.includes(node)) };
}

function readTable(page: Page): Promise<Measurement> {
  return page.evaluate(
    ({ table: tableSel, hand: handSel, cards: cardSel, turn: turnAttr, yourTurn }) => {
      const round = (n: number) => Math.round(n);
      const table = document.querySelector(tableSel);
      if (!table) throw new Error("the table never rendered");
      const tableBox = table.getBoundingClientRect();

      // The server's AFK clock runs while this reads (`MURLAN_AFK_TIMEOUT_MS`,
      // tests/e2e/playwright.config.ts). An auto-pass mid-measurement redraws
      // the hand at `HAND_SCALE` where the offline comparand — which has no
      // clock, its pile being empty — stays at `HAND_SCALE_ON_TURN`, and the
      // 10% between them would be reported as the two tables disagreeing about
      // their layout, which they do not.
      if (!(table.getAttribute(turnAttr) ?? "").startsWith(yourTurn)) {
        throw new Error("the viewer stopped being on move before the table could be measured");
      }

      const cards = Array.from(document.querySelectorAll(cardSel));
      const cardBox = cards[0]?.getBoundingClientRect();
      if (!cardBox) throw new Error("the hand rendered no cards");

      const hand = document.querySelector(handSel);
      const handTop = hand ? hand.getBoundingClientRect().top : tableBox.bottom;
      let plateBottom = tableBox.top;
      for (const ring of Array.from(document.querySelectorAll('[data-testid="seat-ring"]'))) {
        const r = ring.getBoundingClientRect();
        if (r.height === 0) continue;
        if (r.bottom > plateBottom && r.bottom <= handTop) plateBottom = r.bottom;
      }

      // Laid-out boxes that nothing clips, exactly as tableFit.spec.ts counts
      // them: an SVG's box is wider than its ink, and the hand row is meant to
      // overflow inside its own horizontal scroller.
      const clipped = (el: Element) => {
        for (let a = el.parentElement; a && a !== table; a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== "visible") return true;
        }
        return false;
      };
      const wide: string[] = [];
      for (const el of Array.from(table.querySelectorAll("div"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left >= -0.5 && r.right <= window.innerWidth + 0.5) continue;
        if (clipped(el)) continue;
        let named = el.getAttribute("aria-label") ?? el.getAttribute("data-testid");
        for (let a = el.parentElement; !named && a && a !== table; a = a.parentElement) {
          named = a.getAttribute("data-testid") ?? a.getAttribute("aria-label");
        }
        wide.push(`${named ?? "div"} [${round(r.left)}..${round(r.right)}]`);
      }

      return {
        table: { width: round(tableBox.width), height: round(tableBox.height) },
        handSlot: { width: round(cardBox.width), height: round(cardBox.height) },
        emptyBand: handTop - plateBottom,
        wide,
        cards: cards.length,
        hand: hand
          ? {
              width: round(hand.getBoundingClientRect().width),
              height: round(hand.getBoundingClientRect().height),
              top: round(handTop),
            }
          : { width: 0, height: 0, top: round(handTop) },
      };
    },
    { table: TABLE, hand: HAND_ZONE, cards: HAND_CARDS, turn: TABLE_STATE, yourTurn: YOUR_TURN_PREFIX }
  );
}

function line(kind: "ONLINE" | "OFFLINE", vp: (typeof VIEWPORTS)[number], m: Measurement): string {
  return [
    kind,
    vp.name,
    `vp=${vp.width}x${vp.height}`,
    `table=${m.table.width}x${m.table.height}`,
    `handSlot=${m.handSlot.width}x${m.handSlot.height}`,
    `emptyBand=${m.emptyBand.toFixed(3)}`,
    `cards=${m.cards}`,
    `hand=${m.hand.width}x${m.hand.height}@${m.hand.top}`,
    `wide=${m.wide.join(" | ")}`,
  ].join("\t");
}

const rows: string[] = [];

test.describe("the online table, at the audit's viewports", () => {
  for (const vp of VIEWPORTS) {
    // `consoleErrors` is asked for rather than left to the fixture file: it is
    // not an auto fixture, so a test that does not name it gets neither the
    // console-error gate nor the reduced-motion emulation set up beside it.
    test(`${vp.name} — ${vp.width}x${vp.height}`, async ({ page, baseURL, consoleErrors }) => {
      // Past the sum of the ceilings each half sets for itself, so a runner
      // slow enough to reach one fails with that ceiling's own sentence rather
      // than with a timeout that names nothing.
      test.setTimeout(300_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await openOnlineTable(page, baseURL!, { playerCount: SEATS, gameMode: "free_for_all" });
      const online = await measure(page);
      mkdirSync(path.join(AUDIT_DIR, "captures"), { recursive: true });
      await page.screenshot({
        path: path.join(AUDIT_DIR, "captures", `online-table__${vp.name}.png`),
      });

      // Dealt the same number of cards the server just dealt, not the seed
      // helper's default: the hand row sizes its cards to fit however many it
      // holds, so a 13-card seed and a 14-card deal are two different tables
      // and comparing them measures the deal rather than the layout.
      await openSeededGame(page, baseURL!, SEATS, online.cards);
      await page.locator(TABLE).waitFor({ timeout: 30_000 });
      await settled(page, SETTLE_CEILING_MS);
      const offline = await measure(page);

      console.log(line("ONLINE", vp, online));
      console.log(line("OFFLINE", vp, offline));

      // The felt's own box. Both screens size it from the window's short edge
      // (CLAUDE.md), so a difference here is one of them reading a different
      // window — the safe-area regression that invariant exists for.
      expect(
        online.table,
        `the online table is ${online.table.width}x${online.table.height} where the offline one ` +
          `is ${offline.table.width}x${offline.table.height} at the same ${vp.width}x${vp.height} window`
      ).toEqual(offline.table);

      // The hand card is the scale made visible: every seat plate, fan and pile
      // position is derived from it, so two tables that agree here agree about
      // the whole geometry.
      expect(
        online.handSlot,
        `an online hand card is ${online.handSlot.width}x${online.handSlot.height} where an ` +
          `offline one is ${offline.handSlot.width}x${offline.handSlot.height}`
      ).toEqual(offline.handSlot);

      // The number finding 3 is about. It follows from the two above only if
      // the seats sit where the scale says they do, which is the half of the
      // table neither of them measures.
      //
      // Both lengths come out of the same scale, so the tolerance is taken from
      // it too: a fiftieth of a card is below what the design distinguishes at
      // any viewport, and a table whose seats sit differently is out by a card
      // or more. A pixel count would be one thing on a phone and another on a
      // tablet, where every length is two and a half times larger.
      const tolerance = online.handSlot.height * PARITY_TOLERANCE;
      expect(
        Math.abs(online.emptyBand - offline.emptyBand),
        `the online table leaves ${online.emptyBand.toFixed(3)}px between the lowest seat and ` +
          `the hand where the offline one leaves ${offline.emptyBand.toFixed(3)}px, a difference ` +
          `of more than the ${tolerance.toFixed(3)}px this viewport allows`
      ).toBeLessThanOrEqual(tolerance);

      // The floor: a table that laid out as an empty box would satisfy every
      // equality above having drawn nothing.
      expect(
        online.handSlot.width,
        "the online hand rendered cards with no width"
      ).toBeGreaterThan(20);

      expect(
        online.wide,
        `these parts of the online table render off the side of a ${vp.width}px screen: ` +
          online.wide.join("; ")
      ).toEqual([]);

      expect(consoleErrors.entries, "the browser reported errors at the table").toEqual([]);

      // Last, never before the assertions: a red run's numbers are printed
      // above but must not replace the record, which exists to say that the
      // two tables agreed.
      const measured = [line("ONLINE", vp, online), line("OFFLINE", vp, offline)];
      rows.push(...measured);

      if (!UPDATING) {
        const record = recorded();
        for (const row of measured) {
          const was = record.get(keyOf(row));
          if (was === undefined) continue;
          expect(
            row,
            `the table no longer lays out the way docs/design/57-polish-audit/ records it ` +
              `at ${vp.name}. If that is the intended change, say so on the ticket that made ` +
              `it and regenerate the record with AUDIT_UPDATE=1 (a whole run, not a shard), ` +
              `correcting the numbers README.md quotes.`
          ).toBe(was);
        }
      }
    });
  }

  test.afterAll(() => {
    // Only a whole survey is written down. A `--shard`ed or `-g`-filtered run
    // measures some of the four, and a partial file replacing the record reads
    // as the rest having stopped being true.
    if (rows.length !== VIEWPORTS.length * 2) return;
    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(RECORD, rows.join("\n") + "\n", "utf8");
  });
});

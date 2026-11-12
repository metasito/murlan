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
// The captures and `online-table.txt` land in `tests/e2e/57-polish-audit/`
// beside the rest of the survey, so a finding can be re-measured rather than
// re-argued — and the run is held to that record, so a table that lays out
// differently has to say so rather than leaving the audit quietly wrong.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openSeededGame } from "./helpers/offlineSeed";
import { openOnlineTable } from "./helpers/onlineTable";
import { assertFresh } from "./helpers/freshTable";
import { HAND_CARDS, HAND_ZONE, TABLE, TABLE_STATE } from "./helpers/selectors";
import { YOUR_TURN_PREFIX } from "./helpers/labels";
import {
  audited,
  CAPTURES,
  captureName,
  keyOf,
  measuredText,
  MEASURED_ROWS,
  mergedRecord,
  ONLINE_TABLE,
  recordOf,
  VIEWPORTS,
} from "./helpers/onlineTableRecord";

/** Four seats fills the top seat and both side columns — the arrangement with the most to measure. */
const SEATS = 4;

const REPO = path.resolve(__dirname, "..", "..");
const RECORD = path.join(REPO, ONLINE_TABLE);
const AUDIT_DIR = path.dirname(RECORD);
const AUDITED = `${path.posix.dirname(ONLINE_TABLE)}/`;
/** Set to rewrite the record instead of being held to it. */
const UPDATING = process.env.AUDIT_UPDATE === "1";
const regenerate = (grep?: string) =>
  `\`AUDIT_UPDATE=1 npx playwright test -c tests/e2e/playwright.config.ts onlineTableSurvey${grep ? ` -g "${grep}"` : ""}\``;
const fromRun = "or, from the CI run that measured it, `npm run regen -- --from-run <run id>`";

/**
 * The record by `MODE\tviewport\tcards`, so a shard is held to the rows it
 * measured. CI does write a whole one — the split is by spec file, so one
 * shard runs all four — but onto a runner nothing commits from: the checked-in
 * copy moves when someone runs the survey locally, or applies the rows a red CI
 * run left as `MEASURED_ROWS`.
 */
function recordText(): string {
  try {
    return readFileSync(RECORD, "utf8");
  } catch {
    return "";
  }
}
function recorded(): Map<string, string> {
  return recordOf(recordText());
}
/** The tree this checkout holds, which on a pull request's CI is the merge with main. */
function measuredTree(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
/** Past `FLARE_BRIEF_MS` (components/table/moments.tsx), the longest moment a bot's play raises; the match flare's 3 s needs a finished match. */
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
  /**
   * #785: the diagnosis-only half. Nothing here is asserted on or written to
   * the record — it exists so a disagreement can be read from the log of the
   * run that actually disagreed, instead of reasoned about after the fact.
   */
  debug: {
    tableBox: { width: number; height: number; top: number; bottom: number };
    handTop: number;
    plateBottom: number;
    /** Every seat-ring candidate the `plateBottom` scan considered, raw. */
    seatRings: { bottom: number; height: number }[];
    /** Each opponent seat slot's own box and displayed card count. */
    seatSlots: { testId: string; top: number; bottom: number; count: string }[];
    /** `getComputedStyle(a).transform` for each of the table's first 6 DOM ancestors, `""` when identity. */
    ancestorTransforms: string[];
    dpr: number;
    innerWidth: number;
    innerHeight: number;
    fontsStatus: string;
    fontsSize: number;
  };
}

/**
 * A table's numbers, with `wide` narrowed to what overflows *steadily*.
 *
 * The moment overlays a played hand raises — a bomb's flare grows to 7x its
 * 150 px (`BombBurst`, components/table/moments.tsx) — are drawn wider than the
 * screen on purpose and are gone again inside two seconds. Reading twice and keeping only what both readings hold measures the
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

async function readTable(page: Page): Promise<Measurement> {
  const m = await page.evaluate(
    ({ table: tableSel, hand: handSel, cards: cardSel, turn: turnAttr, yourTurn }) => {
      const round = (n: number) => Math.round(n);
      const table = document.querySelector(tableSel);
      if (!table) throw new Error("the table never rendered");
      const tableBox = table.getBoundingClientRect();

      // #785 diagnosis: a peer's lead — `useTableFeedback.ts`'s `kickScale` sits
      // on an ancestor of this element (`styles.kick` in GameTable.tsx) and
      // scales on a heavy landing. Reduced motion should gate it to a no-op
      // (this suite's fixture emulates it before every test), but this reports
      // the ancestor chain's own computed transform rather than trusting that.
      const ancestorTransforms: string[] = [];
      for (let a = table.parentElement, depth = 0; a && depth < 6; a = a.parentElement, depth++) {
        const tf = getComputedStyle(a).transform;
        ancestorTransforms.push(tf === "none" ? "" : tf);
      }

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
      const seatRings: { bottom: number; height: number }[] = [];
      for (const ring of Array.from(document.querySelectorAll('[data-testid="seat-ring"]'))) {
        const r = ring.getBoundingClientRect();
        if (r.height === 0) continue;
        seatRings.push({ bottom: r.bottom, height: r.height });
        if (r.bottom > plateBottom && r.bottom <= handTop) plateBottom = r.bottom;
      }

      // #785 diagnosis: what each opponent seat slot is showing, to correlate a
      // ring-position shift with a bot mid-hand rather than reasoning about it.
      const seatSlots: { testId: string; top: number; bottom: number; count: string }[] = [];
      for (const slot of Array.from(
        document.querySelectorAll('[data-testid="top-seat"], [data-testid="side-seat-left"], [data-testid="side-seat-right"]')
      )) {
        const r = slot.getBoundingClientRect();
        const countEl = slot.querySelector('[data-testid="seat-card-count"]');
        seatSlots.push({
          testId: slot.getAttribute("data-testid") ?? "?",
          top: r.top,
          bottom: r.bottom,
          count: countEl ? (countEl.textContent ?? "") : "?",
        });
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
        debug: {
          tableBox: {
            width: tableBox.width,
            height: tableBox.height,
            top: tableBox.top,
            bottom: tableBox.bottom,
          },
          handTop,
          plateBottom,
          seatRings,
          seatSlots,
          ancestorTransforms,
          dpr: window.devicePixelRatio,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          fontsStatus: document.fonts.status,
          fontsSize: document.fonts.size,
        },
      };
    },
    {
      table: TABLE,
      hand: HAND_ZONE,
      cards: HAND_CARDS,
      turn: TABLE_STATE,
      yourTurn: YOUR_TURN_PREFIX,
    }
  );
  assertFresh(m.debug.seatSlots, SEATS);
  return m;
}

/**
 * Everything the record holds, and so everything that has to have stopped
 * moving before a measurement is taken.
 */
function fields(m: Measurement): string {
  return [
    `table=${m.table.width}x${m.table.height}`,
    `handSlot=${m.handSlot.width}x${m.handSlot.height}`,
    // Rounded like every other field here. The record is held to by exact
    // string equality, and stillness is only ever established to the whole
    // pixel (`settled`), so a band written to three decimals is the one field
    // that can fail for a movement no check in this suite can see.
    `emptyBand=${Math.round(m.emptyBand)}`,
    `cards=${m.cards}`,
    `hand=${m.hand.width}x${m.hand.height}@${m.hand.top}`,
    `wide=${m.wide.join(" | ")}`,
  ].join("\t");
}

function line(kind: "ONLINE" | "OFFLINE", vp: (typeof VIEWPORTS)[number], m: Measurement): string {
  return [kind, vp.name, `vp=${vp.width}x${vp.height}`, fields(m)].join("\t");
}

/** Readings of the record's own fields that must agree before one is taken. */
const AGREEING_READINGS = 3;
const READING_GAP_MS = 150;
const STILL_MEASURING_CEILING_MS = 20_000;

/**
 * A measurement of a table that has stopped moving.
 *
 * `settled` is a proxy: it watches the elements it can reach, in rounded
 * pixels, and returns at its ceiling whether or not the screen ever went
 * still. Neither is enough for a record held to by exact equality, and it is
 * the wrong thing to watch anyway — what has to be stable is this measurement,
 * so this watches that and nothing else. A screen that will not hold one
 * reading says so, rather than being recorded mid-movement.
 */
/**
 * #785 diagnosis: every raw reading `stillMeasure` takes, none of it asserted
 * on or written to the record. `measure()` reads twice (the moment-overlay
 * settle) and reports the second's debug block, which is the one `fields()`
 * — and so agreement — is computed from.
 */
function debugLine(kind: "ONLINE" | "OFFLINE", attempt: number, elapsedMs: number, m: Measurement): string {
  const d = m.debug;
  return (
    `DEBUG\t${kind}\tattempt=${attempt}\telapsedMs=${elapsedMs}\t` +
    `emptyBand(raw)=${m.emptyBand}\thandTop=${d.handTop}\tplateBottom=${d.plateBottom}\t` +
    `tableBox=${d.tableBox.width}x${d.tableBox.height}@${d.tableBox.top}..${d.tableBox.bottom}\t` +
    `seatRings=[${d.seatRings.map((r) => `${r.bottom}/${r.height}`).join(", ")}]\t` +
    `seatSlots=[${d.seatSlots.map((s) => `${s.testId}:${s.top}..${s.bottom}/${s.count}`).join(", ")}]\t` +
    `kick=[${d.ancestorTransforms.map((t, i) => `${i}:${t || "identity"}`).join(", ")}]\t` +
    `dpr=${d.dpr}\tviewport=${d.innerWidth}x${d.innerHeight}\t` +
    `fonts=${d.fontsStatus}(${d.fontsSize})`
  );
}

async function stillMeasure(page: Page, kind: "ONLINE" | "OFFLINE"): Promise<Measurement> {
  const started = Date.now();
  const deadline = started + STILL_MEASURING_CEILING_MS;
  let previous: Measurement | null = null;
  let agreeing = 1;

  for (let attempt = 1; ; attempt++) {
    const current = await measure(page);
    console.log(debugLine(kind, attempt, Date.now() - started, current));
    agreeing = previous && fields(current) === fields(previous) ? agreeing + 1 : 1;
    if (agreeing >= AGREEING_READINGS) return current;
    if (Date.now() >= deadline) {
      throw new Error(
        `the ${kind} table never held one measurement for ${AGREEING_READINGS} readings in ` +
          `${STILL_MEASURING_CEILING_MS}ms, so nothing it reports is what it lays out as. ` +
          `Last two:\n  ${fields(previous!)}\n  ${fields(current)}`
      );
    }
    previous = current;
    await page.waitForTimeout(READING_GAP_MS);
  }
}

const rows: string[] = [];

test("the record holds rows for the audited viewports only", () => {
  const orphans = [...recorded().keys()].filter((key) => !audited(key));
  expect(
    orphans,
    `${ONLINE_TABLE} holds rows for a viewport VIEWPORTS no longer lists; ` +
      `regenerate it with ${regenerate()}, which drops them`
  ).toEqual([]);
});

test.describe("the online table, at the audit's viewports", () => {
  for (const vp of VIEWPORTS) {
    // Not the fixture `page`: every seat here is its own browser context (see
    // `openOnlineTable`), so the reduced-motion emulation the `consoleErrors`
    // fixture would set up on the unused fixture page is wired onto each seat
    // directly instead.
    test(`${vp.name} — ${vp.width}x${vp.height}`, async ({ browser, baseURL }) => {
      // Past the sum of the ceilings each half sets for itself, so a runner
      // slow enough to reach one fails with that ceiling's own sentence rather
      // than with a timeout that names nothing.
      test.setTimeout(300_000);

      const table = await openOnlineTable(browser, baseURL!, {
        playerCount: SEATS,
        gameMode: "free_for_all",
        viewport: { width: vp.width, height: vp.height },
      });
      const { page } = table;
      try {
        const online = await stillMeasure(page, "ONLINE");
        const capture = await page.screenshot();
        writeFileSync(test.info().outputPath(captureName(vp.name)), capture);

        // Dealt the same number of cards the server just dealt, not the seed
        // helper's default: the hand row sizes its cards to fit however many it
        // holds, so a 13-card seed and a 14-card deal are two different tables
        // and comparing them measures the deal rather than the layout.
        await openSeededGame(page, baseURL!, SEATS, online.cards);
        await page.locator(TABLE).waitFor({ timeout: 30_000 });
        const offline = await stillMeasure(page, "OFFLINE");

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

        expect(table.errors, "the browser reported errors at the table").toEqual([]);

        // Last, never before the assertions: a red run's numbers are printed
        // above but must not replace the record, which exists to say that the
        // two tables agreed.
        const measured = [line("ONLINE", vp, online), line("OFFLINE", vp, offline)];
        rows.push(...measured);
        if (UPDATING) {
          mkdirSync(path.join(REPO, CAPTURES), { recursive: true });
          writeFileSync(path.join(REPO, CAPTURES, captureName(vp.name)), capture);
        }

        if (!UPDATING) {
          writeFileSync(test.info().outputPath(MEASURED_ROWS), measuredText(measuredTree(), measured));
          const record = recorded();
          for (const row of measured) {
            const was = record.get(keyOf(row));
            expect(
              was,
              `${AUDITED} records no row for ${keyOf(row).replaceAll("\t", " ")}, so ` +
                `nothing holds this table to anything. Regenerate the record with ${regenerate(vp.name)}, ${fromRun}.`
            ).toBeDefined();
            expect(
              row,
              `the table no longer lays out the way ${AUDITED} records it ` +
                `at ${vp.name}. If that is the intended change, say so on the ticket that made ` +
                `it and regenerate this viewport's rows with ${regenerate(vp.name)}, ${fromRun}, ` +
                `correcting the numbers README.md quotes.`
            ).toBe(was);
          }
        }
      } finally {
        await table.close();
      }
    });
  }

  test.afterAll(() => {
    if (!UPDATING || rows.length === 0) return;
    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(RECORD, mergedRecord(recordText(), rows), "utf8");
  });
});

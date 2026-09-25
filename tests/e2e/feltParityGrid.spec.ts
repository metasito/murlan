// tests/e2e/feltParityGrid.spec.ts — the felt and the lamp across the whole grid.
//
// `mockupParity.spec.ts` holds the table to the Lantern mockup at the one seating and viewport the
// mockup draws: four players, 874x402. Ours seats 2, 3 or 4 at any window size, and the lamp's
// targets map by seat direction and scale with the table frame (#1257), so this walks every seating
// at a phone and a tablet: the lamp over the seat on move, and the Skia cloth brighter and its weave
// louder on the lit side. `feltNap.spec.ts` holds the weave's relief to the mockup's.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openCaptureState } from "./helpers/offlineSeed";
import { tracedLamp, untilSkiaFelt } from "./helpers/tableTrace";
import {
  CAPTURE_STATES,
  CAPTURE_VIEWER_SEAT,
  type CaptureState,
} from "../../lib/captureStates";
import { seatDirection } from "../../components/seatLayout";
import { DESIGN, LIGHT_ABOVE, lampTarget } from "../../components/table/lampRig";

/** The table's scale comes from the window's short edge, so a tablet is a different weave-to-card ratio. */
const VIEWPORTS = [
  { name: "phone", width: 874, height: 402 },
  { name: "tablet", width: 1194, height: 834 },
] as const;

/**
 * The felt, not `game-table`: `game-table` is inset by the control rail on one side and the safe
 * area on the other, so mirrored fractions of it are not mirrored points on the cloth.
 */
const OUR_TABLE = '[data-testid="table-felt"]';

/** Past the deal stagger; every card is at opacity 0 until its own leg runs. */
const DEALT_MS = 2_000;

/** The rig's resting sway, in design points. */
const SWAY = 20;

/** The patch size `feltNap` uses, kept so the two files' numbers are comparable. */
const PATCH_PX = 15;

/**
 * Where a mirrored pair of patches may sit, best first. A fixed fraction is bare felt at one
 * window size and not at another, so `bareAt` picks the first pair the layout leaves alone.
 */
const CANDIDATES = [
  { x: 0.17, y: 0.3 },
  { x: 0.13, y: 0.62 },
] as const;

/** Named for the side of the table each sits on; the pair is mirrored so the two are comparable. */
const PATCH_NAMES = ["left", "right"] as const;

interface Cloth {
  amplitude: number;
  mean: number;
}
type Row = Record<string, Cloth>;
interface Patch {
  name: string;
  x: number;
  y: number;
}

/**
 * The first mirrored pair from `CANDIDATES` that nothing is drawn over, as fractions of `frame`,
 * asked of the layout. Null when no candidate is clear, which is a result to report and not a
 * reason to sample anyway.
 */
async function bareAt(
  page: Page,
  cloth: string,
  frame: { x: number; y: number; width: number; height: number }
): Promise<Patch[] | null> {
  const chosen = await page.evaluate(
    ({ cloth, frame, candidates, size }) => {
      const felt = document.querySelector(cloth);
      if (!felt) return null;
      const area = frame.width * frame.height;
      // What actually puts ink on the cloth: a layout container is transparent and covers most
      // of the felt, so counting boxes rather than paint left nowhere clear.
      const paints = (el: Element) => {
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) {
          return false;
        }
        if (["IMG", "svg", "CANVAS", "VIDEO"].includes(el.tagName)) return true;
        if (s.backgroundImage !== "none") return true;
        if (!/^rgba\(.*,\s*0\)$/.test(s.backgroundColor) && s.backgroundColor !== "transparent") {
          return true;
        }
        if (s.borderTopWidth !== "0px" || s.borderLeftWidth !== "0px") return true;
        return [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""
        );
      };

      const drawn = [...document.body.querySelectorAll("*")]
        .filter((el) => !felt.contains(el) && el !== felt && paints(el))
        .map((el) => el.getBoundingClientRect())
        // A box the size of the cloth is the room behind it, not a thing on it.
        .filter((r) => r.width > 0 && r.height > 0 && r.width * r.height < area * 0.7);

      const clear = (px: number, py: number) => {
        const l = frame.x + px * frame.width;
        const t = frame.y + py * frame.height;
        return drawn.every(
          (r) => r.right <= l || r.left >= l + size || r.bottom <= t || r.top >= t + size
        );
      };

      for (const c of candidates) {
        if (clear(c.x, c.y) && clear(1 - c.x, c.y)) return c;
      }
      return null;
    },
    { cloth, frame, candidates: CANDIDATES.map((c) => ({ ...c })), size: PATCH_PX }
  );
  if (!chosen) return null;
  return [
    { name: PATCH_NAMES[0], x: chosen.x, y: chosen.y },
    { name: PATCH_NAMES[1], x: 1 - chosen.x, y: chosen.y },
  ];
}

/** The hatch as a fraction of the cloth it sits on — `feltNap.spec.ts`'s measure. */
const relief = (c: Cloth) => c.amplitude / Math.max(c.mean, 1);

/** Samples `patches` out of a screenshot of `table` alone, so the fractions are of the table. */
async function clothRow(page: Page, table: Locator, patches: Patch[]): Promise<Row> {
  const box = await table.boundingBox();
  if (!box) throw new Error("nothing to sample: the table has no box");
  const png = (await table.screenshot({ type: "png" })).toString("base64");
  return page.evaluate(
    async ({ png, patches, width, size }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0);
      // The screenshot is in device pixels and the patch size in CSS ones.
      const scale = img.width / width;

      const out: Record<string, { amplitude: number; mean: number }> = {};
      for (const p of patches) {
        const { data } = ctx.getImageData(
          Math.round(p.x * img.width),
          Math.round(p.y * img.height),
          Math.round(size * scale),
          Math.round(size * scale)
        );
        let lo = Infinity;
        let hi = -Infinity;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          if (lum < lo) lo = lum;
          if (lum > hi) hi = lum;
          sum += lum;
        }
        out[p.name] = { amplitude: hi - lo, mean: sum / (data.length / 4) };
      }
      return out;
    },
    { png, patches, width: box.width, size: PATCH_PX }
  );
}

function line(id: string, side: string, row: Row, patches: Patch[]): string {
  return [
    id.padEnd(14),
    `side=${side}`.padEnd(13),
    `@y=${patches[0].y.toFixed(2)}`,
    ...patches.map(
      (p) =>
        `${p.name}: relief=${relief(row[p.name]).toFixed(3)} amp=${row[p.name].amplitude
          .toFixed(1)
          .padStart(5)} mean=${row[p.name].mean.toFixed(1).padStart(5)}`
    ),
  ].join("  ");
}

/**
 * The grid the app can actually seat: what varies with the count is which turns there are, and
 * `pile` is carried across from the state that has one.
 */
function grid(): CaptureState[] {
  const pileState = CAPTURE_STATES.find((s) => s.pile);
  if (!pileState) throw new Error("no capture state carries a pile");

  const cells: CaptureState[] = [];
  for (const playerCount of [2, 3, 4] as const) {
    for (let turn = 0; turn < playerCount; turn++) {
      cells.push({
        id: `p${playerCount}-turn${turn}`,
        label: `${playerCount} players, seat ${turn} on move`,
        playerCount,
        turn,
        side: seatDirection(turn, CAPTURE_VIEWER_SEAT, playerCount),
        pile: false,
      });
    }
    const pileTurn = Math.min(pileState.turn, playerCount - 1);
    cells.push({
      ...pileState,
      id: `p${playerCount}-pile`,
      label: `${playerCount} players, a combination on the felt`,
      playerCount,
      turn: pileTurn,
      side: seatDirection(pileTurn, CAPTURE_VIEWER_SEAT, playerCount),
    });
  }
  return cells;
}

test.describe("the lamp and the cloth everywhere, not just at one seating", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: every seating, every lamp position`, async ({ page, baseURL }) => {
      test.setTimeout(600_000);

      const cells = grid();
      const rows: string[] = [];
      const offenders: string[] = [];

      for (const cell of cells) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openCaptureState(page, baseURL!, cell);
        await page.waitForTimeout(DEALT_MS);
        await untilSkiaFelt(page);

        const felt = page.locator(OUR_TABLE);
        const box = await felt.boundingBox();
        if (!box) throw new Error(`${cell.id}: the felt has no box`);

        const sx = box.width / DESIGN.width;
        const sy = box.height / DESIGN.height;
        const [poolX, poolY] = lampTarget(cell.side);
        const lamp = await tracedLamp(page);
        if (Math.abs(lamp.x - poolX * sx) > (SWAY + 0.5) * sx || Math.abs(lamp.y - (poolY - LIGHT_ABOVE) * sy) > 0.5) {
          offenders.push(
            `${viewport.name}/${cell.id}: lamp at ${lamp.x.toFixed(1)},${lamp.y.toFixed(1)}, ` +
              `not over the ${cell.side} seat at ${(poolX * sx).toFixed(1)},${((poolY - LIGHT_ABOVE) * sy).toFixed(1)}`
          );
        }

        const patches = await bareAt(page, OUR_TABLE, box);
        if (!patches) {
          offenders.push(`${viewport.name}/${cell.id}: no candidate patch is clear of the layout`);
          continue;
        }
        const row = await clothRow(page, felt, patches);

        rows.push(line(cell.id, cell.side, row, patches));

        // Only meaningful with the lamp to one side: at the top or the bottom both patches are
        // the same distance from it, and the comparison says nothing.
        if (cell.side === "left" || cell.side === "right") {
          const lit = cell.side === "left" ? row.left : row.right;
          const away = cell.side === "left" ? row.right : row.left;
          if (away.amplitude >= lit.amplitude) {
            offenders.push(
              `${viewport.name}/${cell.id}: the weave is as loud unlit, ${away.amplitude.toFixed(1)}, as lit, ${lit.amplitude.toFixed(1)}`
            );
          }
          if (away.mean >= lit.mean) {
            offenders.push(
              `${viewport.name}/${cell.id}: lamp not at ${cell.side} — mean ${lit.mean.toFixed(1)} vs ${away.mean.toFixed(1)}`
            );
          }
        }
      }

      console.log(`\n=== ours — ${viewport.name} ${viewport.width}x${viewport.height} ===`);
      for (const r of rows) console.log(r);

      // The floor: a grid that sampled nothing reports no offenders, which is
      // indistinguishable from a clean table.
      expect(rows.length).toBe(cells.length);
      expect(cells.length).toBeGreaterThan(10);

      expect(offenders, offenders.join("\n")).toEqual([]);
    });
  }
});

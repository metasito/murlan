// tests/e2e/feltParityGrid.spec.ts — the felt across the whole grid, and
// against the prototype where the prototype has an answer.
//
// `feltNap.spec.ts` proves the claim #341 makes: the cloth shows more texture
// under the lamp than away from it. It proves it at ONE patch, in TWO states,
// at FOUR players, on a phone. That is enough for the claim and not enough to
// see the table, which is what left #341 with two DoD boxes about *looking* at
// it (#519).
//
// **What the two sides can and cannot answer.** Ours seats 2, 3 or 4 and draws
// at any window size. The prototype seats four, always — `.seat.top`,
// `.seat.left`, `.seat.right`, no control for the count — and sizes itself from
// an eleven-entry `PHONES` table with no tablet in it. So the grid is not one
// grid: ours is walked in full, the prototype is walked over the four lamp
// positions it exposes at the one viewport both share (874x402, its
// `iPhone 16 Pro / 17`), and the cells with no counterpart are named as such
// rather than filled with four-player pixels under a two-player label.
//
// **The cloth is where they are meant to differ.** #341 measured the prototype
// at 0.793 relief unlit against 0.169 lit — the inversion it removed, and
// worse. So the comparison here is of the pool's own falloff, in absolute
// levels, and the relief numbers are printed side by side without being
// asserted against each other.
import { test, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openCaptureState } from "./helpers/offlineSeed";
import {
  CAPTURE_STATES,
  CAPTURE_VIEWER_SEAT,
  type CaptureState,
} from "../../lib/captureStates";
import { seatDirection } from "../../components/gameTableModel";

/** The table's scale comes from the window's short edge, so a tablet is a different weave-to-card ratio. */
const VIEWPORTS = [
  { name: "phone", width: 874, height: 402 },
  { name: "tablet", width: 1194, height: 834 },
] as const;

/** `PHONES[8]`, `iPhone 16 Pro / 17` — the one entry that is also a viewport we draw at. */
const SHARED_VIEWPORT = VIEWPORTS[0];
const PROTOTYPE_PHONE_INDEX = 8;

/**
 * The felt, not `game-table`.
 *
 * `game-table` is inset by `frame.tableLeft`/`tableRight` — the control rail on
 * one side and the safe area on the other, which are not equal — so mirrored
 * fractions of it are not mirrored points on the cloth, and the pool reads as
 * off-centre when it is the frame that is. `table-felt` is `absoluteFill`, the
 * same edge-to-edge box as the prototype's `#device`.
 */
const OUR_TABLE = '[data-testid="table-felt"]';

// `__dirname`, not `import.meta.dirname`: Playwright transpiles a spec to CJS,
// where the latter is a syntax error at load and the whole file disappears
// from the run as "no tests found".
const PROTOTYPE = pathToFileURL(
  path.resolve(__dirname, "fixtures", "prototype-table.html")
).href;

/** Past the deal stagger; every card is at opacity 0 until its own leg runs. */
const DEALT_MS = 2_000;

/** The lamp's own move is a 0.8s spring on `--lx`/`--ly` (the prototype's `.felt` transition). */
const LAMP_SETTLE_MS = 1_200;

/** The patch size `feltNap` uses, kept so the two files' numbers are comparable. */
const PATCH_PX = 15;

/**
 * Where a mirrored pair of patches may sit, best first — `feltNap.spec.ts`'s
 * own y, then lower down the cloth.
 *
 * A candidate list rather than one position, because a fixed fraction is bare
 * felt at one window size and not at another: 0.17/0.3 is clear on a phone and
 * clips the left seat's name and its PASSO chip on a tablet, where it reads a
 * label's edge as a thread and reports the cloth as more textured in the dark.
 * `bareAt` picks the first pair the layout leaves alone, per cell.
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
 * The first mirrored pair from `CANDIDATES` that nothing is drawn over, as
 * fractions of `frame`.
 *
 * Asked of the layout rather than assumed of it. Everything the table draws
 * carries a box; a patch that overlaps one is not cloth, whatever it looks
 * like. Containers are skipped by area — they are transparent and cover most of
 * the felt, so counting them would leave nowhere clear anywhere.
 *
 * Returns null when no candidate is clear, which is a result to report and not
 * a reason to sample anyway.
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
      // What actually puts ink on the cloth. A layout container is transparent
      // and covers most of the felt, so counting boxes rather than paint left
      // nowhere on the table clear of anything.
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

/**
 * Samples `PATCHES` out of a screenshot of `table` alone.
 *
 * Of the element, never of the page. Ours fills the window and the prototype
 * draws its device inside a workbench with headings and controls around it, so
 * one set of viewport fractions cannot mean the same thing on both — and the
 * fractions here are of the table, which is what the patches were chosen
 * against.
 */
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
 * The grid the app can actually seat.
 *
 * Not a 5x3 product: every entry in `CAPTURE_STATES` is a four-player state and
 * a state's `side` is derived from its turn, so "lamp-left at two players" names
 * a seat that does not exist. What varies with the count is which turns there
 * are, so the grid is built from the counts — and `pile` is carried across from
 * the state that has one, since a pile under the lamp is the case #341's own
 * capture set added last.
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

test.describe("the cloth answers to the lamp everywhere, not just at one patch", () => {
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

        const felt = page.locator(OUR_TABLE);
        const box = await felt.boundingBox();
        if (!box) throw new Error(`${cell.id}: the felt has no box`);
        const patches = await bareAt(page, OUR_TABLE, box);
        if (!patches) {
          offenders.push(`${viewport.name}/${cell.id}: no candidate patch is clear of the layout`);
          continue;
        }
        const row = await clothRow(page, felt, patches);

        rows.push(line(cell.id, cell.side, row, patches));

        // The inversion #341 removed: cloth with no light on it showing MORE
        // texture than cloth under the lamp. Only meaningful where the lamp is
        // at an edge — with it at the top or the bottom both patches are the
        // same distance from it, and the comparison says nothing.
        if (cell.side === "left" || cell.side === "right") {
          const lit = cell.side === "left" ? row.left : row.right;
          const away = cell.side === "left" ? row.right : row.left;
          if (relief(away) > relief(lit)) {
            offenders.push(
              `${viewport.name}/${cell.id}: unlit relief ${relief(away).toFixed(3)} > lit ${relief(lit).toFixed(3)}`
            );
          }
          // A seeding failure reads as a clean pass otherwise: if the lamp is
          // not actually across the table, the line above compares one patch
          // with itself.
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

  test("against the prototype, at the one viewport and seating both draw", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(600_000);

    const { width, height } = SHARED_VIEWPORT;
    await page.setViewportSize({ width, height });

    // Prototype `me` is our `bottom`; the rest carry the same names.
    const LAMPS = [
      { theirs: "me", ours: "bottom" },
      { theirs: "top", ours: "top" },
      { theirs: "left", ours: "left" },
      { theirs: "right", ours: "right" },
    ] as const;

    await page.goto(PROTOTYPE);
    await page.selectOption("#model", String(PROTOTYPE_PHONE_INDEX));

    const device = page.locator("#device");
    const size = await device.boundingBox();
    if (!size) throw new Error("the prototype drew no device");
    // Its own workbench, not ours: if the entry moved in `PHONES`, every number
    // below is of some other handset and nothing else would say so.
    expect(Math.round(size.width), "prototype device width").toBe(width);
    expect(Math.round(size.height), "prototype device height").toBe(height);

    const theirs = new Map<string, Row>();
    const theirPatches = new Map<string, Patch[]>();
    for (const lamp of LAMPS) {
      await page.click(`#turn button[data-turn="${lamp.theirs}"]`);
      await page.waitForTimeout(LAMP_SETTLE_MS);
      const box = await device.boundingBox();
      if (!box) throw new Error("the prototype's device vanished");
      const patches = await bareAt(page, "#felt", box);
      if (!patches) throw new Error(`prototype ${lamp.ours}: nothing on the cloth is clear`);
      theirPatches.set(lamp.ours, patches);
      theirs.set(lamp.ours, await clothRow(page, device, patches));
    }

    const ours = new Map<string, Row>();
    const ourPatches = new Map<string, Patch[]>();
    for (const state of CAPTURE_STATES.filter((s) => !s.pile)) {
      await openCaptureState(page, baseURL!, state);
      await page.waitForTimeout(DEALT_MS);
      const felt = page.locator(OUR_TABLE);
      const box = await felt.boundingBox();
      if (!box) throw new Error(`${state.id}: the felt has no box`);
      const patches = await bareAt(page, OUR_TABLE, box);
      if (!patches) throw new Error(`${state.id}: nothing on the cloth is clear`);
      ourPatches.set(state.side, patches);
      ours.set(state.side, await clothRow(page, felt, patches));
    }

    console.log(`\n=== prototype vs ours — ${width}x${height}, four players ===`);
    for (const lamp of LAMPS) {
      console.log(
        line(`proto ${lamp.ours}`, lamp.ours, theirs.get(lamp.ours)!, theirPatches.get(lamp.ours)!)
      );
      console.log(
        line(`ours  ${lamp.ours}`, lamp.ours, ours.get(lamp.ours)!, ourPatches.get(lamp.ours)!)
      );
    }
    console.log(
      "\nno counterpart on the prototype: 2 and 3 players (it seats four only)," +
        " the tablet viewport (its PHONES table is iPhones only), and the pile" +
        " states (its #field sets the combination on the felt, not whose lamp it is under)."
    );

    // Both sides answered for every lamp, so a silent seeding failure cannot
    // read as agreement.
    expect([...theirs.keys()].sort()).toEqual(["bottom", "left", "right", "top"]);
    expect([...ours.keys()].sort()).toEqual(["bottom", "left", "right", "top"]);

    // The pool's own falloff, which #341 did not touch and which is what "the
    // rest of the table still matches" means in levels. Measured 1% at the side
    // lamps, 5% at the bottom and 12% at the top; the band is set above that
    // and well under the size of the mistake it is for — a halved gradient
    // radius reads as 104 against 132 (`docs/agents/loops.md`), a fifth.
    //
    // Lit only. The unlit corner is the cloth, where the two are meant to part.
    // Sampled at the same point on both, or the comparison is between two
    // places rather than two tables.
    const positions = [...theirPatches.values(), ...ourPatches.values()].map(
      (p) => `${p[0].x.toFixed(2)},${p[0].y.toFixed(2)}`
    );
    expect(new Set(positions).size, `patch positions: ${[...new Set(positions)].join(" ")}`).toBe(1);

    const LIT_TOLERANCE = 0.2;
    for (const lamp of LAMPS) {
      for (const name of PATCH_NAMES) {
        const t = theirs.get(lamp.ours)![name];
        const o = ours.get(lamp.ours)![name];
        // "Lit" is the prototype's own reading: below this the patch is the
        // shadowed side, and a ratio between two near-zero levels is noise.
        if (t.mean < 20) continue;
        expect(
          Math.abs(o.mean - t.mean) / t.mean,
          `${lamp.ours} lamp, ${name} patch: ours ${o.mean.toFixed(1)} vs prototype ${t.mean.toFixed(1)}`
        ).toBeLessThan(LIT_TOLERANCE);
      }
    }
  });
});

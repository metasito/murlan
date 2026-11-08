// tests/e2e/mockupPolish.nightly.spec.ts — #1259 plan 5: each notice held to the mockup it was approved in.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appAt, appResumed, mockupAt, type PlatePaint, type Rect, type Stage } from "./helpers/mockupStage";
import { exchangeSave, offlineSave, resumeSaved } from "./helpers/offlineSeed";
import { tap } from "./helpers/press";
import { captureGameState, captureStateById, seatedSituation, type CaptureState } from "../../lib/captureStates";
import { CARD_H, cardScale, HAND_SCALE } from "../../components/cardFaceModel";
import { handVisibleH } from "../../components/seatLayout";
import type { Card } from "../../lib/game/gameEngine";
import { HAND_CARD_BOXES, HAND_SELECTED } from "./helpers/selectors.ts";

const HALF_PT = 0.5;
const ONE_PT = 1;
const TURN = '[data-testid="notice-turn"]';
const COUNT = '[data-testid="turn-chip-count"]';
const STAGES = [
  { name: "iPhone 16 Pro", width: 874, height: 402 },
  { name: "iPhone SE", width: 568, height: 320 },
];

/** Your turn over a pile, so the clock runs and the pill carries its count as `#turn.lit` does. */
const LIT_WITH_COUNT: CaptureState = {
  ...captureStateById("lamp-bottom")!,
  id: "lamp-bottom-pile",
  situation: seatedSituation("lamp-bottom-pile", 4, 0, { by: 3, cards: "K_hearts K_diamonds" }),
};

const shown = async (stage: Stage, selector: string, run?: string): Promise<PlatePaint> => {
  await expect.poll(async () => (await stage.plate(selector))?.opacity, { message: `${selector} fully shown`, timeout: 30_000 }).toBe(1);
  return (await stage.plate(selector, run))!;
};

/** The plate's glow now and after each wait. */
const glowsOver = async (stage: Stage, selector: string, waits: number[]) => {
  const glows = [(await stage.plate(selector))!.glow];
  for (const wait of waits) {
    // fixed wait on purpose: the glow sampled at uneven instants, so no loop's period divides them all
    await stage.page.waitForTimeout(wait);
    glows.push((await stage.plate(selector))!.glow);
  }
  return glows;
};

/** Negative where the two overlap. */
const gap = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));

test("turn, lit: the viewer's turn pill is #turn.lit", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const mockup = await mockupAt(browser, "rest", 1000);
  const app = await appAt(browser, baseURL!, LIT_WITH_COUNT);
  await expect(app.page.locator(COUNT), "the lit pill's count").toBeVisible({ timeout: 30_000 });
  const want = await shown(mockup, "#turn.lit");
  const got = await shown(app, TURN);
  const wantCount = (await mockup.plate("#turn.lit", "#tclock"))!;
  const gotCount = (await app.plate(TURN, COUNT))!;
  await Promise.all([mockup.close(), app.close()]);

  expect.soft(got.edge, "the edge").toBe(want.edge);
  expect.soft(got.glow?.color, "the glow's colour").toBe(want.glow?.color);
  expect.soft(Math.abs((got.glow?.blur ?? 0) - want.glow!.blur), "the glow's blur, off the mockup's").toBeLessThanOrEqual(HALF_PT);
  expect.soft(got.ink, "the label's ink").toBe(want.ink);
  expect.soft(got.fontSize, "the label's size").toBeCloseTo(want.fontSize, 0);
  expect.soft(Math.abs(got.box.h - want.box.h), "the height, off the mockup's").toBeLessThanOrEqual(HALF_PT);
  expect.soft(Math.abs(got.box.w - want.box.w), `the width, ${got.box.w} against the mockup's ${want.box.w}`).toBeLessThanOrEqual(ONE_PT);
  expect.soft(gotCount.ink, "the count's ink").toBe(wantCount.ink);
  expect.soft(gotCount.fontSize, "the count's size").toBeCloseTo(wantCount.fontSize, 0);
});

test("turn, lit: the glow is a static shadow", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const app = await appAt(browser, baseURL!, LIT_WITH_COUNT);
  const first = await shown(app, TURN);
  const glows = await glowsOver(app, TURN, [130, 240, 240, 280]);
  await app.close();
  expect(first.glow, "a lit pill glows").not.toBeNull();
  expect(glows, "the glow at 0, 130, 370, 610 and 890 ms").toEqual(glows.map(() => first.glow));
});

/** The lobby's cap on a seat's name (`app/lobby.tsx`): an exchange between two bots names both. */
const LONGEST = ["Konstantinos", "Maximilianus"];
const SMALLEST = STAGES[STAGES.length - 1];

const exchangeBetweenBots = () =>
  exchangeSave({
    seats: 3,
    names: ["Ana", ...LONGEST],
    winner: 1,
    loser: 2,
    cardFromLoser: "2_spades",
    holding: [["5_hearts", "K_spades"], ["2_spades", "6_diamonds", "K_diamonds"], ["7_clubs", "8_clubs"]],
  });

test(`exchange note: two of the longest names stay whole on one line — ${SMALLEST.name}`, async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(SMALLEST);
  await resumeSaved(page, baseURL!, exchangeBetweenBots());
  const label = page.getByTestId("exchange-pill-note");
  await expect(label, "the last-played pill names the announced").toBeVisible({ timeout: 30_000 });
  const run = await label.evaluate((el) => ({ text: el.textContent ?? "", scroll: el.scrollWidth, client: el.clientWidth, wraps: getComputedStyle(el).whiteSpace }));

  for (const name of LONGEST) expect.soft(run.text, "both seats are named").toContain(name);
  expect.soft(run.wraps, "the note is held to one line").toBe("nowrap");
  expect.soft(run.scroll, `"${run.text}" needs ${run.scroll} pt and has ${run.client}: its tail is cut`).toBeLessThanOrEqual(run.client);
});

for (const phone of STAGES) {
  test(`turn fits its band: a bot on move, in it-IT, clear of every neighbour by the mockup's gap — ${phone.name}`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const mockup = await mockupAt(browser, "bomb", 100);
    const [wantTurn] = await mockup.boxes("#turn");
    const mockupGap = Math.min(
      ...(await Promise.all(["#combo", "#score", ".nm", ".ring"].map((s) => mockup.boxes(s, s === ".nm")))).flat().map((b) => gap(wantTurn, b))
    );
    await mockup.close();
    expect(mockupGap, "the mockup's #turn clears its neighbours").toBeGreaterThan(0);

    const onMove = captureStateById("lamp-left")!;
    const app = await appAt(browser, baseURL!, onMove, phone);
    await expect(app.page.getByTestId("game-hud-stack")).toContainText(`Turno di ${captureGameState(onMove).players[onMove.turn].name}`);
    const pill = (await shown(app, TURN)).box;
    const named = { hudCombo: '[data-testid="notice-hudCombo"]', score: '[data-testid="score-pill"]', name: '[data-testid="seat-name"]', ring: '[data-testid="seat-ring"]' };
    const neighbours = (
      await Promise.all(Object.entries(named).map(async ([what, s]) => (await app.boxes(s, what === "name")).map((b) => ({ what, b }))))
    ).flat();
    const clipped = await app.page.evaluate(
      (sel) => [...document.querySelector(sel)!.querySelectorAll("*")].some((n) => n.scrollWidth > n.clientWidth + 1),
      TURN
    );
    await app.close();

    expect(new Set(neighbours.map((n) => n.what)), "every kind of neighbour is on the table").toEqual(new Set(Object.keys(named)));
    const want = (mockupGap * cardScale(Math.min(phone.width, phone.height))) / cardScale(402);
    const nearest = neighbours.map((n) => ({ ...n, gap: gap(pill, n.b) })).sort((a, b) => a.gap - b.gap)[0];
    expect(
      nearest.gap,
      `the pill ${JSON.stringify(pill)} is ${nearest.gap.toFixed(1)} pt from a ${nearest.what} ${JSON.stringify(nearest.b)}; the mockup keeps ${want.toFixed(1)}`
    ).toBeGreaterThanOrEqual(want - HALF_PT);
    expect(clipped, "the label is cut short").toBe(false);
  });
}

const FLOAT = '[data-testid="notice-passFloat"]';

/** The mockup's clock chapter: seat 1 has played, and the turn runs down to you. */
const seatOneLedYouAnswer = () =>
  offlineSave({
    seats: 4,
    holding: [["5_hearts", "K_spades"], ["J_hearts"], ["7_clubs"], ["4_diamonds"]],
    pile: { cards: ["9_spades"], by: 1 },
  });

test("float: the viewer's own pass is the mockup's .floatchip, in its place, and goes", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const mockup = await mockupAt(browser, "clock", 4600);
  const want = await shown(mockup, ".floatchip");
  await mockup.close();

  const app = await appResumed(browser, baseURL!, seatOneLedYouAnswer());
  await tap(app.page, app.page.getByTestId("btn-passa"));
  await expect
    .poll(async () => (await app.plate(FLOAT))?.opacity, { message: "the float risen and faded in", intervals: [20], timeout: 30_000 })
    .toBe(1);
  const got = (await app.plate(FLOAT))!;
  await expect.poll(async () => (await app.plate(FLOAT))?.opacity ?? 0, { message: "the float gone", timeout: 5_000 }).toBe(0);
  await app.close();

  expect.soft(got.fill, "the fill").toBe(want.fill);
  expect.soft(got.edge, "the edge").toBe(want.edge);
  expect.soft(got.ink, "the ink").toBe(want.ink);
  expect.soft(got.glow, "a float casts no glow").toBe(want.glow);
  expect.soft(got.fontSize, "the text").toBe(want.fontSize);
  expect.soft(Math.abs(got.box.h - want.box.h), `the height, ${got.box.h} against ${want.box.h}`).toBeLessThanOrEqual(HALF_PT);
  expect.soft(Math.abs(got.box.w - want.box.w), `the width, ${got.box.w} against ${want.box.w}`).toBeLessThanOrEqual(ONE_PT);
  const centre = (b: Rect) => b.x + b.w / 2;
  expect.soft(Math.abs(centre(got.box) - centre(want.box)), `the centre, ${centre(got.box)} against ${centre(want.box)}`).toBeLessThanOrEqual(ONE_PT);
  expect.soft(Math.abs(got.box.y - want.box.y), `the top, ${got.box.y} against ${want.box.y}`).toBeLessThanOrEqual(ONE_PT);
});

const MARK = '[data-testid="notice-passed"]';
const rgb = (colour: string) => colour.replace(/rgba?\(([^,]+),([^,]+),([^,)]+).*/, "$1,$2,$3").replace(/\s/g, "");

/** Each seat's mark as its centre x and top edge, off that seat's disc centre. */
const markOffsets = (stage: Stage, seats: Record<string, string>, disc: string, mark: string) =>
  stage.page.evaluate(
    ([seats, disc, mark]) =>
      Object.fromEntries(
        Object.entries(seats).map(([side, seat]) => {
          const el = document.querySelector(seat);
          const d = el?.querySelector(disc)?.getBoundingClientRect();
          const m = el?.querySelector(mark)?.getBoundingClientRect();
          return [side, d && m ? { x: m.left + m.width / 2 - (d.left + d.width / 2), y: m.top - (d.top + d.height / 2) } : null];
        })
      ),
    [seats, disc, mark] as const
  );

test("PASSO: another seat's pass is the mockup's .passo, beside the top disc and under a side disc", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const mockup = await mockupAt(browser, "trick", 4400);
  const want = (await mockup.plate('.seat[data-side="top"] .passo'))!;
  const wantAt = await markOffsets(mockup, { top: '.seat[data-side="top"]', side: '.seat[data-side="side"]' }, ".disc", ".passo");
  await mockup.close();
  expect(want.opacity, "Besnik's PASSO is up in the mockup").toBe(1);

  const app = await appAt(browser, baseURL!, captureStateById("passed")!);
  await expect
    .poll(() => app.page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => getComputedStyle(el).opacity), MARK), {
      message: "two marks, each risen and faded in",
      timeout: 30_000,
    })
    .toEqual(["1", "1"]);
  const got = (await app.plate(`[data-testid="top-seat"] ${MARK}`))!;
  const gotAt = await markOffsets(app, { top: '[data-testid="top-seat"]', side: '[data-testid="side-seat-right"]' }, '[data-testid="seat-ring"]', MARK);
  await app.close();

  expect.soft(got.fill, "the fill").toBe(want.fill);
  expect.soft(got.edge, "the edge, the mockup's .35 on goldBorder (Q4)").toBe("rgba(201, 168, 76, 0.3)");
  expect.soft(rgb(got.edge), "the edge's colour").toBe(rgb(want.edge));
  expect.soft(rgb(got.ink), "the ink's colour").toBe(rgb(want.ink));
  expect.soft(got.ink, `the ink, the mockup's ${want.ink} on textSecondary`).toBe("rgba(240, 234, 214, 0.75)");
  expect.soft(got.fontSize, "the text, at the table's floor (Q3)").toBe(10);
  expect.soft(Math.abs(got.box.h - want.box.h), `the height, ${got.box.h} against the mockup's ${want.box.h}`).toBeLessThanOrEqual(HALF_PT);
  expect.soft(Math.abs(got.radius - want.radius), `the radius, ${got.radius} against ${want.radius}`).toBeLessThanOrEqual(HALF_PT);
  for (const side of ["top", "side"] as const) {
    const [g, w] = [gotAt[side], wantAt[side]];
    expect(w, `the mockup's ${side} mark`).not.toBeNull();
    expect(g, `the app's ${side} mark`).not.toBeNull();
    expect.soft(Math.abs(g!.x - w!.x), `the ${side} mark's x off the disc, ${g!.x} against ${w!.x}`).toBeLessThanOrEqual(ONE_PT);
    expect.soft(Math.abs(g!.y - w!.y), `the ${side} mark's top off the disc, ${g!.y} against ${w!.y}`).toBeLessThanOrEqual(ONE_PT);
  }
});

const PANEL_FIXTURE = pathToFileURL(path.resolve(__dirname, "fixtures", "notice-panel", "index.html")).href;
const DESIGN = { width: 874, height: 402 };
const NEAREST = 0.5;
const FONT_SCALE = 1.2;

type Plate = { x: number; y: number; w: number; h: number; pad: number; gap: number; radius: number; edge: string; dim: string };

const card = (rank: string, suit: string) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });

function openingWithStartCard() {
  const three = card("3", "clubs") as Card;
  return offlineSave({
    seats: 2,
    names: ["Ana", "Besnik"],
    personalities: [undefined, "luan"],
    holding: [["3_clubs", "5_hearts", "K_spades"], ["J_hearts", "Q_diamonds"]],
    fresh: true,
    state: {
      openingCard: three,
      startReason: { type: "start_card", card: three, playerIdx: 0 },
    },
  });
}

/** The plate in design points, whatever the page's own scale: `stage` is the element the design is drawn in. */
function readPlate(page: Page, sel: { stage: string; plate: string; dim: string; tile: string }) {
  return page.evaluate((s) => {
    const q = (css: string) => {
      const el = document.querySelector(css);
      if (!el) throw new Error(`nothing matches ${css}`);
      return el as HTMLElement;
    };
    const stageEl = q(s.stage);
    const stage = stageEl.getBoundingClientRect();
    // Boxes come back transformed, computed lengths in the stage's own untransformed px.
    const k = stage.width / 874;
    const css = stageEl.offsetWidth / 874;
    const plate = q(s.plate);
    const r = plate.getBoundingClientRect();
    const cs = getComputedStyle(plate);
    const dim = q(s.dim);
    const dimCs = getComputedStyle(dim);
    const tileEl = q(s.tile);
    const tile = tileEl.getBoundingClientRect();
    const layers = (shadow: string) =>
      shadow.split(/,(?![^(]*\))/).map((layer) => {
        const colour = /rgba?\([^)]*\)/.exec(layer)?.[0] ?? "";
        const [, y, blur] = (layer.replace(colour, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
        return { colour, y: y / css, blur, inset: layer.includes("inset") };
      });
    const hairline = layers(cs.boxShadow).find((l) => l.inset);
    const lip = layers(getComputedStyle(tileEl).boxShadow).find((l) => !l.inset && l.blur === 0);
    return {
      plate: {
        x: (r.x - stage.x + r.width / 2) / k,
        y: (r.y - stage.y + r.height / 2) / k,
        w: r.width / k,
        h: r.height / k,
        pad: parseFloat(cs.paddingTop) / css,
        gap: parseFloat(cs.rowGap) / css,
        radius: parseFloat(cs.borderTopLeftRadius) / css,
        edge: cs.borderTopColor,
        dim: dimCs.opacity === "1" ? dimCs.backgroundColor : `${dimCs.backgroundColor}@${dimCs.opacity}`,
      } satisfies Plate,
      hairline: hairline && { colour: hairline.colour, y: hairline.y },
      tile: { w: tile.width / k, h: tile.height / k, lip: lip && { colour: lip.colour, y: lip.y } },
    };
  }, sel);
}

const alphaOf = (dim: string) => {
  const [colour, opacity = "1"] = dim.split("@");
  const m = /rgba?\(([^)]+)\)/.exec(colour);
  const parts = m ? m[1].split(",").map(Number) : [0, 0, 0, 1];
  return (parts[3] ?? 1) * Number(opacity);
};

test("panel: who starts is the G1 panel, at its size, place, plate and dim", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.setViewportSize({ width: DESIGN.width + 32, height: 900 });
  await page.goto(PANEL_FIXTURE);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const mockup = await readPlate(page, { stage: ".stage", plate: "#panel", dim: "#dim", tile: "#panel-card" });

  await page.setViewportSize(DESIGN);
  await resumeSaved(page, baseURL!, openingWithStartCard());
  const plate = page.getByTestId("notice-whoStarts");
  await expect(plate).toBeVisible({ timeout: 15_000 });
  const app = await readPlate(page, {
    stage: "body",
    plate: '[data-testid="notice-whoStarts"]',
    dim: '[data-testid="start-reason-gate"] > div',
    tile: '[data-testid="notice-tile"]',
  });

  for (const key of ["x", "y", "w", "pad", "gap", "radius"] as const) {
    expect(Math.abs(app.plate[key] - mockup.plate[key]), `the panel's ${key}: app ${app.plate[key]}, mockup ${mockup.plate[key]}`).toBeLessThanOrEqual(NEAREST);
  }
  expect(app.plate.edge).toBe(mockup.plate.edge);
  expect(alphaOf(app.plate.dim), `the dim: app ${app.plate.dim}, mockup ${mockup.plate.dim}`).toBeCloseTo(alphaOf(mockup.plate.dim), 2);
  expect(Math.abs(app.tile.w - mockup.tile.w)).toBeLessThanOrEqual(NEAREST);
  expect(Math.abs(app.tile.h - mockup.tile.h)).toBeLessThanOrEqual(NEAREST);
  for (const [name, a, m] of [
    ["the plate's top hairline", app.hairline, mockup.hairline],
    ["the tile's paper lip", app.tile.lip, mockup.tile.lip],
  ] as const) {
    expect(m, `the mockup has no ${name}`).toBeDefined();
    expect(a?.colour, name).toBe(m!.colour);
    expect(Math.abs(a!.y - m!.y), `${name}'s offset`).toBeLessThanOrEqual(NEAREST);
  }

  const scaled = await page.evaluate((factor) => {
    const plateEl = document.querySelector('[data-testid="notice-whoStarts"]') as HTMLElement;
    const before = plateEl.getBoundingClientRect();
    const texts = [...plateEl.querySelectorAll<HTMLElement>("*")].filter((el) =>
      [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
    );
    for (const el of texts) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * factor}px`;
    const after = plateEl.getBoundingClientRect();
    const clipped = texts
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > after.right + 0.5 || r.bottom > after.bottom + 0.5 || el.scrollWidth > el.clientWidth + 1;
      })
      .map((el) => el.textContent);
    const tile = plateEl.querySelector('[data-testid="notice-tile"]')!.getBoundingClientRect();
    const rank = texts.find((el) => el.closest('[data-testid="notice-tile"]'))!;
    const range = document.createRange();
    range.selectNodeContents(rank);
    const ink = range.getBoundingClientRect();
    const tileHolds = ink.left >= tile.left - 0.5 && ink.right <= tile.right + 0.5 && ink.top >= tile.top - 0.5 && ink.bottom <= tile.bottom + 0.5;
    return { widthBefore: before.width, widthAfter: after.width, grew: after.height > before.height, texts: texts.length, clipped, tileHolds };
  }, FONT_SCALE);
  expect(scaled.texts, "the panel has no words to scale").toBeGreaterThan(1);
  expect(scaled.widthAfter).toBeCloseTo(scaled.widthBefore, 1);
  expect(scaled.grew, "at 1.2x the panel did not grow with its words").toBe(true);
  expect(scaled.clipped, "at 1.2x these run past the panel").toEqual([]);
  expect(scaled.tileHolds, "at 1.2x the start card's rank runs past its tile").toBe(true);
});

const EXTRAS_FIXTURE = pathToFileURL(path.resolve(__dirname, "fixtures", "notice-extras", "index.html")).href;
const REJECT = '[data-testid="notice-rejectFloat"]';
const WAITING = '[data-testid="notice-waitingOthers"]';

/** A G2 notice and its neighbour in design points, `stage` being the element its table is drawn in. */
function readExtra(page: Page, sel: { stage: string; plate: string; beside: string }) {
  return page.evaluate((s) => {
    const q = (css: string) => {
      const el = document.querySelector(css);
      if (!el) throw new Error(`nothing matches ${css}`);
      return el as HTMLElement;
    };
    const stageEl = q(s.stage);
    const at = stageEl.getBoundingClientRect();
    const k = at.width / 874;
    const css = stageEl.offsetWidth / 874;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - at.left) / k, y: (r.top - at.top) / k, w: r.width / k, h: r.height / k };
    };
    const plate = q(s.plate);
    const cs = getComputedStyle(plate);
    const inside = [...plate.querySelectorAll("*")];
    const inked = [plate, ...inside].find(
      (n) => !/ionicons/i.test(getComputedStyle(n).fontFamily) && [...n.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent!.trim() !== ""),
    );
    const dot = inside.find((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 3 && r.width < 9 && Math.abs(r.width - r.height) < 0.5 && getComputedStyle(n).backgroundColor !== "rgba(0, 0, 0, 0)";
    });
    const box = rect(plate);
    return {
      box,
      fill: cs.backgroundColor,
      edge: cs.borderTopColor,
      ink: getComputedStyle(inked ?? plate).color,
      fontSize: parseFloat(getComputedStyle(inked ?? plate).fontSize) / css,
      radius: Math.min(parseFloat(cs.borderTopLeftRadius) / css, box.h / 2),
      dot: dot ? getComputedStyle(dot).backgroundColor : null,
      beside: rect(q(s.beside)),
    };
  }, sel);
}

type Extra = Awaited<ReturnType<typeof readExtra>>;

async function g2(page: Page, scene: string, plate: string, beside: string): Promise<Extra> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: DESIGN.width + 32, height: 900 });
  await page.goto(EXTRAS_FIXTURE);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return readExtra(page, { stage: `${scene} .stage`, plate, beside: `${scene} ${beside}` });
}

function samePaint(got: Extra, want: Extra) {
  expect.soft(got.fill, "the fill").toBe(want.fill);
  expect.soft(got.edge, "the edge").toBe(want.edge);
  expect.soft(got.ink, "the ink").toBe(want.ink);
  expect.soft(got.dot, "the dot").toBe(want.dot);
  expect.soft(got.fontSize, "the text").toBe(want.fontSize);
  expect.soft(Math.abs(got.radius - want.radius), `the corner, ${got.radius} against ${want.radius}`).toBeLessThanOrEqual(HALF_PT);
  expect.soft(Math.abs(got.box.h - want.box.h), `the height, ${got.box.h} against ${want.box.h}`).toBeLessThanOrEqual(HALF_PT);
  expect.soft(Math.abs(got.box.w - want.box.w), `the width, ${got.box.w} against ${want.box.w}`).toBeLessThanOrEqual(ONE_PT);
}

test("reject: a refused GIOCA floats G2's reason, its right edge on GIOCA's and 8 pt above it, and it goes", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const want = await g2(page, "#sc-reject", "#n-reject", ".gioca");

  const app = await appResumed(
    browser,
    baseURL!,
    offlineSave({
      seats: 4,
      holding: [["4_hearts", "5_hearts"], ["J_hearts"], ["7_clubs"], ["4_diamonds"]],
      pile: { cards: ["9_spades"], by: 1 },
    })
  );
  await tap(app.page, app.page.locator(HAND_CARD_BOXES).first());
  await expect(app.page.locator(HAND_SELECTED)).toHaveCount(1);
  await tap(app.page, app.page.getByTestId("btn-gioca"));
  await expect
    .poll(async () => (await app.plate(REJECT))?.opacity, { message: "the reason risen and faded in", intervals: [20], timeout: 30_000 })
    .toBe(1);
  await expect
    .poll(() => app.page.getByTestId("btn-gioca-box").evaluate((el) => getComputedStyle(el).transform), { message: "GIOCA's shake settled", intervals: [20] })
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  const got = await readExtra(app.page, { stage: "body", plate: REJECT, beside: '[data-testid="btn-gioca"]' });
  await expect.poll(async () => (await app.plate(REJECT))?.opacity ?? 0, { message: "the reason gone", timeout: 5_000 }).toBe(0);
  await app.close();

  samePaint(got, want);
  const right = (b: Rect) => b.x + b.w;
  const offRight = (e: Extra) => right(e.beside) - right(e.box);
  const above = (e: Extra) => e.beside.y - (e.box.y + e.box.h);
  expect.soft(Math.abs(offRight(got) - offRight(want)), `the right edge off GIOCA's, ${offRight(got)} against ${offRight(want)}`).toBeLessThanOrEqual(ONE_PT);
  expect.soft(Math.abs(above(got) - above(want)), `the gap over GIOCA, ${above(got)} against ${above(want)}`).toBeLessThanOrEqual(ONE_PT);
});

test("waiting: a seat gone out waits on G2's gold pill, centred on the hand row", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const want = await g2(page, "#sc-waiting", "#n-waiting", ".hand");

  const save = offlineSave({
    seats: 4,
    turn: 1,
    holding: [[], ["J_hearts", "Q_hearts"], ["7_clubs"], ["4_diamonds"]],
    state: { finishingOrder: ["player_0"] },
  });
  save.gameState.players[0].finishPosition = 1;
  const app = await appResumed(browser, baseURL!, save);
  await expect.poll(async () => (await app.plate(WAITING))?.opacity, { message: "the line shown", timeout: 30_000 }).toBe(1);
  const got = await readExtra(app.page, { stage: "body", plate: WAITING, beside: '[data-testid="hand-zone"]' });
  await app.close();

  samePaint(got, want);
  const centre = (b: Rect) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const row = got.beside.y + got.beside.h - handVisibleH(CARD_H(cardScale(DESIGN.height) * HAND_SCALE)) / 2;
  expect.soft(Math.abs(centre(got.box).x - centre(want.box).x), `the centre, ${centre(got.box).x} against ${centre(want.box).x}`).toBeLessThanOrEqual(ONE_PT);
  expect.soft(Math.abs(centre(got.box).y - row), `the middle, ${centre(got.box).y} against the hand row's ${row}`).toBeLessThanOrEqual(HALF_PT);
  // G2 says "the centre of the hand row", and an out seat's row is the off-turn one, about 8 pt under G2's y.
  expect.soft(Math.abs(centre(got.box).y - centre(want.box).y), `the middle against G2's, ${centre(got.box).y} against ${centre(want.box).y}`).toBeLessThanOrEqual(9);
});

const WAITING_SEATS = ["top-seat", "side-seat-left", "side-seat-right"];
/** Every part of a seat: the disc, its badge, the name over it and the first back of its fan. */
const SEAT_PARTS = ["seat-ring", "seat-card-count", "seat-name", "seat-back"];

test("seats are not dimmed: every seat waiting for its turn is at full strength, as the mockup's", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const mockup = await mockupAt(browser, "rest", 1000);
  const want = await Promise.all([".seat:not(.on) .disc", ".seat:not(.on) .badge", ".seat:not(.on) .nm", ".fan"].map(async (part) => (await mockup.plate(part))?.opacity));
  await mockup.close();
  expect(want, "the mockup's waiting seat: disc, badge, name, fan").toEqual([1, 1, 1, 1]);

  const app = await appAt(browser, baseURL!, captureStateById("lamp-bottom")!);
  const parts = WAITING_SEATS.flatMap((seat) => SEAT_PARTS.map((part) => `[data-testid="${seat}"] [data-testid="${part}"]`));
  await expect(app.page.locator(parts[0]), "the top seat").toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => Object.fromEntries(await Promise.all(parts.map(async (s) => [s, (await app.plate(s))?.opacity ?? null]))), {
      message: "each waiting seat's every part, with its ancestors' opacity",
      timeout: 10_000,
    })
    .toEqual(Object.fromEntries(parts.map((s) => [s, 1])));
  await app.close();
});

const LAST_BADGE = '[data-testid="top-seat"] [data-testid="seat-card-count"]';
const grownBy = (page: Page, selector: string) =>
  page.evaluate((s) => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(s)!).transform).a, selector);

test("last card: the seat down to one card wears the mockup's red .badge.last, its glow static", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const mockup = await mockupAt(browser, "mwin", 100);
  const want = await mockup.plate(".badge.last");
  expect(want, "Besnik holds one card in the mockup").not.toBeNull();
  const grown = await grownBy(mockup.page, ".badge.last");
  await mockup.close();

  const app = await appAt(browser, baseURL!, captureStateById("counts-2-1-2")!);
  await expect(app.page.locator(LAST_BADGE), "the top seat's badge").toHaveText("1", { timeout: 30_000 });
  const got = (await app.plate(LAST_BADGE))!;
  const glows = await glowsOver(app, LAST_BADGE, [130, 240, 280]);
  await app.close();

  const wantBlur = want!.glow!.blur * grown;
  expect.soft(got.fill, "the fill").toBe(want!.fill);
  expect.soft(got.edge, "the edge").toBe(want!.edge);
  expect.soft(got.ink, "the digit's ink").toBe(want!.ink);
  expect.soft(got.glow?.color, "the glow's colour").toBe(want!.glow?.color);
  expect.soft(Math.abs((got.glow?.blur ?? 0) - wantBlur), `the glow's blur, ${got.glow?.blur} against the mockup's ${wantBlur}`).toBeLessThanOrEqual(HALF_PT);
  expect.soft(Math.abs(got.box.h - want!.box.h), `the badge, ${got.box.h} tall against the mockup's ${want!.box.h}`).toBeLessThanOrEqual(HALF_PT);
  expect(glows, "the glow at 0, 130, 370 and 650 ms").toEqual(glows.map(() => got.glow));
});

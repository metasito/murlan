// tests/e2e/mockupPolish.spec.ts — #1259 plan 5: each notice held to the mockup it was approved in.
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appAt, mockupAt, type PlatePaint, type Rect, type Stage } from "./helpers/mockupStage";
import { resumeSaved } from "./helpers/offlineSeed";
import { setDeviceOffline } from "./helpers/deviceNetwork";
import { captureStateById, type CaptureState } from "../../lib/captureStates";
import { cardScale } from "../../components/cardFaceModel";
import { RANK_SLOTS } from "../../lib/game/gameEngine";

const HALF_PT = 0.5;
const ONE_PT = 1;
const TURN = '[data-testid="notice-turn"]';
const COUNT = '[data-testid="turn-chip-count"]';
const STAGES = [
  { name: "iPhone 16 Pro", width: 874, height: 402 },
  { name: "iPhone SE", width: 568, height: 320 },
];

/** Your turn over a pile, so the clock runs and the pill carries its count as `#turn.lit` does. */
const LIT_WITH_COUNT: CaptureState = { ...captureStateById("lamp-bottom")!, id: "lamp-bottom-pile", pile: true };

const shown = async (stage: Stage, selector: string, run?: string): Promise<PlatePaint> => {
  await expect.poll(async () => (await stage.plate(selector))?.opacity, { message: `${selector} fully shown`, timeout: 30_000 }).toBe(1);
  return (await stage.plate(selector, run))!;
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
  const glows = [first.glow];
  for (const wait of [130, 240, 240, 280]) {
    // fixed wait on purpose: the glow sampled at uneven instants, so no loop's period divides them all
    await app.page.waitForTimeout(wait);
    glows.push((await app.plate(TURN))!.glow);
  }
  await app.close();
  expect(first.glow, "a lit pill glows").not.toBeNull();
  expect(glows, "the glow at 0, 130, 370, 610 and 890 ms").toEqual(glows.map(() => first.glow));
});

test("offline: on the table the turn pill is #turn.bad, and the pill off the table yields to it", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const mockup = await mockupAt(browser, "reconnect", 8000);
  const app = await appAt(browser, baseURL!, LIT_WITH_COUNT);
  await expect(app.page.locator(COUNT), "the lit pill's count").toBeVisible({ timeout: 30_000 });
  await setDeviceOffline(app.page.context(), app.page, true);
  await expect(app.page.locator(COUNT), "the count gives way to the connection").toHaveCount(0, { timeout: 15_000 });
  const want = await shown(mockup, "#turn.bad");
  const got = await shown(app, TURN);
  const dotOf = (stage: Stage, sel: string) => stage.page.evaluate((s) => getComputedStyle(document.querySelector(s)!).backgroundColor, sel);
  const wantDot = await dotOf(mockup, "#turn.bad .dot");
  const gotDot = await dotOf(app, '[data-testid="turn-chip-dot"]');
  const offTable = await app.plate('[data-testid="notice-offline"]');
  await setDeviceOffline(app.page.context(), app.page, false);
  await Promise.all([mockup.close(), app.close()]);

  expect.soft(got.edge, "the edge").toBe(want.edge);
  expect.soft(got.ink, "the label's ink").toBe(want.ink);
  expect.soft(gotDot, "the dot").toBe(wantDot);
  expect.soft(got.glow, "#turn.bad casts no glow").toEqual(want.glow);
  expect.soft(Math.abs(got.box.h - want.box.h), "the height, off the mockup's").toBeLessThanOrEqual(HALF_PT);
  expect(offTable?.opacity, "the pill off the table shows over the table").toBe(0);
});

for (const phone of STAGES) {
  test(`turn fits its band: Besnik on move, in it-IT, clear of every neighbour by the mockup's gap — ${phone.name}`, async ({
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

    const app = await appAt(browser, baseURL!, captureStateById("lamp-left")!, phone);
    await expect(app.page.getByTestId("game-hud-stack")).toContainText("Turno di Besnik");
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

const PANEL_FIXTURE = pathToFileURL(path.resolve(__dirname, "fixtures", "notice-panel", "index.html")).href;
const DESIGN = { width: 874, height: 402 };
const NEAREST = 0.5;
const FONT_SCALE = 1.2;

type Plate = { x: number; y: number; w: number; h: number; pad: number; gap: number; radius: number; edge: string; dim: string };

const card = (rank: string, suit: string) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });

function openingWithStartCard() {
  const hand = [card("5", "hearts"), card("K", "spades")];
  return {
    version: 2,
    gameState: {
      players: [
        { id: "player_0", name: "Ana", hand: [card("3", "clubs"), ...hand], type: "human" },
        { id: "player_1", name: "Besnik", hand: [card("J", "hearts"), card("Q", "diamonds")], type: "ai" },
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: false,
      startCard: card("3", "clubs"),
      startReason: { type: "start_card", card: card("3", "clubs"), playerIdx: 0 },
      playedRanks: Array.from({ length: RANK_SLOTS }, () => 0),
    },
    match: { length: "match", target: 21, scores: {}, hands: [], over: false, winners: [], isDraw: false },
    rematchAnswers: {},
    players: [
      { name: "Ana", type: "human" },
      { name: "Besnik", type: "ai", personality: "luan" },
    ],
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
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

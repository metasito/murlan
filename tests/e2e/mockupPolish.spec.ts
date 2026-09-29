// tests/e2e/mockupPolish.spec.ts — #1259 plan 5: each notice held to the mockup it was approved in.
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resumeSaved } from "./helpers/offlineSeed";
import { RANK_SLOTS } from "../../lib/game/gameEngine";

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
    const stage = q(s.stage).getBoundingClientRect();
    const k = stage.width / 874;
    const plate = q(s.plate);
    const r = plate.getBoundingClientRect();
    const cs = getComputedStyle(plate);
    const dim = q(s.dim);
    const dimCs = getComputedStyle(dim);
    const tile = q(s.tile).getBoundingClientRect();
    return {
      plate: {
        x: (r.x - stage.x + r.width / 2) / k,
        y: (r.y - stage.y + r.height / 2) / k,
        w: r.width / k,
        h: r.height / k,
        pad: parseFloat(cs.paddingTop) / k,
        gap: parseFloat(cs.rowGap) / k,
        radius: parseFloat(cs.borderTopLeftRadius) / k,
        edge: cs.borderTopColor,
        dim: dimCs.opacity === "1" ? dimCs.backgroundColor : `${dimCs.backgroundColor}@${dimCs.opacity}`,
      } satisfies Plate,
      tile: { w: tile.width / k, h: tile.height / k },
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
    return { widthBefore: before.width, widthAfter: after.width, grew: after.height > before.height, texts: texts.length, clipped };
  }, FONT_SCALE);
  expect(scaled.texts, "the panel has no words to scale").toBeGreaterThan(1);
  expect(scaled.widthAfter).toBeCloseTo(scaled.widthBefore, 1);
  expect(scaled.grew, "at 1.2x the panel did not grow with its words").toBe(true);
  expect(scaled.clipped, "at 1.2x these run past the panel").toEqual([]);
});

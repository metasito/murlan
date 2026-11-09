// tests/e2e/tableRects.spec.ts — the table is drawn where `tableRects` says, on the viewports, safe
// areas and languages the pure property test walks. The pure test cannot see flexbox; this is what
// ties the solver to it.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { DEAL_SIZE, exchangeSave, offlineSave, seedSave } from "./helpers/offlineSeed";
import { openApp } from "./helpers/navigation";
import { openOnlineTable } from "./helpers/onlineTable";
import { PHONES } from "./helpers/phones";
import { setSafeArea } from "./helpers/safeArea";
import { INSETS } from "../helpers/phoneTable";
import { fits, type Box, type Fit } from "../helpers/drawnFit";
import { captureGameState, captureStateById, type CaptureState } from "../../lib/captureStates";
import { createDeck } from "../../lib/game/gameEngine";
import type { OfflineSave } from "../../lib/offlineSave";
import { LOCALE_KEY } from "../../lib/storageKeys";
import { catalogs, type Locale } from "../../shared/i18n";
import type { EdgeInsets } from "../../components/tableFrame";
import { brokenRules, tableRects, type Rect, type RectName, type TableRects } from "../../components/tableRects";
import { drawnChips, gameTable, TABLETS, type DrawnTable } from "../helpers/tableScenes";

const VIEWPORTS = [...PHONES, ...TABLETS];
const PHONE_INSETS = Object.entries(INSETS);
const LOCALES: readonly Locale[] = ["it", "en", "sq"];
const STATES: readonly CaptureState[] = ["held", "pile-right", "bomb-landed"].map((id) => captureStateById(id)!);

const DRAWN: Partial<Record<RectName, { sel: string; fit: Fit }>> = {
  rail: { sel: '[data-testid="control-rail"]', fit: "same" },
  railMenu: { sel: '[data-testid="control-rail"] > div:first-child [role="button"]', fit: "same" },
  hudCombo: { sel: '[data-testid="notice-hudCombo"]', fit: "words" },
  hudTurn: { sel: '[data-testid="notice-turn"]', fit: "words" },
  scorePill: { sel: '[data-testid="score-pill-plate"]', fit: "same" },
  seatTop: { sel: '[data-testid="top-seat"] [data-testid="seat-ring"]', fit: "same" },
  seatLeft: { sel: '[data-testid="side-seat-left"] [data-testid="seat-ring"]', fit: "same" },
  seatRight: { sel: '[data-testid="side-seat-right"] [data-testid="seat-ring"]', fit: "same" },
  nameTop: { sel: '[data-testid="top-seat"] [data-testid="seat-name"]', fit: "line" },
  nameLeft: { sel: '[data-testid="side-seat-left"] [data-testid="seat-name"]', fit: "line" },
  nameRight: { sel: '[data-testid="side-seat-right"] [data-testid="seat-name"]', fit: "line" },
  fanTop: { sel: '[data-testid="top-seat"] [data-testid="seat-back"]', fit: "same" },
  fanLeft: { sel: '[data-testid="side-seat-left"] [data-testid="seat-back"]', fit: "same" },
  fanRight: { sel: '[data-testid="side-seat-right"] [data-testid="seat-back"]', fit: "same" },
  pile: { sel: '[data-testid="pile-card"]', fit: "same" },
  handZone: { sel: '[data-testid="hand-zone"]', fit: "same" },
  passa: { sel: '[data-testid="btn-passa-box"]', fit: "same" },
  gioca: { sel: '[data-testid="btn-gioca-box"]', fit: "same" },
  hand: { sel: '[data-testid="hand-row"] [data-testid="card-box"]', fit: "same" },
};
/** The rail's foot holds a knob only on the online table, where the reactions trigger takes it. */
const RAIL: Partial<Record<RectName, { sel: string; fit: Fit }>> = {
  rail: DRAWN.rail,
  railMenu: DRAWN.railMenu,
  railFoot: { sel: '[data-testid="control-rail"] > div:last-child [role="button"]', fit: "same" },
};
interface Drawn { boxes: Partial<Record<RectName, Box>>; clip: Rect | null; texts: { combo: string; turn: string } }

/** Each rect as the union of what its selector matched; a scrolled hand as the part its window shows. */
async function drawn(page: Page, rects: Partial<Record<RectName, { sel: string; fit: Fit }>>): Promise<Drawn> {
  return page.evaluate((specs: Record<string, { sel: string; fit: Fit }>) => {
    /** Words at linear advances: set LARGE times over in the same face, case, tracking and features, a hinted advance is off by a LARGEth of a pixel. */
    const LARGE = 64;
    const linear = (el: Element, words: string) => {
      const cs = getComputedStyle(el);
      const probe = document.createElement("span");
      Object.assign(probe.style, {
        position: "absolute",
        visibility: "hidden",
        whiteSpace: "pre",
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        fontVariantNumeric: cs.fontVariantNumeric,
        fontFeatureSettings: cs.fontFeatureSettings,
        fontKerning: cs.fontKerning,
        textTransform: cs.textTransform,
        fontSize: `${parseFloat(cs.fontSize) * LARGE}px`,
        letterSpacing: `${(parseFloat(cs.letterSpacing) || 0) * LARGE}px`,
      });
      probe.lang = el.closest("[lang]")?.getAttribute("lang") ?? "";
      probe.textContent = words;
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width / LARGE;
      probe.remove();
      return w;
    };
    const union = (rs: DOMRect[]) => {
      const live = rs.filter((r) => r.width > 0 && r.height > 0);
      if (live.length === 0) return null;
      const x = Math.min(...live.map((r) => r.left));
      const y = Math.min(...live.map((r) => r.top));
      return { x, y, w: Math.max(...live.map((r) => r.right)) - x, h: Math.max(...live.map((r) => r.bottom)) - y };
    };
    const boxes: Record<string, Box> = {};
    for (const [name, { sel, fit }] of Object.entries(specs)) {
      const els = [...document.querySelectorAll(sel)];
      const r = union(els.map((e) => e.getBoundingClientRect()));
      if (!r) continue;
      boxes[name] = r;
      if (fit === "same") continue;
      const sizes = els.flatMap((e) => [e, ...e.querySelectorAll("*")]).map((e) => parseFloat(getComputedStyle(e).fontSize));
      let [drawnW, linearW] = [0, 0];
      for (const e of els)
        for (let walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), node = walk.nextNode(); node; node = walk.nextNode()) {
          if (!node.textContent) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          drawnW += range.getBoundingClientRect().width;
          linearW += linear(node.parentElement!, node.textContent);
        }
      boxes[name].text = { words: els.map((e) => e.textContent ?? "").join(""), em: Math.max(...sizes), drawn: drawnW, linear: linearW };
    }
    const window = document.querySelector('[data-testid="hand-pan"]')?.parentElement;
    const c = window && getComputedStyle(window).overflowX !== "visible" ? window.getBoundingClientRect() : null;
    return {
      boxes,
      clip: c && { x: c.left, y: c.top, w: c.width, h: c.height },
      texts: {
        combo: document.querySelector('[data-testid="notice-hudCombo"]')?.textContent ?? "",
        turn: document.querySelector('[data-testid="notice-turn"]')?.textContent ?? "",
      },
    };
  }, rects as Record<string, { sel: string; fit: Fit }>) as Promise<Drawn>;
}

async function settled(page: Page, rects = DRAWN): Promise<Drawn> {
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await drawn(page, rects));
        const still = now === previous;
        previous = now;
        return still;
      },
      { message: "the table never came to rest", timeout: 15_000, intervals: [250] }
    )
    .toBe(true);
  return drawn(page, rects);
}

async function open(page: Page, baseURL: string, save: OfflineSave, locale: Locale, insets: EdgeInsets) {
  await seedSave(page, save, { holdTurn: true });
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LOCALE_KEY, locale]);
  await openApp(page, baseURL);
  await page.getByRole("button", { name: catalogs[locale]["home.resumeGame"] }).click({ timeout: 60_000 });
  await expect(page.getByTestId("hand-zone")).toBeVisible({ timeout: 30_000 });
  await setSafeArea(page, insets.left, insets.bottom, insets.right);
}

const clipTo = (r: Rect, c: Rect | null): Rect => {
  if (!c) return r;
  const x = Math.max(r.x, c.x);
  const y = Math.max(r.y, c.y);
  return { x, y, w: Math.min(r.x + r.w, c.x + c.w) - x, h: Math.min(r.y + r.h, c.y + c.h) - y };
};
const at = (r: Rect) => `${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.w.toFixed(1)}x${r.h.toFixed(1)}`;

function misfits(got: Drawn, want: TableRects, rects = DRAWN): string[] {
  const bad: string[] = [];
  for (const [name, spec] of Object.entries(rects) as [RectName, { fit: Fit }][]) {
    const solved = want.rects[name];
    const raw = got.boxes[name];
    const box = raw && name === "hand" ? { ...raw, ...clipTo(raw, got.clip) } : raw;
    if (!solved !== !box) bad.push(`${name}: drawn ${box ? at(box) : "nothing"}, solver ${solved ? at(solved) : "nothing"}`);
    else if (solved && box && !fits[spec.fit](box, solved, { align: want.aligns[name], overcount: want.overcount[name] })) {
      const words = box.text && ` (words ${box.text.drawn.toFixed(1)} drawn, ${box.text.linear.toFixed(1)} linear; overcount ${want.overcount[name]?.toFixed(1)})`;
      bad.push(`${name}: drawn ${at(box)}, solver ${at(solved)}${words ?? ""}`);
    }
  }
  return bad;
}

async function check(page: Page, where: string, vp: { width: number; height: number }, insets: EdgeInsets, locale: Locale, table: DrawnTable, exchangeName?: string, keepsRules = false) {
  const got = await settled(page);
  const chips = drawnChips(table, locale, got.texts, exchangeName);
  expect(chips, `${where}: the pills read words a scene says (${got.texts.combo} | ${got.texts.turn})`).toEqual({ combo: expect.anything(), turn: expect.anything() });
  const solved = tableRects({ width: vp.width, height: vp.height, insets, locale, state: { ...table.base, chips: { combo: chips.combo!, turn: chips.turn! } } });
  expect(misfits(got, solved), where).toEqual([]);
  if (keepsRules) expect(brokenRules(solved), `${where}: the solved table breaks its rules`).toEqual([]);
}

for (const [v, vp] of VIEWPORTS.entries())
  test(`the table is drawn in the solver's rects: ${vp.name}`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const [i, locale] of LOCALES.entries()) {
      const capture = STATES[(i + v) % STATES.length];
      const [inset, insets] = PHONES.some((p) => p.name === vp.name) ? PHONE_INSETS[(i + v) % PHONE_INSETS.length] : PHONE_INSETS[0];
      const save = offlineSave({ seats: capture.playerCount, hand: DEAL_SIZE[capture.playerCount], turn: capture.turn });
      await open(page, baseURL!, { ...save, gameState: captureGameState(capture) }, locale, insets);
      await check(page, `${vp.name}, ${inset}, ${locale}, ${capture.id}`, vp, insets, locale, gameTable(captureGameState(capture)));
    }
  });

const SIXTEEN = PHONES.find((p) => p.name === "iPhone 16 Pro")!;
const ISLAND = INSETS["62/21/62"];
/** Every seat one name, so the exchange's pills read words `exchangeScenes` says. */
const EXCHANGE_NAME = "Besnik";
/** A straight of every face on the felt, and the biggest hand a deal gives, beside it. */
const STRAIGHT_13 = ["A_hearts", "2_spades", "3_hearts", "4_spades", "5_hearts", "6_spades", "7_hearts", "8_spades", "9_hearts", "10_spades", "J_hearts", "Q_spades", "K_hearts"];

test.describe("the table at its limits is drawn in the solver's rects", () => {
  for (const vp of [SIXTEEN, TABLETS[1]]) {
    const insets = vp === SIXTEEN ? ISLAND : INSETS["0/0"];
    test(`an exchange: ${vp.name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const save = exchangeSave({ seats: 3, hand: DEAL_SIZE[3], winner: 0, loser: 1, names: [EXCHANGE_NAME, EXCHANGE_NAME, EXCHANGE_NAME] });
      await open(page, baseURL!, save, "it", insets);
      await expect(page.getByTestId("exchange-prompt"), "the winner's hand lifts once the exchange asks").toBeVisible({ timeout: 15_000 });
      await check(page, `${vp.name}, exchange`, vp, insets, "it", gameTable(save.gameState), EXCHANGE_NAME);
    });

    test(`a thirteen-card straight over an eighteen-card hand: ${vp.name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const free = createDeck().map((c) => c.id).filter((id) => !STRAIGHT_13.includes(id));
      const save = offlineSave({ seats: 3, holding: [free.slice(0, 18), free.slice(18, 29), free.slice(29, 40)], pile: { cards: STRAIGHT_13, by: 2 } });
      await open(page, baseURL!, save, "sq", insets);
      await check(page, `${vp.name}, pile 13, hand 18`, vp, insets, "sq", gameTable(save.gameState));
    });
  }
});

const ANA_AND_BESNIKS = ["Ana", "Besnik", "Besnik", "Besnik"];
const STRAIGHT_12 = STRAIGHT_13.slice(0, 12);

test.describe("the side seats and the hand are drawn in the solver's rects, and keep its rules", () => {
  for (const vp of [PHONES[0], PHONES[1], PHONES[3], TABLETS[0]]) {
    for (const [turn, hand] of [[1, "off its turn"], [0, "on its turn"]] as const)
      test(`full seats, hand ${hand}: ${vp.name}`, async ({ page, baseURL }) => {
        test.setTimeout(120_000);
        const insets = INSETS["0/0"];
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const save = offlineSave({ seats: 4, hand: 13, turn, names: ANA_AND_BESNIKS });
        await open(page, baseURL!, save, "en", insets);
        await check(page, `${vp.name}, hand ${hand}`, vp, insets, "en", gameTable(save.gameState), undefined, true);
      });
  }

  for (const vp of TABLETS)
    test(`a twelve-card straight between the side fans: ${vp.name}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      const insets = INSETS["0/0"];
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const free = createDeck().map((c) => c.id).filter((id) => !STRAIGHT_12.includes(id));
      const save = offlineSave({ seats: 4, holding: [0, 10, 20, 30].map((from) => free.slice(from, from + 10)), pile: { cards: STRAIGHT_12, by: 2 }, names: ANA_AND_BESNIKS });
      await open(page, baseURL!, save, "en", insets);
      await check(page, `${vp.name}, pile 12`, vp, insets, "en", gameTable(save.gameState), undefined, true);
    });
});

test("the rail's knobs are drawn in the solver's rects: online", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const table = await openOnlineTable(browser, baseURL!, { playerCount: 2, gameMode: "free_for_all", viewport: { width: SIXTEEN.width, height: SIXTEEN.height } });
  try {
    const got = await settled(table.page, RAIL);
    const solved = tableRects({ width: SIXTEEN.width, height: SIXTEEN.height, insets: INSETS["0/0"], locale: "it", state: { seats: { top: null, left: null, right: null }, hand: { cards: 0, onTurn: false, faceDown: false }, pile: 0, chips: { combo: [], turn: [] } } });
    expect(misfits(got, solved, RAIL), "iPhone 16 Pro, online").toEqual([]);
  } finally {
    await table.close();
  }
});

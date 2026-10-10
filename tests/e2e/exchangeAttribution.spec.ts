// tests/e2e/exchangeAttribution.spec.ts — who gave what to whom is read off the pile and the seats
// (tests/e2e/fixtures/exchange-legs, "Through the pile"), frame by frame on the virtual clock.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { installVirtualClock, step, stepUntil, takeOver } from "./helpers/virtualClock";
import { HAND_CARDS } from "./helpers/selectors";
import { E2E_SUSPEND_AI_KEY, OFFLINE_SAVE_KEY, TUTORIAL_SEEN_KEY } from "../../lib/storageKeys";
import { LEG } from "../../lib/game/exchangeTimeline";
import { Hold, MancheEnding, Motion } from "../../lib/tokens";

const X = Motion.exchange;
const FRAME = 16;
const NAMES = ["Ana", "Luan", "Gent"];
const TO_WINNER = "exchange-flier-to-winner";
const TO_LOSER = "exchange-flier-to-loser";
const FLIERS = [TO_WINNER, TO_LOSER, "exchange-joker-0", "exchange-joker-1"];

interface Pt { x: number; y: number }
interface Frame {
  t: number;
  fliers: Record<string, Pt & { face: boolean }>;
  pile: Pt | null;
  label: (Pt & { text: string }) | null;
  lit: string[];
  ping: string[];
  glow: boolean;
  hand: string[];
  dealt: number;
}

const card = (id: string) => {
  const [rank, suit] = id.split("_");
  return { id, rank, suit, isJoker: false };
};

function save(winnerIdx: number, loserIdx: number, hands: string[][], over: object = {}) {
  return {
    version: 2,
    gameState: {
      players: NAMES.map((name, i) => ({ id: `player_${i}`, name, hand: hands[i].map(card), type: i === 0 ? "human" : "ai" })),
      currentTurnIndex: winnerIdx,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
      exchangePhase: { active: true, winnerIdx, loserIdx, cardFromLoser: card("2_spades"), bothJokersException: false },
      ...over,
    },
    match: { length: "match", target: 21, scores: {}, hands: [], over: false, winners: [], isDraw: false },
    players: NAMES.map((name, i) => ({ name, type: i === 0 ? "human" : "ai" })),
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
}

async function open(page: Page, baseURL: string, seed: object) {
  await installVirtualClock(page, 1259);
  await page.addInitScript(
    (entries) => {
      for (const [k, v] of entries) window.localStorage.setItem(k, v);
    },
    [
      [TUTORIAL_SEEN_KEY, "1"],
      [E2E_SUSPEND_AI_KEY, "1"],
      [OFFLINE_SAVE_KEY, JSON.stringify(seed)],
    ]
  );
  await page.goto(baseURL);
  await takeOver(page);
  const resume = page.getByRole("button", { name: "Riprendi partita" });
  await stepUntil(page, () => resume.isVisible(), "the home screen");
  await resume.click({ force: true });
}

const table = (page: Page) =>
  stepUntil(page, () => page.locator('[data-testid="game-table"]').isVisible(), "the table");

/** Room for a deal the table may run before the trade goes. */
const SLACK = 3000;

/** React commits on a MessageChannel task after the frame, so the DOM is read after one. */
async function frame(page: Page): Promise<Frame> {
  await page.evaluate(() => new Promise<void>((r) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => r();
    c.port2.postMessage(0);
  }));
  return page.evaluate(({ fliers, hand }) => {
    const seen = (el: Element | null) => {
      let k = el ? 1 : 0;
      for (let n = el; n; n = n.parentElement) k *= Number(getComputedStyle(n).opacity);
      return k;
    };
    const centre = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const out: Record<string, { x: number; y: number; face: boolean }> = {};
    for (const id of fliers) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (el && seen(el) > 0) out[id] = { ...centre(el), face: seen(el.firstElementChild) > 0.5 };
    }
    const pile = document.querySelector('[data-testid="pile-area"]');
    const label = document.querySelector('[data-testid="exchange-pile-label"], [data-testid="exchange-no-swap"]');
    const seats = [...document.querySelectorAll('[data-testid="top-seat"], [data-testid^="side-seat-"]')].map((s) => ({
      name: s.querySelector('[data-testid="seat-name"]')?.textContent ?? "",
      lit: s.querySelector('[data-testid="seat-ring"]')?.getAttribute("data-seat-lit") === "true",
      ping: seen(s.querySelector('[data-testid="seat-ring-ping"]')) > 0.05,
    }));
    return {
      t: performance.now(),
      fliers: out,
      pile: pile ? centre(pile) : null,
      label: label && seen(label) > 0 ? { ...centre(label), text: label.textContent ?? "" } : null,
      lit: seats.filter((s) => s.lit).map((s) => s.name),
      ping: seats.filter((s) => s.ping).map((s) => s.name),
      glow: [...document.querySelectorAll('[data-testid="hand-received-highlight"]')].some((el) => seen(el) > 0),
      hand: [...document.querySelectorAll(hand)].map((el) => el.getAttribute("aria-label") ?? ""),
      dealt: document.querySelectorAll('[data-testid="dealt-back"]').length,
    };
  }, { fliers: FLIERS, hand: HAND_CARDS });
}

async function run(page: Page, ms: number, frames: Frame[]) {
  for (let t = 0; t < ms; t += FRAME) {
    await step(page);
    frames.push(await frame(page));
  }
}

/** A press the hand reads as a tap: it measures the press on the clock this spec holds. */
async function press(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = (await locator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await step(page, 8 * FRAME);
  await page.mouse.up();
  await step(page);
}

const near = (a: Pt, b: Pt, pt: number) => Math.hypot(a.x - b.x, a.y - b.y) <= pt;

/** One leg, giver to pile to receiver, checked against the fixture's hooks. */
function checkLeg(frames: Frame[], leg: { id: string; giver: string; receiver: string; label: string; viewer: string }) {
  const i0 = frames.findIndex((f) => f.fliers[leg.id]);
  expect(i0, `${leg.id} was never drawn`).toBeGreaterThan(0);
  const f0 = frames[i0].t;
  const rest = frames.findIndex((f, i) => i > i0 && f.label?.text === leg.label);
  expect(rest, `the pile never read "${leg.label}"`).toBeGreaterThan(i0);
  const landed = frames.findIndex((f, i) => i > rest && !f.fliers[leg.id]);
  expect(landed, `${leg.id} never landed`).toBeGreaterThan(rest);
  expect(Math.abs(frames[rest].t - f0 - LEG.rest), "the rest starts one lift and flight after the first frame").toBeLessThanOrEqual(FRAME);
  expect(Math.abs(frames[landed].t - f0 - LEG.end), "it lands one tuck after the rest").toBeLessThanOrEqual(FRAME);

  for (const f of frames.slice(i0, landed)) {
    const at = f.t - f0;
    const resting = at >= LEG.rest + FRAME && at < LEG.tuck - FRAME;
    const flying = at < LEG.rest - FRAME || at >= LEG.tuck + FRAME;
    if (resting) {
      expect(near(f.fliers[leg.id], f.pile!, 4), `${leg.id} at ${at} ms is off the pile centre`).toBe(true);
      expect(f.fliers[leg.id].face, `${leg.id} at ${at} ms rests face down`).toBe(true);
      expect(f.label?.text, `the pile at ${at} ms`).toBe(leg.label);
    }
    if (flying) expect(f.label, `the pile label at ${at} ms, outside the rest`).toBeNull();
  }
  const seat = (name: string, f: Frame) => name !== leg.viewer && f.lit.includes(name);
  if (leg.giver !== leg.viewer) {
    expect(seat(leg.giver, frames[i0 - 1]), "the giver lit before its card showed").toBe(false);
    expect(seat(leg.giver, frames[i0]), "the giver is lit from the card's first frame").toBe(true);
    expect(frames.slice(i0, i0 + 3).some((f) => f.ping.includes(leg.giver)), "the giver's ring pings as the card leaves").toBe(true);
  }
  if (leg.receiver !== leg.viewer) {
    expect(seat(leg.receiver, frames[rest - 1]), "the receiver lit before the rest").toBe(false);
    expect(seat(leg.receiver, frames[rest]), "the receiver is lit from the rest frame").toBe(true);
    expect(frames.slice(rest, rest + 3).some((f) => f.ping.includes(leg.receiver)), "the receiver's ring pings at the rest").toBe(true);
  }
  expect(frames[landed].lit.filter((n) => n === leg.giver || n === leg.receiver), "both seats back to normal at the landing").toEqual([]);
  expect(frames.some((f) => f.lit.includes(leg.viewer)), "the viewer has no ring to light").toBe(false);
  return { i0, rest, landed };
}

function checkGlow(frames: Frame[], landed: number) {
  const on = frames.map((f, i) => (f.glow ? i : -1)).filter((i) => i >= 0);
  expect(on.length, "the received card never glowed").toBeGreaterThan(0);
  expect(Math.abs(frames[on[0]].t - frames[landed].t), "the glow starts at the landing").toBeLessThanOrEqual(2 * FRAME);
  const lasted = frames[on.at(-1)!].t - frames[on[0]].t + FRAME;
  expect(Math.abs(lasted - X.highlight), `the glow lasted ${lasted} ms`).toBeLessThanOrEqual(2 * FRAME);
}

test.describe.configure({ timeout: 240_000 });

test("the winner watches the loser's card rest on the pile, then gives its own", async ({ page, baseURL }) => {
  await open(page, baseURL!, save(0, 1, [["2_spades", "5_hearts", "K_spades"], ["J_hearts", "Q_diamonds"], ["7_clubs", "8_clubs"]]));
  await table(page);
  const frames: Frame[] = [];
  await run(page, X.beat + LEG.end + X.highlight + SLACK, frames);
  const receive = checkLeg(frames, { id: TO_WINNER, giver: "Luan", receiver: "Ana", label: "Luan ti dà 2♠", viewer: "Ana" });

  await press(page, page.locator(HAND_CARDS).and(page.getByRole("button", { name: "5 di Cuori", exact: true })));
  await press(page, page.getByTestId("btn-gioca"));
  const at = frames.length;
  await run(page, X.giveWait + LEG.end + 20 * FRAME, frames);
  const give = checkLeg(frames.slice(at - 1), { id: TO_LOSER, giver: "Ana", receiver: "Luan", label: "Dai 5♥ a Luan", viewer: "Ana" });
  const from = frames.slice(at - 1);
  expect(from[give.i0 - 1].hand, "the given card stays in the hand until its leg lifts it").toContain("5 di Cuori");
  expect(from[give.i0].hand, "and leaves it on that leg's first frame").not.toContain("5 di Cuori");
  checkGlow(frames, receive.landed);
});

test("the loser's card lifts out of its hand, and the winner's comes back to it", async ({ page, baseURL }) => {
  await open(page, baseURL!, save(1, 0, [["5_hearts", "K_spades"], ["2_spades", "6_diamonds", "K_diamonds"], ["7_clubs", "8_clubs"]]));
  await table(page);
  const frames: Frame[] = [];
  await run(page, X.beat + 2 * (LEG.end + X.read) + X.giveWait + SLACK, frames);
  const receive = checkLeg(frames, { id: TO_WINNER, giver: "Ana", receiver: "Luan", label: "Dai 2♠ a Luan", viewer: "Ana" });
  expect(frames[receive.i0 - 1].hand, "the taken card is still drawn in the loser's hand").toContain("2 di Picche");
  expect(frames[receive.i0].hand, "until its leg's first frame").not.toContain("2 di Picche");
  const give = checkLeg(frames, { id: TO_LOSER, giver: "Luan", receiver: "Ana", label: "Luan ti dà 6♦", viewer: "Ana" });
  expect(frames[give.i0].t - frames[receive.landed].t, "the give waits for the receive's read").toBeGreaterThanOrEqual(X.read);
  checkGlow(frames, give.landed);
});

test("a seat outside the trade reads both legs off the pile and the lit seats", async ({ page, baseURL }) => {
  await open(page, baseURL!, save(1, 2, [["5_hearts", "K_spades"], ["2_spades", "6_diamonds", "K_diamonds"], ["7_clubs", "8_clubs"]]));
  await table(page);
  const frames: Frame[] = [];
  await run(page, X.beat + 2 * (LEG.end + X.read) + X.giveWait + SLACK, frames);
  checkLeg(frames, { id: TO_WINNER, giver: "Gent", receiver: "Luan", label: "Gent dà 2♠ a Luan", viewer: "Ana" });
  checkLeg(frames, { id: TO_LOSER, giver: "Luan", receiver: "Gent", label: "Luan dà 6♦ a Gent", viewer: "Ana" });
  expect(frames.some((f) => f.glow), "nothing arrives in a bystander's hand").toBe(false);
});

// A deal the loser holds both Jokers in: the shuffle draws from `crypto.getRandomValues`, held at 92
// for the deal (found by running `initializeRematch` under the same stub).
test("both Jokers rest side by side on the pile under their notice, and go back", async ({ page, baseURL }) => {
  const over = save(0, 2, [[], [], []], { gameOver: true, exchangePhase: undefined, rankings: ["player_0", "player_1", "player_2"] });
  await open(page, baseURL!, over);
  await page.evaluate(() => {
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(a: T) => {
      (a as unknown as Uint32Array).fill(92);
      return a;
    }) as Crypto["getRandomValues"];
  });
  await table(page);
  const frames: Frame[] = [];
  await run(page, MancheEnding.deal + X.beat + LEG.end + X.read + 2 * SLACK, frames);

  const i0 = frames.findIndex((f) => f.fliers["exchange-joker-0"]);
  expect(i0, "the Jokers never flew").toBeGreaterThan(0);
  expect(frames.slice(0, i0).some((f) => f.dealt > 0), "the manche was never dealt before the Jokers").toBe(true);
  expect(frames.slice(i0).every((f) => f.dealt === 0), "the deal still flew under the Jokers").toBe(true);
  expect(frames[i0].lit, "the loser's seat is lit while its Jokers are out").toContain("Gent");
  // A flier is drawn a frame after its clock moves, so its leg began within the frame before i0's;
  // these frames are the rest, notice and drawn pose both, for every start that allows.
  const resting = frames.filter((f) => f.t - frames[i0].t >= LEG.rest && f.t - frames[i0].t < LEG.tuck - 2 * FRAME);
  expect(resting.length).toBeGreaterThan((Hold.reveal - 4 * FRAME) / FRAME);
  for (const f of resting) {
    for (const [id, dx] of [["exchange-joker-0", -18], ["exchange-joker-1", 18]] as const) {
      expect(near(f.fliers[id], { x: f.pile!.x + dx, y: f.pile!.y }, 4), `${id} beside the pile centre`).toBe(true);
      expect(f.fliers[id].face).toBe(true);
    }
    expect(f.label?.text, "the notice names no swap").toBe("Nessuno scambio — Jolly doppio 🃏");
    expect(Math.abs(f.label!.x - f.pile!.x), "the notice is centred on the pile").toBeLessThanOrEqual(4);
    expect(f.label!.y, "and sits under it").toBeGreaterThan(f.pile!.y);
  }
  expect(frames.at(-1)!.fliers["exchange-joker-0"], "the Jokers go back").toBeUndefined();
});

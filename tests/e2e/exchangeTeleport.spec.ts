// tests/e2e/exchangeTeleport.spec.ts — each traded card is drawn on every frame of its leg, one
// frame's travel from the last, and face up from the lift until it leaves the pile (#1259).
import { test, expect } from "./fixtures";
import { resumeSaved } from "./helpers/offlineSeed";
import { tap } from "./helpers/press";
import { Motion } from "../../lib/tokens";
import { LEG } from "../../lib/game/exchangeTimeline";

const LEGS = ["exchange-flier-to-winner", "exchange-flier-to-loser"] as const;
/** The receive, its read, the choice, then the give. */
const SAMPLE_MS = 2 * (LEG.end + Motion.exchange.read) + 4000;
/** Above the legs' peak speed per 16 ms frame; a teleport is hundreds of points. */
const MAX_STEP = 40;

interface Sample { leg: string; t: number; x: number; y: number; back: number }

const card = (id: string, rank: string, suit: string) => ({ id, rank, suit, isJoker: false });
/** The viewer, Ana, has just won a manche and is choosing what to hand back to Bea. */
const midExchangeSave = () => ({
  version: 2,
  gameState: {
    players: [
      { id: "player_0", name: "Ana", hand: [card("5_hearts", "5", "hearts"), card("K_spades", "K", "spades")], type: "human" },
      { id: "player_1", name: "Bea", hand: [card("J_hearts", "J", "hearts"), card("Q_diamonds", "Q", "diamonds")], type: "ai" },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
    exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card("2_spades", "2", "spades"), bothJokersException: false },
  },
  match: { length: "match", target: 21, scores: {}, hands: [], over: false, winners: [], isDraw: false },
  players: [{ name: "Ana", type: "human" }, { name: "Bea", type: "ai", personality: "luan" }],
  gameMode: "free_for_all",
  dealFirstSeat: 0,
});

test("the traded cards fly through the pile, never jumping, face up from the lift to the tuck", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await resumeSaved(page, baseURL!, midExchangeSave());

  await page.evaluate(({ legs, sampleMs }) => {
    const out: Sample[] = [];
    (window as unknown as { __track: Sample[] }).__track = out;
    const t0 = performance.now();
    const shown = (el: Element, stop: Element) => {
      let k = 1;
      for (let n: Element | null = el; n && n !== stop.parentElement; n = n.parentElement) k *= Number(getComputedStyle(n).opacity);
      return k;
    };
    const frame = () => {
      for (const leg of legs) {
        const el = document.querySelector(`[data-testid="${leg}"]`);
        if (!el || shown(el, el) === 0) continue;
        const r = el.getBoundingClientRect();
        const back = el.querySelector('[data-testid="card-box-back"]');
        out.push({ leg, t: performance.now() - t0, x: r.x + r.width / 2, y: r.y + r.height / 2, back: back ? shown(back, el) : 0 });
      }
      if (performance.now() - t0 < sampleMs) requestAnimationFrame(frame);
      else (window as unknown as { __tracked: boolean }).__tracked = true;
    };
    requestAnimationFrame(frame);
  }, { legs: LEGS, sampleMs: SAMPLE_MS });

  await expect(page.getByTestId("exchange-prompt")).toBeVisible({ timeout: 15_000 });
  await tap(page, page.getByRole("button", { name: "5 di Cuori", exact: true }));
  await tap(page, page.getByTestId("btn-gioca"));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __tracked?: boolean }).__tracked === true), { timeout: 30_000 })
    .toBe(true);
  const track = await page.evaluate(() => (window as unknown as { __track: Sample[] }).__track);

  for (const leg of LEGS) {
    const path = track.filter((p) => p.leg === leg);
    expect(path.length, `${leg} was drawn`).toBeGreaterThan(10);
    for (let i = 1; i < path.length; i++) {
      const frames = Math.max(1, (path[i].t - path[i - 1].t) / 16.7);
      const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      expect(d, `${leg} jumped ${d.toFixed(1)} pt at ${path[i].t.toFixed(0)} ms`).toBeLessThanOrEqual(MAX_STEP * frames);
    }
    const first = path[0].t;
    const facing = path.filter((p) => p.t > first + Motion.exchange.lift + 50 && p.t < first + LEG.tuck - 50);
    expect(facing.length, `${leg} was sampled between its lift and its tuck`).toBeGreaterThan(10);
    expect(facing.filter((p) => p.back > 0).map((p) => p.t.toFixed(0)), `${leg} showed its back mid-leg`).toEqual([]);
  }
});

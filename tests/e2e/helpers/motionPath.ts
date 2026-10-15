// Plays an offline table on the motion path a player's build ships: the deal animates, and the
// exchange closes when its ceremony does rather than on the e2e hold's timer
// (`lib/e2eRealExchange.ts`). Every other spec that plays a round reduces motion.
import type { Locator, Page } from "@playwright/test";
import { E2E_REAL_EXCHANGE_KEY } from "../../../lib/storageKeys.ts";
import { EXCHANGE_GIVE_PREFIX, giveExchangeCard } from "./bot.ts";
import { GIOCA_VALID_LABEL, YOUR_TURN_PREFIX } from "./labels.ts";
import { dismissStartAnnouncement } from "./navigation.ts";
import { tap } from "./press.ts";
import { HAND_CARDS, TABLE, TABLE_DEALING, TABLE_STATE } from "./selectors.ts";

type Kind = "deal" | "landed" | "announce" | "announced" | "play";
type Seen = { kind: Kind; at: number };

const STALL_MS = 20_000;
/** A deal waits out the whole round before it; `announced` waits out the ceremony and the viewer's give. */
const GATE_MS: Record<Kind, number> = { deal: 40_000, landed: 10_000, announce: 10_000, announced: 20_000, play: 15_000 };

/** Every edge of the observables, sampled each frame, so a gate never races the state it waits on. */
function recordMotion(sel: { table: string; dealing: string }) {
  const seen: Seen[] = [];
  (window as unknown as { __motion: Seen[] }).__motion = seen;
  let inFlight = false;
  const was = { announce: false, play: false };
  const sample = () => {
    const dealing = document.querySelector(sel.table)?.getAttribute(sel.dealing);
    const backs = document.querySelector('[data-testid="dealt-back"]') !== null;
    const now = {
      announce: document.querySelector('[data-testid="exchange-announce"]') !== null,
      play: document.querySelector('[data-testid="flying-cards"]') !== null,
    };
    const at = performance.now();
    if (!inFlight && dealing === "true" && backs) {
      inFlight = true;
      seen.push({ kind: "deal", at });
    } else if (inFlight && dealing === "false") {
      inFlight = false;
      seen.push({ kind: "landed", at });
    }
    if (now.announce && !was.announce) seen.push({ kind: "announce", at });
    if (!now.announce && was.announce) seen.push({ kind: "announced", at });
    if (now.play && !was.play) seen.push({ kind: "play", at });
    Object.assign(was, now);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

/** Motion on, the e2e hold dropped and the recorder armed: call before the app loads, after the `consoleErrors` fixture. */
export async function onShippedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript((key) => window.localStorage.setItem(key, "1"), E2E_REAL_EXCHANGE_KEY);
  await page.addInitScript(recordMotion, { table: TABLE, dealing: TABLE_DEALING });
}

const edges = (page: Page) =>
  page.evaluate(() => (window as unknown as { __motion: Seen[] }).__motion.map((s) => s.kind).join(" "));

/** The index of the `nth` `kind` after `from`, waited for no longer than its own gate. */
async function gate(page: Page, round: number, kind: Kind, from: number, nth = 1): Promise<number> {
  try {
    const found = await page.waitForFunction(
      ({ kind, from, nth }) => {
        const seen = (window as unknown as { __motion: Seen[] }).__motion;
        let count = 0;
        for (let i = from + 1; i < seen.length; i++) {
          // An object, because index 0 is falsy and `waitForFunction` would keep polling.
          if (seen[i].kind === kind && ++count === nth) return { i };
        }
        return null;
      },
      { kind, from, nth },
      { timeout: GATE_MS[kind], polling: 100 }
    );
    return ((await found.jsonValue()) as { i: number }).i;
  } catch {
    throw new Error(`round ${round}: no "${kind}" within ${GATE_MS[kind]} ms. Edges seen: ${await edges(page)}`);
  }
}

/**
 * The `deal`th deal this page has animated lands, its exchange (from round 2 on) shows and
 * leaves, and then a card is played.
 */
async function roundGates(page: Page, round: number, deal: number): Promise<void> {
  const dealt = await gate(page, round, "deal", -1, deal);
  const landed = await gate(page, round, "landed", dealt);
  let before = landed;
  if (round > 1) {
    // The overlay mounts with the deal; it only starts once the deal lands (`GameTable.tsx` `go`).
    const announce = await gate(page, round, "announce", dealt);
    before = await gate(page, round, "announced", Math.max(announce, landed));
  }
  const play = await gate(page, round, "play", landed);
  if (play < before) {
    throw new Error(`round ${round}: a card was played while the exchange was still on the table. Edges seen: ${await edges(page)}`);
  }
}

/** A player moves once the deal has landed and the exchange has left the felt; the state sentence says "your turn" before either. */
function settledTable(page: Page): Promise<boolean> {
  return page.evaluate(
    ({ sel, attr }) =>
      document.querySelector(sel)?.getAttribute(attr) === "false" &&
      document.querySelector('[data-testid="exchange-announce"]') === null,
    { sel: TABLE, attr: TABLE_DEALING }
  );
}

async function lead(page: Page, gioca: Locator): Promise<void> {
  const cards = page.locator(`${HAND_CARDS}[aria-label]`);
  const labels = await cards.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  const opener = labels.indexOf("3 di Picche");
  const order = opener >= 0 ? [opener] : labels.map((_, i) => i);
  const picked = page.locator(`${HAND_CARDS}[aria-pressed="true"]`);
  for (const i of order) {
    for (let tries = 0; tries < 20 && (await picked.count()) > 0; tries++) {
      await tap(page, picked.first()).catch(() => {});
    }
    await tap(page, cards.nth(i)).catch(() => {});
    if ((await gioca.getAttribute("aria-label", { timeout: 1_000 }).catch(() => null)) === GIOCA_VALID_LABEL) {
      await tap(page, gioca).catch(() => {});
      return;
    }
  }
}

/**
 * The viewer passes whenever it may and otherwise leads its lowest legal single, so the bot plays
 * the round out fast. `driveGameToCompletion` searches every combination before it passes, which
 * takes a round past the budget of a spec playing three.
 */
async function playOn(page: Page, stop: () => boolean): Promise<void> {
  const table = page.locator(TABLE);
  const pass = page.getByTestId("btn-passa");
  const gioca = page.getByTestId("btn-gioca");
  let last: string | null = null;
  let since = Date.now();
  while (!stop()) {
    await dismissStartAnnouncement(page);
    const desc = await table.getAttribute(TABLE_STATE, { timeout: 2_000 }).catch(() => null);
    if (desc !== last) {
      last = desc;
      since = Date.now();
    } else if (Date.now() - since > STALL_MS) {
      throw new Error(`the table sat ${STALL_MS} ms on "${desc}"`);
    }
    if (desc?.startsWith(EXCHANGE_GIVE_PREFIX)) {
      await giveExchangeCard(page);
    } else if (desc?.startsWith(YOUR_TURN_PREFIX) && (await settledTable(page))) {
      if (await pass.isEnabled({ timeout: 1_000 }).catch(() => false)) {
        await tap(page, pass).catch(() => {});
      } else {
        await lead(page, gioca);
      }
      await page
        .waitForFunction(
          ({ sel, attr, was }) => document.querySelector(sel)?.getAttribute(attr) !== was,
          { sel: TABLE, attr: TABLE_STATE, was: desc },
          { timeout: 3_000 }
        )
        .catch(() => {});
    }
    await page.waitForTimeout(100);
  }
}

/**
 * Plays on until round `to` has seen its first play, holding each round from `from` to its gates.
 * `from` is the round of the page's first deal: a resumed table opens with none.
 */
export async function playRounds(page: Page, from: number, to: number): Promise<void> {
  let done = false;
  // Caught here and thrown after the gates: a stuck deal also stalls the driver, and the gate names it.
  const drive = playOn(page, () => done).then(
    () => null,
    (err: unknown) => err
  );
  for (let round = from; round <= to; round++) {
    await roundGates(page, round, round - from + 1);
  }
  done = true;
  const err = await drive;
  if (err) throw err;
}

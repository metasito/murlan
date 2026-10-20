// Drives a real game of Murlan through the rendered UI: reads the table's
// own screen-reader description (components/tableA11y.ts
// `describeTableForA11y`) to know whose turn it is and what was last played,
// selects real cards by their `accessibilityLabel`, and asserts the game
// keeps progressing. A game that stops advancing is treated as a failure,
// not something to wait out — that is exactly how the exchange-phase
// freezes and the bot-lead deadlock this suite targets used to present.
//
// Card legality itself is never modelled here: every candidate combination
// is verified against the real GIOCA button state ("Gioca le carte
// selezionate" vs "Gioca — non disponibile: ...", from locales/it.ts), the
// same signal a player relies on. The bot tries singles, then pairs, then
// triples, then four-of-a-kind bombs, ascending by rank, and passes when
// nothing beats the table.

import { expect, type Locator, type Page } from "@playwright/test";
// Extensioned because `tests/tooling/botProgress.test.ts` loads this file through Node's ESM
// resolver, which will not guess one. Playwright accepts it either way.
import {
  CARD_NAME_JOIN,
  EXCHANGE_GIVE_PREFIX,
  GIOCA_VALID_LABEL,
  GIVEBACK_RANK_WORDS,
  handCounts,
  OTHERS_PLAY,
  RANK_WORDS,
  REPLY_SIZE,
  START_CARD_LABEL,
  SUIT_WORDS,
  YOUR_TURN_PREFIX,
} from "./labels.ts";
import { dismissStartAnnouncement } from "./navigation.ts";

import { tap } from "./press.ts";
import { HAND_CARDS, HAND_SELECTED, TABLE, TABLE_STATE } from "./selectors.ts";

const GIOCA_BTN = '[data-testid="btn-gioca"]';

/** GIOCA, only while it offers the current selection as a legal play. */
export function legalGioca(page: Page): Locator {
  return page.getByRole("button", { name: GIOCA_VALID_LABEL, exact: true });
}

/** Whether GIOCA offers the current selection as a legal play, read once. */
async function giocaAccepts(page: Page, timeout = CARD_CLICK_TIMEOUT_MS): Promise<boolean> {
  return (await page.locator(GIOCA_BTN).getAttribute("aria-label", { timeout }).catch(() => null)) === GIOCA_VALID_LABEL;
}

/** Fails with `message` unless GIOCA comes to offer the current selection as a legal play. */
export async function expectSelectionLegal(page: Page, message: string, timeout = 10_000): Promise<void> {
  await expect(page.locator(GIOCA_BTN), message).toHaveAttribute("aria-label", GIOCA_VALID_LABEL, { timeout });
}

/** Resolves once the table state differs from `was`, or the table has gone; false at `timeoutMs`. */
function stateLeaves(page: Page, was: string, timeoutMs: number): Promise<boolean> {
  return page
    .waitForFunction(
      ({ sel, attr, was }) => document.querySelector(sel)?.getAttribute(attr) !== was,
      { sel: TABLE, attr: TABLE_STATE, was },
      { timeout: timeoutMs }
    )
    .then(
      () => true,
      () => false
    );
}

/** Taps `card` and waits for its selection to flip; false when it never did. */
async function toggle(page: Page, card: Locator): Promise<boolean> {
  try {
    const was = await card.getAttribute("aria-pressed", { timeout: CARD_CLICK_TIMEOUT_MS });
    await tap(page, card);
    const now = () => card.getAttribute("aria-pressed", { timeout: 1_000 }).catch(() => was);
    await expect.poll(now, { timeout: CARD_CLICK_TIMEOUT_MS }).not.toBe(was);
    return true;
  } catch {
    return false;
  }
}

/**
 * Plays the first single in hand that GIOCA accepts, weakest first, and returns its label — null
 * when none is legal or the hand stopped answering. GIOCA is the only judge: the first play of a
 * match must hold the dealt opening card, and no rule here could know which that is.
 */
export async function playAnyLegal(page: Page): Promise<string | null> {
  const labelsOf = (selector: string) =>
    page.locator(`${selector}[aria-label]`).evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  const card = (label: string) => page.locator(`${HAND_CARDS}${labelSelector(label)}`);
  const hand = await labelsOf(HAND_CARDS);
  const order = hand.includes(START_CARD_LABEL) ? [START_CARD_LABEL, ...hand.filter((l) => l !== START_CARD_LABEL)] : hand;
  for (const label of order) {
    for (const held of await labelsOf(`${TABLE} ${HAND_SELECTED}`)) {
      if (!(await toggle(page, card(held)))) return null;
    }
    if (!(await toggle(page, card(label)))) continue;
    if (await giocaAccepts(page, 1_000)) {
      return (await tap(page, page.locator(GIOCA_BTN)).then(() => true, () => false)) ? label : null;
    }
  }
  return null;
}

async function tableDescription(page: Page): Promise<string | null> {
  const table = page.locator(TABLE);
  if ((await table.count()) === 0) return null;
  try {
    // The table can unmount between the count() above and this read — exactly
    // when a game ends — so a short bound lets the caller's isFinished loop
    // re-check instead of waiting out the whole test budget.
    return await table.getAttribute(TABLE_STATE, { timeout: CARD_CLICK_TIMEOUT_MS });
  } catch {
    return null;
  }
}

/**
 * Every hand size the table announces, summed (`gameTable.a11yYourCards` and
 * `a11yOpponentCards`, both numbers in locales/it.ts). Null when the state
 * names none.
 */
export function cardsInHands(desc: string): number | null {
  const counts = handCounts(desc);
  return counts.length === 0 ? null : counts.reduce((sum, n) => sum + n, 0);
}

/** An `isFinished` for a round that ends on the table: its only sign is the next deal growing the hands. */
export function untilNextDeal(): (page: Page) => Promise<boolean> {
  let held: number | null = null;
  return async (page) => {
    const desc = await tableDescription(page);
    const now = desc === null ? null : cardsInHands(desc);
    if (now === null) return false;
    const dealt = held !== null && now > held;
    held = now;
    return dealt;
  };
}

export interface Progress {
  /** Cards across every hand the table has announced so far. */
  held: number | null;
  /** Table states seen since that total last moved. */
  stale: number;
}

export const NO_PROGRESS_YET: Progress = { held: null, stale: 0 };

/**
 * Folds one new table state into the progress seen so far. Any move of the
 * total counts, including the deal that grows it again between rounds: what a
 * game that cannot end never does is change it.
 */
export function observeProgress(prev: Progress, desc: string): Progress {
  const held = cardsInHands(desc);
  // A state that names no hand sizes is neither progress nor a lack of it.
  if (held === null) return prev;
  return { held, stale: held === prev.held ? prev.stale + 1 : 0 };
}

function rankKeyOf(cardLabel: string): string {
  const sep = cardLabel.indexOf(CARD_NAME_JOIN);
  return sep === -1 ? cardLabel : cardLabel.slice(0, sep);
}

/** Ascending rank groups, in the order they first appear — the hand is already rank-sorted. */
function groupByRank(labels: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const label of labels) {
    const key = rankKeyOf(label);
    const existing = groups.get(key);
    if (existing) existing.push(label);
    else groups.set(key, [label]);
  }
  return groups;
}

/** CSS attribute-escapes a card's accessibilityLabel for use in a selector. */
function labelSelector(label: string): string {
  return `[aria-label="${label.replace(/"/g, '\\"')}"]`;
}

export class StuckError extends Error {}

/**
 * One `playOrPass` call tried more candidate combinations than
 * `maxCombosTried` allows, or ran past `maxSearchMs` doing it. Neither
 * `stallMs` nor `maxStatesWithoutProgress` can see this: both only compare
 * table descriptions *between* calls.
 *
 * `maxCombosTried` is counted rather than timed, for the same reason
 * `maxStatesWithoutProgress` is: a slow CI runner plays through the same
 * finite candidate list a fast one does, just slower, and a wall-clock
 * ceiling on one candidate can't tell "still working" from "stuck" under
 * machine-speed variance — every locator call inside one candidate's own
 * search (`tryCombo`, `setSelection`) already carries its own bounded
 * timeout for that. `maxSearchMs` bounds the sum across every candidate
 * instead: up to `maxCombosTried` of them, each capable of costing close to
 * its own per-locator ceiling if every read comes back slow rather than
 * fast, can still add up past this test's own timeout before either
 * watchdog above gets a look — the #770 failure mode this class exists to
 * pre-empt with a real diagnostic instead of a bare timeout.
 */
export class SearchTimeoutError extends StuckError {}

// The table's own aria-label announces "your turn" purely from
// `currentTurnIndex === viewerSeat` (components/tableA11y.ts
// `describeTableForA11y`), with no notion of `roundOver` — so for one tick
// after an opponent's move ends the round, the description can still read as
// "your turn" while the hand itself is already correctly disabled. A short
// per-click timeout turns that harmless one-tick race into "this turn
// evaporated, go round the loop again" instead of hanging until the test's
// own timeout, which buries the real diagnostic under a generic one.
const CARD_CLICK_TIMEOUT_MS = 4_000;

/**
 * `tests/bots/botSearchTimeout.test.ts` derives the real worst case from
 * `dealCards`' own output and fails if this stops being comfortably above
 * it. `DriveOptions.maxCombosTried` overrides it.
 */
export const DEFAULT_MAX_COMBOS_TRIED = 150;

/**
 * Backstop against the aggregate, not against one candidate hanging
 * (`CARD_CLICK_TIMEOUT_MS` already covers that) or against CPU variance
 * (`DEFAULT_MAX_COMBOS_TRIED` already covers a healthy search running slow).
 * Comfortably above anything a healthy search has been measured to take, and
 * comfortably below both `maxTotalMs` and Playwright's own per-test timeout,
 * so this names the failure before either buries it under a bare 300s
 * timeout with no diagnostic (#770). `DriveOptions.maxSearchMs` overrides it.
 */
export const DEFAULT_MAX_SEARCH_MS = 90_000;

/**
 * The table description names the last play's shape, and `canPlay` only ever
 * accepts a matching card count — so parsing it up front saves a singles
 * sweep that was always going to fail.
 *
 * Null means leading or replying to a single; -1 means a straight, which this
 * bot cannot build, so only a bomb can answer.
 */
/** -1 for anything this does not recognise, which callers treat as "try it". */
function rankIndex(cardLabel: string): number {
  return RANK_WORDS.indexOf(rankKeyOf(cardLabel));
}

/**
 * The strength of a single sitting on the table, or null when there is none to
 * beat.
 *
 * Null covers three cases that all want the same exhaustive search: an empty
 * table, a combination that is not a single (its label reads "coppia di
 * Donna", whose rank key is "coppia" and matches nothing here), and a play the
 * viewer made themselves — "Hai giocato" does not contain "ha giocato", so the
 * pattern misses it, which is right: everyone passed and the viewer now leads.
 *
 * Leading must stay exhaustive. The opening play of a match has to contain the
 * dealt opening card specifically, so skipping any candidate there can skip the
 * only legal move.
 */
function tableSingleStrength(desc: string): number | null {
  const played = desc.match(OTHERS_PLAY);
  if (!played) return null;
  const index = rankIndex(played[1]);
  return index === -1 ? null : index;
}

function requiredReplySize(desc: string): number | null {
  return REPLY_SIZE.find(([shape]) => shape.test(desc))?.[1] ?? null;
}

/**
 * Tries, in order, every single/pair/triple/bomb the current hand can form
 * (ascending by rank), playing the first one the real GIOCA button accepts.
 * Falls back to PASSA. Returns null if the hand stopped being interactive
 * mid-search (the race above). Throws `StuckError` only when the hand is
 * genuinely interactive and *still* offers no legal single/pair/triple/bomb
 * and PASSA is disabled — which never happens under the real rules — every
 * leader can play a single and every follower may always pass — so it means
 * the app itself is wrong.
 *
 * Singles are tried card by card, not one per rank: suit never affects a
 * single's legality except on the first play of a match, which must contain
 * the dealt opening card — one representative per rank would miss it.
 *
 * Cards are clicked by their accessibilityLabel, not by list position: the
 * hand re-renders (selection state, entrance/lift animations) between one
 * click and the next, and a positional `nth()` locator can resolve to an
 * element that has since detached, failing the whole turn on what is really
 * just animation churn rather than a stuck game.
 */
async function playOrPass(
  page: Page,
  desc: string,
  maxCombosTried = DEFAULT_MAX_COMBOS_TRIED,
  maxSearchMs = DEFAULT_MAX_SEARCH_MS
): Promise<string | null> {
  const searchDeadline = Date.now() + maxSearchMs;
  const replySize = requiredReplySize(desc);
  const handCards = page.locator(HAND_CARDS);
  const cardsNow = (await handCards.evaluateAll((els) =>
    els.map((el) => ({
      label: el.getAttribute("aria-label") ?? "",
      // `aria-pressed` (lib/a11y.tsx `a11yState`) is the selection itself —
      // ground truth for what the table actually holds selected right now,
      // as opposed to what this driver last believed it clicked.
      selected: el.getAttribute("aria-pressed") === "true",
    }))
  )) as { label: string; selected: boolean }[];
  const labels = cardsNow.map((c) => c.label);
  const giocaBtn = page.locator(GIOCA_BTN);
  const passBtn = page.locator('[data-testid="btn-passa"]');

  // An empty hand is the end of the race described above, not a stuck table:
  // the viewer has just played their last card, the hand is already gone, and
  // the table's own description has not caught up for a tick. The
  // play-or-pass invariant below is about a hand that still has cards in it —
  // asserting it here turns a finished game into a failure. Handing back null
  // lets the caller's isFinished check see the end-of-match board.
  if (labels.length === 0) return null;

  function cardByLabel(label: string): Locator {
    return page.locator(`${HAND_CARDS}${labelSelector(label)}`);
  }

  async function click(locator: Locator): Promise<boolean> {
    try {
      await tap(page, locator);
      return true;
    } catch {
      return false;
    }
  }

  // Diffs the requested selection against what is actually still selected,
  // rather than blindly deselecting-then-reselecting from scratch — so a
  // click that silently failed to toggle leaves a card correctly tracked as
  // still selected instead of being assumed clear.
  //
  // Read fresh from the table at the top of every call, rather than carried
  // in a variable across the whole search: a selection can survive an
  // opponent's turn, but it can just as well be cleared out from under this
  // driver by something that is not a click — offline, `HUMAN_TURN_SECONDS`
  // auto-passes the turn on a timer that a slow card search (many
  // setSelection calls, one search) can run into mid-search, and a pass
  // clears the selection (`GameContext.tsx` `passTurn`). A belief carried in
  // memory has no way to learn that happened partway through a search and
  // keeps clicking against a hand that has already moved on; re-reading
  // `aria-pressed` on every call is what the DOM cannot go stale on.
  async function currentSelection(): Promise<string[]> {
    const cards = (await handCards.evaluateAll((els) =>
      els.map((el) => ({
        label: el.getAttribute("aria-label") ?? "",
        selected: el.getAttribute("aria-pressed") === "true",
      }))
    )) as { label: string; selected: boolean }[];
    return cards.filter((c) => c.selected).map((c) => c.label);
  }

  async function setSelection(target: string[]): Promise<boolean> {
    let selected = await currentSelection();
    for (const l of selected) {
      if (target.includes(l)) continue;
      if (!(await toggle(page, cardByLabel(l)))) return false;
      selected = selected.filter((x) => x !== l);
    }
    for (const l of target) {
      if (selected.includes(l)) continue;
      if (!(await toggle(page, cardByLabel(l)))) return false;
      selected = [...selected, l];
    }
    return true;
  }

  let combosTried = 0;

  async function tryCombo(cardLabels: string[]): Promise<"played" | "no" | "gone"> {
    if (combosTried >= maxCombosTried) {
      throw new SearchTimeoutError(
        `Search for a reply to "${desc}" tried ${combosTried} candidate(s) without finishing, ` +
          `past the ${maxCombosTried}-candidate ceiling. Hand at search start: ` +
          `[${labels.join(", ")}].`
      );
    }
    if (Date.now() > searchDeadline) {
      throw new SearchTimeoutError(
        `Search for a reply to "${desc}" ran past ${maxSearchMs}ms after ${combosTried} ` +
          `candidate(s) — the count cap alone would not have caught this. Hand at search ` +
          `start: [${labels.join(", ")}].`
      );
    }
    combosTried += 1;
    if (!(await setSelection(cardLabels))) return "gone";
    if (await giocaAccepts(page)) {
      if (!(await click(giocaBtn))) return "gone";
      return "played";
    }
    return "no"; // leave the selection as-is; the next attempt's setSelection diffs against it
  }

  if (replySize === null) {
    // Following a single, every card at or below the table's rank is a wasted
    // pair of clicks: a beating play must be *strictly* higher, so an equal
    // rank is illegal and a lower one obviously is. This orders the search; it
    // does not decide it. GIOCA is still the only thing that says yes, and an
    // unrecognised rank sorts as "try it" rather than "skip it".
    //
    // This is where the suite's wall clock goes. Answering a Queen from a hand
    // of eighteen used to mean selecting and deselecting fifteen losing cards
    // first, one move at a time, all game.
    const floor = tableSingleStrength(desc);
    const worthTrying =
      floor === null ? labels : labels.filter((l) => rankIndex(l) === -1 || rankIndex(l) > floor);

    for (const label of worthTrying) {
      const outcome = await tryCombo([label]);
      if (outcome === "played") return `played single ${label}`;
      if (outcome === "gone") return null;
    }
  }

  const groups = groupByRank(labels);
  // A bomb answers anything, so it is always worth trying; a matching-size
  // reply only when the last play's shape actually calls for it.
  const sizesToTry =
    replySize === null ? [2, 3, 4] : Array.from(new Set([replySize === -1 ? 4 : replySize, 4]));
  for (const size of sizesToTry) {
    for (const [rank, groupLabels] of groups) {
      if (groupLabels.length < size) continue;
      const outcome = await tryCombo(groupLabels.slice(0, size));
      if (outcome === "played") {
        return `played ${size === 2 ? "pair" : size === 3 ? "triple" : "bomb"} of ${rank}`;
      }
      if (outcome === "gone") return null;
    }
  }

  if (!(await setSelection([]))) return null; // leave a clean hand before passing

  let passEnabled: boolean;
  try {
    passEnabled = await passBtn.isEnabled({ timeout: CARD_CLICK_TIMEOUT_MS });
  } catch {
    return null; // PASSA itself has gone — the game moved on, not a stuck table.
  }
  if (!passEnabled) {
    // The search answered `desc`, and a table that has moved on since is not the one it
    // answered: an auto-pass, or a fresh trick the viewer now leads, where PASSA is
    // rightly disabled and the singles filtered out against the old play were legal.
    // Still the viewer's turn is not enough; only the same table proves the app wrong.
    if ((await tableDescription(page)) !== desc) return null;
    throw new StuckError(
      `No combination in hand [${labels.join(", ")}] satisfies GIOCA, and PASSA is disabled — the rules guarantee one of those always holds.`
    );
  }
  if (!(await click(passBtn))) return null;
  return "passed";
}

// The valid giveback ranks (docs/GAME-RULES.md §10: rank 3 through 10). Matching
// on this — rather than excluding known UI chrome by label — means the
// selector can't accidentally land on an unrelated button such as the
// top-bar quit control, whatever its label happens to be.
const GIVEBACK_CARD_LABEL = new RegExp(`^(${GIVEBACK_RANK_WORDS.join("|")})${CARD_NAME_JOIN}(${SUIT_WORDS.join("|")})$`);

/** The prompt on the felt. Its presence is what says an exchange is open. */
const EXCHANGE_PROMPT = '[data-testid="exchange-prompt"]';

/**
 * The winner's giveable cards, in their own hand.
 *
 * The exchange happens on the table now, so the hand is the picker: the cards
 * in the 3-10 range are the enabled ones and everything else in the fan reports
 * itself disabled. Asking for the enabled ones rather than filtering by rank
 * alone means this follows `getValidGivebackCards` — including its fallback,
 * where a hand holding nothing in range offers its single lowest card instead
 * and a rank filter would find nothing to click.
 *
 * Scoped to the hand, not the table: with nothing in range the rank filter
 * matches nothing and every candidate is tried in turn, so a selector reaching
 * the whole table would work its way through GIOCA, PASS and the rail's own
 * controls looking for a card.
 */
function giveCandidates(page: Page) {
  return page.locator(`${HAND_CARDS}[aria-label]:not([aria-disabled="true"])`);
}

async function giveCandidateLabels(page: Page): Promise<string[]> {
  return (await giveCandidates(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  )) as string[];
}

/**
 * Gives back a card during the between-rounds exchange (docs/GAME-RULES.md §10).
 *
 * Select-then-confirm: clicking a card only picks it, and the give happens on
 * the table's own GIOCA, which the exchange borrows (#533). Both clicks are
 * needed, in that order.
 *
 * Watch for: GIOCA refuses with a shake rather than throwing when no card is
 * picked, so a confirm that does nothing means the card click missed. The
 * prompt leaving the felt is what proves the give landed — a click that
 * silently missed the gesture responder throws nothing.
 */
export async function giveExchangeCard(page: Page): Promise<boolean> {
  const prompt = page.locator(EXCHANGE_PROMPT);
  if ((await prompt.count()) === 0) return false;

  const labels = await giveCandidateLabels(page);
  const picks = labels.filter((l) => GIVEBACK_CARD_LABEL.test(l));
  // The fallback case: nothing in 3-10, so the engine offers the lowest card
  // and it is the only enabled one in the fan.
  const order = picks.length > 0 ? picks : labels;

  for (const label of order.reverse()) {
    const card = page.locator(`${HAND_CARDS}${labelSelector(label)}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await card.getAttribute("aria-pressed", { timeout: CARD_CLICK_TIMEOUT_MS }).catch(() => null)) !== "true") await toggle(page, card);
      await tap(page, page.locator(GIOCA_BTN)).catch(() => {});
      if (await expect(prompt).toHaveCount(0, { timeout: 1_000 }).then(() => true, () => false)) return true;
    }
  }
  return false;
}

/** How long one idle pass waits for the table to move before the watchdogs look again. */
const IDLE_WAIT_MS = 1_000;
/** Shorter: an abandoned turn is usually a table one tick from moving on. */
const ABANDON_WAIT_MS = 250;

const onViewer = (desc: string) => desc.startsWith(YOUR_TURN_PREFIX) || desc.startsWith(EXCHANGE_GIVE_PREFIX);

export interface DriveOptions {
  /** Resolves true once the game has reached a terminal, checkable screen. */
  isFinished: (page: Page) => Promise<boolean>;
  /**
   * How many table states may pass with no card leaving anyone's hand before
   * this is a game that cannot end rather than a long one. Counted rather than
   * timed: a slow machine plays the same moves as a fast one, and the spread
   * across deals is wide enough that any wall-clock figure covering the slow
   * tail is useless as a check.
   */
  maxStatesWithoutProgress?: number;
  /** How long the table description may sit unchanged before this is a stall, not a wait. */
  stallMs?: number;
  /**
   * Wall-clock ceiling for the whole drive, independent of the two watchdogs
   * above: both can stay green forever on a game that keeps changing state and
   * keeps moving cards out of hands while never once reaching `isFinished`
   * (#770). Comfortably above a normal round (measured: 37s, offline 2-player)
   * and comfortably below every caller's own `test.setTimeout`, so this names
   * the failure before Playwright's bare timeout buries it under an unrelated
   * assertion.
   */
  maxTotalMs?: number;
  /** See `SearchTimeoutError`. Overrides `DEFAULT_MAX_COMBOS_TRIED`. */
  maxCombosTried?: number;
  /** See `SearchTimeoutError`. Overrides `DEFAULT_MAX_SEARCH_MS`. */
  maxSearchMs?: number;
  log?: (line: string) => void;
}

/**
 * Plays one game to completion, acting whenever it is this viewer's turn and
 * otherwise waiting for the opponents/server. Fails loudly, with the table's
 * own state description, the moment progress stops rather than after a bare
 * timeout — a stalled `currentTurnIndex` or an unresolved exchange looks
 * identical to "still thinking" until you compare consecutive polls.
 */
export async function driveGameToCompletion(page: Page, opts: DriveOptions): Promise<void> {
  // A round ends when someone runs out, so cards leaving hands is the only
  // progress there is. Legitimately it pauses for a round of passes and the
  // turn churn around it — a handful of states; this sits an order above that.
  const maxStatesWithoutProgress = opts.maxStatesWithoutProgress ?? 100;
  // Generous relative to a normal turn (a few seconds, measured, with
  // EXPO_PUBLIC_E2E_FAST and reduced motion both active) without being so
  // tight that one slow bot response false-positives a healthy game.
  const stallMs = opts.stallMs ?? 15_000;
  const maxTotalMs = opts.maxTotalMs ?? 240_000;
  const maxCombosTried = opts.maxCombosTried ?? DEFAULT_MAX_COMBOS_TRIED;
  const maxSearchMs = opts.maxSearchMs ?? DEFAULT_MAX_SEARCH_MS;
  const log = opts.log ?? (() => {});

  let lastDesc = "";
  let lastChangeAt = Date.now();
  let progress = NO_PROGRESS_YET;
  const startedAt = Date.now();
  // `progress` sums cards across every hand, so a viewer stuck auto-passing
  // every turn (HUMAN_TURN_SECONDS beating a slow search — see `playOrPass`'s
  // null return) is invisible to it as long as opponents keep playing: the
  // total still falls, `stale` keeps resetting, and the match finishes with a
  // winner even though this seat never once played. This counts turns
  // abandoned back to back, which only that specific failure can run up.
  let consecutiveAbandons = 0;
  const maxConsecutiveAbandons = 10;

  for (;;) {
    if (await opts.isFinished(page)) return;
    if (Date.now() - startedAt > maxTotalMs) {
      throw new StuckError(
        `Game did not reach isFinished within ${maxTotalMs}ms even though the table kept ` +
          `changing state and cards kept leaving hands — neither watchdog above catches a match ` +
          `that plays forever without ending. Last table state: "${lastDesc}".`
      );
    }

    // Every round opens with one, so this cannot be done once before the loop.
    await dismissStartAnnouncement(page);

    const desc = await tableDescription(page);
    if (desc === null) {
      await page.locator(`${TABLE}[${TABLE_STATE}]`).waitFor({ timeout: 1_000 }).catch(() => {});
      continue;
    }

    if (desc !== lastDesc) {
      lastDesc = desc;
      lastChangeAt = Date.now();

      progress = observeProgress(progress, desc);
      if (progress.stale > maxStatesWithoutProgress) {
        throw new StuckError(
          `Game passed through ${progress.stale} table states with ${progress.held} cards still in hand, ` +
            `so no move is reducing them and it cannot end. Last table state: "${desc}".`
        );
      }
    }

    let acted = false;
    if (desc.startsWith(EXCHANGE_GIVE_PREFIX)) {
      const gaveCard = await giveExchangeCard(page);
      acted = gaveCard;
      if (gaveCard) {
        log(`exchange: gave back a card (${desc})`);
        const changed = await stateLeaves(page, desc, stallMs);
        if (!changed) {
          throw new StuckError(
            `Gave back an exchange card but the table state did not advance. Last state: "${desc}".`
          );
        }
        lastDesc = (await tableDescription(page)) ?? lastDesc;
        lastChangeAt = Date.now();
      }
      // No valid giveback card exists — nothing to click; keep polling for the stall watchdog.
    } else if (desc.startsWith(YOUR_TURN_PREFIX)) {
      const searchStartedAt = Date.now();
      const action = await playOrPass(page, desc, maxCombosTried, maxSearchMs);
      // Logged before the null branch below, not after: a search that lost its
      // hand partway through is the one whose duration is worth having, and it
      // is exactly the branch that returns null.
      log(`${action ?? "abandoned"} (was: "${desc}") [search ${Date.now() - searchStartedAt}ms]`);
      if (action === null) {
        // The hand stopped being interactive mid-search — most often the
        // one-tick "your turn" / roundOver race described above `playOrPass`.
        // Let the next iteration's isFinished/description check decide what
        // actually happened, except for the count below, which is the one
        // thing that check cannot see.
        consecutiveAbandons += 1;
        if (consecutiveAbandons > maxConsecutiveAbandons) {
          throw new StuckError(
            `The viewer's turn was abandoned ${consecutiveAbandons} times in a row without ever ` +
              `completing a play or pass — this seat is not participating even though the game ` +
              `keeps moving. Last table state: "${desc}".`
          );
        }
        await stateLeaves(page, desc, ABANDON_WAIT_MS);
        continue;
      }
      consecutiveAbandons = 0;
      acted = true;
      const changed = await stateLeaves(page, desc, stallMs);
      if (!changed) {
        throw new StuckError(
          `Took action "${action}" but the table state did not advance. Last state: "${desc}".`
        );
      }
      lastDesc = (await tableDescription(page)) ?? lastDesc;
      lastChangeAt = Date.now();
    }

    if (Date.now() - lastChangeAt > stallMs) {
      throw new StuckError(
        `Game stopped progressing for ${stallMs}ms. Last table state: "${lastDesc}".`
      );
    }

    // A move that lands on the viewer's next move has nothing left to wait for.
    if (!(acted && onViewer(lastDesc))) await stateLeaves(page, lastDesc, IDLE_WAIT_MS);
  }
}

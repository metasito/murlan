// Drives a real game of Murlan through the rendered UI: reads the table's
// own screen-reader description (components/gameTableModel.ts
// `describeTableForA11y`) to know whose turn it is and what was last played,
// selects real cards by their `accessibilityLabel`, and asserts the game
// keeps progressing. A game that stops advancing is treated as a failure,
// not something to wait out — that is exactly how the exchange-phase
// freezes and the AI-lead deadlock this suite targets used to present.
//
// Card legality itself is never modelled here: every candidate combination
// is verified against the real GIOCA button state ("Gioca le carte
// selezionate" vs "Gioca — non disponibile: ...", from locales/it.ts), the
// same signal a player relies on. The bot tries singles, then pairs, then
// triples, then four-of-a-kind bombs, ascending by rank, and passes when
// nothing beats the table.

import type { Locator, Page } from "@playwright/test";
// Extensioned because `tests/botProgress.test.ts` loads this file through Node's ESM
// resolver, which will not guess one. Playwright accepts it either way.
import { GIOCA_VALID_LABEL } from "./labels.ts";

const TABLE = '[data-testid="game-table"]';
// Scoped to the hand wrapper specifically (its own accessibilityLabel always
// starts with "La tua mano:" — components/GameTable.tsx `handA11yLabel`),
// not just anywhere under the table: the played-pile display renders real,
// correctly-labelled CardView buttons too (disabled, decorative), and an
// unscoped `[role="button"]` sweep picks those up as if they were playable
// hand cards — including, confusingly, a card that's actually sitting in an
// opponent's just-played combination.
const HAND_CARDS = `${TABLE} [aria-label^="La tua mano"] [role="button"]`;
const EXCHANGE_GIVE_PREFIX = "Fase di scambio: devi dare una carta a";
const YOUR_TURN_PREFIX = "È il tuo turno.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tableDescription(page: Page): Promise<string | null> {
  const table = page.locator(TABLE);
  if ((await table.count()) === 0) return null;
  try {
    // The table can unmount between the count() above and this read — exactly
    // when a game ends — so a short bound lets the caller's isFinished loop
    // re-check instead of waiting out the whole test budget.
    return await table.getAttribute("aria-label", { timeout: CARD_CLICK_TIMEOUT_MS });
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
  const counts = [...desc.matchAll(/(\d+) cart[ae] in mano/g)];
  return counts.length === 0 ? null : counts.reduce((sum, m) => sum + Number(m[1]), 0);
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
 * total counts, including the deal that grows it again between hands: what a
 * game that cannot end never does is change it.
 */
export function observeProgress(prev: Progress, desc: string): Progress {
  const held = cardsInHands(desc);
  // A state that names no hand sizes is neither progress nor a lack of it.
  if (held === null) return prev;
  return { held, stale: held === prev.held ? prev.stale + 1 : 0 };
}

function rankKeyOf(cardLabel: string): string {
  const sep = cardLabel.indexOf(" di ");
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
 * What this driver believes is selected in each page's hand, across turns.
 * Since a staged play survives an opponent's turn, the selection is no longer
 * guaranteed to be empty when a turn begins, and an early return mid-search
 * leaves cards lit that the next turn has to know about.
 */
const stagedSelection = new WeakMap<Page, string[]>();

// The table's own aria-label announces "your turn" purely from
// `currentTurnIndex === viewerSeat` (components/gameTableModel.ts
// `describeTableForA11y`), with no notion of `gameOver` — so for one tick
// after an opponent's move ends the game, the description can still read as
// "your turn" while the hand itself is already correctly disabled. A short
// per-click timeout turns that harmless one-tick race into "this turn
// evaporated, go round the loop again" instead of hanging until the test's
// own timeout, which buries the real diagnostic under a generic one.
const CARD_CLICK_TIMEOUT_MS = 4_000;

/**
 * The table description names the last play's shape, and `canPlay` only ever
 * accepts a matching card count — so parsing it up front saves a singles
 * sweep that was always going to fail.
 *
 * Null means leading or replying to a single; -1 means a straight, which this
 * bot cannot build, so only a bomb can answer.
 */
/**
 * Card strength, weakest first, by the word the table uses for each rank
 * (lib/cardNames.ts against locales/it.ts) — "Jolly nero"/"Jolly rosso" for
 * the jokers, since cardView.jokerBlack/jokerColored render "Jolly", not
 * "Joker". Suit is absent on purpose: no source gives suits an order and
 * `cardStrength()` ignores them, so equal ranks are equal strength.
 */
const RANK_ORDER = [
  "3", "4", "5", "6", "7", "8", "9", "10",
  "Fante", "Donna", "Re", "Asso", "2",
  "Jolly nero", "Jolly rosso",
];

/** -1 for anything this does not recognise, which callers treat as "try it". */
function rankIndex(cardLabel: string): number {
  return RANK_ORDER.indexOf(rankKeyOf(cardLabel));
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
 * dealt start card specifically, so skipping any candidate there can skip the
 * only legal move.
 */
function tableSingleStrength(desc: string): number | null {
  const played = desc.match(/ha giocato (.+?)\./);
  if (!played) return null;
  const index = rankIndex(played[1]);
  return index === -1 ? null : index;
}

function requiredReplySize(desc: string): number | null {
  if (/ha giocato coppia di/.test(desc)) return 2;
  if (/ha giocato tris di/.test(desc)) return 3;
  if (/ha giocato bomba di/.test(desc)) return 4;
  if (/ha giocato scala( reale)? di \d+ carte/.test(desc)) return -1;
  return null;
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
 * the dealt start card — one representative per rank would miss it.
 *
 * Cards are clicked by their accessibilityLabel, not by list position: the
 * hand re-renders (selection state, entrance/lift animations) between one
 * click and the next, and a positional `nth()` locator can resolve to an
 * element that has since detached, failing the whole turn on what is really
 * just animation churn rather than a stuck game.
 */
async function playOrPass(page: Page, desc: string): Promise<string | null> {
  const replySize = requiredReplySize(desc);
  const handCards = page.locator(HAND_CARDS);
  const labels = (await handCards.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  )) as string[];
  const giocaBtn = page.locator('[data-testid="btn-gioca"]');
  const passBtn = page.locator('[data-testid="btn-passa"]');

  // An empty hand is the end of the race described above, not a stuck table:
  // the viewer has just played their last card, the hand is already gone, and
  // the table's own description has not caught up for a tick. The
  // play-or-pass invariant below is about a hand that still has cards in it —
  // asserting it here turns a finished game into a failure. Handing back null
  // lets the caller's isFinished check see the game-over overlay.
  if (labels.length === 0) return null;

  function cardByLabel(label: string): Locator {
    return page.locator(`${HAND_CARDS}${labelSelector(label)}`);
  }

  async function click(locator: Locator): Promise<boolean> {
    try {
      await locator.click({ timeout: CARD_CLICK_TIMEOUT_MS });
      // Selecting a card runs a haptic call, a sound, and a Reanimated pop;
      // clicking the next candidate before React has flushed the resulting
      // state update is how a select and its own deselect end up racing
      // each other and a card is left selected across attempts.
      await sleep(80);
      return true;
    } catch {
      return false;
    }
  }

  // Diffs the requested selection against what is actually still selected
  // from the previous attempt, rather than blindly deselecting-then-
  // reselecting from scratch — so a click that silently failed to toggle
  // leaves a card correctly tracked as still selected instead of being
  // assumed clear.
  //
  // Carried over from the previous turn, intersected with the hand that is
  // there now: a selection survives an opponent's turn (the app no longer
  // wipes it), so an early return on a click timeout leaves cards lit that a
  // fresh, empty tracker would add targets on top of — building a combination
  // the bot never meant to offer and, when leading, one it cannot pass out of.
  // The app itself drops a staged id the hand no longer holds, which is why the
  // intersection is the honest starting point rather than a guess.
  let selected = (stagedSelection.get(page) ?? []).filter((l) => labels.includes(l));
  function setStaged(next: string[]): void {
    selected = next;
    stagedSelection.set(page, next);
  }
  setStaged(selected);

  async function setSelection(target: string[]): Promise<boolean> {
    for (const l of selected) {
      if (target.includes(l)) continue;
      if (!(await click(cardByLabel(l)))) return false;
      setStaged(selected.filter((x) => x !== l));
    }
    for (const l of target) {
      if (selected.includes(l)) continue;
      if (!(await click(cardByLabel(l)))) return false;
      setStaged([...selected, l]);
    }
    return true;
  }

  async function tryCombo(cardLabels: string[]): Promise<"played" | "no" | "gone"> {
    if (!(await setSelection(cardLabels))) return "gone";
    const label = await giocaBtn.getAttribute("aria-label").catch(() => null);
    if (label === GIOCA_VALID_LABEL) {
      if (!(await click(giocaBtn))) return "gone";
      setStaged([]); // the play succeeded — the hand itself is about to change entirely
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
    throw new StuckError(
      `No combination in hand [${labels.join(", ")}] satisfies GIOCA, and PASSA is disabled — the rules guarantee one of those always holds.`
    );
  }
  if (!(await click(passBtn))) return null;
  return "passed";
}

// The valid giveback ranks (docs/RULES.md §10: rank 3 through 10). Matching
// on this — rather than excluding known UI chrome by label — means the
// selector can't accidentally land on an unrelated button such as the
// top-bar quit control, whatever its label happens to be.
const GIVEBACK_CARD_LABEL = /^(3|4|5|6|7|8|9|10) di (Fiori|Cuori|Quadri|Picche)$/;

/**
 * Gives back a card during the between-hands exchange (docs/RULES.md §10).
 *
 * The winner's hand renders underneath the modal, so the same
 * accessibilityLabel exists twice: once inside `[data-testid="game-table"]`,
 * once in the modal, which GameTable renders as a *sibling* of the table.
 * Excluding the table testid leaves the modal's copy.
 *
 * The click handler sits on the `<button>` ancestor, matched through
 * Chromium's accessibility tree rather than the DOM: react-native-web turns
 * `accessibilityRole="button"` into a literal `<button>`, and two cannot
 * legally nest, so the parser's treatment of that nesting is not bettable.
 */
async function giveExchangeCandidateCount(page: Page): Promise<number> {
  const candidates = page.locator(`[aria-label]:not(${TABLE} [aria-label])`);
  const labels = (await candidates.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  )) as string[];
  return labels.filter((l) => GIVEBACK_CARD_LABEL.test(l)).length;
}

const EXCHANGE_CONFIRM = '[data-testid="exchange-confirm"]';

/**
 * The modal is select-then-confirm: clicking a card only picks it, and the
 * give happens on the confirm control. Both clicks are needed, in that order.
 *
 * Watch for: the confirm is disabled until a card is picked, so a confirm that
 * does nothing means the card click missed. The candidate count dropping is
 * what proves the give landed — a click that silently missed the gesture
 * responder throws nothing.
 */
async function giveExchangeCard(page: Page): Promise<boolean> {
  const before = await giveExchangeCandidateCount(page);
  if (before === 0) return false;

  const candidates = page.locator(`[aria-label]:not(${TABLE} [aria-label])`);
  const labels = (await candidates.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  )) as string[];

  for (let i = labels.length - 1; i >= 0; i--) {
    if (!GIVEBACK_CARD_LABEL.test(labels[i])) continue;
    // The label sits on SelectableCard's own Pressable, so the matched element
    // is the control itself and a real click lands on it directly.
    for (let attempt = 0; attempt < 3; attempt++) {
      await candidates
        .nth(i)
        .click({ timeout: CARD_CLICK_TIMEOUT_MS })
        .catch(() => {});
      await sleep(250);
      await page
        .locator(EXCHANGE_CONFIRM)
        .click({ timeout: CARD_CLICK_TIMEOUT_MS })
        .catch(() => {});
      await sleep(250);
      if ((await giveExchangeCandidateCount(page)) < before) return true;
    }
  }
  return false;
}

/**
 * The rematch prompt (GameTable's `RematchPromptSlot`) is asked as a
 * non-blocking side panel while the closing hand of a match is still being
 * played, independent of whose turn it is. Always declining keeps a driven
 * match bounded — otherwise how many hands a test plays would depend on how
 * the AI seats vote.
 */
async function declineRematchPromptIfShown(page: Page): Promise<void> {
  const no = page.locator('[data-testid="btn-rematch-no"]');
  if ((await no.count()) > 0 && (await no.isVisible())) {
    await no.click();
  }
}

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
  // A hand ends when someone runs out, so cards leaving hands is the only
  // progress there is. Legitimately it pauses for a round of passes and the
  // turn churn around it — a handful of states; this sits an order above that.
  const maxStatesWithoutProgress = opts.maxStatesWithoutProgress ?? 100;
  // Generous relative to a normal turn (a few seconds, measured, with
  // EXPO_PUBLIC_E2E_FAST and reduced motion both active) without being so
  // tight that one slow AI response false-positives a healthy game.
  const stallMs = opts.stallMs ?? 15_000;
  const log = opts.log ?? (() => {});

  let lastDesc = "";
  let lastChangeAt = Date.now();
  let progress = NO_PROGRESS_YET;

  for (;;) {
    if (await opts.isFinished(page)) return;

    await declineRematchPromptIfShown(page);

    const desc = await tableDescription(page);
    if (desc === null) {
      await sleep(200);
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

    if (desc.startsWith(EXCHANGE_GIVE_PREFIX)) {
      const gaveCard = await giveExchangeCard(page);
      if (gaveCard) {
        log(`exchange: gave back a card (${desc})`);
        const changed = await waitForChange(page, desc, stallMs);
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
      const action = await playOrPass(page, desc);
      if (action === null) {
        // The hand stopped being interactive mid-search — most often the
        // one-tick "your turn" / gameOver race described above `playOrPass`.
        // Let the next iteration's isFinished/description check decide what
        // actually happened rather than asserting anything here.
        await sleep(150);
        continue;
      }
      log(`${action} (was: "${desc}")`);
      const changed = await waitForChange(page, desc, stallMs);
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

    await sleep(150);
  }
}

/**
 * Waits for the table's description to differ from `previous`, or for the
 * table to disappear entirely (a full navigation away — e.g. to /result —
 * counts as progress on its own).
 */
async function waitForChange(page: Page, previous: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const desc = await tableDescription(page);
    if (desc === null || desc !== previous) return true;
    await sleep(100);
  }
  return false;
}

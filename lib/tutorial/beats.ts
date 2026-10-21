import {
  type Card,
  type Suit,
  type Rank,
  type CombinationType,
  type GameState,
  type ExchangePhase,
  type TableDemand,
  buildCombination,
  getCardDisplayRank,
  getSuitSymbol,
  getValidGivebackCards,
  actingSeat,
  applyMove,
  emptyRankTally,
} from "../game/gameEngine.ts";
import type { TFn, TranslationKey } from "../i18n.ts";
import { readStagedPlay, type PlayButtonLabel, type StagedPlay } from "../table/stagedPlay.ts";
import { playRefusalLabel } from "../table/playRefusal.ts";

/** The tutorial's own sentence for a refusal the staged play reports; one with none gets the game's. */
export const TUTORIAL_REFUSAL_KEYS: Partial<Record<PlayButtonLabel, TranslationKey>> = {
  notACombination: "tutorial.errNotAValidCombo",
  royalUnbeatable: "tutorial.errRoyalBeatsAll",
  bombOnly: "tutorial.errOnlyHigherBomb",
  wrongType: "tutorial.errSameType",
  wrongLength: "tutorial.errSameLength",
  tooLow: "tutorial.errTooWeak",
};

// Every card is a literal, so each beat always matches what the player holds.
// Ids need only be unique within one beat; the same card recurs across beats.
function mk(rank: Exclude<Rank, "joker_bw" | "joker_colored">, suit: Suit): Card {
  return { id: `${rank}_${suit}`, suit, rank, isJoker: false };
}
const JOKER_COLORED: Card = { id: "joker_colored", suit: null, rank: "joker_colored", isJoker: true };

const TYPE_LABEL_KEYS: Record<CombinationType, TranslationKey> = {
  single: "tutorial.typeSingle",
  pair: "tutorial.typePair",
  triple: "tutorial.typeTriple",
  straight: "tutorial.typeStraight",
  bomb: "tutorial.typeBomb",
  royal_straight: "tutorial.typeRoyalStraight",
};

// InfoBeat and CompleteBeat stay two interfaces: narrowing on `kind` needs one literal tag per member.
export interface InfoBeat {
  kind: "info";
  id: string;
  title: string;
  body: string[];
  cta: string;
  /** Runs the table's own turn clock under the text, from this many seconds. */
  clockSeconds?: number;
}

export interface CompleteBeat {
  kind: "complete";
  id: string;
  title: string;
  body: string[];
  cta: string;
}

export interface PlayBeat {
  kind: "play";
  id: string;
  title: string;
  instruction: string;
  tip?: string;
  handCards: Card[];
  demand: TableDemand;
  expectedType: CombinationType;
  highlightIds: string[];
  opponentLabel?: string;
  successNarrative: string;
  /** Says, as cards are picked up, whether the selection would go — the table's staging. */
  staged?: boolean;
  /** Nothing in hand beats the table: the answer is Pass. */
  passes?: boolean;
}

export type OpenExchangeState = GameState & { exchangePhase: Extract<ExchangePhase, { kind: "open" }> };

export interface ExchangeBeat {
  kind: "exchange";
  id: string;
  title: string;
  instruction: string;
  tip: string;
  state: OpenExchangeState;
  successNarrative: string;
}

export type Beat = InfoBeat | PlayBeat | ExchangeBeat | CompleteBeat;

const threeSpades = mk("3", "spades");

const respondLastPlayed = buildCombination([mk("6", "spades")])!;

const bombLastPlayed = buildCombination([
  mk("7", "diamonds"),
  mk("8", "spades"),
  mk("9", "hearts"),
  mk("10", "clubs"),
  mk("J", "diamonds"),
])!;

const royalLastPlayed = buildCombination([
  mk("5", "spades"),
  mk("5", "hearts"),
  mk("5", "diamonds"),
  mk("5", "clubs"),
])!;

const passLastPlayed = buildCombination([mk("2", "spades")])!;
const stageLastPlayed = buildCombination([mk("7", "spades"), mk("7", "hearts")])!;
const CLOCK_DEMO_SECONDS = 10;

const exchangeWinnerCard = mk("5", "diamonds");
const exchangeDeadCard = mk("K", "clubs");
const exchangeThreeHearts = mk("3", "hearts");
// Rebuilt per render: the player's name is translated, and the locale is not known at import.
function buildExchangeState(t: TFn): OpenExchangeState {
  return {
    players: [
      {
        id: "player_0",
        name: t("tutorial.you"),
        hand: [JOKER_COLORED, exchangeWinnerCard, exchangeDeadCard, exchangeThreeHearts],
        type: "human",
      },
      {
        id: "player_1",
        name: "Dea",
        hand: [mk("4", "spades"), mk("7", "spades")],
        type: "bot",
      },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    playedRanks: emptyRankTally(),
    lastMove: { seq: 0, kind: "deal" },
    exchangePhase: { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: JOKER_COLORED },
  };
}

export function buildBeats(t: TFn): Beat[] {
  return [
    {
      kind: "info",
      id: "welcome",
      title: t("tutorial.beat.welcome.title"),
      body: [
        t("tutorial.beat.welcome.body1"),
        t("tutorial.beat.welcome.body2"),
        t("tutorial.beat.welcome.body3"),
      ],
      cta: t("tutorial.beat.welcome.cta"),
    },
    {
      kind: "play",
      id: "open",
      title: t("tutorial.beat.open.title"),
      instruction: t("tutorial.beat.open.instruction"),
      handCards: [threeSpades, mk("4", "diamonds"), mk("7", "hearts")],
      demand: { toBeat: null, mustInclude: threeSpades },
      expectedType: "single",
      highlightIds: [threeSpades.id],
      successNarrative: t("tutorial.beat.open.successNarrative"),
    },
    {
      kind: "play",
      id: "respond",
      title: t("tutorial.beat.respond.title"),
      instruction: t("tutorial.beat.respond.instruction"),
      tip: t("tutorial.beat.respond.tip"),
      handCards: [mk("5", "hearts"), mk("6", "hearts"), mk("9", "clubs"), mk("2", "diamonds")],
      demand: { toBeat: respondLastPlayed, mustInclude: null },
      expectedType: "single",
      highlightIds: [],
      opponentLabel: t("tutorial.beat.respond.opponentLabel"),
      successNarrative: t("tutorial.beat.respond.successNarrative"),
    },
    {
      kind: "play",
      id: "pass",
      title: t("tutorial.beat.pass.title"),
      instruction: t("tutorial.beat.pass.instruction"),
      tip: t("tutorial.beat.pass.tip"),
      handCards: [mk("4", "diamonds"), mk("8", "clubs"), mk("J", "hearts"), mk("A", "clubs")],
      demand: { toBeat: passLastPlayed, mustInclude: null },
      expectedType: "single",
      highlightIds: [],
      opponentLabel: t("tutorial.beat.pass.opponentLabel"),
      successNarrative: t("tutorial.beat.pass.successNarrative"),
      passes: true,
    },
    {
      kind: "info",
      id: "clock",
      title: t("tutorial.beat.clock.title"),
      body: [t("tutorial.beat.clock.body1"), t("tutorial.beat.clock.body2")],
      cta: t("tutorial.beat.clock.cta"),
      clockSeconds: CLOCK_DEMO_SECONDS,
    },
    {
      kind: "play",
      id: "pair",
      title: t("tutorial.beat.pair.title"),
      instruction: t("tutorial.beat.pair.instruction"),
      handCards: [mk("8", "hearts"), mk("8", "diamonds"), mk("5", "clubs"), mk("4", "clubs")],
      demand: { toBeat: null, mustInclude: null },
      expectedType: "pair",
      highlightIds: [],
      successNarrative: t("tutorial.beat.pair.successNarrative"),
    },
    {
      kind: "play",
      id: "stage",
      title: t("tutorial.beat.stage.title"),
      instruction: t("tutorial.beat.stage.instruction"),
      tip: t("tutorial.beat.stage.tip"),
      handCards: [mk("6", "hearts"), mk("6", "clubs"), mk("9", "diamonds"), mk("9", "spades"), mk("4", "clubs")],
      demand: { toBeat: stageLastPlayed, mustInclude: null },
      expectedType: "pair",
      highlightIds: [],
      opponentLabel: t("tutorial.beat.stage.opponentLabel"),
      successNarrative: t("tutorial.beat.stage.successNarrative"),
      staged: true,
    },
    {
      kind: "play",
      id: "triple",
      title: t("tutorial.beat.triple.title"),
      instruction: t("tutorial.beat.triple.instruction"),
      handCards: [mk("J", "clubs"), mk("J", "diamonds"), mk("J", "hearts"), mk("3", "diamonds"), mk("6", "clubs")],
      demand: { toBeat: null, mustInclude: null },
      expectedType: "triple",
      highlightIds: [],
      successNarrative: t("tutorial.beat.triple.successNarrative"),
    },
    {
      kind: "play",
      id: "straight",
      title: t("tutorial.beat.straight.title"),
      instruction: t("tutorial.beat.straight.instruction"),
      handCards: [
        mk("5", "spades"),
        mk("6", "diamonds"),
        mk("7", "clubs"),
        mk("8", "clubs"),
        mk("9", "diamonds"),
        mk("2", "clubs"),
      ],
      demand: { toBeat: null, mustInclude: null },
      expectedType: "straight",
      highlightIds: [],
      successNarrative: t("tutorial.beat.straight.successNarrative"),
    },
    {
      kind: "play",
      id: "bomb",
      title: t("tutorial.beat.bomb.title"),
      instruction: t("tutorial.beat.bomb.instruction"),
      tip: t("tutorial.beat.bomb.tip"),
      handCards: [mk("K", "spades"), mk("K", "hearts"), mk("K", "diamonds"), mk("K", "clubs"), mk("A", "clubs")],
      demand: { toBeat: bombLastPlayed, mustInclude: null },
      expectedType: "bomb",
      highlightIds: [],
      opponentLabel: t("tutorial.beat.bomb.opponentLabel"),
      successNarrative: t("tutorial.beat.bomb.successNarrative"),
    },
    {
      kind: "play",
      id: "royal",
      title: t("tutorial.beat.royal.title"),
      instruction: t("tutorial.beat.royal.instruction"),
      tip: t("tutorial.beat.royal.tip"),
      handCards: [
        mk("8", "spades"),
        mk("9", "spades"),
        mk("10", "spades"),
        mk("J", "spades"),
        mk("Q", "spades"),
        mk("Q", "hearts"),
      ],
      demand: { toBeat: royalLastPlayed, mustInclude: null },
      expectedType: "royal_straight",
      highlightIds: [],
      opponentLabel: t("tutorial.beat.royal.opponentLabel"),
      successNarrative: t("tutorial.beat.royal.successNarrative"),
    },
    {
      kind: "exchange",
      id: "exchange",
      title: t("tutorial.beat.exchange.title"),
      instruction: t("tutorial.beat.exchange.instruction"),
      tip: t("tutorial.beat.exchange.tip"),
      state: buildExchangeState(t),
      successNarrative: t("tutorial.beat.exchange.successNarrative"),
    },
    {
      kind: "complete",
      id: "done",
      title: t("tutorial.beat.done.title"),
      body: [
        t("tutorial.beat.done.body1"),
        t("tutorial.beat.done.body2"),
        t("tutorial.beat.done.body3"),
      ],
      cta: t("tutorial.beat.done.cta"),
    },
  ];
}

export function stageBeat(beat: PlayBeat, selectedIds: Set<string>): StagedPlay {
  return readStagedPlay({
    hand: beat.handCards,
    selectedIds: [...selectedIds],
    demand: beat.demand,
    isMyTurn: true,
    isFinished: false,
  });
}

function refusalMessage(staged: StagedPlay, demand: TableDemand, t: TFn): string {
  const required = demand.mustInclude;
  if (staged.refusal === "needsStartCard" && required) {
    return t("tutorial.errMustIncludeCard", {
      rank: getCardDisplayRank(required.rank),
      suit: getSuitSymbol(required.suit),
    });
  }
  const key = TUTORIAL_REFUSAL_KEYS[staged.refusal];
  return key
    ? t(key)
    : playRefusalLabel(
        { refusal: staged.refusal, isMyTurn: true, isFinished: false, openingCard: null },
        t
      );
}

export function evaluatePlay(selectedIds: Set<string>, beat: PlayBeat, t: TFn): { ok: boolean; message: string } {
  if (selectedIds.size === 0) {
    return { ok: false, message: t("tutorial.errSelectAtLeastOne") };
  }

  const staged = stageBeat(beat, selectedIds);
  if (!staged.playable) {
    return { ok: false, message: refusalMessage(staged, beat.demand, t) };
  }

  const combo = buildCombination(staged.cards)!;
  if (combo.type !== beat.expectedType) {
    return {
      ok: false,
      message: t("tutorial.errWrongExpectedType", { type: t(TYPE_LABEL_KEYS[beat.expectedType]) }),
    };
  }

  return { ok: true, message: beat.successNarrative };
}

export function stagedLine(beat: PlayBeat, selectedIds: Set<string>, done: boolean, t: TFn): string | null {
  if (!beat.staged || done || selectedIds.size === 0) return null;
  const staged = stageBeat(beat, selectedIds);
  return staged.playable
    ? t("tutorial.stagedReady")
    : t("tutorial.stagedBlocked", {
        reason: playRefusalLabel({ refusal: staged.refusal, isMyTurn: true, isFinished: false, openingCard: null }, t),
      });
}

export function playEnabled(beat: PlayBeat, selectedIds: Set<string>): boolean {
  return selectedIds.size > 0 && (!beat.staged || stageBeat(beat, selectedIds).playable);
}

export function exchangeHand(beat: ExchangeBeat): { hand: Card[]; receivedId: string } {
  const { winnerIdx, cardFromLoser } = beat.state.exchangePhase;
  return { hand: beat.state.players[winnerIdx].hand, receivedId: cardFromLoser.id };
}

export function evaluateExchange(selectedIds: Set<string>, beat: ExchangeBeat, t: TFn): { ok: boolean; message: string } {
  const { hand, receivedId } = exchangeHand(beat);
  const selected = hand.find((c) => selectedIds.has(c.id));
  if (!selected) return { ok: false, message: t("tutorial.errSelectCardToReturn") };
  if (!getValidGivebackCards(hand, receivedId).some((c) => c.id === selected.id)) {
    return { ok: false, message: t(selected.id === receivedId ? "tutorial.errJustReceived" : "tutorial.errExchangeRange") };
  }
  if (applyMove(beat.state, actingSeat(beat.state), { kind: "giveback", cardId: selected.id }).ok) {
    return { ok: true, message: beat.successNarrative };
  }
  return { ok: false, message: t("tutorial.errExchangeGeneric") };
}

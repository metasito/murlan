// The one presentational game table.
//
// app/game.tsx (offline, local engine) and app/(online)/game.tsx (online,
// server-authoritative socket state) were ~2,400 lines of parallel
// implementation of this. They are now thin adapters: each maps its own state
// source onto `GameTableProps` and passes its own extras through the slots.
// Nothing below knows or cares which mode it is running in.

import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Platform,
  type AccessibilityProps,
  type GestureResponderEvent,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import * as ScreenOrientation from "expo-screen-orientation";
import type { NativeStackNavigationProp } from "expo-router";
import { NavigationContext, type ParamListBase } from "expo-router/react-navigation";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  getCardDisplayRank,
  getSuitSymbol,
  getValidGivebackCards,
  givebackIsFallback,
  mancheUnplayed,
  openingIsPending,
  sortHand,
  type Card,
  type GameState,
  type StartReason,
} from "@/lib/game/gameEngine";
import { buildExchangeAnnounce, type ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import type { LegStage } from "@/lib/game/exchangeTimeline";
import {
  CHIP_H,
  HAND_ZONE_H,
  handVisibleH,
  actionBtnSize,
  HAND_ZONE_GAP,
  arrangeOpponents,
  seatDirection,
  viewerOwnsSeat,
} from "@/components/seatLayout";
import { handCountOf, vacatedOf } from "@/shared/protocol";
import type { CardFrom } from "@/components/flightPose";
import { NO_LANDING, type LandingSignal } from "@/components/table/useFlightClock";
import {
  anchorPoints,
  comboKey,
  JOKERS,
  NO_STAGES,
  readExchange,
  readTradeSeats,
  floatTop,
  seatsJustPassed,
  tableGeometry,
  tradeKey,
  type TradeStages,
} from "@/components/flightPhysics";
import { FloatSlot, type Float } from "@/components/table/notices/floats";
import type { ServerError } from "@/context/OnlineGameContext";
import { EndMatchVote, MancheVote, type EndMatchVoteNote, type MancheVoteNote } from "@/components/table/notices/netNotes";
import { mockupPx } from "@/components/table/noticeModel";
import { WaitingLine } from "@/components/table/notices/tableLines";
import { ExchangeLegs, type LegName, type RingFlash } from "@/components/table/ExchangeLegs";
import { canPassNow as canPassNowOf, turnTimerActive } from "@/components/turnTimerUi";
import { computeTableFrame, sideSlotHeight, topBandHeight } from "@/components/tableFrame";
import { describeTableForA11y, type TableA11yExchange, type TableA11yLastPlay, type TableA11yOpponent } from "@/components/tableA11y";
import {
  BASE_SHORT_EDGE,
  CARD_H,
  cardScale,
  HAND_SCALE,
  physicalTouchTarget,
} from "@/components/cardFaceModel";
import { ScorePill } from "@/components/table/scorePill";
import type { PartitaBoardActions } from "@/components/table/partitaBoard";
import { partitaDim } from "@/lib/game/partitaEnding";
import { MOCKUP_SHORT_EDGE, scorePillBox, scorePillHitBox } from "@/components/table/scorePillModel";
import { scorePillStandings } from "@/lib/game/scorePill";
import { useTranslation } from "@/lib/i18n";
import { HudComboPill, TurnChip, type ConnectionNote } from "@/components/table/notices/hud";
import { useDeviceOffline, useTableClaim } from "@/components/OfflineBanner";
import {
  ControlRail,
  useFocusFade,
  useHandLift,
  RailKnob,
  sharedTableStyles,
  harnessState,
} from "@/components/table/chrome";
import { WhoStartsPanel } from "@/components/table/notices/panels";
import {
  arrangedLabel,
  lastPlayLabel,
  tableStrings,
  topBarLabel,
} from "@/components/table/spokenLabels";
import { canBeatPileOf } from "@/components/table/stagedPlay";
import {
  createSelectionStore,
  press,
  settle,
  type Selection,
  type SelectionMode,
} from "@/components/table/selection";
import { useSelection } from "@/components/table/useSelection";
import { GiocaControl, HandStatus, settledSelection } from "@/components/table/selectionLeaves";
import { PassaButton } from "@/components/table/actions";
import { Felt } from "@/components/table/feltSkia";
import { useLampRig } from "@/components/table/useLampRig";
import { useLinkHold } from "@/components/table/useLinkHold";
import type { OwnLink } from "@/lib/ownLink";
import { CardTableProvider, useCardTableValue } from "@/components/table/useCardRects";
import { lampPools } from "@/components/table/lampRig";
import { useTableTimeline } from "@/components/table/tableTimeline";
import { useMancheEnding } from "@/components/table/useMancheEnding";
import { mancheVoteShown } from "@/lib/game/mancheEnding";
import { ParticleLayer } from "@/components/table/particleLayer";
import { StraightHand, useHandArrival } from "@/components/table/hand";
import { RotateOverlay } from "@/components/table/rotateOverlay";
import { GameSettingsSheet } from "@/components/table/settingsSheet";
import { useShownTurn, useTableFeedback } from "@/components/useTableFeedback";
import { useHandOrder } from "@/components/useHandOrder";
import { useSameCards } from "@/components/useSameCards";
import { PileLayer, getComboLabel, usePileFlight } from "@/components/table/pile";
import { topPlay } from "@/components/table/trick";
import { warmCardArt } from "@/components/CardView";
import { BombBurst, BombFlash, FeltScrim, LampLift, Sweep } from "@/components/table/moments";
import { TopOppSlot, SideOppSlot, usePassedSeats } from "@/components/table/seats";
import { CardCastContext, useCardCast, useFeltReady } from "@/components/table/feltReady";
import { restingCast } from "@/components/table/cardShadows";
import { DealFlights, useDeal, useDealBreath } from "@/components/table/deal";
import { dealSpecks, type ParticleEmitter } from "@/components/table/particles";
import { traceOnset } from "@/lib/e2eTrace";
import { event, uiFeedback } from "@/lib/device/feedback";
import { useOrientedWindow, usePortraitInterface } from "@/lib/device/orientation";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import {
  Colors,
  motionMs,
  Layer,
  TOUCH_TARGET_MIN,
} from "@/lib/theme";
import { useTableFelt } from "@/lib/cosmetics";
import { A11yStatus, A11yVeil, a11yGroup, a11yHidden, a11yVeiled } from "@/lib/a11y";
import { useBenchHandle, useOrientationRows } from "@/lib/diagnostics";
import nativeOrientation from "@/modules/murlan-orientation";

// Whole-pixel travel, mirroring components/MenuButton.tsx: PASSA/GIOCA hold
// text labels, and React Native rasterises text before transforming it, so a
// fractional offset resamples the glyphs. 2px down is the smallest offset
// that still reads as a press.

/**
 * The hand runs past the bottom edge on purpose, and the side fans lean out
 * past their columns. `overflow: hidden` hides all of that but still leaves a
 * scrollable box, and the browser scrolls a tapped card into view — sliding
 * the whole table off the screen. `overflow: clip` clips without creating one.
 * Native has no such box to begin with, and does not know the value.
 */
const WEB_CLIP =
  Platform.OS === "web" ? ({ overflow: "clip" } as unknown as ViewStyle) : null;

/** The banner band sits over the felt. */
const BANNER_BAND_Z = Layer.band;
/** G2: the end-match vote's top, under the score pill at rest. */
const VOTE_BELOW_PILL = 7;
/**
 * The felt is decoration and everything else is the game, so the game is
 * always on top. Stated rather than left to sibling order: the pool paints
 * over the seats, the pile and the hand on the iOS renderer, which draws that
 * subtree above them however the tree is written (#209).
 *
 * They are the root's only two children, and the pair is what keeps the felt
 * covering the window: `kickStyle` rides the upper one, so the cloth the game
 * is played on never leaves the viewport whatever the landing displaces.
 */
const FELT_Z = { zIndex: Layer.felt } as const;
const TABLE_Z = { zIndex: Layer.table } as const;
const RAIL_Z = { zIndex: Layer.rail } as const;
/**
 * The turn chip while the opening gate holds the table. Online the deadline is
 * the server's and keeps running under the hold, so the countdown rides over it
 * rather than being covered by it.
 */
const HELD_CLOCK_Z = { zIndex: Layer.clock } as const;

const passView = (s: GameState) => ({ ...s, outOfCards: s.players.map((p) => handCountOf(p) === 0) });
const raised = (standing: Float | null, kind: Float["kind"], text: string, live = true): Float => ({
  id: (standing?.id ?? 0) + 1,
  kind,
  text,
  live,
});

const NO_DISMISS = () => {};
const roundStart = () => event([{ kind: "roundStart" }]);

const lockLandscape = () => {
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  nativeOrientation?.holdLandscape().catch(() => {});
};

export interface TurnTimerConfig {
  /** Length of the countdown, in seconds. */
  seconds: number;
  /**
   * Restarts the countdown when it changes, on top of the turn itself. Online
   * the server re-arms its window on paths that change no state — a rejoin,
   * a disconnect — and the clock has to follow.
   */
  resetKey?: string;
  /**
   * The viewer's own chip counts down while leading a new round too (seat rings
   * always do). False offline, no deadline; true online, armed every turn.
   */
  includeNewRound?: boolean;
  /**
   * Called when the countdown reaches zero. Offline this auto-passes locally;
   * online it is omitted, because the server owns the timeout and the client
   * countdown is only a display of it.
   */
  onExpire?: () => void;
  /**
   * Whether this client owns the deadline, and may therefore stop the clock
   * while an announcement is holding the table. True offline. False online:
   * the server's AFK window keeps running whatever the client draws, so a
   * pause here would show a seat more time than it has.
   */
  pausable?: boolean;
}

export interface ExchangeAnnouncementSlot {
  visible: boolean;
  data: ExchangeAnnounceData | null;
  onDismiss: () => void;
  /** Offline-only E2E override for how long the overlay holds (#915). */
  holdMsOverride?: number;
}

export interface GameTableProps {
  /**
   * The game, from whichever authority owns it. Offline this is the local
   * engine's state; online it is the server's, sanitized for this viewer
   * (opponents' hands blanked, `handCount` shipped alongside).
   */
  gameState: GameState;
  /**
   * Whether the *match* — the partita, not this hand — is over. `MatchVerdict.over`
   * offline, `matchState.over` online: the same landing that empties a hand can
   * also be the one that closes the match, so this is read alongside
   * `gameState.gameOver` at the moment a play lands, never inferred from it.
   * Defaults false: replay, capture and reaction-preview callers hold no match.
   */
  matchOver?: boolean;
  matchWinners?: readonly string[];
  /**
   * What the manche just played awarded, by engine player id — the score
   * pill's gains, fed to the table's own win/lose sting via `handOutcomeFor`. Defaults empty
   * for the same callers `matchOver` defaults false for: with no scores to
   * read, the sting simply stays silent rather than guessing.
   */
  handScores?: Record<string, number>;
  /**
   * The partita's running points by engine player id, and the target they race to — what
   * the score pill shows. Absent in a replay. A `single` manche shows the pill only as its board.
   */
  matchScore?: { scores: Record<string, number>; target: number; single?: boolean };
  /** Present where a partita ends on the table: the score pill becomes the board, with these. */
  partitaActions?: PartitaBoardActions;
  /** Seat the table is drawn from. Always rendered at the bottom. */
  viewerSeat: number;
  /**
   * Watching, not playing. The bottom seat belongs to someone else, so its
   * cards are drawn face-down from `handCount` and the actions are absent.
   * An explicit prop rather than a null `viewerSeat`, which is read in a dozen
   * places and would put a branch in each of them.
   */
  spectating?: boolean;

  /** Only ever called with a selection that is a legal play. */
  onPlay: (cardIds: string[]) => void;
  onPass: () => void;
  onQuit: () => void;
  onExchangeGive: (cardId: string) => void;
  /** The exchange's choice opens: the received card has landed and been read. The offline bot winner gives on it. */
  onExchangeReady?: () => void;
  /**
   * Present where a manche ends on the table: the score pill's payoff runs, and this hears the
   * landing that ended it, which the next deal is timed from (`MancheEnding.deal`).
   */
  onMancheLanded?: (landsAt: number) => void;

  turnTimer?: TurnTimerConfig;
  exchangeAnnouncement?: ExchangeAnnouncementSlot;
  /**
   * Seats mid disconnect grace, by seat — the countdown for the whole 60 s
   * window (docs/GAME-RULES.md § Decisions), driven from the server's own `seconds` the
   * same way `turnTimer` is. Empty offline, which disconnects nobody.
   */
  disconnectedSeats?: Record<number, { seconds: number; resetKey: string }>;

  /** The rail's lower knob (online: the reactions trigger). */
  railExtra?: React.ReactNode;
  /** Transient strips under the top bar (the replay's transport). */
  banners?: React.ReactNode;
  /** The server's refusal, floated while it stands (online only). */
  error?: ServerError | null;
  /** How many times the viewer's turn was passed for them: each new count floats the pass under its own title. */
  autoPassed?: number;
  /** The vote to end a match a seat has left, under the score pill (online only). */
  endMatchVote?: EndMatchVoteNote | null;
  /** Present where the next deal waits on a vote: the manche's ending holds the pill open with this at its foot. */
  mancheVote?: MancheVoteNote | null;
  /** The online connection, carried by the turn pill; the device being offline outranks it. Left out, the table needs no network and shows neither. */
  connection?: ConnectionNote | null;
  /** The table is being replayed after a reconnect: a throw takes the catch-up timing. */
  catchUp?: boolean;
  /** The viewer's own link; anything but `up` holds the table (#1268). */
  ownLink?: OwnLink;
  /**
   * Full-screen layers above the table (game over, error toasts, waiting states).
   *
   * Takes the veil rather than returning plain nodes: whether the settings
   * sheet is open is this component's own state, and a layer that renders a
   * `<Modal>` is above the veil while one that does not is behind it — which
   * only the caller knows.
   */
  overlays?: (veiled: AccessibilityProps) => React.ReactNode;

  /**
   * A layer in `overlays` covers the table and the player may not act. It
   * withdraws what is under it, and not the slot it is rendered in.
   */
  tableCovered?: boolean;
}

// ─── GameTable ────────────────────────────────────────────────────────────────

export function GameTable({
  gameState,
  matchOver = false,
  matchWinners,
  handScores = {},
  matchScore,
  partitaActions,
  viewerSeat,
  spectating = false,
  onPlay,
  onPass,
  onQuit,
  onExchangeGive,
  onExchangeReady,
  onMancheLanded,
  turnTimer,
  exchangeAnnouncement,
  disconnectedSeats = {},
  railExtra,
  banners,
  error = null,
  autoPassed = 0,
  endMatchVote = null,
  mancheVote = null,
  connection,
  catchUp = false,
  ownLink = "up",
  overlays,
  tableCovered = false,
}: GameTableProps) {
  const { t, tn } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useContext(NavigationContext) as NativeStackNavigationProp<ParamListBase> | undefined;
  const { width: W, height: H } = useOrientedWindow();
  const portrait = usePortraitInterface();
  // The window's own short edge, so a phone and a browser at the same size draw the same
  // table. The safe area is the layout's job — the rail absorbs the cutout and the hand zone
  // carries the home indicator — and taking it off here instead shrinks the cards on device
  // only, which is the divergence from the web design, not a fit for it.
  const scale = cardScale(Math.min(W, H));
  const handCardH = CARD_H(scale * HAND_SCALE);
  // What the player sees of a hand card, and how tall PASSA and GIOCA are —
  // the row reads as one band even though only the cards are cropped.
  const actionBtn = actionBtnSize(scale);
  const knobSize = physicalTouchTarget(scale);
  const reduceMotion = usePrefersReducedMotion();
  const felt = useTableFelt();
  const deviceOffline = useDeviceOffline();
  const connectionNote: ConnectionNote | null =
    connection === undefined ? null : deviceOffline ? { state: "offline", text: t("offlineBanner.text") } : connection;

  // Whether the rail's settings sheet is open, and the two toggles it owns
  // that live nowhere else: focus mode and the left-handed swap are a
  // session's own choice, not a stored preference — sound, music and
  // vibration are the persisted ones, which the sheet reads for itself.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  // Who opens the manche, held over the table for as long as that opening has
  // yet to be played. The opening ending is what turns the sentence into a
  // statement about the past, so it is a condition of showing it at all rather
  // than something a timer happens to outrun.
  const startReason = gameState.startReason;
  const openingPending =
    openingIsPending(gameState) &&
    // The exchange ceremony owns the table first; the two sequence rather than
    // stacking, and this is the second of them.
    exchangeAnnouncement?.visible !== true;
  const [openingSpent, setOpeningSpent] = useState(false);
  // Spent for this opening only, and cleared by the opening itself passing —
  // the play that ends it, or the deal that replaces it. Online this component
  // is never unmounted between manches, and nothing in the state names which
  // manche is which, so a flag that outlived the opening would swallow the next
  // one whenever two deals ran the same way.
  const [spentForPending, setSpentForPending] = useState(openingPending);
  if (openingPending !== spentForPending) {
    setSpentForPending(openingPending);
    if (!openingPending) setOpeningSpent(false);
  }
  const holdingForStart = openingPending && !openingSpent;

  // A reader must not be left able to play through a gate a finger cannot get
  // past, so the hold sits beside the other two reasons the table is unusable.
  const covered = tableCovered || portrait;
  const tableWithdrawn = settingsOpen || covered || holdingForStart;
  const behindVeil = a11yVeiled(tableWithdrawn);
  // The sheet hangs off the rail, outside the overlays slot, so the slot goes
  // behind its veil. A cover inside the slot does not: `app/(online)/game.tsx`
  // spreads this onto the one wrapper holding the cover, which would withdraw
  // the cover's own message along with the table it is explaining.
  const behindSheetOnly = a11yVeiled(settingsOpen || portrait);
  // The rail is the one child that answers to a cover but not to the sheet: the sheet is
  // closed by the knob the rail carries, so veiling it there shuts the reader inside.
  // The opening gate covers the rail too, and the sheet its menu knob opens
  // would come up above the gate carrying an exit.
  const behindCoverOnly = a11yVeiled((covered || holdingForStart) && !settingsOpen);
  // The turn chip answers to everything that takes the table away except the
  // opening gate: it names no control, and the countdown it carries is the one
  // thing a hold may not hide from a reader either.
  const clockVeil = a11yVeiled(settingsOpen || covered);
  const [focusMode, setFocusMode] = useState(false);
  const [playOnLeft, setPlayOnLeft] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);

  const focusFadeStyle = useFocusFade(focusMode);
  const ownPill = connection?.state === "reconnecting" || connection?.state === "lost" || connection?.state === "back";
  const stackFocused = focusMode && !ownPill;
  const stackFadeStyle = useFocusFade(stackFocused);
  useTableClaim(!stackFocused && !tableCovered);

  // ── Derived view of the game ────────────────────────────────────────────────

  const players = gameState.players;
  const viewer = players[viewerSeat];
  const isMyTurn = viewerOwnsSeat(gameState.currentTurnIndex, viewerSeat, spectating);
  const isFinished = viewer?.finishPosition !== undefined;
  const isNewRound = gameState.lastPlayedCombination === null;
  const exchange = readExchange(gameState, viewerSeat, spectating);

  // A spectator receives every hand blanked, so the bottom seat's cards come
  // from its count. They carry synthetic ids because nothing may identify a
  // card the watcher is not entitled to see.
  const dealtHand = React.useMemo(() => {
    if (spectating) {
      const count = viewer ? handCountOf(viewer) : 0;
      return Array.from({ length: count }, (_, i) => ({
        id: `hidden-${i}`,
        rank: "3",
        suit: "spades",
        isJoker: false,
      })) as Card[];
    }
    return sortHand(viewer?.hand ?? []);
  }, [spectating, viewer]);
  const sortedHand = useSameCards(dealtHand);
  // The engine's order is the fallback; what the player sees is whatever they
  // have arranged on top of it (#531). Spectated hands are excluded by the
  // seat's own cards being synthetic above — there is nothing there to arrange.
  const { arranged: shownHand, moveTo, order: handOrder } = useHandOrder(viewerSeat, sortedHand);
  // The trade runs from the phase opening, before any announcement: the receive flies ahead of the choice.
  const announced = exchangeAnnouncement?.visible ? exchangeAnnouncement.data : null;
  const phase = gameState.exchangePhase;
  const trade: ExchangeAnnounceData | null =
    announced ??
    (phase?.active && !phase.bothJokersException ? buildExchangeAnnounce(players, phase, { received: phase.cardFromLoser }) : null);
  // A pairing and its card repeat across manches, so each trade is also counted.
  const [tradeSeq, setTradeSeq] = useState({ open: false, seq: 0 });
  if (!!trade !== tradeSeq.open) setTradeSeq({ open: !!trade, seq: tradeSeq.seq + (trade ? 1 : 0) });
  const tradeId = trade ? `${tradeSeq.seq}:${tradeKey(trade)}` : "";
  const [reported, setReported] = useState<TradeStages>({ key: "", ...NO_STAGES });
  const stages: TradeStages = trade && reported.key === tradeId ? reported : { key: tradeId, ...NO_STAGES };
  const choiceReady = reported.key === tradeId && reported.ready;
  const onTradeStage = useCallback((key: string, leg: LegName, stage: LegStage) => {
    setReported((s) => ({ ...(s.key === key ? s : { key, ...NO_STAGES }), [leg]: stage }));
  }, []);
  const onTradeReady = useCallback(
    (key: string) => {
      setReported((s) => ({ ...(s.key === key ? s : { key, ...NO_STAGES }), ready: true }));
      onExchangeReady?.();
    },
    [onExchangeReady]
  );
  const ringFlash = useSharedValue<RingFlash>({ seq: 0, seat: -1 });
  const lifted = useSharedValue<string[]>([]);
  const tradeSeats = readTradeSeats(trade, stages);
  const { handOnTable, holding, arrivingIndex, descendingId, receivedId } = useHandArrival({
    hand: shownHand,
    sorted: sortedHand,
    order: handOrder,
    trade,
    stages,
    viewerSeat: spectating ? null : viewerSeat,
  });
  // Where the last move put a card. A drag shows its own answer; the discrete
  // actions behind it (WCAG 2.5.7) move a card with nothing on screen changing
  // for whoever asked, so the live region below says where it went.
  const [arranged, setArranged] = React.useState<{ id: string; to: number } | null>(null);
  const arrange = React.useCallback(
    (id: string, to: number) => {
      moveTo(id, to);
      setArranged({ id, to });
    },
    [moveTo]
  );
  const exchangeIsWinners = exchange.active && exchange.viewerIsWinner;
  const exchangeIsMine = exchangeIsWinners && choiceReady;
  const selectionMode: SelectionMode = exchangeIsMine ? "exchange" : "play";
  // Nothing here subscribes to the selection: a tap renders only the leaves that show it.
  const [selection] = useState(() => createSelectionStore());
  const heldIds = React.useMemo(() => sortedHand.map((c) => c.id), [sortedHand]);
  const shownSelection = React.useMemo(
    () => settledSelection(selection, heldIds, selectionMode),
    [selection, heldIds, selectionMode]
  );
  // A memo so the compiler sees `isMyTurn` frozen before an object carries it into a call: bare,
  // every later memo on `isMyTurn` fails to preserve and GameTable goes uncompiled.
  const canPass = React.useMemo(
    () => canPassNowOf({ isMyTurn, isFinished, isNewRound }),
    [isMyTurn, isFinished, isNewRound]
  );
  const passIsOnlyMove = React.useMemo(
    () =>
      canPass &&
      !canBeatPileOf({
        hand: sortedHand,
        lastPlayedCombination: gameState.lastPlayedCombination,
        startCard: gameState.startCard,
        firstPlayMade: gameState.firstPlayMade,
        isNewRound,
        isMyTurn,
        isFinished,
      }),
    [
      canPass,
      sortedHand,
      gameState.lastPlayedCombination,
      gameState.startCard,
      gameState.firstPlayMade,
      isNewRound,
      isMyTurn,
      isFinished,
    ]
  );
  const passed = usePassedSeats(
    gameState.currentTurnIndex,
    gameState.lastPlayedBy,
    gameState.lastPlayedCombination,
    players
  );
  const [passSeen, setPassSeen] = useState(gameState);
  const [errorSeen, setErrorSeen] = useState<ServerError | null>(null);
  const [autoSeen, setAutoSeen] = useState(autoPassed);
  const [float, setFloat] = useState<Float | null>(null);
  let floatNow = float;
  if (passSeen !== gameState) {
    setPassSeen(gameState);
    if (!spectating && seatsJustPassed(passView(passSeen), passView(gameState)).includes(viewerSeat)) {
      floatNow = raised(floatNow, "pass", t("gameShared.passedLabel"), !tableWithdrawn);
    } else if (floatNow?.live) {
      floatNow = { ...floatNow, live: false };
    }
  }
  if (errorSeen?.seq !== error?.seq) {
    setErrorSeen(error);
    if (error) floatNow = raised(floatNow, "toast", error.text, !tableWithdrawn);
    else if (floatNow?.kind === "toast" && floatNow.live) floatNow = { ...floatNow, live: false };
  }
  if (autoSeen !== autoPassed) {
    setAutoSeen(autoPassed);
    // The state lands no later than the notice (offline one batch, online the server's order). Only a pass is
    // re-titled, in its own life: a timed-out lead is a card the server played, and raises nothing.
    if (floatNow?.kind === "pass" && floatNow.live) floatNow = { ...floatNow, kind: "autoPass", text: t("game.autoPassTitle") };
  }
  const [withdrawnSeen, setWithdrawnSeen] = useState(tableWithdrawn);
  if (withdrawnSeen !== tableWithdrawn) {
    setWithdrawnSeen(tableWithdrawn);
    if (tableWithdrawn && floatNow?.live) floatNow = { ...floatNow, live: false };
  }
  if (floatNow !== float) setFloat(floatNow);

  // ── The exchange, on the table ──────────────────────────────────────────────
  //
  // The winner picks from their own hand rather than from a filtered row in a
  // dialog, so the legality the engine enforces has to be readable in the fan:
  // `getValidGivebackCards` is the same call `processExchangeChoice` validates
  // against, asked here only to decide which cards light up.
  const giveable = React.useMemo(
    () =>
      exchangeIsMine ? getValidGivebackCards(sortedHand, exchange.cardFromLoser?.id) : undefined,
    [exchangeIsMine, sortedHand, exchange.cardFromLoser?.id]
  );
  const giveableIds = React.useMemo(() => giveable?.map((c) => c.id), [giveable]);
  const exchangeLoserName = exchange.loser?.name ?? "";

  const opponents = React.useMemo(
    () => arrangeOpponents(players, viewerSeat),
    [players, viewerSeat]
  );

  const frame = computeTableFrame({ width: W, height: H, insets, scale });

  const pillAnchor = {
    right: W - frame.tableRight - frame.pad,
    top: frame.tableTop,
    restH: CHIP_H(scale),
    centreX: (frame.tableLeft + W - frame.tableRight) / 2,
    unit: (scale * BASE_SHORT_EDGE) / MOCKUP_SHORT_EDGE,
  };
  const pillStandings =
    matchScore &&
    scorePillStandings({
      players,
      teams: gameState.gameMode === "teams",
      scores: matchScore.scores,
      handScores,
      rankings: gameState.rankings,
      viewerId: spectating ? undefined : viewer?.id,
    });
  const partitaBoard = (() => {
    if (!pillStandings || !matchScore || !partitaActions) return null;
    const teamOf: Record<string, string | undefined> = Object.fromEntries(players.map((p) => [p.id, p.team]));
    const winnerKeys = (matchWinners ?? []).map((id) => (pillStandings.teams ? (teamOf[id] ?? id) : id));
    const won = pillStandings.rows.filter((row) => winnerKeys.includes(row.key));
    const race = matchScore.single ? t("result.singleHandFormat") : t("scorePill.race", { target: matchScore.target });
    return {
      winnerKeys,
      actions: partitaActions,
      winner: {
        name: won.map((row) => (pillStandings.teams ? t("lobby.team", { team: row.name }) : row.name)).join(" · "),
        mine: won.length === 1 && won[0].mine,
        draw: won.length > 1,
        line: won.length === 1 ? `${race} · ${won[0].total}` : race,
      },
    };
  })();
  // Capture, returning false: every touch on the table closes the pill on its way to
  // whatever it was for, so the pill never costs a play. The pill's own box is left to
  // the pill, whose press toggles it.
  const closeScoreElsewhere = (e: GestureResponderEvent) => {
    mancheEnding.skip();
    partitaEnding.skip();
    if (scoreOpen) {
      const hit = scorePillHitBox(1, 0, pillAnchor, TOUCH_TARGET_MIN);
      const { pageX: x, pageY: y } = e.nativeEvent;
      if (x < hit.x || x > hit.x + hit.w || y < hit.y || y > hit.y + hit.h) setScoreOpen(false);
    }
    return false;
  };

  const seatGeometry = {
    viewerSeat,
    players,
    opponents,
    scale,
    windowWidth: W,
    windowHeight: H,
    tableLeft: frame.tableLeft,
    tableRight: frame.tableRight,
    tableTop: frame.tableTop,
    surplus: frame.surplus,
    bottomPad: frame.bottomPad,
    handCardH,
  };

  const [entryMs] = useState(() => motionMs("reveal", reduceMotion));
  const dealFresh = mancheUnplayed(gameState);
  const deal = useDeal({
    geometry: seatGeometry,
    fresh: dealFresh,
    entryMs,
    reduceMotion,
  });
  const particles = useRef<ParticleEmitter>(null);
  const onDealt = useCallback(
    (x: number, y: number) => {
      traceOnset("moment", "dealt");
      particles.current?.emit(dealSpecks(x, y, reduceMotion, Math.random));
    },
    [reduceMotion]
  );
  const breathStyle = useDealBreath(deal.hand);

  // ── Screen-reader table description ─────────────────────────────────────────
  //
  // describeTableForA11y (tableA11y.ts) does the ordering; this just
  // gathers the translated pieces it asks for. The bottom seat's size comes
  // from `sortedHand`, which is the real hand when playing and the count-derived
  // face-down set when spectating — `viewer.hand.length` is 0 in that case,
  // because a watcher is sent no cards at all.

  const tableA11yStrings = React.useMemo(() => tableStrings(t, tn), [t, tn]);

  const tableA11yLabel = React.useMemo(() => {
    const combo = gameState.lastPlayedCombination;
    const lastPlay: TableA11yLastPlay | null = combo
      ? {
          label: lastPlayLabel(combo, t),
          byViewer: viewerOwnsSeat(gameState.lastPlayedBy, viewerSeat, spectating),
          byName: players[gameState.lastPlayedBy]?.name ?? "",
        }
      : null;
    const opponentsA11y: TableA11yOpponent[] = players
      .filter((_, seat) => seat !== viewerSeat)
      .map((p) => ({ name: p.name, cardCount: handCountOf(p) }));
    const exchangeA11y: TableA11yExchange | undefined = exchange.active
      ? {
          active: true,
          viewerIsWinner: exchange.viewerIsWinner,
          viewerIsLoser: exchange.viewerIsLoser,
          winnerName: exchange.winner?.name ?? "",
          loserName: exchange.loser?.name ?? "",
        }
      : undefined;

    return describeTableForA11y(
      {
        isMyTurn,
        currentTurnName: players[gameState.currentTurnIndex]?.name ?? "",
        myCardCount: handOnTable.length,
        lastPlay,
        opponents: opponentsA11y,
        exchange: exchangeA11y,
        handOver: gameState.gameOver,
      },
      tableA11yStrings
    );
  }, [
    gameState.gameOver,
    gameState.lastPlayedCombination,
    gameState.lastPlayedBy,
    gameState.currentTurnIndex,
    players,
    viewerSeat,
    handOnTable.length,
    isMyTurn,
    spectating,
    exchange,
    tableA11yStrings,
    t,
  ]);

  const arrangedA11yLabel = React.useMemo(
    () =>
      arranged === null
        ? null
        : arrangedLabel(
            shownHand.find((c) => c.id === arranged.id),
            arranged.to,
            handOnTable.length,
            t
          ),
    [arranged, shownHand, handOnTable.length, t]
  );

  const landingSignal = useSharedValue<LandingSignal>(NO_LANDING);
  const timeline = useTableTimeline();
  const {
    passaFlashStyle,
    kickStyle,
    giocaRejectX,
    rejectPlay,
    flushTrigger,
    celebrateFlush,
    shakeStyle,
    tableMotion,
  } = useTableFeedback({
    isMyTurn,
    isFinished,
    canPass,
    passCount: gameState.passCount,
    lastPlayedCombination: gameState.lastPlayedCombination,
    roundWinner: gameState.roundWinner,
    gameOver: gameState.gameOver,
    rankings: gameState.rankings,
    players,
    isTeamMode: gameState.gameMode === "teams",
    handScores,
    viewerId: viewer?.id,
    scale,
    matchOver,
    matchWinners,
    landing: landingSignal,
    timeline,
  });

  const { style: handLiftStyle, lift: handLift } = useHandLift(
    (isMyTurn && !isFinished && !exchange.active) || exchangeIsMine,
    scale
  );

  // Merged, never replaced: by the throw's commit the hand has already redrawn without the thrown cards.
  const handOrigins = useRef(new Map<string, CardFrom>());
  const onHandOrigins = useCallback((drawn: ReadonlyMap<string, CardFrom>) => {
    drawn.forEach((from, id) => handOrigins.current.set(id, from));
  }, []);
  const {
    trick,
    endSweep,
    flights,
    roundWinnerTag,
    onFlightStart,
    onFlightContact,
    onFlightDone,
    onFlightClock,
    bombClock,
    feltDim,
  } = usePileFlight({
    lastPlayedCombination: gameState.lastPlayedCombination,
    lastPlayedBy: gameState.lastPlayedBy,
    roundWinner: gameState.roundWinner,
    gameOver: gameState.gameOver,
    matchOver,
    ...seatGeometry,
    timeline,
    celebrateFlush,
    playRoundStart: roundStart,
    handOrigins,
    roomW: frame.fieldRoomW,
    catchUp,
  });
  const mancheEnding = useMancheEnding({
    ended: gameState.gameOver && !matchOver && (onMancheLanded !== undefined || mancheVote !== null),
    hold: mancheVote !== null,
    timeline,
    pileEmpty: trick.plays.length === 0,
    onLanded: onMancheLanded,
  });
  const partitaOnTable = gameState.gameOver && matchOver && partitaActions !== undefined;
  const partitaEnding = useMancheEnding({
    ended: partitaOnTable,
    partita: true,
    timeline,
    pileEmpty: trick.plays.length === 0,
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: partitaDim(partitaEnding.clock.value) }));
  const mancheVoteStyle = useAnimatedStyle(() => {
    const shown = mancheVoteShown(mancheEnding.clock.value);
    return { opacity: shown, display: shown > 0 ? "flex" : "none" };
  });
  const openPill = scorePillBox(1, 0, pillAnchor);
  const shownTurnIndex = useShownTurn(gameState.currentTurnIndex, timeline);
  const shownTurnIsMine = viewerOwnsSeat(shownTurnIndex, viewerSeat, spectating);

  // The owner's own remedy for an announcement nobody noticed: swing the lamp
  // off the seat and onto the middle, where the words are. The table's existing
  // attention mechanism, pointed somewhere else — not a second device.
  const anchors = anchorPoints(tableGeometry(seatGeometry));
  const lampAim = lampPools(anchors, W, H)[
    holdingForStart ? "centre" : seatDirection(shownTurnIndex, viewerSeat, players.length)
  ];
  const emberFrom = useRef(shownTurnIndex);
  const emberRuns = !holdingForStart && !trade && !gameState.gameOver && gameState.firstPlayMade;
  useEffect(() => {
    const from = emberFrom.current;
    emberFrom.current = shownTurnIndex;
    if (from === shownTurnIndex || !emberRuns) return;
    particles.current?.ember(
      seatDirection(from, viewerSeat, players.length),
      seatDirection(shownTurnIndex, viewerSeat, players.length)
    );
  }, [shownTurnIndex, emberRuns, viewerSeat, players.length]);
  const rig = useLampRig({
    pool: lampAim,
    deal: deal.hand,
    width: W,
    height: H,
    landing: landingSignal,
  });
  const cardTable = useCardTableValue(
    {
      pile: anchors.pile,
      hand: anchors.bottom,
      seats: { top: anchors.top, left: anchors.left, right: anchors.right },
      felt: {
        sx: rig.sx,
        sy: rig.sy,
        s: scale,
        kickAt: { x: W / 2, y: H / 2 },
        shakeAt: { x: (frame.tableLeft + W - frame.tableRight) / 2, y: (frame.tableTop + H - frame.surplus) / 2 },
      },
    },
    tableMotion,
    handLift,
    rig.glossLight
  );
  const [feltReady, onFeltReady] = useFeltReady();
  const cardCast = useCardCast(feltReady, restingCast(cardTable.pile, lampAim, cardTable.felt));
  useBenchHandle("lampFreeze", rig.freeze);
  const { greyStyle, frozen: clockHeld } = useLinkHold(ownLink, rig, catchUp && timeline.inFlight);

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    // Fast game -> menu -> game navigation makes these cancel each other, and an
    // unhandled rejection here is fatal on device.
    warmCardArt();
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
      nativeOrientation?.release().catch(() => {});
    };
  }, []);
  useOrientationRows(W, H);
  // A portrait-only lock from UIKit can land after ours with no rotation to report
  // it, so an upright window keeps re-asking until it turns (#1378).
  const upright = W < H;
  useEffect(() => {
    lockLandscape();
    if (!upright) return;
    const relock = setInterval(lockLandscape, 1000);
    return () => clearInterval(relock);
  }, [upright]);
  const dealCue = useCallback((at: number) => event([{ kind: "deal" }], Math.max(performance.now(), at)), []);
  // Under reduced motion no deal flies to start the cue, and sound is not motion.
  useEffect(() => {
    if (dealFresh && reduceMotion) dealCue(performance.now());
  }, [dealFresh, reduceMotion, dealCue]);

  // UIKit pins the scene to its current orientation for an animated screen
  // transition, overriding a lock that lands inside it (#1211).
  useEffect(
    () =>
      navigation?.addListener("transitionEnd", (e) => {
        if (!e.data.closing) lockLandscape();
      }),
    [navigation]
  );


  // ── Handlers ────────────────────────────────────────────────────────────────

  // The tap handlers reach the memoized hand as props, so they are stabilized
  // by hand: a fresh arrow per render defeats every card's memo comparator.
  // Staging a play while an opponent thinks is how every game in this family
  // works, and it is what stops the turn clock starting from a blank hand.
  // Only the *submission* is gated on the turn, by `GiocaControl`'s staged
  // play, so GIOCA lights on its own the moment the turn arrives.
  const tapsReach = !(isFinished || spectating || (exchangeIsWinners && !exchangeIsMine));
  const announceTap = useCallback(
    (next: Selection, id: string) => {
      event([{ kind: next.ids.includes(id) ? "select" : "deselect" }]);
      selection.set(next);
    },
    [selection]
  );
  const handleCardPress = useCallback(
    (id: string) => {
      if (!tapsReach) return;
      announceTap(press(settle(selection.get(), heldIds, selectionMode), id), id);
    },
    [tapsReach, announceTap, selection, heldIds, selectionMode]
  );
  const uiSelection = useSelection(selection, heldIds, selectionMode, tapsReach, announceTap);
  useBenchHandle("cardPress", uiSelection.tapFromJs);
  const showRefusal = useCallback(
    (text: string) => setFloat((standing) => raised(standing, "reject", text)),
    [setFloat]
  );
  // Asked again rather than closing over `canPass`: with `canPass` as the
  // dependency, `react-hooks/preserve-manual-memoization` refuses this memo and
  // React Compiler skips the whole component.
  const handlePass = useCallback(() => {
    if (!canPassNowOf({ isMyTurn, isFinished, isNewRound })) return;
    // Haptic only: the pass sound follows the committed state, so firing it
    // here as well would double the viewer's own pass.
    uiFeedback("light");
    selection.set({ ...settle(selection.get(), heldIds, selectionMode), ids: [] });
    onPass();
  }, [isMyTurn, isFinished, isNewRound, onPass, selection, heldIds, selectionMode]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const announcementHolds = holdingForStart && (turnTimer?.pausable ?? false);
  const timerActive =
    !!turnTimer &&
    turnTimerActive({
      isMyTurn,
      isFinished,
      isNewRound,
      gameOver: gameState.gameOver,
      exchangeActive: exchange.active,
      includeNewRound: turnTimer.includeNewRound ?? false,
      announcementHolds,
    });

  // Changes on every move and every pass, so the countdown restarts once per
  // turn — including when the same seat leads a new round after winning one.
  const turnToken =
    `${gameState.currentTurnIndex}|${gameState.passCount}|` +
    (gameState.lastPlayedCombination
      ? comboKey(gameState.lastPlayedCombination, gameState.lastPlayedBy)
      : "-");

  const top = topPlay(trick.plays);
  const onTop = top?.combo ?? null;
  const comboLabel = getComboLabel(onTop, t);

  // Named off the trick, not `gameState.lastPlayedBy` — the pile lags the
  // game state by the flight animation, and reading the seat straight off the
  // game state would name the *new* player over the *old* combination for the
  // length of one throw. Spectating, the bottom seat is someone else's, so no
  // play on the felt is the watcher's own.
  const playedByViewer = viewerOwnsSeat(top?.playedBy ?? null, viewerSeat, spectating);
  const lastPlayName =
    top === null
      ? ""
      : playedByViewer
        ? t("gameShared.you")
        : (players[top.playedBy]?.name ?? "");

  const topBarA11yLabel = topBarLabel(onTop, playedByViewer, lastPlayName, t);

  const viewerOnMove = shownTurnIsMine && !isFinished && !gameState.gameOver;
  const onMoveName = players[shownTurnIndex]?.name ?? "";

  // The seat on move sweeps its own rim over the same window the viewer's chip
  // counts down, and the turn changing is what arms it. There is no per-seat
  // deadline to read, so a lead sweeps offline too: the ring marks the seat on
  // move (the mockup's `.seat.on .ring`), not a deadline, which offline a lead
  // does not have.
  //
  // Asked about the seat the ring is drawn on, never about the viewer: a seat
  // that is not the viewer's still has a server deadline online once the viewer
  // is out.
  const seatCountdown =
    turnTimer &&
    turnTimerActive({
      // SeatRing draws this only on the seat that is on move, so the subject of
      // the question is always a seat whose turn it is — and never one that has
      // gone out, because `getNextActivePlayer` (lib/game/gameEngine.ts) steps over
      // an empty hand rather than landing on it.
      isMyTurn: true,
      isFinished: false,
      isNewRound,
      gameOver: gameState.gameOver,
      exchangeActive: exchange.active,
      includeNewRound: true,
      announcementHolds,
    })
      ? { seconds: turnTimer.seconds, resetKey: `${turnToken}|${turnTimer.resetKey ?? ""}`, held: clockHeld }
      : undefined;

  const startCardDue = !gameState.firstPlayMade && !!gameState.startCard;
  const whoStarts: StartReason | undefined =
    startReason ??
    (gameState.startCard
      ? { type: "start_card", card: gameState.startCard, playerIdx: gameState.currentTurnIndex }
      : undefined);
  const startGated = holdingForStart && !!startReason;

  const tradeName = (seat: number) => players[seat]?.name ?? "";
  const shortName = (card: Card) => `${getCardDisplayRank(card.rank)}${getSuitSymbol(card.suit)}`;
  const giveNote = (card: Card | undefined, from: number, to: number) => {
    if (!card) return "";
    const c = shortName(card);
    if (viewerOwnsSeat(from, viewerSeat, spectating)) return t("exchange.pileYouGive", { card: c, to: tradeName(to) });
    if (viewerOwnsSeat(to, viewerSeat, spectating)) return t("exchange.pileGivesYou", { from: tradeName(from), card: c });
    return t("exchange.pileGives", { from: tradeName(from), card: c, to: tradeName(to) });
  };
  const pileNote = !trade
    ? null
    : trade.bothJokersException
      ? stages.receive === "rest"
        ? { text: t("exchangeAnnouncement.noSwapText"), testID: "exchange-no-swap", cards: JOKERS }
        : null
      : stages.receive === "rest" && trade.cardReceived
        ? { text: giveNote(trade.cardReceived, trade.loserIdx, trade.winnerIdx), testID: "exchange-pile-label", cards: [trade.cardReceived] }
        : stages.give === "rest" && trade.cardGiven
          ? { text: giveNote(trade.cardGiven, trade.winnerIdx, trade.loserIdx), testID: "exchange-pile-label", cards: [trade.cardGiven] }
          : null;

  // The choice opens once the received card has landed and been read; until then the chip names the exchange.
  const choiceOpen = exchange.active && stages.ready;
  const exchangeChip = !trade
    ? null
    : !choiceOpen
      ? t("exchange.chipTitle")
      : exchange.viewerIsWinner
        ? giveable && givebackIsFallback(giveable)
          ? t("exchange.noValidCards")
          : t("exchange.chipGive", { name: exchangeLoserName })
        : exchange.viewerIsLoser
          ? t("exchange.waitingForYou", { winner: exchange.winner?.name ?? "" })
          : t("exchange.watching", { winner: exchange.winner?.name ?? "", loser: exchangeLoserName });
  const seatMark = (seat: number) => ({ marked: tradeSeats.lit.includes(seat), seat, flash: ringFlash });
  const onMove = (seat: number) => !trade && seat === shownTurnIndex;
  useBenchHandle("tableAnchors", () => ({ width: W, height: H, anchors }));
  const seatCount = (seat: number, player: (typeof players)[number]) => handCountOf(player) + (tradeSeats.shift.get(seat) ?? 0);

  // The last hook: effects run in declaration order, so every producer above has queued its moments.
  useEffect(() => timeline.flush());

  return (
    <CardTableProvider value={cardTable}>
    <CardCastContext.Provider value={cardCast}>
    <View style={[styles.root, WEB_CLIP]} onStartShouldSetResponderCapture={closeScoreElsewhere}>
      {/* Felt — decoration only: one canvas that never carries game
          information (#1244), lit by the one lamp rig. */}
      <Animated.View
        testID="table-felt"
        style={[StyleSheet.absoluteFill, FELT_Z, greyStyle, breathStyle]}
        pointerEvents="none"
        {...a11yHidden()}
      >
        <Felt rig={rig} stops={felt} pool={lampAim} ready={feltReady} onReady={onFeltReady} cards={cardTable} />
        <LampLift landing={landingSignal} scale={scale} rig={rig} />
        <ParticleLayer ref={particles} rig={rig} landing={landingSignal} />
        <FeltScrim dim={feltDim} />
      </Animated.View>

      {/* The game, and everything a landing displaces. It clips at its own
          moving edge, so the strip the kick uncovers is the cloth behind it
          rather than whatever the window is drawn on. */}
      <Animated.View style={[styles.kick, WEB_CLIP, TABLE_Z, kickStyle]}>
        <Sweep trigger={flushTrigger} width={W} height={H} />
        <A11yStatus label={tableA11yLabel} veiled={tableWithdrawn} />
        {/* Chips over the felt where the cards never reach — the combination in
            play at the head of the field, whose turn it is at the top centre, the
            score at the far corner. Anything wider would be chrome drawn where a card lands. */}
        <Animated.View
          testID="game-top-bar"
          {...a11yGroup(topBarA11yLabel)}
          pointerEvents={focusMode ? "none" : undefined}
          {...behindVeil}
          style={[styles.hudLeft, { left: frame.tableLeft + frame.pad, top: frame.tableTop }, focusFadeStyle, greyStyle]}
        >
          {/* The chip draws the words the group's label already says. */}
          <View {...a11yHidden()}>
            <HudComboPill scale={scale} play={comboLabel === null ? null : { name: lastPlayName, combo: comboLabel }} />
          </View>
        </Animated.View>

        <Animated.View
          testID="game-hud-stack"
          pointerEvents={stackFocused ? "none" : "box-none"}
          {...clockVeil}
          style={[
            styles.hudCentre,
            { left: frame.tableLeft, right: frame.tableRight, top: frame.tableTop },
            holdingForStart && HELD_CLOCK_Z,
            stackFadeStyle,
          ]}
        >
          <A11yVeil veil={clockVeil}>
            <View testID={choiceOpen ? "exchange-prompt" : undefined}>
              <TurnChip
                scale={scale}
                lit={exchangeChip === null ? viewerOnMove : choiceOpen && exchange.viewerIsWinner}
                chipText={
                  exchangeChip ??
                  (gameState.gameOver
                    ? t("gameShared.handOver")
                    : viewerOnMove
                      ? t("gameShared.yourTurn")
                      : t("gameShared.turnOf", { name: onMoveName }))
                }
                spokenSeat={
                  exchangeChip ??
                  (gameState.gameOver
                    ? t("gameTable.a11yHandOver")
                    : viewerOnMove
                      ? t("gameTable.a11yYourTurn")
                      : t("gameTable.a11yTurnOf", { name: onMoveName }))
                }
                seconds={turnTimer?.seconds ?? 0}
                active={timerActive}
                revealed={viewerOnMove}
                resetKey={`${turnToken}|${turnTimer?.resetKey ?? ""}`}
                onExpire={turnTimer?.onExpire}
                frozen={clockHeld}
                connection={choiceOpen && connectionNote?.state === "reconnected" ? null : connectionNote}
              />
            </View>
          </A11yVeil>
        </Animated.View>

        {pillStandings && matchScore && (!matchScore.single || partitaOnTable) && (
          <Animated.View {...behindVeil} testID="score-pill-layer" pointerEvents="box-none" style={[styles.pillLayer, greyStyle]}>
            {partitaOnTable && (
              <Animated.View testID="partita-dim" pointerEvents="none" style={[styles.partitaDim, dimStyle]} />
            )}
            <ScorePill
              standings={pillStandings}
              target={matchScore.target}
              open={scoreOpen}
              onPress={() => setScoreOpen((open) => !open)}
              anchor={pillAnchor}
              ending={partitaOnTable ? partitaEnding.clock : mancheEnding.clock}
              partita={partitaOnTable ? partitaBoard : null}
            />
          </Animated.View>
        )}

        {endMatchVote && !scoreOpen && (
          <View
            {...behindVeil}
            pointerEvents="box-none"
            style={[
              styles.voteSpot,
              { right: W - pillAnchor.right, top: pillAnchor.top + pillAnchor.restH + mockupPx(VOTE_BELOW_PILL, scale) },
            ]}
          >
            <A11yVeil veil={behindVeil}>
              <EndMatchVote {...endMatchVote} scale={scale} />
            </A11yVeil>
          </View>
        )}

        {mancheVote && (
          <Animated.View
            {...behindVeil}
            testID="manche-vote"
            pointerEvents="box-none"
            style={[
              styles.voteSpot,
              { right: W - pillAnchor.right, top: openPill.y + openPill.h + mockupPx(VOTE_BELOW_PILL, scale) },
              mancheVoteStyle,
            ]}
          >
            <A11yVeil veil={behindVeil}>
              <MancheVote {...mancheVote} scale={scale} />
            </A11yVeil>
          </Animated.View>
        )}

        <FloatSlot
          float={float}
          at={{ x: anchors.pile.x, y: floatTop(seatGeometry) }}
          beside={{
            giocaTop: frame.surplus + frame.bottomPad + actionBtn,
            left: frame.tableLeft,
            right: frame.tableRight,
            mirrored: playOnLeft,
          }}
          scale={scale}
          veiled={tableWithdrawn}
        />

        {/* Over the whole table rather than inside the mid band: while gated it holds
            the table as well as saying something, so the first tap is spent clearing
            it instead of playing a card; then it stays, holding nothing, until the first play. */}
        {(startGated || startCardDue) && whoStarts && (
          <WhoStartsPanel
            reason={whoStarts}
            starterName={players[whoStarts.playerIdx]?.name ?? ""}
            starterIsViewer={viewerOwnsSeat(whoStarts.playerIdx, viewerSeat, spectating)}
            gated={startGated}
            veiled={settingsOpen}
            onDone={() => setOpeningSpent(true)}
            scale={scale}
            tableLeft={frame.tableLeft}
            tableRight={frame.tableRight}
          />
        )}

        {/* The cutout's own column. A cutout can never sit on a card, but it sits
            happily between two controls — so the menu knob takes the head of the
            column, the reactions knob its foot, and the cutout the gap between. */}
        <Animated.View testID="control-rail-layer" pointerEvents="box-none" style={[StyleSheet.absoluteFill, RAIL_Z, greyStyle]}>
          <ControlRail
            veiled={behindCoverOnly}
            width={frame.rail}
            topPad={frame.tableTop}
            bottomPad={frame.tableBottom}
            top={
              <RailKnob
                onPress={() => setSettingsOpen((open) => !open)}
                a11yLabel={t("gameTable.settingsA11yLabel")}
                size={knobSize}
                expanded={settingsOpen}
              >
                <Ionicons name={settingsOpen ? "close" : "menu"} size={knobSize * 0.4} color={Colors.textMuted} />
              </RailKnob>
            }
            bottom={
              <Animated.View pointerEvents={focusMode ? "none" : undefined} style={focusFadeStyle}>
                {railExtra}
              </Animated.View>
            }
          />
        </Animated.View>

        {settingsOpen && (
          <GameSettingsSheet
            rail={frame.rail}
            topPad={frame.tableTop}
            bottomPad={frame.tableBottom}
            scale={scale}
            onClose={closeSettings}
            focusMode={focusMode}
            onToggleFocusMode={() => setFocusMode((v) => !v)}
            playOnLeft={playOnLeft}
            onTogglePlayOnLeft={() => setPlayOnLeft((v) => !v)}
            onExit={() => {
              closeSettings();
              onQuit();
            }}
          />
        )}

        <View
          {...behindVeil}
          style={[
            styles.bannerBand,
            {
              top: frame.tableTop + CHIP_H(scale) + frame.pad,
              left: frame.tableLeft + frame.pad,
              right: frame.tableRight + frame.pad,
            },
          ]}
        >
          <A11yVeil veil={behindVeil}>{banners}</A11yVeil>
        </View>


        {/* Same coordinates, overflow visible so slots and buttons can extend out.
            `dataSet` and not `accessibilityLabel`: this sentence is the browser
            harness's hook, and a container without `accessible` names nobody on any
            platform. It cannot have `accessible` either — that would collapse the
            PASSA/GIOCA buttons and every card underneath into one unreachable leaf.
            Players get the same sentence from the A11yStatus node above. */}
        <Animated.View
          testID="game-table"
          {...harnessState({ tableState: tableA11yLabel, dealing: String(deal.dealing) })}
          {...behindVeil}
          style={[
            sharedTableStyles.tableOverlay,
            TABLE_Z,
            {
              left: frame.tableLeft,
              top: frame.tableTop,
              right: frame.tableRight,
              // The table's own bottom edge, not the felt's: the hand runs to
              // it and past it, which is what buys the table the height above.
              // Zero on every phone — `surplus` is only the height a window
              // taller than the scale cap has, and it is taken off both ends so
              // the drawn table stays centred rather than growing one gap.
              bottom: frame.surplus,
            },
            greyStyle,
          ]}
        >
          <A11yVeil veil={behindVeil}>
          <Animated.View style={[sharedTableStyles.tableContent, shakeStyle]}>
            <View testID="table-top-section" style={[sharedTableStyles.topSection, { height: topBandHeight(scale) }]}>
              {opponents.top ? (
                <TopOppSlot
                  player={opponents.top.player}
                  isActive={onMove(opponents.top.seat)}
                  cardCount={seatCount(opponents.top.seat, opponents.top.player)}
                  dealArrivals={deal.arrivalsFor(opponents.top.seat)}
                  passed={passed.includes(opponents.top.seat)}
                  vacated={vacatedOf(opponents.top.player)}
                  reconnecting={disconnectedSeats[opponents.top.seat]}
                  scale={scale}
                  countdown={seatCountdown}
                  focusMode={focusMode}
                  {...seatMark(opponents.top.seat)}
                />
              ) : (
                <View />
              )}
            </View>

            {/* The band left over between the top band and the hand. The seats
                and the field centre in what is actually there rather than at a
                guessed percentage. */}
            {/* The flier's first frame sits on its own hand slot or fan, so the pile's band paints above both while one is up. */}
            <View style={[sharedTableStyles.midSection, (flights.length > 0 || trade !== null) && { zIndex: Layer.moment }]}>
              <View style={[sharedTableStyles.sideSection, sharedTableStyles.sideSectionLeft, { height: sideSlotHeight(scale) }]}>
                {opponents.left && (
                  <SideOppSlot
                    player={opponents.left.player}
                    isActive={onMove(opponents.left.seat)}
                    side="left"
                    cardCount={seatCount(opponents.left.seat, opponents.left.player)}
                    dealArrivals={deal.arrivalsFor(opponents.left.seat)}
                    passed={passed.includes(opponents.left.seat)}
                    vacated={vacatedOf(opponents.left.player)}
                    reconnecting={disconnectedSeats[opponents.left.seat]}
                    scale={scale}
                    countdown={seatCountdown}
                    focusMode={focusMode}
                    {...seatMark(opponents.left.seat)}
                  />
                )}
              </View>

              <View style={sharedTableStyles.centerSection}>
                <PileLayer
                  trick={trick}
                  flights={flights}
                  signal={landingSignal}
                  bombClock={bombClock}
                  onFlightStart={onFlightStart}
                  onFlightContact={onFlightContact}
                  onFlightEnd={onFlightDone}
                  onFlightClock={onFlightClock}
                  onSweepEnd={endSweep}
                  comboLabel={timeline.inFlight ? null : onTop}
                  roundWinner={roundWinnerTag === null ? null : players[roundWinnerTag.seat]?.name ?? ""}
                  roomW={frame.fieldRoomW}
                  scale={scale}
                  note={pileNote}
                  hidden={startCardDue}
                  opacity={mancheEnding.pileOpacity}
                />

                {/* Centred on the same point the pile draws at, so the burst
                    rings the impact rather than the middle of the table box. */}
                <BombBurst landing={landingSignal} scale={scale} />

                {/* Beside the pile, not beside the table: the flight has to
                    settle exactly where the pile then draws the same cards,
                    and the rail makes the table box asymmetric — centred on the
                    screen instead, the combination lands and then jumps. */}
                {trade && (
                  <ExchangeLegs
                    key={stages.key}
                    trade={trade}
                    stages={stages}
                    geometry={seatGeometry}
                    handOrigins={handOrigins}
                    go={!deal.dealing}
                    viewerSeat={spectating ? null : viewerSeat}
                    scale={scale}
                    flash={ringFlash}
                    lifted={lifted}
                    onStage={onTradeStage}
                    onReady={onTradeReady}
                    onDismiss={exchangeAnnouncement?.onDismiss ?? NO_DISMISS}
                    holdMsOverride={exchangeAnnouncement?.holdMsOverride}
                  />
                )}

                {deal.cards.length > 0 && (
                  <DealFlights
                    key={deal.cards[0].key}
                    cards={deal.cards}
                    scale={scale}
                    clock={deal.clock}
                    startMs={deal.startMs}
                    endMs={deal.endMs}
                    onStarted={dealCue}
                    onLanded={deal.onLanded}
                  />
                )}
              </View>

              <View style={[sharedTableStyles.sideSection, sharedTableStyles.sideSectionRight, { height: sideSlotHeight(scale) }]}>
                {opponents.right && (
                  <SideOppSlot
                    player={opponents.right.player}
                    isActive={onMove(opponents.right.seat)}
                    side="right"
                    cardCount={seatCount(opponents.right.seat, opponents.right.player)}
                    dealArrivals={deal.arrivalsFor(opponents.right.seat)}
                    passed={passed.includes(opponents.right.seat)}
                    vacated={vacatedOf(opponents.right.player)}
                    reconnecting={disconnectedSeats[opponents.right.seat]}
                    scale={scale}
                    countdown={seatCountdown}
                    focusMode={focusMode}
                    {...seatMark(opponents.right.seat)}
                  />
                )}
              </View>
            </View>

            {/* The hand rises off the bottom edge on the viewer's own turn. A
                lift rather than a lit band: a wash behind the hand draws a gold
                hairline the full width of the table, which reads as chrome over
                the felt instead of as the hand coming up. */}
            <Animated.View
              testID="hand-zone"
              style={[
                sharedTableStyles.handSection,
                {
                  height: HAND_ZONE_H(handCardH, frame.bottomPad),
                  paddingBottom: frame.bottomPad,
                  gap: HAND_ZONE_GAP * scale,
                },
                // Play on the left mirrors the row rather than moving the rail,
                // which stays put at the physical cutout: only GIOCA changes
                // which thumb it falls under.
                playOnLeft && styles.handSectionReversed,
                handLiftStyle,
              ]}
            >
              {!spectating && (
                <PassaButton
                  canPass={canPass}
                  onlyMove={passIsOnlyMove}
                  flashStyle={passaFlashStyle}
                  onPress={handlePass}
                  a11yLabel={t("gameTable.passA11yLabel")}
                  size={actionBtn}
                  scale={scale}
                />
              )}

              {isFinished ? (
                <View style={[styles.finishedRow, { width: frame.handAvailW, height: handVisibleH(handCardH) }]}>
                  <WaitingLine scale={scale} />
                </View>
              ) : (
                <HandStatus store={shownSelection} cardCount={handOnTable.length}>
                  {arrangedA11yLabel !== null && <A11yStatus label={arrangedA11yLabel} />}
                  <StraightHand
                    faceDown={spectating}
                    cards={handOnTable}
                    store={shownSelection}
                    selection={uiSelection}
                    onActivate={handleCardPress}
                    disabled={isFinished || spectating}
                    giveableIds={giveableIds}
                    giveHint={t("exchange.cardA11yHint")}
                    refuseHint={t("exchange.cardA11yNotGiveable")}
                    availW={frame.handAvailW}
                    roomW={frame.handRoomW}
                    isMyTurn={isMyTurn && !isFinished}
                    scale={scale}
                    // Off whenever a card is held back or lent: the fan is drawn
                    // without the state's hand, but `arrange` moves within it, so
                    // a drop would land a slot from where the finger let go.
                    onReorder={spectating || holding ? undefined : arrange}
                    arrivingIndex={arrivingIndex}
                    descendingId={descendingId}
                    receivedId={receivedId}
                    lifted={lifted}
                    handBottomPad={frame.bottomPad}
                    onOrigins={onHandOrigins}
                    // Only while the opening is still owed. Named rather than
                    // counted to: Maestro's `index` sorts by position, and the
                    // arc puts the outermost card below its neighbours (#757).
                    deal={deal.hand && { ...deal.hand, onDealt }}
                    startCardId={
                      gameState.firstPlayMade ? undefined : gameState.startCard?.id
                    }
                  />
                </HandStatus>
              )}

              {!spectating && (
                <GiocaControl
                  store={shownSelection}
                  hand={sortedHand}
                  lastPlayedCombination={gameState.lastPlayedCombination}
                  startCard={gameState.startCard}
                  firstPlayMade={gameState.firstPlayMade}
                  isNewRound={isNewRound}
                  isMyTurn={isMyTurn}
                  isFinished={isFinished}
                  giveTo={exchangeIsMine ? exchangeLoserName : null}
                  lit={exchangeIsMine || (isMyTurn && !isFinished && !exchange.active)}
                  rejectX={giocaRejectX}
                  rejectPlay={rejectPlay}
                  onRefuse={showRefusal}
                  onPlay={onPlay}
                  onGive={onExchangeGive}
                  size={actionBtn}
                  scale={scale}
                />
              )}
            </Animated.View>
          </Animated.View>
          </A11yVeil>
        </Animated.View>


        <A11yVeil veil={behindSheetOnly}>{overlays?.(behindSheetOnly)}</A11yVeil>

        {portrait && <RotateOverlay />}
      </Animated.View>
      <BombFlash landing={landingSignal} />
    </View>
    </CardCastContext.Provider>
    </CardTableProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, overflow: "hidden" },
  kick: { ...StyleSheet.absoluteFill, overflow: "hidden" },

  bannerBand: {
    position: "absolute",
    alignItems: "center",
    zIndex: BANNER_BAND_Z,
    pointerEvents: "box-none",
  },
  voteSpot: { position: "absolute", zIndex: BANNER_BAND_Z },

  hudLeft: { position: "absolute", zIndex: Layer.moment },
  hudCentre: { position: "absolute", alignItems: "center", zIndex: Layer.moment },
  pillLayer: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: Layer.moment },
  partitaDim: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: Colors.shadow },
  handSectionReversed: { flexDirection: "row-reverse" },


  finishedRow: { alignItems: "center", justifyContent: "center" },

});

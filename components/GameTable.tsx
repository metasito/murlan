// The one presentational game table.
//
// app/game.tsx (offline, local engine) and app/(online)/game.tsx (online,
// server-authoritative socket state) were ~2,400 lines of parallel
// implementation of this. They are now thin adapters: each maps its own state
// source onto `GameTableProps` and passes its own extras through the slots.
// Nothing below knows or cares which mode it is running in.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Platform,
  type AccessibilityProps,
  type GestureResponderEvent,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  roundUnplayed,
  openingIsPending,
  sortHand,
  type Card,
  type GameState,
  type StartReason,
} from "@/lib/game/gameEngine";
import type { ExchangeAnnounceData, ExchangeHold } from "@/lib/game/sharedGameFlow";
import {
  handVisibleH,
  actionBtnSize,
  HAND_ZONE_GAP,
  arrangeOpponents,
  seatDirection,
  viewerOwnsSeat,
  type OpponentSide,
} from "@/components/seatLayout";
import { handCountOf } from "@/shared/protocol";
import type { CardFrom } from "@/components/flightPose";
import { NO_LANDING, type LandingSignal } from "@/components/table/useFlightClock";
import { turnKey } from "@/components/passes";
import { tableLayout, type Seating } from "@/components/tableLayout";
import { useTableExchange } from "@/components/table/useTableExchange";
import { FloatSlot } from "@/components/table/notices/floats";
import { useTableFloat } from "@/components/table/useTableFloat";
import { tableVeils } from "@/components/table/tableVeils";
import type { ServerError } from "@/context/OnlineGameContext";
import {
  EndMatchVote,
  LeftTable,
  RoundVote,
  type EndMatchVoteNote,
  type LeftTableNote,
  type RoundVoteNote,
} from "@/components/table/notices/netNotes";
import { WaitingLine } from "@/components/table/notices/tableLines";
import { ExchangeLegs, type RingFlash } from "@/components/table/ExchangeLegs";
import { canPassNow as canPassNowOf, turnPresentation, type TurnTimerConfig } from "@/components/turnTimerUi";
import { sideSlotHeight, topBandHeight } from "@/components/tableFrame";
import { describeTableForA11y, type TableA11yExchange, type TableA11yLastPlay, type TableA11yOpponent } from "@/components/tableA11y";
import { cardScale, physicalTouchTarget } from "@/components/cardFaceModel";
import { ScorePill } from "@/components/table/scorePill";
import type { MatchBoardActions, MatchRating } from "@/components/table/matchBoard";
import { matchDim } from "@/lib/timeline/matchEnding";
import { scorePillHitBox, voteTop } from "@/components/table/scorePillModel";
import { matchBoardFor, scorePillStandings } from "@/lib/game/scorePill";
import { useTranslation } from "@/lib/i18n";
import { HudComboPill, WindowTurnChip, type ConnectionNote } from "@/components/table/notices/hud";
import { useCountdown } from "@/components/table/countdown";
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
  comboLabel as comboText,
  lastPlayLabel,
  tableStrings,
  topBarLabel,
} from "@/components/table/spokenLabels";
import { canBeatPileOf, type TableFacts } from "@/components/table/stagedPlay";
import {
  createSelectionStore,
  press,
  settle,
  type Selection,
  type SelectionMode,
} from "@/components/table/selection";
import { useSelection } from "@/components/table/useSelection";
import { GiocaControl, settledSelection } from "@/components/table/selectionLeaves";
import { PassaButton } from "@/components/table/actions";
import { Felt } from "@/components/table/feltSkia";
import { HandShade } from "@/components/table/handShade";
import { useLampRig } from "@/components/table/useLampRig";
import { useLinkHold } from "@/components/table/useLinkHold";
import type { OwnLink } from "@/lib/ownLink";
import { CardTableProvider, useCardTableValue } from "@/components/table/useCardRects";
import { lampPools } from "@/components/table/lampRig";
import { useTableTimeline } from "@/components/table/tableTimeline";
import { useRoundEnding } from "@/components/table/useRoundEnding";
import { roundVoteShown } from "@/lib/timeline/roundEnding";
import { roundOutcomeFor, matchOutcomeFor, scoredOutcome } from "@/lib/game/matchState";
import { ParticleLayer } from "@/components/table/particleLayer";
import { HandRow } from "@/components/table/handRow";
import { RotateOverlay } from "@/components/table/rotateOverlay";
import { GameSettingsSheet } from "@/components/table/settingsSheet";
import { useShownTurn, useTableFeedback } from "@/components/useTableFeedback";
import { useHandOrder } from "@/components/useHandOrder";
import { useSameCards } from "@/components/useSameCards";
import { PileLayer, usePileFlight } from "@/components/table/pile";
import { topPlay } from "@/components/table/trick";
import { warmCardArt } from "@/components/CardView";
import { BombBurst, BombFlash, FeltScrim, Sweep } from "@/components/table/moments";
import { OpponentSeat, usePassedSeats } from "@/components/table/seats";
import { seatView, type SeatTable } from "@/components/table/seatView";
import { CardCastContext, useCardCast, useFeltReady } from "@/components/table/feltReady";
import { restingCast } from "@/components/table/cardShadows";
import { DealFlights, useDeal, useDealBreath } from "@/components/table/deal";
import { dealSpecks, roundMotes, type ParticleEmitter } from "@/components/table/particles";
import { useRoundOutcome, type ShownOutcome } from "@/components/table/useRoundOutcome";
import { traceOnset } from "@/lib/e2eTrace";
import { event, uiFeedback } from "@/lib/device/feedback";
import { useLandscapeLock, useOrientedWindow, usePortraitInterface } from "@/lib/device/orientation";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import {
  Colors,
  motionMs,
  Layer,
  TOUCH_TARGET_MIN,
} from "@/lib/theme";
import { useTableFelt } from "@/lib/cosmetics";
import { A11yStatus, A11yVeil, a11yGroup, a11yHidden, a11yVeiled } from "@/lib/a11y";
import { useBenchHandle } from "@/lib/diagnostics";

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
const CARD_SHADE_Z = { zIndex: Layer.cardShade } as const;
const PARTICLES_Z = { zIndex: Layer.particles } as const;
const RAIL_Z = { zIndex: Layer.rail } as const;
/**
 * The turn chip while the opening gate holds the table. Online the deadline is
 * the server's and keeps running under the hold, so the countdown rides over it
 * rather than being covered by it.
 */
const HELD_CLOCK_Z = { zIndex: Layer.clock } as const;

const NO_DISMISS = () => {};
const NO_POINTS: Record<string, number> = {};
const NO_DISCONNECTS: Record<number, { seconds: number; resetKey: string }> = {};
const trickStart = () => event([{ kind: "trickStart" }]);

export interface ExchangeAnnouncementSlot {
  visible: boolean;
  data: ExchangeAnnounceData | null;
  onDismiss: () => void;
  /** Offline-only E2E override for how long the overlay holds (#915). */
  holdMsOverride?: ExchangeHold;
}

export interface GameTableProps {
  /**
   * The game, from whichever authority owns it. Offline this is the local
   * engine's state; online it is the server's, sanitized for this viewer
   * (opponents' hands blanked, `handCount` shipped alongside).
   */
  gameState: GameState;
  /**
   * Whether the *match* — the match, not this hand — is over. `MatchVerdict.over`
   * offline, `matchState.over` online: the same landing that empties a hand can
   * also be the one that closes the match, so this is read alongside
   * `gameState.roundOver` at the moment a play lands, never inferred from it.
   * Defaults false: replay, capture and reaction-preview callers hold no match.
   */
  matchOver?: boolean;
  matchWinners?: readonly string[];
  /**
   * What the round just played awarded, by engine player id — the score
   * pill's gains, fed to the table's own win/lose sting via `roundOutcomeFor`. Defaults empty
   * for the same callers `matchOver` defaults false for: with no scores to
   * read, the sting simply stays silent rather than guessing.
   */
  placementPoints?: Record<string, number>;
  /**
   * The match's running points by engine player id, and the target they race to — what
   * the score pill shows. Absent in a replay. A `single` round shows the pill only as its board.
   */
  matchScore?: { scores: Record<string, number>; target: number; single?: boolean };
  /** Present where a match ends on the table: the score pill becomes the board, with these. */
  matchActions?: MatchBoardActions;
  matchRating?: MatchRating;
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
  /** Whether a deal is in flight; the offline table holds the round's opener until it lands. */
  onDealing?: (dealing: boolean) => void;
  /**
   * Present where a round ends on the table: the score pill's payoff runs, and this hears the
   * landing that ended it, which the next round is timed from (`RoundEnding.deal`).
   */
  onRoundLanded?: (landsAt: number) => void;

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
  /** Present where the next round waits on a vote: the round's ending holds the pill open with this at its foot. */
  roundVote?: RoundVoteNote | null;
  /** Present once the vote deadline gave the viewer's own seat to a bot: it takes the vote's place under the open pill. */
  leftTable?: LeftTableNote | null;
  /** The online connection, carried by the turn pill; the device being offline outranks it. Left out, the table needs no network and shows neither. */
  connection?: ConnectionNote | null;
  /** The table is being replayed after a reconnect: a throw takes the catch-up timing. */
  catchUp?: boolean;
  /** Mounting on a match restored from its save: the play on the pile was thrown before, so it mounts at rest. */
  restored?: boolean;
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
  placementPoints = NO_POINTS,
  matchScore,
  matchActions,
  matchRating,
  viewerSeat,
  spectating = false,
  onPlay,
  onPass,
  onQuit,
  onExchangeGive,
  onExchangeReady,
  onDealing,
  onRoundLanded,
  turnTimer,
  exchangeAnnouncement,
  disconnectedSeats = NO_DISCONNECTS,
  railExtra,
  banners,
  error = null,
  autoPassed = 0,
  endMatchVote = null,
  roundVote = null,
  leftTable = null,
  connection,
  catchUp = false,
  restored = false,
  ownLink = "up",
  overlays,
  tableCovered = false,
}: GameTableProps) {
  const { t, tn } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useOrientedWindow();
  const portrait = usePortraitInterface();
  // The window's own short edge, so a phone and a browser at the same size draw the same
  // table. The safe area is the layout's job — the rail absorbs the cutout and the hand zone
  // carries the home indicator — and taking it off here instead shrinks the cards on device
  // only, which is the divergence from the web design, not a fit for it.
  const scale = cardScale(Math.min(W, H));
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
  // Who opens the round, held over the table for as long as that opening has
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
  // the play that ends it, or the round that replaces it. Online this component
  // is never unmounted between rounds, and nothing in the state names which
  // round is which, so a flag that outlived the opening would swallow the next
  // one whenever two rounds ran the same way.
  const [spentForPending, setSpentForPending] = useState(openingPending);
  if (openingPending !== spentForPending) {
    setSpentForPending(openingPending);
    if (!openingPending) setOpeningSpent(false);
  }
  const holdingForStart = openingPending && !openingSpent;

  const { withdrawn: tableWithdrawn, veil } = tableVeils({ settingsOpen, tableCovered, portrait, holdingForStart });
  const behindVeil = a11yVeiled(veil.table);
  const behindSheetOnly = a11yVeiled(veil.sheetOnly);
  const behindCoverOnly = a11yVeiled(veil.coverOnly);
  const clockVeil = a11yVeiled(veil.clock);
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
  // The round's end places the last player too, still holding cards: they keep their hand, untold.
  const wentOut = viewer?.finishPosition !== undefined && handCountOf(viewer) === 0;
  const isNewTrick = gameState.lastPlayedCombination === null;

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
  const handOrder = useHandOrder(viewerSeat, sortedHand);
  const {
    exchange,
    shownExchange,
    stages,
    onExchangeStage,
    onExchangeLegsReady,
    exchangeLit,
    exchangeShift,
    exchangeIsWinners,
    exchangeIsMine,
    giveableIds,
    exchangeLoserName,
    choiceOpen,
    exchangeChip,
    pileNote,
  } = useTableExchange({
    gameState,
    viewerSeat,
    spectating,
    announcement: exchangeAnnouncement?.visible ? exchangeAnnouncement.data : null,
    onExchangeReady,
    sortedHand,
  });
  const ringFlash = useSharedValue<RingFlash>({ seq: 0, seat: -1 });
  const lifted = useSharedValue<string[]>([]);
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
    () => canPassNowOf({ isMyTurn, isFinished, isNewTrick }),
    [isMyTurn, isFinished, isNewTrick]
  );
  const facts = React.useMemo<TableFacts>(
    () => ({
      hand: sortedHand,
      lastPlayedCombination: gameState.lastPlayedCombination,
      startCard: gameState.startCard,
      firstPlayMade: gameState.firstPlayMade,
      isNewTrick,
      isMyTurn,
      isFinished,
    }),
    [
      sortedHand,
      gameState.lastPlayedCombination,
      gameState.startCard,
      gameState.firstPlayMade,
      isNewTrick,
      isMyTurn,
      isFinished,
    ]
  );
  const passIsOnlyMove = React.useMemo(() => canPass && !canBeatPileOf(facts), [canPass, facts]);
  const passed = usePassedSeats(
    gameState.currentTurnIndex,
    gameState.lastPlayedBy,
    gameState.lastPlayedCombination,
    players
  );
  const { float, raise: raiseFloat } = useTableFloat({
    gameState,
    error,
    autoPassed,
    withdrawn: tableWithdrawn,
    viewerSeat,
    spectating,
  });

  const opponents = React.useMemo(
    () => arrangeOpponents(players, viewerSeat),
    [players, viewerSeat]
  );

  const layout = React.useMemo(
    () =>
      tableLayout({
        width: W,
        height: H,
        insets: { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right },
        scale,
      }),
    [W, H, insets.top, insets.bottom, insets.left, insets.right, scale]
  );
  const seating = React.useMemo<Seating>(() => ({ viewerSeat, players, opponents }), [viewerSeat, players, opponents]);
  const { frame, handCardH, pill: pillAnchor } = layout;
  const pillStandings =
    matchScore &&
    scorePillStandings({
      players,
      teams: gameState.gameMode === "teams",
      scores: matchScore.scores,
      placementPoints,
      finishingOrder: gameState.finishingOrder,
      viewerId: spectating ? undefined : viewer?.id,
    });
  const matchBoard =
    pillStandings && matchScore && matchActions
      ? matchBoardFor({
          standings: pillStandings,
          players,
          winners: matchWinners ?? [],
          score: matchScore,
          actions: matchActions,
          rating: matchRating,
          t,
        })
      : null;
  // Capture, returning false: every touch on the table closes the pill on its way to
  // whatever it was for, so the pill never costs a play. The pill's own box is left to
  // the pill, whose press toggles it.
  const closeScoreElsewhere = (e: GestureResponderEvent) => {
    roundEnding.skip();
    matchEnding.skip();
    if (scoreOpen) {
      const hit = scorePillHitBox(1, 0, pillAnchor, TOUCH_TARGET_MIN);
      const { pageX: x, pageY: y } = e.nativeEvent;
      if (x < hit.x || x > hit.x + hit.w || y < hit.y || y > hit.y + hit.h) setScoreOpen(false);
    }
    return false;
  };

  const [entryMs] = useState(() => motionMs("reveal", reduceMotion));
  const dealFresh = roundUnplayed(gameState);
  const deal = useDeal({
    layout,
    seating,
    fresh: dealFresh,
    entryMs,
    reduceMotion,
  });
  // What the table shows, and what Gioca follows; `canPass` and the clock keep the true turn.
  const turnShown = isMyTurn && !deal.dealing;
  useEffect(() => {
    onDealing?.(deal.dealing);
  }, [onDealing, deal.dealing]);
  const giocaFacts = React.useMemo<TableFacts>(() => ({ ...facts, isMyTurn: turnShown }), [facts, turnShown]);
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
        isMyTurn: turnShown,
        currentTurnName: players[gameState.currentTurnIndex]?.name ?? "",
        myCardCount: sortedHand.length,
        lastPlay,
        opponents: opponentsA11y,
        exchange: exchangeA11y,
        roundOver: gameState.roundOver,
        matchOver,
        dealing: deal.dealing,
      },
      tableA11yStrings
    );
  }, [
    gameState.roundOver,
    matchOver,
    gameState.lastPlayedCombination,
    gameState.lastPlayedBy,
    gameState.currentTurnIndex,
    players,
    viewerSeat,
    sortedHand.length,
    turnShown,
    deal.dealing,
    spectating,
    exchange,
    tableA11yStrings,
    t,
  ]);

  const landingSignal = useSharedValue<LandingSignal>(NO_LANDING);
  const timeline = useTableTimeline();
  const isTeamMode = gameState.gameMode === "teams";
  const outcome = roundOutcomeFor(players, gameState.finishingOrder, placementPoints, viewer?.id, isTeamMode);
  const matchOutcome = matchOutcomeFor(players, matchWinners ?? [], viewer?.id, isTeamMode);
  const {
    passaFlashStyle,
    kickStyle,
    giocaRejectX,
    rejectPlay,
    goingOutTrigger,
    celebrateGoingOut,
    shakeStyle,
    tableMotion,
  } = useTableFeedback({
    isMyTurn: turnShown,
    isFinished,
    canPass,
    passCount: gameState.passCount,
    lastPlayedCombination: gameState.lastPlayedCombination,
    trickWinner: gameState.trickWinner,
    roundOver: gameState.roundOver,
    outcome: scoredOutcome(outcome, gameState.finishingOrder, placementPoints),
    matchOutcome: matchOver ? matchOutcome : "pending",
    scale,
    landing: landingSignal,
    timeline,
  });

  const { style: handLiftStyle, lift: handLift } = useHandLift(
    (turnShown && !isFinished && !exchange.active) || exchangeIsMine,
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
    trickWinnerTag,
    onFlightStart,
    onFlightContact,
    onFlightDone,
    onFlightClock,
    bombClock,
    feltDim,
    ending,
  } = usePileFlight({
    lastPlayedCombination: gameState.lastPlayedCombination,
    lastPlayedBy: gameState.lastPlayedBy,
    trickWinner: gameState.trickWinner,
    roundOver: gameState.roundOver,
    matchOver,
    viewerWon: (matchOver ? matchOutcome : outcome) === "won",
    layout,
    seating,
    timeline,
    celebrateGoingOut,
    playTrickStart: trickStart,
    handOrigins,
    roomW: frame.fieldRoomW,
    catchUp,
    restored,
  });
  const landed = ending?.landedAt ?? null;
  const roundEnding = useRoundEnding({
    ended: gameState.roundOver && !matchOver && (onRoundLanded !== undefined || roundVote !== null || leftTable !== null),
    landed,
    hold: roundVote !== null || leftTable !== null,
    pileEmpty: trick.plays.length === 0,
    onLanded: onRoundLanded,
  });
  const roundShown = useRoundOutcome({ ended: gameState.roundOver && !matchOver, outcome, landed });
  const matchShown = useRoundOutcome({ ended: gameState.roundOver && matchOver, outcome: matchOutcome, landed });
  const shown = matchShown ?? roundShown;
  // A won match bursts from the viewer's own seat, so a teams win never lands on the partner's.
  const winnerId = matchShown === null ? gameState.finishingOrder[0] : matchShown === "won" ? viewer?.id : matchWinners?.[0];
  const winnerSeat = players.findIndex((p) => p.id === winnerId);
  const winnerDir = winnerSeat < 0 ? null : seatDirection(winnerSeat, viewerSeat, players.length);
  const lampToWinner = winnerDir !== null && (shown === "lost" || shown === "neutral");
  const matchOnTable = gameState.roundOver && matchOver && matchActions !== undefined;
  const matchEnding = useRoundEnding({
    ended: matchOnTable,
    landed,
    match: true,
    pileEmpty: trick.plays.length === 0,
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: matchDim(matchEnding.clock.value) }));
  const roundVoteStyle = useAnimatedStyle(() => {
    const shown = roundVoteShown(roundEnding.clock.value);
    return { opacity: shown, display: shown > 0 ? "flex" : "none" };
  });
  const [leftTableLive, setLeftTableLive] = useState(false);
  useAnimatedReaction(
    () => roundVoteShown(roundEnding.clock.value) >= 1,
    (live, prev) => {
      if (live !== prev) scheduleOnRN(setLeftTableLive, live);
    }
  );
  const shownTurnIndex = useShownTurn(gameState.currentTurnIndex, timeline);
  const shownTurnIsMine = viewerOwnsSeat(shownTurnIndex, viewerSeat, spectating);

  // The owner's own remedy for an announcement nobody noticed: swing the lamp
  // off the seat and onto the middle, where the words are. The table's existing
  // attention mechanism, pointed somewhere else — not a second device.
  const { anchors } = layout;
  const lampAim = lampPools(anchors, W, H)[
    lampToWinner ? winnerDir : holdingForStart ? "centre" : seatDirection(shownTurnIndex, viewerSeat, players.length)
  ];
  const emberFrom = useRef(shownTurnIndex);
  const emberRuns = !holdingForStart && !shownExchange && !gameState.roundOver && gameState.firstPlayMade;
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
    dim: shown === "lost",
  });
  const winnerAt = winnerDir === null ? null : anchors[winnerDir];
  const [wx, wy] = [winnerAt?.x ?? 0, winnerAt?.y ?? 0];
  const { sx: rigSx, sy: rigSy } = rig;
  const motesFor = useRef<ShownOutcome | null>(null);
  useEffect(() => {
    if (motesFor.current === shown) return;
    motesFor.current = shown;
    if (shown === null || winnerDir === null) return;
    particles.current?.emit(roundMotes(shown, { x: wx, y: wy }, reduceMotion, rigSx, rigSy, Math.random));
    if (matchShown === "won") particles.current?.rain();
  }, [shown, matchShown, winnerDir, wx, wy, reduceMotion, rigSx, rigSy]);
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
  const { grey, greyStyle, edgeGreyStyle, darkenStyle, greyed: linkGreyed, frozen: clockHeld } = useLinkHold(ownLink, rig, catchUp && timeline.inFlight);

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    warmCardArt();
  }, []);
  useLandscapeLock();
  const dealCue = useCallback((at: number) => event([{ kind: "deal" }], Math.max(performance.now(), at)), []);
  // Under reduced motion no deal flies to start the cue, and sound is not motion.
  useEffect(() => {
    if (dealFresh && reduceMotion) dealCue(performance.now());
  }, [dealFresh, reduceMotion, dealCue]);

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
  const showRefusal = useCallback((text: string) => raiseFloat("reject", text), [raiseFloat]);
  // Asked again rather than closing over `canPass`: with `canPass` as the
  // dependency, `react-hooks/preserve-manual-memoization` refuses this memo and
  // React Compiler skips the whole component.
  const handlePass = useCallback(() => {
    if (!canPassNowOf({ isMyTurn, isFinished, isNewTrick })) return;
    // Haptic only: the pass sound follows the committed state, so firing it
    // here as well would double the viewer's own pass.
    uiFeedback("light");
    selection.set({ ...settle(selection.get(), heldIds, selectionMode), ids: [] });
    onPass();
  }, [isMyTurn, isFinished, isNewTrick, onPass, selection, heldIds, selectionMode]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const top = topPlay(trick.plays);
  const onTop = top?.combo ?? null;
  const closer = top ? players[top.playedBy] : undefined;
  const closedByWinners =
    roundShown === "won" && closer !== undefined && (isTeamMode ? closer.team === viewer?.team : closer.id === viewer?.id);
  const comboLabel = comboText(onTop, t);

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

  const turn = turnPresentation({
    roundOver: gameState.roundOver,
    matchOver,
    dealing: deal.dealing,
    shownTurnIsMine,
    onMoveName: players[shownTurnIndex]?.name ?? "",
    exchange: { chip: exchangeChip, choiceOpen, viewerIsWinner: exchange.viewerIsWinner, active: exchange.active },
    timer: turnTimer,
    vote: roundVote?.deadline ?? null,
    isMyTurn,
    isFinished,
    isNewTrick,
    holdingForStart,
    held: clockHeld,
    turnToken: turnKey(gameState),
    t,
  });
  const countdown = useCountdown(turn.window);

  const startCardDue = !gameState.firstPlayMade && !!gameState.startCard;
  const whoStarts: StartReason | undefined =
    startReason ??
    (gameState.startCard
      ? { type: "start_card", card: gameState.startCard, playerIdx: gameState.currentTurnIndex }
      : undefined);
  const startGated = holdingForStart && !!startReason;

  useBenchHandle("tableAnchors", () => ({ width: W, height: H, anchors }));
  const seatTable: SeatTable = {
    onMoveSeat: !shownExchange && shown === null ? shownTurnIndex : null,
    passed,
    disconnectedSeats,
    exchangeLit,
    exchangeShift,
  };
  const opponentSeat = (place: OpponentSide) => {
    const opponent = opponents[place];
    return (
      opponent && (
        <OpponentSeat
          place={place}
          player={opponent.player}
          {...seatView(opponent.seat, opponent.player, seatTable)}
          dealArrivals={deal.arrivalsFor(opponent.seat)}
          scale={scale}
          countdown={turn.seat && countdown}
          focusMode={focusMode}
          flash={ringFlash}
        />
      )
    );
  };

  // The last hook: effects run in declaration order, so every producer above has queued its moments.
  useEffect(() => timeline.flush());

  return (
    <CardTableProvider value={cardTable}>
    <CardCastContext.Provider value={cardCast}>
    <View testID="game-root" style={[styles.root, WEB_CLIP]} onStartShouldSetResponderCapture={closeScoreElsewhere}>
      {/* Felt — decoration only: one canvas that never carries game
          information (#1244), lit by the one lamp rig. */}
      <Animated.View
        testID="table-felt"
        style={[StyleSheet.absoluteFill, FELT_Z, edgeGreyStyle, breathStyle]}
        pointerEvents="none"
        {...a11yHidden()}
      >
        <Felt rig={rig} stops={felt} pool={lampAim} ready={feltReady} onReady={onFeltReady} cards={cardTable} grey={grey} />
        <FeltScrim dim={feltDim} />
      </Animated.View>

      {/* The game, and everything a landing displaces. It clips at its own
          moving edge, so the strip the kick uncovers is the cloth behind it
          rather than whatever the window is drawn on. */}
      <Animated.View testID="game-layer" style={[styles.kick, WEB_CLIP, TABLE_Z, kickStyle]}>
        <Sweep trigger={goingOutTrigger} width={W} height={H} />
        <View testID="card-shade" style={[StyleSheet.absoluteFill, CARD_SHADE_Z]} pointerEvents="none" {...a11yHidden()}>
          <HandShade lamp={rig.lamp} cards={cardTable} ready={cardCast === "felt"} />
        </View>
        <Animated.View testID="table-particles" style={[StyleSheet.absoluteFill, PARTICLES_Z, edgeGreyStyle]} pointerEvents="none" {...a11yHidden()}>
          <ParticleLayer ref={particles} rig={rig} landing={landingSignal} grey={grey} />
        </Animated.View>
        <A11yStatus testID="table-status" label={tableA11yLabel} veiled={tableWithdrawn} />
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
            (holdingForStart || (darkenStyle && linkGreyed)) && HELD_CLOCK_Z,
            stackFadeStyle,
          ]}
        >
          <A11yVeil veil={clockVeil}>
            <View testID={choiceOpen ? "exchange-prompt" : undefined}>
              <WindowTurnChip
                scale={scale}
                lit={turn.chip.lit}
                chipText={turn.chip.text}
                spokenSeat={turn.chip.spoken}
                countdown={countdown}
                active={turn.clock.active}
                revealed={turn.clock.revealed}
                connection={choiceOpen && connectionNote?.state === "reconnected" ? null : connectionNote}
              />
            </View>
          </A11yVeil>
        </Animated.View>

        {pillStandings && matchScore && (!matchScore.single || matchOnTable) && (
          <Animated.View {...behindVeil} testID="score-pill-layer" pointerEvents="box-none" style={[styles.pillLayer, greyStyle]}>
            {matchOnTable && (
              <Animated.View testID="match-dim" pointerEvents="none" style={[styles.matchDim, dimStyle]} />
            )}
            <ScorePill
              standings={pillStandings}
              target={matchScore.target}
              open={scoreOpen}
              onPress={() => setScoreOpen((open) => !open)}
              anchor={pillAnchor}
              ending={matchOnTable ? matchEnding.clock : roundEnding.clock}
              match={matchOnTable ? matchBoard : null}
            />
          </Animated.View>
        )}

        {endMatchVote && !scoreOpen && (
          <View
            testID="end-match-vote"
            {...behindVeil}
            pointerEvents="box-none"
            style={[
              styles.voteSpot,
              { right: W - pillAnchor.right, top: voteTop(pillAnchor, false, scale) },
            ]}
          >
            <A11yVeil veil={behindVeil}>
              <EndMatchVote {...endMatchVote} scale={scale} />
            </A11yVeil>
          </View>
        )}

        {(leftTable || roundVote) && (
          <Animated.View
            {...behindVeil}
            testID={leftTable ? "left-table" : "round-vote"}
            pointerEvents="box-none"
            style={[
              styles.voteSpot,
              { right: W - pillAnchor.right, top: voteTop(pillAnchor, true, scale) },
              roundVoteStyle,
            ]}
          >
            <A11yVeil veil={behindVeil}>
              {leftTable ? (
                <LeftTable {...leftTable} live={leftTableLive} scale={scale} />
              ) : (
                roundVote && <RoundVote {...roundVote} scale={scale} />
              )}
            </A11yVeil>
          </Animated.View>
        )}

        <FloatSlot
          float={float}
          at={{ x: anchors.pile.x, y: layout.floatTop }}
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
            veiled={veil.sheet}
            onDone={() => setOpeningSpent(true)}
            scale={scale}
            tableLeft={frame.tableLeft}
            tableRight={frame.tableRight}
          />
        )}

        {/* The cutout's own column. A cutout can never sit on a card, but it sits
            happily between two controls — so the menu knob takes the head of the
            column, the reactions knob its foot, and the cutout the gap between. */}
        <Animated.View testID="control-rail-layer" pointerEvents="box-none" style={[StyleSheet.absoluteFill, RAIL_Z, edgeGreyStyle]}>
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
                <Ionicons name={settingsOpen ? "close" : "menu"} size={knobSize * 0.4} color={Colors.textMuted} {...a11yHidden()} />
              </RailKnob>
            }
            bottom={
              <Animated.View pointerEvents={focusMode ? "none" : undefined} style={focusFadeStyle}>
                {railExtra}
              </Animated.View>
            }
          />
        </Animated.View>

        {darkenStyle && <Animated.View testID="grey-scrim" pointerEvents="none" {...a11yHidden()} style={[styles.greyScrim, darkenStyle]} />}

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
          testID="banner-band"
          {...behindVeil}
          style={[
            styles.bannerBand,
            {
              top: layout.chipsBottom,
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
            layout.tableBox,
            greyStyle,
          ]}
        >
          <A11yVeil veil={behindVeil}>
          <Animated.View style={[sharedTableStyles.tableContent, shakeStyle]}>
            <View testID="table-top-section" style={[sharedTableStyles.topSection, { height: topBandHeight(scale) }]}>
              {opponentSeat("top") ?? <View />}
            </View>

            {/* The band left over between the top band and the hand. The seats
                and the field centre in what is actually there rather than at a
                guessed percentage. */}
            {/* The flier's first frame sits on its own hand slot or fan, so the pile's band paints above both while one is up. */}
            <View style={[sharedTableStyles.midSection, (flights.length > 0 || shownExchange !== null) && { zIndex: Layer.moment }]}>
              <View style={[sharedTableStyles.sideSection, sharedTableStyles.sideSectionLeft, { height: sideSlotHeight(scale) }]}>
                {opponentSeat("left")}
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
                  trickWinner={trickWinnerTag === null ? null : players[trickWinnerTag.seat]?.name ?? ""}
                  roomW={frame.fieldRoomW}
                  scale={scale}
                  note={pileNote}
                  hidden={startCardDue}
                  opacity={roundEnding.pileOpacity}
                  lit={closedByWinners}
                />

                {/* Centred on the same point the pile draws at, so the burst
                    rings the impact rather than the middle of the table box. */}
                <BombBurst landing={landingSignal} scale={scale} />

                {/* Beside the pile, not beside the table: the flight has to
                    settle exactly where the pile then draws the same cards,
                    and the rail makes the table box asymmetric — centred on the
                    screen instead, the combination lands and then jumps. */}
                {shownExchange && (
                  <ExchangeLegs
                    key={stages.key}
                    announced={shownExchange}
                    stages={stages}
                    layout={layout}
                    seating={seating}
                    handOrigins={handOrigins}
                    go={!deal.dealing}
                    viewerSeat={spectating ? null : viewerSeat}
                    scale={scale}
                    flash={ringFlash}
                    lifted={lifted}
                    onStage={onExchangeStage}
                    onReady={onExchangeLegsReady}
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
                {opponentSeat("right")}
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
                  height: layout.handZoneH,
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

              {wentOut ? (
                <View style={[styles.finishedRow, { width: frame.handAvailW, height: handVisibleH(handCardH) }]}>
                  <WaitingLine scale={scale} />
                </View>
              ) : (
                <HandRow
                  facts={facts}
                  turnShown={turnShown}
                  viewerSeat={spectating ? null : viewerSeat}
                  arrangement={handOrder}
                  exchange={{ shown: shownExchange, stages, giveableIds, lifted }}
                  deal={{ key: deal.key, hand: deal.hand && { ...deal.hand, onDealt } }}
                  geometry={{
                    availW: frame.handAvailW,
                    roomW: frame.handRoomW,
                    bottomPad: frame.bottomPad,
                    scale,
                    onOrigins: onHandOrigins,
                  }}
                  selection={{ store: shownSelection, ui: uiSelection, onActivate: handleCardPress }}
                />
              )}

              {!spectating && (
                <GiocaControl
                  store={shownSelection}
                  facts={giocaFacts}
                  giveTo={exchangeIsMine ? exchangeLoserName : null}
                  lit={exchangeIsMine || (turnShown && !isFinished && !exchange.active)}
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
  greyScrim: { ...StyleSheet.absoluteFill, zIndex: Layer.greyScrim, backgroundColor: Colors.shadow },
  matchDim: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: Layer.felt, backgroundColor: Colors.shadow },
  handSectionReversed: { flexDirection: "row-reverse" },


  finishedRow: { alignItems: "center", justifyContent: "center" },

});

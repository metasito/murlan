// The one presentational game table.
//
// app/game.tsx (offline, local engine) and app/(online)/game.tsx (online,
// server-authoritative socket state) were ~2,400 lines of parallel
// implementation of this. They are now thin adapters: each maps its own state
// source onto `GameTableProps` and passes its own extras through the slots.
// Nothing below knows or cares which mode it is running in.
//
// Where the two modes genuinely differ the difference is an explicit prop or a
// slot (`topBarExtra`, `banners`, `overlays`, `turnTimer`) — never an
// `isOnline &&` branch threaded through the render.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Platform,
  useWindowDimensions,
  type AccessibilityProps,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { TableText } from "@/components/table/TableText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  cancelAnimation,
  FadeIn,
} from "react-native-reanimated";
import * as ScreenOrientation from "expo-screen-orientation";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  getValidGivebackCards,
  givebackIsFallback,
  sortHand,
  type Card,
  type GameState,
} from "@/lib/gameEngine";
import { useTradedCardsLanded, type ExchangeAnnounceData } from "@/lib/sharedGameFlow";
import {
  CHIP_H,
  HAND_ZONE_H,
  CARD_H,
  exchangeFlight,
  type ExchangeFlight,
  cardScale,
  actionBtnSize,
  HAND_ZONE_GAP,
  advancePile,
  arrangeOpponents,
  canPassNow as canPassNowOf,
  comboKey,
  computeTableFrame,
  railSideFor,
  LANDSCAPE_LEFT,
  readHandArrival,
  describeTableForA11y,
  EMPTY_PILE,
  handCountOf,
  readThrownPlay,
  impactDelayMs,
  landingTier,
  lightPosition,
  passedSeats,
  readExchange,
  roundClosedWithWinner,
  seatDirection,
  turnTimerActive,
  viewerOwnsSeat,
  type FlyDirection,
  type OpponentSide,
  type PileState,
  type TableA11yExchange,
  type TableA11yLastPlay,
  type TableA11yOpponent,
} from "@/components/gameTableModel";
import { useTranslation } from "@/lib/i18n";
import {
  CHIP_NAME_MAX_W,
  ChipDot,
  ChipText,
  ControlRail,
  useHandLift,
  RailKnob,
  sharedTableStyles,
  StartCardBanner,
  StartReasonBanner,
  TableChip,
} from "@/components/table/chrome";
import {
  arrangedLabel,
  handLabel,
  lastPlayLabel,
  playRefusalLabel,
  tableStrings,
  topBarLabel,
} from "@/components/table/spokenLabels";
import { readStagedPlay } from "@/components/table/stagedPlay";
import { TurnTimer } from "@/components/table/turnTimer";
import { GiocaButton, PassaButton } from "@/components/table/actions";
import { RematchPromptPanel, type RematchAnswers } from "@/components/table/rematchPrompt";
import { FeltPool } from "@/components/table/felt";
import { StraightHand } from "@/components/table/hand";
import { RotateOverlay } from "@/components/table/rotateOverlay";
import { GameSettingsSheet } from "@/components/table/settingsSheet";
import { useTableFeedback } from "@/components/useTableFeedback";
import { useHandOrder } from "@/components/useHandOrder";
import { FlyingCards, PlayedPile, getComboLabel } from "@/components/table/pile";
import { BombBurst, Sweep } from "@/components/table/moments";
import { TopOppSlot, SideOppSlot } from "@/components/table/seats";
import { ExchangeAnnouncement } from "@/components/ExchangeAnnouncement";
import { ExchangePrompt } from "@/components/table/ExchangePrompt";
import { CARD_W, FIELD_SCALE, HAND_SCALE, physicalTouchTarget } from "@/components/cardFaceModel";
import {
  playCardSelect,
  playCardPlay,
  playRoundStart,
  playRoundWin,
  playDeal,
  preloadSounds,
  unloadSounds,
} from "@/lib/sounds";
import { hapticError, hapticLight, hapticMedium, hapticSelection } from "@/lib/haptics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, FontSize, Motion, Radius, Scrim, Spacing, Layer } from "@/lib/theme";
import { useTableFelt } from "@/lib/cosmetics";
import { A11yStatus, a11yGroup, a11yHidden, a11yVeiled } from "@/lib/a11y";

// How long the round-winner tag stays over the pile. A domain beat, not a
// generic UI transition, so it is not a Motion token.
const ROUND_WINNER_MS = 1800;
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

// How long the refused-play reason stays on screen, and how wide it may get
// before it wraps onto its second (and last) line.
const REJECT_HINT_MS = 2600;
const REJECT_HINT_MAX_W = 260;
/** Above the top bar and the rematch panel: the reason must not be covered. */
const REJECT_HINT_Z = Layer.hint;
/** The banner band sits over the felt, under the reject hint. */
const BANNER_BAND_Z = Layer.band;
/**
 * The felt is decoration and everything else is the game, so the game is
 * always on top. Stated rather than left to sibling order: the pool paints
 * over the seats, the pile and the hand on the iOS renderer, which draws that
 * subtree above them however the tree is written (#209).
 */
const FELT_Z = { zIndex: Layer.felt } as const;
const TABLE_Z = { zIndex: Layer.table } as const;

/**
 * A sentence the browser harness reads, as `data-<hyphenated key>`. `dataSet` is
 * react-native-web's own escape hatch and reaches the DOM; React Native has no such
 * prop and no types for it, which is what the cast is for. It is deliberately not an
 * `accessibilityLabel`: these containers cannot be `accessible` without collapsing
 * their controls into one leaf, so a name on them would reach no reader at all.
 * `tests/e2e/helpers/selectors.ts` holds the other end.
 */
const harnessState = (state: Record<string, string>) => ({ dataSet: state }) as ViewProps;

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
   * Count down while leading a new round too. False offline (leading has no
   * deadline); true online, where the server arms its AFK timer every turn.
   */
  includeNewRound?: boolean;
  /**
   * Called when the countdown reaches zero. Offline this auto-passes locally;
   * online it is omitted, because the server owns the timeout and the client
   * countdown is only a display of it.
   */
  onExpire?: () => void;
}

/**
 * The rematch question, put to the table down the side of the screen while the
 * closing manche is still being played. Majority decides; a seat that never
 * answers counts as a no.
 */
export interface RematchPromptSlot extends RematchAnswers {
  visible: boolean;
}

export interface ExchangeAnnouncementSlot {
  visible: boolean;
  data: ExchangeAnnounceData | null;
  onDismiss: () => void;
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
  /** Seat the table is drawn from. Always rendered at the bottom. */
  viewerSeat: number;
  /**
   * Watching, not playing. The bottom seat belongs to someone else, so its
   * cards are drawn face-down from `handCount` and the actions are absent.
   * An explicit prop rather than a null `viewerSeat`, which is read in a dozen
   * places and would put a branch in each of them.
   */
  spectating?: boolean;

  selectedIds: string[];
  onSelectCard: (cardId: string) => void;
  /** Only ever called with a selection that is a legal play. */
  onPlay: (cardIds: string[]) => void;
  onPass: () => void;
  onQuit: () => void;
  onExchangeGive: (cardId: string) => void;

  turnTimer?: TurnTimerConfig;
  exchangeAnnouncement?: ExchangeAnnouncementSlot;
  rematchPrompt?: RematchPromptSlot;

  /** The rail's lower knob (online: the reactions trigger). */
  railExtra?: React.ReactNode;
  /** Transient strips under the top bar (online: reconnect notice). */
  banners?: React.ReactNode;
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
  viewerSeat,
  spectating = false,
  selectedIds,
  onSelectCard,
  onPlay,
  onPass,
  onQuit,
  onExchangeGive,
  turnTimer,
  exchangeAnnouncement,
  rematchPrompt,
  railExtra,
  banners,
  overlays,
  tableCovered = false,
}: GameTableProps) {
  const { t, tn } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
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

  // Whether the rail's settings sheet is open, and the two toggles it owns
  // that live nowhere else: focus mode and the left-handed swap are a
  // session's own choice, not a stored preference — sound, music and
  // vibration are the persisted ones, which the sheet reads for itself.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rotation, setRotation] = useState<number>(LANDSCAPE_LEFT);
  const tableWithdrawn = settingsOpen || tableCovered;
  const behindVeil = a11yVeiled(tableWithdrawn);
  // The sheet hangs off the rail, outside the overlays slot, so the slot goes
  // behind its veil. A cover inside the slot does not: `app/(online)/game.tsx`
  // spreads this onto the one wrapper holding the cover, which would withdraw
  // the cover's own message along with the table it is explaining.
  const behindSheetOnly = a11yVeiled(settingsOpen);
  // The rail is the one child that answers to a cover but not to the sheet: the sheet is
  // closed by the knob the rail carries, so veiling it there shuts the reader inside.
  const behindCoverOnly = a11yVeiled(tableCovered && !settingsOpen);
  const [focusMode, setFocusMode] = useState(false);
  const [playOnLeft, setPlayOnLeft] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);

  // The HUD chips and the reactions trigger fade rather than vanish under
  // focus mode — kept mounted throughout, so a timer or an in-flight
  // animation living inside them (the turn countdown included) is never torn
  // down and restarted by a toggle that is about decluttering the felt, not
  // about the turn itself.
  const focusFade = useSharedValue(1);
  useEffect(() => {
    const target = focusMode ? 0 : 1;
    if (reduceMotion) {
      cancelAnimation(focusFade);
      focusFade.value = target;
      return;
    }
    focusFade.value = withTiming(target, { duration: Motion.duration.travel });
    return () => cancelAnimation(focusFade);
  }, [focusMode, reduceMotion, focusFade]);
  const focusFadeStyle = useAnimatedStyle(() => ({ opacity: focusFade.value }));

  // The seat that took the last round and a counter of how many rounds have
  // closed. The counter is what makes an identical repeat a new announcement:
  // the seat that wins a round leads the next one, so the same seat winning
  // twice running is ordinary play.
  const [roundWinnerTag, setRoundWinnerTag] = useState<{ seat: number; closure: number } | null>(null);
  const [pileState, setPileState] = useState<PileState>(EMPTY_PILE);
  const [pileBounceTrigger, setPileBounceTrigger] = useState(0);
  const [flyInfo, setFlyInfo] = useState<{
    key: string;
    dir: FlyDirection;
    cards: Card[];
    /** Where the throw starts — components/gameTableModel.ts `flightOrigin`. */
    origin: { dx: number; dy: number };
  } | null>(null);
  // False for exactly impactDelayMs() from the moment a flight begins — the
  // throwing seat's own held count and departing backs read off this, not off
  // flyInfo's own lifetime, which runs past the landing to cover the settle
  // spring too (components/table/pile.tsx `FlyingCards`).
  const [flightLanded, setFlightLanded] = useState(true);
  const landTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Impact feedback is scheduled for the moment the thrown card lands, so it
  // has to be cancellable: a fast next play, or leaving the table, must not
  // fire a bang for a card that is no longer in the air.
  const impactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Non-null while the winning combination is being held on the felt under the
  // round-winner tag. Its presence is what tells the pile effect the felt is
  // spoken for.
  const roundHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevComboKeyRef = useRef<string>("");
  const roundClosedRef = useRef(false);

  // The reason a tap on an unavailable GIOCA was refused, spelled out. Keyed by
  // a counter so tapping again restarts the dwell instead of being swallowed as
  // an unchanged value.
  const [rejectHint, setRejectHint] = useState<{ key: number; text: string } | null>(null);

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
  const sortedHand = React.useMemo(() => {
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
  // The engine's order is the fallback; what the player sees is whatever they
  // have arranged on top of it (#531). Spectated hands are excluded by the
  // seat's own cards being synthetic above — there is nothing there to arrange.
  const { arranged: shownHand, moveTo } = useHandOrder(viewerSeat, sortedHand);
  // Held back at display rather than by deferring the state: online the state
  // is the server's, and freezing a whole snapshot for the length of a phase
  // would swallow every other thing that arrives in that window.
  //
  // Arranged first and filtered second, so the card lands in the place the
  // player arranged for it instead of re-entering an order computed without it.
  const announcing = exchangeAnnouncement?.visible === true;
  const announceData = exchangeAnnouncement?.data ?? null;
  // Only until the card lands, not for the whole notice — the tags beside each
  // seat stay up another `Reading.notice` to be read, and a hand short of a card
  // for four seconds after it arrived is a different defect.
  const tradedCardsLanded = useTradedCardsLanded(announcing, announceData?.bothJokersException);
  const { withheldId, arrivingIndex, descendingId } = readHandArrival({
    hand: shownHand,
    exchange,
    announce: announcing ? announceData : null,
    viewerSeat: spectating ? null : viewerSeat,
    landed: tradedCardsLanded,
    reduceMotion,
  });
  const handOnTable =
    withheldId === undefined ? shownHand : shownHand.filter((c) => c.id !== withheldId);
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
  const staged = React.useMemo(
    () =>
      readStagedPlay({
        hand: sortedHand,
        selectedIds,
        lastPlayedCombination: gameState.lastPlayedCombination,
        startCard: gameState.startCard,
        firstPlayMade: gameState.firstPlayMade,
        isNewRound,
        isMyTurn,
        isFinished,
      }),
    [
      sortedHand,
      selectedIds,
      gameState.lastPlayedCombination,
      gameState.startCard,
      gameState.firstPlayMade,
      isNewRound,
      isMyTurn,
      isFinished,
    ]
  );
  // Which seats have already answered the round on the table. Derived rather
  // than stored, so a new lead empties it on the same commit that lands the
  // card and no effect has to clear it.
  const passed = React.useMemo(
    () =>
      passedSeats({
        currentTurnIndex: gameState.currentTurnIndex,
        lastPlayedBy: gameState.lastPlayedBy,
        lastPlayedCombination: gameState.lastPlayedCombination,
        outOfCards: players.map((p) => handCountOf(p) === 0),
      }),
    [
      gameState.currentTurnIndex,
      gameState.lastPlayedBy,
      gameState.lastPlayedCombination,
      players,
    ]
  );

  const canPass = canPassNowOf({ isMyTurn, isFinished, isNewRound });

  // ── The exchange, on the table ──────────────────────────────────────────────
  //
  // The winner picks from their own hand rather than from a filtered row in a
  // dialog, so the legality the engine enforces has to be readable in the fan:
  // `getValidGivebackCards` is the same call `processExchangeChoice` validates
  // against, asked here only to decide which cards light up.
  const exchangeIsMine = exchange.active && exchange.viewerIsWinner;
  const giveable = React.useMemo(
    () =>
      exchangeIsMine ? getValidGivebackCards(sortedHand, exchange.cardFromLoser?.id) : undefined,
    [exchangeIsMine, sortedHand, exchange.cardFromLoser?.id]
  );
  const giveableIds = React.useMemo(() => giveable?.map((c) => c.id), [giveable]);
  // Kept apart from `selectedIds`, which stages a *play*: an exchange gives one
  // card, and folding it into a multi-select the play button also reads would
  // let a staged combination survive into the next manche.
  const [exchangePick, setExchangePick] = useState<string | null>(null);
  useEffect(() => {
    if (!exchangeIsMine) setExchangePick(null);
  }, [exchangeIsMine]);
  const pickedGiveCard = exchangePick
    ? (sortedHand.find((c) => c.id === exchangePick) ?? null)
    : null;
  const exchangeLoserName = exchange.loser?.name ?? "";

  const dimReasonText = playRefusalLabel(
    { refusal: staged.refusal, isMyTurn, isFinished, startCard: gameState.startCard },
    t
  );

  const opponents = React.useMemo(
    () => arrangeOpponents(players, viewerSeat),
    [players, viewerSeat]
  );

  const railSide = railSideFor(Math.max(insets.left, insets.right), rotation);
  const frame = computeTableFrame({ width: W, height: H, insets, scale, railSide });
  // The felt box the lamp lives in. The pool is drawn oversized and slid under
  // this box's own clipping, so it needs the box rather than the screen.
  const feltW = W;
  const feltH = H;
  const light = lightPosition(
    seatDirection(gameState.currentTurnIndex, viewerSeat, players.length)
  );

  // ── Screen-reader table description ─────────────────────────────────────────
  //
  // describeTableForA11y (gameTableModel.ts) does the ordering; this just
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
      },
      tableA11yStrings
    );
  }, [
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

  const handA11yLabel = React.useMemo(
    () => handLabel(handOnTable.length, selectedIds.length, tn),
    [tn, handOnTable.length, selectedIds.length]
  );

  const {
    giocaFlashStyle,
    passaFlashStyle,
    giocaGlowStyle,
    kickStyle,
    giocaRejectX,
    playImpact,
    rejectPlay,
    boomTrigger,
    flushTrigger,
    celebrateFlush,
    shakeStyle,
    shake,
  } = useTableFeedback({
    isMyTurn,
    isFinished,
    exchangeActive: exchange.active,
    canPass,
    playBtnValid: staged.playable,
    selectedCount: selectedIds.length,
    passCount: gameState.passCount,
    lastPlayedCombination: gameState.lastPlayedCombination,
    roundWinner: gameState.roundWinner,
    gameOver: gameState.gameOver,
    rankings: gameState.rankings,
    viewerId: viewer?.id,
    scale,
  });

  const handLiftStyle = useHandLift(
    (isMyTurn && !isFinished && !exchange.active) || exchangeIsMine,
    scale
  );

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  // The lock permits both landscape directions, so the cutout is on whichever
  // side the player is holding the phone — and the rail is the cutout's column.
  useEffect(() => {
    let mounted = true;
    const follow = (o: ScreenOrientation.Orientation) => {
      if (mounted) setRotation(o);
    };
    ScreenOrientation.getOrientationAsync().then(follow).catch(() => {});
    const sub = ScreenOrientation.addOrientationChangeListener((e) =>
      follow(e.orientationInfo.orientation)
    );
    return () => {
      mounted = false;
      // `removeOrientationChangeListener` throws on a subscription with no
      // `remove`, which is what the native module hands back untethered.
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    // Fast game -> result -> game navigation makes these cancel each other, and an
    // unhandled rejection here is fatal on device.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    // Guarded: the cleanup removes every native player, so resolving after unmount
    // would play through a released one.
    preloadSounds()
      .then(() => {
        if (mounted) playDeal();
      })
      .catch(() => {});
    return () => {
      mounted = false;
      ScreenOrientation.unlockAsync().catch(() => {});
      unloadSounds();
    };
  }, []);

  // Flying card + pile state, derived straight from the game state so a card
  // can never be shown twice or dropped. CLAUDE.md marks this load-bearing.
  useEffect(
    () => () => {
      if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
      if (roundHoldTimerRef.current) clearTimeout(roundHoldTimerRef.current);
      if (landTimerRef.current) clearTimeout(landTimerRef.current);
    },
    []
  );

  // The dedupe on `prevComboKeyRef` comes before anything with an effect, so a
  // re-run for one of the other dependencies leaves the pile, the flying card
  // and the pending impact exactly as they were.
  useEffect(() => {
    // A flight ending early — a new lead before it landed, the table leaving —
    // must not leave a stale hold on the throwing seat's own count.
    const clearLanding = () => {
      if (landTimerRef.current) {
        clearTimeout(landTimerRef.current);
        landTimerRef.current = null;
      }
      setFlightLanded(true);
    };

    // Clearing the felt and announcing a new round are one beat, whether it
    // happens now or after the winning cards have been held.
    const openNewRound = () => {
      playRoundStart();
      setPileState(EMPTY_PILE);
      setFlyInfo(null);
      clearLanding();
    };

    const combo = gameState.lastPlayedCombination;
    if (combo === null) {
      // The winning cards are being held for the tag; nothing may take the
      // felt out from under them until the hold expires or a new lead arrives.
      if (roundHoldTimerRef.current) return;
      if (prevComboKeyRef.current === "") {
        setPileState(EMPTY_PILE);
        setFlyInfo(null);
        clearLanding();
        return;
      }
      if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
      prevComboKeyRef.current = "";
      if (roundClosedWithWinner({ lastPlayedCombination: combo, roundWinner: gameState.roundWinner })) {
        roundHoldTimerRef.current = setTimeout(() => {
          roundHoldTimerRef.current = null;
          openNewRound();
        }, ROUND_WINNER_MS);
        return;
      }
      openNewRound();
      return;
    }
    const key = comboKey(combo, gameState.lastPlayedBy);
    if (key === prevComboKeyRef.current) return;
    if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
    // A lead inside the hold window ends it early: the new card has to fly
    // onto a cleared pile, not onto the combination it did not beat.
    if (roundHoldTimerRef.current) {
      clearTimeout(roundHoldTimerRef.current);
      roundHoldTimerRef.current = null;
      openNewRound();
    }
    prevComboKeyRef.current = key;
    setPileState((s) => advancePile(s, combo, gameState.lastPlayedBy));

    const thrown = readThrownPlay({
      combo,
      playedBy: gameState.lastPlayedBy,
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
    });

    // The card is thrown here and arrives ~312ms later, so everything that
    // reads as *impact* waits for it. Announced for every seat, not only the
    // viewer's: the sound belongs to a card landing, not to a tap.
    impactTimerRef.current = setTimeout(() => {
      playImpact(thrown.heavy);
      shake(landingTier({ comboType: combo.type, handOver: gameState.gameOver, matchOver }));
      if (thrown.emptiedHand) celebrateFlush();
    }, impactDelayMs(reduceMotion));

    // The throwing seat's held count and departing backs read off this same
    // boundary — the fan and the badge drop the instant the impact fires,
    // not whenever FlyingCards' settle spring happens to finish.
    if (landTimerRef.current) clearTimeout(landTimerRef.current);
    setFlightLanded(false);
    landTimerRef.current = setTimeout(() => {
      landTimerRef.current = null;
      setFlightLanded(true);
    }, impactDelayMs(reduceMotion));

    setFlyInfo({ key, dir: thrown.dir, cards: thrown.cards, origin: thrown.origin });
  }, [
    gameState.lastPlayedCombination,
    gameState.lastPlayedBy,
    gameState.roundWinner,
    gameState.gameOver,
    matchOver,
    viewerSeat,
    players.length,
    reduceMotion,
    playImpact,
    shake,
    celebrateFlush,
    players,
    opponents,
    scale,
    W,
    H,
    frame.tableLeft,
    frame.tableRight,
    frame.tableTop,
    frame.surplus,
    frame.bottomPad,
    handCardH,
  ]);

  // Round-winner tag over the pile, keyed on the round *closing* rather than on
  // the value of `roundWinner`: processPlay leaves that field standing through
  // the round the winner goes on to lead, so with two players it never changes
  // and every win after the first would go unannounced. The seat is what is
  // stored, not the name — the name is looked up at render, so a game update
  // that only changes the player list cannot restart the banner's own timers.
  useEffect(() => {
    if (
      !roundClosedWithWinner({
        lastPlayedCombination: gameState.lastPlayedCombination,
        roundWinner: gameState.roundWinner,
      })
    ) {
      roundClosedRef.current = false;
      return;
    }
    if (roundClosedRef.current) return;
    roundClosedRef.current = true;
    const seat = gameState.roundWinner!;
    setRoundWinnerTag((prev) => ({ seat, closure: (prev?.closure ?? 0) + 1 }));
  }, [gameState.lastPlayedCombination, gameState.roundWinner]);

  // A round closes on a pass, never on a play, so nothing is in flight here and
  // the sting is the first sound of the beat — ahead of the round-start sting,
  // which the pile effect has deferred for as long as this tag is up.
  useEffect(() => {
    if (roundWinnerTag === null) return;
    playRoundWin();
    const dismiss = setTimeout(() => setRoundWinnerTag(null), ROUND_WINNER_MS);
    return () => clearTimeout(dismiss);
  }, [roundWinnerTag]);

  useEffect(() => {
    if (rejectHint === null) return;
    const id = setTimeout(() => setRejectHint(null), REJECT_HINT_MS);
    return () => clearTimeout(id);
  }, [rejectHint]);

  // A card can leave the hand without the player having touched it — the server
  // moves for a seat that ran out of clock — and a staged id the hand no longer
  // holds is both a lit GIOCA the server refuses and a play the viewer did not
  // choose. `onSelectCard` toggles, so naming such an id drops it. An id the
  // *new* hand does hold is a different problem, and the manche boundary is
  // where it is cleared (app/(online)/game.tsx, context/GameContext.tsx).
  useEffect(() => {
    if (spectating) return;
    const handIds = new Set(sortedHand.map((c) => c.id));
    for (const id of selectedIds) {
      if (!handIds.has(id)) onSelectCard(id);
    }
  }, [sortedHand, selectedIds, onSelectCard, spectating]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  // These three reach the memoized hand as props, so they are stabilized by
  // hand: a fresh arrow per render defeats every card's memo comparator.
  // Staging a play while an opponent thinks is how every game in this family
  // works, and it is what stops the turn clock starting from a blank hand.
  // Only the *submission* is gated on the turn: `staged.playable` already
  // requires it, so GIOCA lights on its own the moment the turn arrives.
  const handleCardPress = useCallback(
    (id: string) => {
      if (isFinished || spectating) return;
      hapticSelection();
      playCardSelect();
      // An exchange gives exactly one card, so a second tap replaces the pick
      // rather than adding to it.
      if (exchangeIsMine) {
        setExchangePick((prev) => (prev === id ? null : id));
        return;
      }
      onSelectCard(id);
    },
    [isFinished, spectating, onSelectCard, exchangeIsMine, setExchangePick]
  );
  // The button stays pressable while it is unavailable so a refusal has a
  // channel: an error haptic, a shake, and the reason in words. It keeps
  // reporting itself as disabled to assistive tech.
  const handlePlay = useCallback(() => {
    if (!staged.playable) {
      hapticError();
      setRejectHint((prev) => ({ key: (prev?.key ?? 0) + 1, text: dimReasonText }));
      rejectPlay();
      return;
    }
    // Haptic only: the throw is acknowledged in the hand, and card_play sounds
    // when the card actually reaches the pile.
    hapticMedium();
    // The validated set, not the raw selection: the server rejects — silently —
    // any request naming a card the hand does not hold.
    onPlay(staged.cards.map((c) => c.id));
  }, [staged, onPlay, dimReasonText, rejectPlay, setRejectHint]);
  // The table's own GIOCA is the exchange's confirm — a second floating button
  // would be the dialog this replaced, in a smaller coat (#532). Its own
  // function rather than a branch inside handlePlay: they answer the same key,
  // but only one of them is a play, and the compiler cannot preserve a manual
  // memo over a translated string (scripts/react-compiler-probe.mjs).
  const handleExchangeGive = () => {
    if (!exchangePick) {
      hapticError();
      setRejectHint((prev) => ({
        key: (prev?.key ?? 0) + 1,
        text: t("exchange.confirmA11yWaiting", { name: exchangeLoserName }),
      }));
      rejectPlay();
      return;
    }
    hapticMedium();
    playCardPlay();
    onExchangeGive(exchangePick);
  };
  const handlePass = useCallback(() => {
    if (!canPass) return;
    // Haptic only: the pass sound follows the committed state, so firing it
    // here as well would double the viewer's own pass.
    hapticLight();
    onPass();
  }, [canPass, onPass]);

  // ── Render ──────────────────────────────────────────────────────────────────

  // Cards the throwing seat's own fan holds back until the flight lands —
  // displayedHandCount's other term, cleared at `flightLanded` rather than at
  // `flyInfo`'s own lifetime, which runs past the landing for the settle
  // spring. `impactDelayMs(reduceMotion)` is 0 under reduced motion, so
  // `flightLanded` is already true by the next render and nothing holds.
  const departingSide: OpponentSide | null =
    flyInfo && !flightLanded && flyInfo.dir !== "bottom" ? flyInfo.dir : null;
  const departingCount = departingSide ? flyInfo!.cards.length : 0;

  const timerActive =
    !!turnTimer &&
    turnTimerActive({
      isMyTurn,
      isFinished,
      isNewRound,
      gameOver: gameState.gameOver,
      exchangeActive: exchange.active,
      includeNewRound: turnTimer.includeNewRound ?? false,
    });

  // Changes on every move and every pass, so the countdown restarts once per
  // turn — including when the same seat leads a new round after winning one.
  const turnToken =
    `${gameState.currentTurnIndex}|${gameState.passCount}|` +
    (gameState.lastPlayedCombination
      ? comboKey(gameState.lastPlayedCombination, gameState.lastPlayedBy)
      : "-");

  const comboLabel = getComboLabel(pileState.current, t);

  // Named off `pileState`, not `gameState.lastPlayedBy` — the pile lags the
  // game state by the flight animation, and reading the seat straight off the
  // game state would name the *new* player over the *old* combination for the
  // length of one throw. Spectating, the bottom seat is someone else's, so no
  // play on the felt is the watcher's own.
  const playedByViewer = viewerOwnsSeat(pileState.playedBy, viewerSeat, spectating);
  const lastPlayName =
    pileState.playedBy === null
      ? ""
      : playedByViewer
        ? t("gameShared.you")
        : (players[pileState.playedBy]?.name ?? "");

  const topBarA11yLabel = topBarLabel(pileState.current, playedByViewer, lastPlayName, t);

  // The seat on move sweeps its own rim over the same window the viewer's chip
  // counts down, so both are armed by one gate. There is no per-seat deadline
  // to read — online the server arms one window per turn, offline there is none
  // at all — so the turn changing is what arms it, exactly as it arms the chip.
  //
  // Asked about the seat the ring is drawn on, never about the viewer: a seat
  // that is not the viewer's still has a server deadline online once the viewer
  // is out.
  const seatCountdown =
    turnTimer &&
    turnTimerActive({
      // SeatRing draws this only on the seat that is on move, so the subject of
      // the question is always a seat whose turn it is — and never one that has
      // gone out, because `getNextActivePlayer` (lib/gameEngine.ts) steps over
      // an empty hand rather than landing on it.
      isMyTurn: true,
      isFinished: false,
      isNewRound,
      gameOver: gameState.gameOver,
      exchangeActive: exchange.active,
      includeNewRound: turnTimer.includeNewRound ?? false,
    })
      ? { seconds: turnTimer.seconds, resetKey: `${turnToken}|${turnTimer.resetKey ?? ""}` }
      : undefined;

  const showStartCardBanner = !gameState.firstPlayMade && !!gameState.startCard;

  // The catch belongs to the combination that emptied a hand, and to no other:
  // the pile mounts fresh cards for every play, so each one would read a
  // standing counter as its own cue. A seat holding nothing can only have
  // thrown its last cards, so the top layer being theirs is the whole test.
  const pileThrower =
    pileState.playedBy === null ? undefined : players[pileState.playedBy];
  const pileFlushed = !!pileThrower && handCountOf(pileThrower) === 0;

  // The two trips the exchange's cards make, derived here for the same reason
  // the throw's origin is: this is where the table's own measurements live, and
  // a second measurement is how a card comes to land somewhere its seat is not.
  const announce = exchangeAnnouncement?.data;
  const exchangeTrips = ((): { toWinner: ExchangeFlight; toLoser: ExchangeFlight } | null => {
    if (!announce) return null;
    const geometry = {
      scale,
      windowWidth: W,
      windowHeight: H,
      tableLeft: frame.tableLeft,
      tableRight: frame.tableRight,
      tableTop: frame.tableTop,
      surplus: frame.surplus,
      handZoneH: HAND_ZONE_H(handCardH, frame.bottomPad),
      // Nothing is in flight when an exchange resolves, so each seat's
      // displayed count is simply the hand it holds.
      topDisplayedCount: opponents.top ? handCountOf(opponents.top.player) : 0,
      sideDisplayedCounts: {
        left: opponents.left ? handCountOf(opponents.left.player) : 0,
        right: opponents.right ? handCountOf(opponents.right.player) : 0,
      },
      cardW: CARD_W(scale * FIELD_SCALE),
      cardH: CARD_H(scale * FIELD_SCALE),
    };
    const winnerDir = seatDirection(announce.winnerIdx, viewerSeat, players.length);
    const loserDir = seatDirection(announce.loserIdx, viewerSeat, players.length);
    return {
      toWinner: exchangeFlight({ ...geometry, from: loserDir, to: winnerDir }),
      toLoser: exchangeFlight({ ...geometry, from: winnerDir, to: loserDir }),
    };
  })();

  return (
    <Animated.View style={[styles.root, WEB_CLIP, kickStyle]}>
      <Sweep trigger={flushTrigger} width={W} height={H} />
      <A11yStatus label={tableA11yLabel} veiled={tableWithdrawn} />
      {/* Two chips over the felt, at the corners the cards never reach — the
          combination in play at the head of the field, whose turn it is at the
          far side. Anything wider would be chrome drawn where a card lands. */}
      <Animated.View
        testID="game-top-bar"
        {...a11yGroup(topBarA11yLabel)}
        pointerEvents={focusMode ? "none" : undefined}
        {...behindVeil}
        style={[styles.hudLeft, { left: frame.tableLeft + frame.pad, top: frame.tableTop }, focusFadeStyle]}
      >
        {/* The chip draws the words the group's label already says. */}
        <View {...a11yHidden()}>
          <TableChip scale={scale}>
            {comboLabel === null ? (
              <ChipText scale={scale}>{t("gameShared.emptyTable")}</ChipText>
            ) : (
              <>
                <ChipText scale={scale} maxWidth={CHIP_NAME_MAX_W}>
                  {lastPlayName}
                </ChipText>
                <ChipText scale={scale} strong>
                  {comboLabel}
                </ChipText>
              </>
            )}
          </TableChip>
        </View>
      </Animated.View>

      <Animated.View
        testID="game-hud-stack"
        pointerEvents={focusMode ? "none" : undefined}
        {...behindVeil}
        style={[
          styles.hudRight,
          { right: frame.tableRight + frame.pad, top: frame.tableTop, gap: frame.pad },
          focusFadeStyle,
        ]}
      >
        <TableChip scale={scale} lit={isMyTurn && !isFinished}>
          <ChipDot testID="turn-chip-dot" scale={scale} lit={isMyTurn && !isFinished} />
          <ChipText scale={scale} lit={isMyTurn && !isFinished}>
            {isMyTurn && !isFinished
              ? t("gameShared.yourTurn")
              : t("gameShared.turnOf", {
                  name: players[gameState.currentTurnIndex]?.name ?? "",
                })}
          </ChipText>
          <TurnTimer
            seconds={turnTimer?.seconds ?? 0}
            active={timerActive}
            resetKey={`${turnToken}|${turnTimer?.resetKey ?? ""}`}
            onExpire={turnTimer?.onExpire}
            scale={scale}
          />
        </TableChip>
      </Animated.View>

      {/* The cutout's own column. A cutout can never sit on a card, but it sits
          happily between two controls — so the menu knob takes the head of the
          column, the reactions knob its foot, and the cutout the gap between. */}
      <ControlRail
        veiled={behindCoverOnly}
        width={frame.rail}
        side={frame.railSide}
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

      {settingsOpen && (
        <GameSettingsSheet
          rail={frame.rail}
          railSide={frame.railSide}
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
        {banners}
      </View>

      {/* Felt — decoration only, and edge to edge: a framed table draws a lit
          rectangle in a dark room, which is the one thing a single overhead
          lamp cannot produce. The pool tracks whose turn it is, so half the
          cloth falls into shadow when it is not yours.

          Never animated: `tests/e2e/tableFit.spec.ts` takes this node's own
          `boundingBox()` and `tests/e2e/feltParityGrid.spec.ts` samples pixels
          inside it against a prototype fixture, both asserted exactly. */}
      <View
        testID="table-felt"
        style={[StyleSheet.absoluteFill, FELT_Z]}
        pointerEvents="none"
        {...a11yHidden()}
      >
        <FeltPool
          width={feltW}
          height={feltH}
          stops={felt}
          lightX={light.x}
          lightY={light.y}
        />
      </View>

      {/* The escalation's own shake (#763) rides on this node instead — a
          sibling neither `tableFit` nor `feltParityGrid` nor any other e2e
          spec addresses by testID, so a transform (and the trauma-scaled veil
          riding with it) never reaches a box those specs assert against. At
          rest `shakeStyle`'s opacity is 0 (no trauma, no offset), so it never
          changes a sampled pixel even when a shake happens to land mid-spec. */}
      <Animated.View
        testID="table-shake-veil"
        style={[StyleSheet.absoluteFill, FELT_Z, shakeStyle, styles.shakeVeilFill]}
        pointerEvents="none"
        {...a11yHidden()}
      />

      {/* Same coordinates, overflow visible so slots and buttons can extend out.
          `dataSet` and not `accessibilityLabel`: this sentence is the browser
          harness's hook, and a container without `accessible` names nobody on any
          platform. It cannot have `accessible` either — that would collapse the
          PASSA/GIOCA buttons and every card underneath into one unreachable leaf.
          Players get the same sentence from the A11yStatus node above. */}
      <View
        testID="game-table"
        {...harnessState({ tableState: tableA11yLabel })}
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
        ]}
      >
        <View style={sharedTableStyles.tableContent}>
          <View testID="table-top-section" style={sharedTableStyles.topSection}>
            {opponents.top ? (
              <TopOppSlot
                player={opponents.top.player}
                isActive={opponents.top.seat === gameState.currentTurnIndex}
                cardCount={handCountOf(opponents.top.player)}
                departing={departingSide === "top" ? departingCount : 0}
                passed={passed.includes(opponents.top.seat)}
                scale={scale}
                countdown={seatCountdown}
                focusMode={focusMode}
              />
            ) : (
              <View />
            )}
          </View>

          {/* The band left over between the top seat and the hand. The seats
              and the field centre in what is actually there rather than at a
              guessed percentage, so a taller top seat takes it from the field
              instead of overlapping it. */}
          <View style={sharedTableStyles.midSection}>
            {/* Gated on the exchange announcement so the two banners sequence
                rather than stack. Inside the mid band, not at a computed
                offset: the top opponent's avatar, name and card fan sit above
                it, and card count is the single most important tactical signal
                on the table. */}
            {gameState.startReason && !exchangeAnnouncement?.visible && (
              <StartReasonBanner
                key={`reason-${gameState.startReason.type}-${gameState.startReason.playerIdx}`}
                reason={gameState.startReason}
                players={players}
              />
            )}
            <View style={[sharedTableStyles.sideSection, sharedTableStyles.sideSectionLeft]}>
              {opponents.left && (
                <SideOppSlot
                  player={opponents.left.player}
                  isActive={opponents.left.seat === gameState.currentTurnIndex}
                  side="left"
                  cardCount={handCountOf(opponents.left.player)}
                  departing={departingSide === "left" ? departingCount : 0}
                  passed={passed.includes(opponents.left.seat)}
                  scale={scale}
                  countdown={seatCountdown}
                  focusMode={focusMode}
                />
              )}
            </View>

            <View style={sharedTableStyles.centerSection}>
              {exchange.active && !exchangeAnnouncement?.visible ? (
                // The round that opened this phase is already resolved, so the
                // centre is free — and it is the one place every seat is
                // already looking. It vacates the moment the cards fly.
                <ExchangePrompt
                  receivedCard={gameState.exchangePhase?.cardFromLoser}
                  winnerName={exchange.winner?.name ?? ""}
                  loserName={exchangeLoserName}
                  viewerIsWinner={exchange.viewerIsWinner}
                  viewerIsLoser={exchange.viewerIsLoser}
                  noValidCards={!!giveable && givebackIsFallback(giveable)}
                  scale={scale}
                />
              ) : showStartCardBanner ? (
                <StartCardBanner
                  card={gameState.startCard!}
                  starterIsViewer={isMyTurn}
                  starterName={players[gameState.currentTurnIndex]?.name ?? ""}
                />
              ) : (
                <PlayedPile
                  prev={pileState.prev}
                  current={flyInfo ? null : pileState.current}
                  roundWinner={roundWinnerTag === null ? null : players[roundWinnerTag.seat]?.name ?? ""}
                  bounceTrigger={pileBounceTrigger}
                  catchTrigger={pileFlushed ? flushTrigger : undefined}
                  roomW={frame.fieldRoomW}
                  scale={scale}
                />
              )}

              {/* Centred on the same point the pile draws at, so the burst
                  rings the impact rather than the middle of the table box. */}
              <BombBurst trigger={boomTrigger} scale={scale} />

              {/* Beside the pile, not beside the table: the flight has to
                  settle exactly where PlayedPile then redraws the same cards,
                  and the rail makes the table box asymmetric — centred on the
                  screen instead, the combination lands and then jumps. */}
              {exchangeAnnouncement?.data && exchangeTrips && (
                <ExchangeAnnouncement
                  visible={exchangeAnnouncement.visible}
                  winnerName={exchangeAnnouncement.data.winnerName}
                  loserName={exchangeAnnouncement.data.loserName}
                  bothJokersException={exchangeAnnouncement.data.bothJokersException}
                  cardGiven={exchangeAnnouncement.data.cardGiven}
                  cardReceived={exchangeAnnouncement.data.cardReceived}
                  toWinner={exchangeTrips.toWinner}
                  toLoser={exchangeTrips.toLoser}
                  scale={scale * FIELD_SCALE}
                  onDismiss={exchangeAnnouncement.onDismiss}
                />
              )}

              {flyInfo && (
                <FlyingCards
                  key={flyInfo.key}
                  cards={flyInfo.cards}
                  direction={flyInfo.dir}
                  origin={flyInfo.origin}
                  onDone={() => {
                    setFlyInfo(null);
                    setPileBounceTrigger((t) => t + 1);
                  }}
                  roomW={frame.fieldRoomW}
                  scale={scale}
                />
              )}
            </View>

            <View style={[sharedTableStyles.sideSection, sharedTableStyles.sideSectionRight]}>
              {opponents.right && (
                <SideOppSlot
                  player={opponents.right.player}
                  isActive={opponents.right.seat === gameState.currentTurnIndex}
                  side="right"
                  cardCount={handCountOf(opponents.right.player)}
                  departing={departingSide === "right" ? departingCount : 0}
                  passed={passed.includes(opponents.right.seat)}
                  scale={scale}
                  countdown={seatCountdown}
                  focusMode={focusMode}
                />
              )}
            </View>
          </View>

          {/* The hand rises off the bottom edge on the viewer's own turn. A
              lift rather than a lit band: a wash behind the hand draws a gold
              hairline the full width of the table, which reads as chrome over
              the felt instead of as the hand coming up. */}
          <Animated.View
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
                flashStyle={passaFlashStyle}
                onPress={handlePass}
                a11yLabel={t("gameTable.passA11yLabel")}
                size={actionBtn}
                scale={scale}
              />
            )}

            {isFinished ? (
              <View style={styles.finishedRow}>
                <Ionicons name="trophy" size={18} color={Colors.gold} />
                <TableText style={styles.finishedText}>{t("gameTable.waitingOthers")}</TableText>
              </View>
            ) : (
              // The harness's hook, for the same reason as the table's above: no
              // `accessible` here — it would hide every card's own label behind one
              // leaf — so a name on this wrapper would reach nobody.
              <View {...harnessState({ handState: handA11yLabel })}>
                <A11yStatus label={handA11yLabel} />
                {arrangedA11yLabel !== null && <A11yStatus label={arrangedA11yLabel} />}
                <StraightHand
                  faceDown={spectating}
                  cards={handOnTable}
                  selectedIds={
                    exchangeIsMine ? (exchangePick ? [exchangePick] : []) : selectedIds
                  }
                  onPress={handleCardPress}
                  disabled={isFinished || spectating}
                  giveableIds={giveableIds}
                  giveHint={t("exchange.cardA11yHint")}
                  refuseHint={t("exchange.cardA11yNotGiveable")}
                  availW={frame.handAvailW}
                  roomW={frame.handRoomW}
                  isMyTurn={isMyTurn && !isFinished}
                  scale={scale}
                  // Off whenever a card is held back: the fan is drawn without
                  // it, but `arrange` moves within the whole hand, so a drop
                  // would land a slot from where the finger let go.
                  onReorder={spectating || withheldId !== undefined ? undefined : arrange}
                  arrivingIndex={arrivingIndex}
                  descendingId={descendingId}
                  // Only while the opening is still owed. Named rather than
                  // counted to: Maestro's `index` sorts by position, and the
                  // arc puts the outermost card below its neighbours (#757).
                  startCardId={
                    gameState.firstPlayMade ? undefined : gameState.startCard?.id
                  }
                />
              </View>
            )}

            {!spectating && (
              <GiocaButton
                lit={exchangeIsMine || (isMyTurn && !isFinished)}
                label={exchangeIsMine ? t("exchange.confirm") : t("gameTable.playLabelGioca")}
                rejectX={giocaRejectX}
                flashStyle={giocaFlashStyle}
                glowStyle={giocaGlowStyle}
                onPress={exchangeIsMine ? handleExchangeGive : handlePlay}
                // The visible `3c` suffix is hidden and deliberately not folded
                // in here: each card already reports its own selectedness, and a
                // button whose name changes on every tap is re-announced on
                // every tap. `tests/e2e/helpers/bot.ts` also reads this exact
                // sentence as the signal that the play is legal.
                a11yLabel={
                  staged.playable
                    ? t("gameTable.playA11yValid")
                    : t("gameTable.playA11yUnavailable", { reason: dimReasonText })
                }
                exchange={
                  exchangeIsMine
                    ? { toName: exchangeLoserName, picked: pickedGiveCard }
                    : undefined
                }
                selectedCount={exchangeIsMine ? 0 : selectedIds.length}
                size={actionBtn}
                scale={scale}
              />
            )}
          </Animated.View>
        </View>
      </View>


      {rematchPrompt?.visible && (
        <RematchPromptPanel
          prompt={rematchPrompt}
          top={frame.tableTop + CHIP_H(scale) + frame.pad}
          left={frame.tableLeft + Spacing.sm}
          veiled={behindVeil}
        />
      )}


      {/* Sits just above the hand row, at the GIOCA end of it — the button
          wears two words, this is the whole sentence, next to the control the
          player just pressed rather than at the far side of the screen. */}
      {rejectHint && (
        <Animated.View
          key={rejectHint.key}
          entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.tap)}
          pointerEvents="none"
          {...behindVeil}
          style={[
            styles.rejectHint,
            {
              bottom: HAND_ZONE_H(handCardH, frame.bottomPad) + Spacing.xs,
              left: frame.tableLeft,
              right: frame.tableRight,
            },
            playOnLeft && styles.rejectHintMirrored,
          ]}
        >
          <TableText
            style={[styles.rejectHintText, playOnLeft && styles.rejectHintTextMirrored]}
            numberOfLines={2}
            accessibilityLiveRegion="polite"
          >
            {rejectHint.text}
          </TableText>
        </Animated.View>
      )}

      {overlays?.(behindSheetOnly)}

      {W < H && <RotateOverlay />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, overflow: "hidden" },
  shakeVeilFill: { backgroundColor: Scrim.subtle },

  bannerBand: {
    position: "absolute",
    alignItems: "center",
    zIndex: BANNER_BAND_Z,
    pointerEvents: "box-none",
  },

  hudLeft: { position: "absolute", zIndex: Layer.moment },
  hudRight: { position: "absolute", alignItems: "flex-end", zIndex: Layer.moment },
  handSectionReversed: { flexDirection: "row-reverse" },


  finishedRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  finishedText: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm, color: Colors.gold,
  },
  rejectHint: {
    position: "absolute",
    zIndex: REJECT_HINT_Z,
    alignItems: "flex-end",
  },
  // The hint belongs beside the button that raised it, so it follows GIOCA
  // across when the hand row is mirrored.
  rejectHintMirrored: { alignItems: "flex-start" },
  rejectHintText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.text,
    textAlign: "right",
    maxWidth: REJECT_HINT_MAX_W,
    backgroundColor: Scrim.heavy,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    overflow: "hidden",
  },
  rejectHintTextMirrored: { textAlign: "left" },

});

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
  Text,
  StyleSheet,
  Pressable,
  Modal,
  Platform,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  withRepeat,
  cancelAnimation,
  Easing,
  FadeIn,
  type SharedValue,
  type AnimatedStyle,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as ScreenOrientation from "expo-screen-orientation";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  buildCombination,
  canPlay,
  sortHand,
  type Card,
  type Combination,
  type GameState,
} from "@/lib/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/sharedGameFlow";
import {
  TOP_BAR_H,
  TOP_SECTION_H,
  HAND_SECTION_H,
  CARD_H,
  SIDE_BTN_W,
  TABLE_M,
  advancePile,
  arrangeOpponents,
  canPassNow as canPassNowOf,
  comboKey,
  computeTableFrame,
  describeTableForA11y,
  EMPTY_PILE,
  handCountOf,
  impactDelayMs,
  passedSeats,
  playButtonLabel,
  readExchange,
  roundClosedWithWinner,
  seatDirection,
  straightTopRankChar,
  turnTimerActive,
  urgentThresholdSeconds,
  URGENT_TICK_SECONDS,
  type FlyDirection,
  type PileState,
  type PlayButtonLabel,
  type TableA11yExchange,
  type TableA11yLastPlay,
  type TableA11yOpponent,
  type TableA11yStrings,
} from "@/components/gameTableModel";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { cardSpokenName, rankSpokenName, suitSpokenName, type TFn } from "@/lib/cardNames";
import {
  TableVignette,
  sharedTableStyles,
  portraitOverlayStyles,
  StartReasonBanner,
  useTurnPulse,
  GameBillboard,
} from "@/components/GameShared";
import { StraightHand } from "@/components/table/hand";
import { FlyingCards, PlayedPile, getComboLabel } from "@/components/table/pile";
import { TopOppSlot, SideOppSlot } from "@/components/table/seats";
import { ExchangeModal } from "@/components/ExchangeModal";
import { ExchangeAnnouncement } from "@/components/ExchangeAnnouncement";
import {
  playCardSelect,
  playCardPlay,
  playCardPass,
  playYourTurn,
  playRoundStart,
  playRoundWin,
  playUrgentTick,
  playBomb,
  playGameWin,
  playGameLose,
  playDeal,
  playExchange,
  preloadSounds,
  unloadSounds,
} from "@/lib/sounds";
import { hapticError, hapticHeavy, hapticLight, hapticMedium, hapticSelection, hapticSuccess, hapticWarn } from "@/lib/haptics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, FontSize, Highlight, Motion, Radius, Scrim, Shadow, Spacing, TABLE_FONT_SCALE_MAX, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { useTableFelt } from "@/lib/cosmetics";
import { A11yStatus, a11yHidden, a11yState } from "@/lib/a11y";

// How long the round-winner tag stays over the pile. A domain beat, not a
// generic UI transition, so it is not a Motion token.
const ROUND_WINNER_MS = 1800;
// Whole-pixel travel, mirroring components/MenuButton.tsx: PASSA/GIOCA hold
// text labels, and React Native rasterises text before transforming it, so a
// fractional offset resamples the glyphs. 2px down is the smallest offset
// that still reads as a press.
const BTN_PRESS_TRAVEL = 2;

// The refusal shake on GIOCA: deliberately a third of the bomb's amplitude —
// it is a "no", not an event. One leg duration for all four legs.
const BTN_REJECT_TRAVEL = 3;
const BTN_REJECT_LEG_MS = 40;
// How long the refused-play reason stays on screen, and how wide it may get
// before it wraps onto its second (and last) line.
const REJECT_HINT_MS = 2600;
const REJECT_HINT_MAX_W = 260;
/** Above the top bar and the rematch panel: the reason must not be covered. */
const REJECT_HINT_Z = 30;
/** The banner band sits over the felt, under the reject hint. */
const BANNER_BAND_Z = 50;

// Raked light across the gold surface — bright at the top-left corner,
// dropping to goldDark at the bottom-right — same treatment and same rake
// angle as components/MenuButton.tsx's primary variant, so the table's most-
// pressed control reads as struck metal like every other primary action.
const GIOCA_GRADIENT = [Colors.goldLight, Colors.gold, Colors.goldDark] as const;
const GIOCA_GRADIENT_PRESSED = [Colors.gold, Colors.goldDark, Colors.goldDim] as const;

// gameTableModel.ts's `playButtonLabel` returns a rejection reason, not copy.
// This is the translation boundary: the short two-line form the button wears,
// and the full sentence a screen reader speaks. Both are keyed by the same
// identifier, so a new reason cannot be added without both.
const PLAY_LABEL_KEYS: Record<PlayButtonLabel, TranslationKey> = {
  play: "gameTable.playLabelGioca",
  notACombination: "gameTable.playLabelInvalid",
  needsStartCard: "gameTable.playLabelStartCard",
  royalUnbeatable: "gameTable.playLabelRoyalUnbeatable",
  bombOnly: "gameTable.playLabelBombOnly",
  wrongType: "gameTable.playLabelWrongType",
  wrongLength: "gameTable.playLabelWrongLength",
  tooLow: "gameTable.playLabelTooLow",
};
const PLAY_A11Y_SPOKEN_KEYS: Partial<Record<PlayButtonLabel, TranslationKey>> = {
  notACombination: "gameTable.playA11ySpokenInvalid",
  needsStartCard: "gameTable.playA11ySpokenStartCard",
  royalUnbeatable: "gameTable.playA11ySpokenRoyalUnbeatable",
  bombOnly: "gameTable.playA11ySpokenBombOnly",
  wrongType: "gameTable.playA11ySpokenWrongType",
  wrongLength: "gameTable.playA11ySpokenWrongLength",
  tooLow: "gameTable.playA11ySpokenTooLow",
};

// ─── Screen-reader table description ───────────────────────────────────────
//
// describeTableForA11y (gameTableModel.ts) is pure and takes every phrase
// pre-translated; this is the translation boundary that builds them. Card names
// come from lib/cardNames so a card named here is named identically wherever
// else it is spoken.
/**
 * Spoken form of a played combination for describeTableForA11y — richer than
 * getComboLabel's visual chip text (which a sighted player pairs with the
 * cards they can already see): "coppia di 8", not just "Coppia". For a
 * straight/royal straight only the top card is named (the fact that decides
 * whether a reply beats it) rather than the whole run.
 */
function lastPlayA11yLabel(combo: Combination, t: TFn): string {
  switch (combo.type) {
    case "single":
      return cardSpokenName(combo.cards[0], t);
    case "pair":
      return t("gameTable.a11yLastPlayPair", { rank: rankSpokenName(combo.cards[0].rank, t) });
    case "triple":
      return t("gameTable.a11yLastPlayTriple", { rank: rankSpokenName(combo.cards[0].rank, t) });
    case "bomb":
      return t("gameTable.a11yLastPlayBomb", { rank: rankSpokenName(combo.cards[0].rank, t) });
    case "straight":
      return t("gameTable.a11yLastPlayStraight", {
        count: combo.cards.length,
        rank: rankSpokenName(straightTopRankChar(combo.strength), t),
      });
    case "royal_straight":
      return t("gameTable.a11yLastPlayRoyalStraight", {
        count: combo.cards.length,
        rank: rankSpokenName(straightTopRankChar(combo.strength), t),
        suit: suitSpokenName(combo.cards[0].suit, t),
      });
  }
}

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
export interface RematchPromptSlot {
  visible: boolean;
  /** null until this player has answered. */
  myAnswer: boolean | null;
  yesCount: number;
  seatCount: number;
  onAnswer: (wants: boolean) => void;
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

  /** Small mode label under the combination in the billboard. */
  roundLabel: string;
  turnTimer?: TurnTimerConfig;
  exchangeAnnouncement?: ExchangeAnnouncementSlot;
  rematchPrompt?: RematchPromptSlot;

  /** Extra controls at the right end of the top bar (online: reactions). */
  topBarExtra?: React.ReactNode;
  /** Transient strips under the top bar (online: reconnect notice). */
  banners?: React.ReactNode;
  /** Full-screen layers above the table (game over, error toasts, waiting states). */
  overlays?: React.ReactNode;
}

// ─── Turn countdown ───────────────────────────────────────────────────────────
//
// Its own component so the once-a-second tick re-renders a single <Text> and
// not the whole board — which, with hands of up to 27 cards, matters.

function TurnTimer({
  seconds,
  active,
  resetKey,
  onExpire,
}: {
  seconds: number;
  active: boolean;
  /** Restarts the countdown whenever it changes — one full clock per turn. */
  resetKey: string;
  onExpire?: () => void;
}) {
  const { tn } = useTranslation();
  const [timeLeft, setTimeLeft] = useState(seconds);
  // Written after commit, never during render: the only reader is the interval
  // below, which fires a second later at the earliest.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    if (!active) {
      setTimeLeft(seconds);
      return;
    }
    let remaining = seconds;
    setTimeLeft(remaining);
    const id = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= URGENT_TICK_SECONDS && remaining >= 0) playUrgentTick();
      if (remaining <= 0) {
        clearInterval(id);
        onExpireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [active, resetKey, seconds]);

  if (!active) return null;
  const urgent = timeLeft <= urgentThresholdSeconds(seconds);
  // The clock face marks the number as a deadline rather than a score.
  return (
    <View style={styles.timerGroup}>
      <Ionicons
        name="timer-outline"
        size={FontSize.sm}
        color={urgent ? Colors.red : Colors.gold}
        {...a11yHidden()}
      />
      <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX}
        style={[styles.timerNum, urgent && styles.timerUrgent]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={tn("gameTable.a11ySecondsLeft", timeLeft)}
      >
        {timeLeft}
      </Text>
    </View>
  );
}

// ─── Rematch prompt ───────────────────────────────────────────────────────────
//
// Deliberately a side panel rather than a modal: it is asked while the closing
// manche is still being played, so it must never take the table away from the
// player. Once answered it shrinks to the running tally.

function RematchPromptPanel({
  prompt,
  top,
  left,
}: {
  prompt: RematchPromptSlot;
  top: number;
  left: number;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const answered = prompt.myAnswer !== null;
  const tally = t("gameTable.rematchTally", {
    yes: prompt.yesCount,
    total: prompt.seatCount,
  });

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.moderate)}
      style={[styles.rematchPanel, { top, left }]}
    >
      {answered ? (
        <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.rematchTally} accessibilityLiveRegion="polite">
          {tally}
        </Text>
      ) : (
        <>
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.rematchTitle}>{t("gameTable.rematchPromptTitle")}</Text>
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.rematchSubtitle}>{t("gameTable.rematchPromptSubtitle")}</Text>
          <View style={styles.rematchButtons}>
            <Pressable
              testID="btn-rematch-yes"
              onPress={() => {
                hapticSelection();
                prompt.onAnswer(true);
              }}
              style={[styles.rematchChoice, styles.rematchChoiceYes]}
              accessibilityRole="button"
              accessibilityLabel={t("gameTable.rematchYesA11yLabel")}
            >
              <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.rematchChoiceYesLabel}>{t("gameTable.rematchYes")}</Text>
            </Pressable>
            <Pressable
              testID="btn-rematch-no"
              onPress={() => {
                hapticLight();
                prompt.onAnswer(false);
              }}
              style={styles.rematchChoice}
              accessibilityRole="button"
              accessibilityLabel={t("gameTable.rematchNoA11yLabel")}
            >
              <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.rematchChoiceLabel}>{t("gameTable.rematchNo")}</Text>
            </Pressable>
          </View>
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.rematchTally}>{tally}</Text>
        </>
      )}
    </Animated.View>
  );
}

// ─── GIOCA / PASSA ────────────────────────────────────────────────────────────
//
// Press feedback (a discrete gradient swap plus a whole-pixel travel) needs
// its own React state — split into their own components so pressing either
// button re-renders just that button, not the whole table.

function GiocaButton({
  valid,
  reduceMotion,
  rejectX,
  flashStyle,
  glowStyle,
  onPress,
  a11yLabel,
  dimLabel,
  startCardRank,
  selectedCount,
}: {
  valid: boolean;
  reduceMotion: boolean;
  /** Owned by GameTable — driven by handlePlay's reject shake, not by press. */
  rejectX: SharedValue<number>;
  flashStyle: AnimatedStyle<ViewStyle>;
  glowStyle: AnimatedStyle<ViewStyle>;
  onPress: () => void;
  a11yLabel: string;
  dimLabel: PlayButtonLabel;
  startCardRank: string;
  selectedCount: number;
}) {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);
  const pressVal = useSharedValue(0);

  useEffect(() => () => cancelAnimation(pressVal), [pressVal]);

  const setPress = (down: boolean) => {
    if (!valid) return;
    setPressed(down);
    pressVal.value = reduceMotion
      ? down ? 1 : 0
      : withTiming(down ? 1 : 0, { duration: Motion.duration.fast });
  };

  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: pressVal.value * BTN_PRESS_TRAVEL },
      { translateX: rejectX.value },
    ],
  }));

  return (
    <Animated.View style={[styles.playBtn, !valid && styles.playBtnDim, pressStyle]}>
      {valid && (
        <Animated.View pointerEvents="none" style={[styles.playBtnGlow, glowStyle]} />
      )}
      <Pressable
        testID="btn-gioca"
        onPress={onPress}
        onPressIn={() => setPress(true)}
        onPressOut={() => setPress(false)}
        style={styles.playBtnInner}
        accessibilityLabel={a11yLabel}
        {...a11yState({ role: "button", disabled: !valid })}
      >
        {valid ? (
          <LinearGradient
            colors={pressed ? GIOCA_GRADIENT_PRESSED : GIOCA_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.35, y: 1 }}
            style={styles.playBtnGrad}
          >
            <View pointerEvents="none" style={styles.btnTopHighlight} />
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.btnFlash, flashStyle]}
            />
            <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.playBtnLabel}>{t("gameTable.playLabelGioca")}</Text>
            {selectedCount > 1 && (
              <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.playBtnSub}>{t("gameTable.selectedCountSuffix", { n: selectedCount })}</Text>
            )}
          </LinearGradient>
        ) : (
          <View style={[styles.playBtnGrad, styles.playBtnGradDim]}>
            <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.playBtnLabelDim} numberOfLines={2}>
              {t(PLAY_LABEL_KEYS[dimLabel], { rank: startCardRank })}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function PassaButton({
  canPass,
  reduceMotion,
  flashStyle,
  onPress,
  a11yLabel,
}: {
  canPass: boolean;
  reduceMotion: boolean;
  flashStyle: AnimatedStyle<ViewStyle>;
  onPress: () => void;
  a11yLabel: string;
}) {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);
  const pressVal = useSharedValue(0);

  useEffect(() => () => cancelAnimation(pressVal), [pressVal]);

  const setPress = (down: boolean) => {
    if (!canPass) return;
    setPressed(down);
    pressVal.value = reduceMotion
      ? down ? 1 : 0
      : withTiming(down ? 1 : 0, { duration: Motion.duration.fast });
  };

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pressVal.value * BTN_PRESS_TRAVEL }],
  }));

  return (
    <Animated.View style={[styles.passBtn, !canPass && styles.passBtnDim, pressStyle]}>
      <Pressable
        testID="btn-passa"
        onPress={onPress}
        onPressIn={() => setPress(true)}
        onPressOut={() => setPress(false)}
        disabled={!canPass}
        style={styles.passBtnInner}
        accessibilityLabel={a11yLabel}
        {...a11yState({ role: "button", disabled: !canPass })}
      >
        <LinearGradient
          colors={pressed ? PASS_GRADIENT_PRESSED : PASS_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.35, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.btnTopHighlight} />
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.btnFlash, flashStyle]}
        />
        <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX}
          style={[styles.passBtnLabel, !canPass && styles.passBtnLabelDim]}
        >
          {t("gameTable.passLabel")}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── GameTable ────────────────────────────────────────────────────────────────

export function GameTable({
  gameState,
  viewerSeat,
  spectating = false,
  selectedIds,
  onSelectCard,
  onPlay,
  onPass,
  onQuit,
  onExchangeGive,
  roundLabel,
  turnTimer,
  exchangeAnnouncement,
  rematchPrompt,
  topBarExtra,
  banners,
  overlays,
}: GameTableProps) {
  const { t, tn } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const reduceMotion = usePrefersReducedMotion();
  const felt = useTableFelt();

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
  } | null>(null);

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
  const prevMyTurnRef = useRef(false);
  const prevExchangeActiveRef = useRef(false);
  const prevGameOverRef = useRef(false);
  // Seeded from the state the table mounts on, so rejoining mid-round does not
  // replay the passes that happened before the viewer arrived.
  const prevPassCountRef = useRef(gameState.passCount);
  const prevRoundClosedRef = useRef(
    roundClosedWithWinner({
      lastPlayedCombination: gameState.lastPlayedCombination,
      roundWinner: gameState.roundWinner,
    })
  );

  // Nothing here scales: a fractional scale on a view containing text makes
  // React Native resample the already-rasterised glyphs, and PASSA/GIOCA read
  // as blurry for as long as it is applied. Emphasis is opacity, glow and —
  // for the press feedback below — a whole-pixel translateY only.
  const giocaFlashVal = useSharedValue(0);
  const passaFlashVal = useSharedValue(0);
  const giocaGlowVal = useSharedValue(0);
  const shakeX = useSharedValue(0);
  const giocaRejectX = useSharedValue(0);

  // The reason a tap on an unavailable GIOCA was refused, spelled out. Keyed by
  // a counter so tapping again restarts the dwell instead of being swallowed as
  // an unchanged value.
  const [rejectHint, setRejectHint] = useState<{ key: number; text: string } | null>(null);

  // ── Derived view of the game ────────────────────────────────────────────────

  const players = gameState.players;
  const viewer = players[viewerSeat];
  const isMyTurn = gameState.currentTurnIndex === viewerSeat;
  const isFinished = viewer?.finishPosition !== undefined;
  const isNewRound = gameState.lastPlayedCombination === null;
  const exchange = readExchange(gameState, viewerSeat);

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
  const selectedObjs = React.useMemo(
    () => sortedHand.filter((c) => selectedIds.includes(c.id)),
    [sortedHand, selectedIds]
  );
  const tentativeCombo = React.useMemo(
    () => (selectedObjs.length > 0 ? buildCombination(selectedObjs) : null),
    [selectedObjs]
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

  const requiresStartCard = !gameState.firstPlayMade && !!gameState.startCard;
  const selectionHasStartCard =
    !!gameState.startCard && selectedObjs.some((c) => c.id === gameState.startCard!.id);
  const isValidPlay =
    tentativeCombo !== null &&
    canPlay(tentativeCombo, isNewRound ? null : gameState.lastPlayedCombination) &&
    (!requiresStartCard || selectionHasStartCard);

  const canPass = canPassNowOf({ isMyTurn, isFinished, isNewRound });
  const playBtnValid = isValidPlay && isMyTurn && !isFinished;

  const pileCombo = gameState.lastPlayedCombination;
  const dimLabel = playButtonLabel({
    isMyTurn,
    isFinished,
    selectedCount: selectedIds.length,
    selection: tentativeCombo
      ? { type: tentativeCombo.type, length: tentativeCombo.cards.length }
      : null,
    pile: pileCombo ? { type: pileCombo.type, length: pileCombo.cards.length } : null,
    requiresStartCard,
    selectionHasStartCard,
  });
  // Two words fit on the button; the sentence is what the screen reader speaks
  // and what the toast shows when the refusal is tapped. Only the start-card
  // reason reads the rank.
  const startCardRank = gameState.startCard?.rank ?? "";
  const dimReasonText = t(PLAY_A11Y_SPOKEN_KEYS[dimLabel] ?? PLAY_LABEL_KEYS[dimLabel], {
    rank: startCardRank,
  });

  const opponents = React.useMemo(
    () => arrangeOpponents(players, viewerSeat),
    [players, viewerSeat]
  );

  const frame = computeTableFrame({
    width: W,
    insets,
    isWeb: Platform.OS === "web",
  });

  // ── Screen-reader table description ─────────────────────────────────────────
  //
  // describeTableForA11y (gameTableModel.ts) does the ordering; this just
  // gathers the translated pieces it asks for. The bottom seat's size comes
  // from `sortedHand`, which is the real hand when playing and the count-derived
  // face-down set when spectating — `viewer.hand.length` is 0 in that case,
  // because a watcher is sent no cards at all.

  const tableA11yStrings: TableA11yStrings = React.useMemo(
    () => ({
      yourTurn: t("gameTable.a11yYourTurn"),
      turnOf: (name) => t("gameTable.a11yTurnOf", { name }),
      emptyTable: t("gameTable.a11yEmptyTable"),
      youPlayed: (label) => t("gameTable.a11yYouPlayed", { label }),
      playerPlayed: (name, label) => t("gameTable.a11yPlayerPlayed", { name, label }),
      opponentCardCount: (name, count) => tn("gameTable.a11yOpponentCards", count, { name }),
      yourCardCount: (count) => tn("gameTable.a11yYourCards", count),
      exchangeGiveCard: (loserName) => t("gameTable.a11yExchangeGive", { name: loserName }),
      exchangeWaitForCard: (winnerName) => t("gameTable.a11yExchangeWait", { name: winnerName }),
    }),
    [t, tn]
  );

  const tableA11yLabel = React.useMemo(() => {
    const combo = gameState.lastPlayedCombination;
    const lastPlay: TableA11yLastPlay | null = combo
      ? {
          label: lastPlayA11yLabel(combo, t),
          byViewer: gameState.lastPlayedBy === viewerSeat,
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
        myCardCount: sortedHand.length,
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
    sortedHand.length,
    isMyTurn,
    exchange,
    tableA11yStrings,
    t,
  ]);

  const handA11yLabel = React.useMemo(() => {
    const count = tn("gameTable.a11yHandCount", sortedHand.length);
    const selected = selectedIds.length > 0 ? tn("gameTable.a11yHandSelected", selectedIds.length) : null;
    return selected ? `${count} ${selected}` : count;
  }, [tn, sortedHand.length, selectedIds.length]);

  // ── Lifecycle ───────────────────────────────────────────────────────────────

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
    },
    []
  );

  // The dedupe on `prevComboKeyRef` comes before anything with an effect, so a
  // re-run for one of the other dependencies leaves the pile, the flying card
  // and the pending impact exactly as they were.
  useEffect(() => {
    // Clearing the felt and announcing a new round are one beat, whether it
    // happens now or after the winning cards have been held.
    const openNewRound = () => {
      playRoundStart();
      setPileState(EMPTY_PILE);
      setFlyInfo(null);
    };

    const combo = gameState.lastPlayedCombination;
    if (combo === null) {
      // The winning cards are being held for the tag; nothing may take the
      // felt out from under them until the hold expires or a new lead arrives.
      if (roundHoldTimerRef.current) return;
      if (prevComboKeyRef.current === "") {
        setPileState(EMPTY_PILE);
        setFlyInfo(null);
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
    setPileState((s) => advancePile(s, combo));

    // The card is thrown here and arrives ~312ms later, so everything that
    // reads as *impact* waits for it. Announced for every seat, not only the
    // viewer's: the sound belongs to a card landing, not to a tap.
    const heavy = combo.type === "bomb" || combo.type === "royal_straight";
    impactTimerRef.current = setTimeout(() => {
      if (heavy) {
        playBomb();
        hapticHeavy();
        if (!reduceMotion) {
          shakeX.value = withSequence(
            withTiming(5, { duration: 45 }),
            withTiming(-5, { duration: 45 }),
            withTiming(4, { duration: 40 }),
            withTiming(-4, { duration: 40 }),
            withTiming(2, { duration: 35 }),
            withTiming(-2, { duration: 35 }),
            withTiming(0, { duration: 30 })
          );
        }
      } else {
        playCardPlay();
      }
    }, impactDelayMs(reduceMotion));

    setFlyInfo({
      key,
      dir: seatDirection(gameState.lastPlayedBy, viewerSeat, players.length),
      cards: combo.cards,
    });
  }, [
    gameState.lastPlayedCombination,
    gameState.lastPlayedBy,
    gameState.roundWinner,
    viewerSeat,
    players.length,
    reduceMotion,
    shakeX,
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

  useEffect(() => {
    if (isMyTurn && !isFinished && !prevMyTurnRef.current) playYourTurn();
    prevMyTurnRef.current = isMyTurn;
  }, [isMyTurn, isFinished]);

  useEffect(() => {
    if (exchange.active && !prevExchangeActiveRef.current) playExchange();
    prevExchangeActiveRef.current = exchange.active;
  }, [exchange.active]);

  // A pass moves nothing on the felt, so the sound is the whole event — and it
  // belongs to every seat, not only the viewer's own tap. Keyed on the state
  // the pass produced rather than on the tap, so a bot, an opponent and the
  // server moving for a seat all announce themselves identically.
  //
  // `processPass` resets `passCount` to zero on the pass that closes a round,
  // so the closing pass raises no count edge and the round closing stands in
  // for it. A round only ever closes on a pass, and heads-up every legal pass
  // closes one — without this the sound would never fire in a two-player game
  // at all. It layers under the round-winner sting, which is the beat after.
  useEffect(() => {
    const prevCount = prevPassCountRef.current;
    prevPassCountRef.current = gameState.passCount;
    const closed = roundClosedWithWinner({
      lastPlayedCombination: gameState.lastPlayedCombination,
      roundWinner: gameState.roundWinner,
    });
    const wasClosed = prevRoundClosedRef.current;
    prevRoundClosedRef.current = closed;
    if (gameState.passCount > prevCount || (closed && !wasClosed)) playCardPass();
  }, [gameState.passCount, gameState.lastPlayedCombination, gameState.roundWinner]);

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

  useEffect(() => {
    // Reset on the way back down so a rematch — which never unmounts this
    // component — gets its own win/lose sting instead of staying silent.
    if (!gameState.gameOver) {
      prevGameOverRef.current = false;
      return;
    }
    if (prevGameOverRef.current) return;
    prevGameOverRef.current = true;
    // `rankings` holds engine player ids (`player_0`), never display names.
    const myId = viewer?.id;
    const myRank = myId ? gameState.rankings.indexOf(myId) : -1;
    if (myRank === 0) {
      hapticSuccess();
      playGameWin();
    } else if (myRank >= 0 && myRank === gameState.rankings.length - 1) {
      hapticWarn();
      playGameLose();
    }
  }, [gameState.gameOver, gameState.rankings, viewer?.id]);

  // ── Animation ───────────────────────────────────────────────────────────────

  // GIOCA bloom — a slow gold pulse while the button is armed.
  useEffect(() => {
    if (playBtnValid && !reduceMotion) {
      giocaGlowVal.value = withRepeat(
        withSequence(
          withTiming(1.0, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.35, { duration: 1000, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(giocaGlowVal);
      giocaGlowVal.value =
        reduceMotion && playBtnValid
          ? 0.6
          : withTiming(0, { duration: Motion.duration.fast });
    }
    return () => {
      cancelAnimation(giocaGlowVal);
    };
  }, [playBtnValid, reduceMotion, giocaGlowVal]);

  // GIOCA flash as the selection grows or shrinks.
  const prevSelectedLen = useRef(0);
  useEffect(() => {
    const hasSelection = selectedIds.length > 0 && isMyTurn && !isFinished;
    if (hasSelection && prevSelectedLen.current !== selectedIds.length && !reduceMotion) {
      giocaFlashVal.value = withSequence(
        withTiming(1, { duration: Motion.duration.fast }),
        withTiming(0, { duration: Motion.duration.base })
      );
    }
    prevSelectedLen.current = selectedIds.length;
  }, [selectedIds.length, isMyTurn, isFinished, reduceMotion, giocaFlashVal]);

  // PASSA flash the moment passing becomes possible. `canPass` already folds in
  // whose turn it is, whether the viewer has finished, and whether the round is
  // new, so the transition into it is the whole trigger.
  useEffect(() => {
    if (canPass && !reduceMotion) {
      passaFlashVal.value = withSequence(
        withTiming(1, { duration: Motion.duration.base }),
        withTiming(0, { duration: Motion.duration.moderate })
      );
    }
  }, [canPass, reduceMotion, passaFlashVal]);

  // Reanimated keeps driving shared values after unmount unless cancelled.
  // GiocaButton/PassaButton own and cancel their own press values.
  useEffect(
    () => () => {
      cancelAnimation(giocaFlashVal);
      cancelAnimation(passaFlashVal);
      cancelAnimation(shakeX);
      cancelAnimation(giocaRejectX);
    },
    [giocaFlashVal, passaFlashVal, shakeX, giocaRejectX]
  );

  const giocaFlashStyle = useAnimatedStyle(() => ({ opacity: giocaFlashVal.value }));
  const passaFlashStyle = useAnimatedStyle(() => ({ opacity: passaFlashVal.value }));
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));
  // Opacity only, on the childless sibling behind the button. A shadow written
  // per frame is main-thread paint the browser cannot composite.
  const giocaGlowStyle = useAnimatedStyle(() => ({ opacity: giocaGlowVal.value }));
  const turnPulseStyle = useTurnPulse(isMyTurn && !isFinished && !exchange.active);

  // ── Handlers ────────────────────────────────────────────────────────────────

  // These three reach the memoized hand as props, so they are stabilized by
  // hand: a fresh arrow per render defeats every card's memo comparator.
  // Staging a play while an opponent thinks is how every game in this family
  // works, and it is what stops the turn clock starting from a blank hand.
  // Only the *submission* is gated on the turn: `playBtnValid` already requires
  // it, so GIOCA lights on its own the moment the turn arrives.
  const handleCardPress = useCallback(
    (id: string) => {
      if (isFinished || spectating) return;
      hapticSelection();
      playCardSelect();
      onSelectCard(id);
    },
    [isFinished, spectating, onSelectCard]
  );
  // The button stays pressable while it is unavailable so a refusal has a
  // channel: an error haptic, a shake, and the reason in words. It keeps
  // reporting itself as disabled to assistive tech.
  const handlePlay = useCallback(() => {
    if (!playBtnValid) {
      hapticError();
      setRejectHint((prev) => ({ key: (prev?.key ?? 0) + 1, text: dimReasonText }));
      if (!reduceMotion) {
        giocaRejectX.value = withSequence(
          withTiming(BTN_REJECT_TRAVEL, { duration: BTN_REJECT_LEG_MS }),
          withTiming(-BTN_REJECT_TRAVEL, { duration: BTN_REJECT_LEG_MS }),
          withTiming(BTN_REJECT_TRAVEL, { duration: BTN_REJECT_LEG_MS }),
          withTiming(0, { duration: BTN_REJECT_LEG_MS })
        );
      }
      return;
    }
    // Haptic only: the throw is acknowledged in the hand, and card_play sounds
    // when the card actually reaches the pile.
    hapticMedium();
    // The validated set, not the raw selection: `playBtnValid` is computed from
    // `selectedObjs`, and the server rejects — silently — any request naming a
    // card the hand does not hold.
    onPlay(selectedObjs.map((c) => c.id));
  }, [playBtnValid, onPlay, selectedObjs, dimReasonText, reduceMotion, giocaRejectX]);
  const handlePass = useCallback(() => {
    if (!canPass) return;
    // Haptic only: the pass sound follows the committed state, so firing it
    // here as well would double the viewer's own pass.
    hapticLight();
    onPass();
  }, [canPass, onPass]);

  // ── Render ──────────────────────────────────────────────────────────────────

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

  const showStartCardBanner = !gameState.firstPlayMade && !!gameState.startCard;

  return (
    <Animated.View style={[styles.root, shakeStyle]}>
      <A11yStatus label={tableA11yLabel} />
      <LinearGradient
        colors={[Colors.bg, Colors.feltDark, Colors.bg]}
        style={StyleSheet.absoluteFill}
      />

      <View
        testID="game-top-bar"
        style={[
          styles.topBar,
          { top: frame.topPad, left: frame.leftPad, right: frame.rightPad },
        ]}
      >
        <Pressable
          onPress={onQuit}
          style={styles.quitBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("gameTable.leaveA11yLabel")}
        >
          <Ionicons name="close" size={18} color={Colors.textMuted} />
        </Pressable>

        <GameBillboard
          roundLabel={roundLabel}
          currentComboLabel={getComboLabel(pileState.current, t)}
          currentTurnName={players[gameState.currentTurnIndex]?.name ?? ""}
          isLocalPlayerTurn={isMyTurn && !isFinished}
        />

        <TurnTimer
          seconds={turnTimer?.seconds ?? 0}
          active={timerActive}
          resetKey={`${turnToken}|${turnTimer?.resetKey ?? ""}`}
          onExpire={turnTimer?.onExpire}
        />

        <View style={styles.topBarRight}>
          <View style={styles.cardCountBadge}>
            <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.cardCountText}>{sortedHand.length}</Text>
          </View>
          {topBarExtra}
        </View>
      </View>

      <View
        style={[
          styles.bannerBand,
          { top: frame.topPad + TOP_BAR_H, left: frame.leftPad, right: frame.rightPad },
        ]}
      >
        {banners}
      </View>

      {/* Felt — clipped to its rounded corners, decoration only */}
      <View
        style={[
          sharedTableStyles.tableBg,
          {
            left: frame.tableLeft,
            top: frame.tableTop,
            right: frame.tableRight,
            bottom: frame.tableBottom,
          },
        ]}
      >
        <LinearGradient
          colors={felt}
          locations={[0, 0.25, 0.5, 0.75, 1]}
          style={StyleSheet.absoluteFill}
        />
        <TableVignette />
        <View style={sharedTableStyles.tableInnerBorder} />
      </View>

      {/* Same coordinates, overflow visible so slots and buttons can extend out.
          accessibilityLabel is the E2E harness's hook on the table description
          (tests/e2e/helpers/bot.ts reads the raw attribute). Players get the
          same sentence from the A11yStatus node above — a container without
          `accessible` reaches no screen reader on any platform, and adding it
          would collapse the PASSA/GIOCA buttons and every card underneath into
          one unreachable leaf. */}
      <View
        testID="game-table"
        accessibilityLabel={tableA11yLabel}
        style={[
          sharedTableStyles.tableOverlay,
          {
            left: frame.tableLeft,
            top: frame.tableTop,
            right: frame.tableRight,
            bottom: frame.tableBottom,
          },
        ]}
      >
        <View style={sharedTableStyles.tableContent}>
          <View style={[sharedTableStyles.topSection, { height: TOP_SECTION_H }]}>
            {opponents.top ? (
              <TopOppSlot
                player={opponents.top.player}
                isActive={opponents.top.seat === gameState.currentTurnIndex}
                cardCount={handCountOf(opponents.top.player)}
                passed={passed.includes(opponents.top.seat)}
              />
            ) : (
              <View />
            )}
          </View>

          <View style={sharedTableStyles.midSection}>
            <View style={[sharedTableStyles.sideSection, sharedTableStyles.sideSectionLeft]}>
              {opponents.left && (
                <SideOppSlot
                  player={opponents.left.player}
                  isActive={opponents.left.seat === gameState.currentTurnIndex}
                  side="left"
                  cardCount={handCountOf(opponents.left.player)}
                  passed={passed.includes(opponents.left.seat)}
                />
              )}
            </View>

            <View style={sharedTableStyles.centerSection}>
              {showStartCardBanner ? (
                <View style={styles.startCardBanner}>
                  <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.startCardGlyph}>♠</Text>
                  <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.startCardText}>
                    {gameState.currentTurnIndex === viewerSeat
                      ? t("gameTable.startCardBannerSelf", { rank: gameState.startCard!.rank })
                      : t("gameTable.startCardBannerOther", {
                          name: players[gameState.currentTurnIndex]?.name ?? "",
                          rank: gameState.startCard!.rank,
                        })}
                  </Text>
                </View>
              ) : (
                <PlayedPile
                  prev={pileState.prev}
                  current={flyInfo ? null : pileState.current}
                  roundWinner={roundWinnerTag === null ? null : players[roundWinnerTag.seat]?.name ?? ""}
                  bounceTrigger={pileBounceTrigger}
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
                  passed={passed.includes(opponents.right.seat)}
                />
              )}
            </View>
          </View>

          <View
            style={[
              sharedTableStyles.handSection,
              isMyTurn && !isFinished && sharedTableStyles.handSectionActive,
              { height: HAND_SECTION_H },
            ]}
          >
            <Animated.View
              pointerEvents="none"
              style={[sharedTableStyles.handGlow, turnPulseStyle]}
            />
            {!spectating && (
              <PassaButton
                canPass={canPass}
                reduceMotion={reduceMotion}
                flashStyle={passaFlashStyle}
                onPress={handlePass}
                a11yLabel={t("gameTable.passA11yLabel")}
              />
            )}

            {isFinished ? (
              <View style={styles.finishedRow}>
                <Ionicons name="trophy" size={18} color={Colors.gold} />
                <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={styles.finishedText}>{t("gameTable.waitingOthers")}</Text>
              </View>
            ) : (
              // The wrapper carries no `accessible`, which would hide the
              // individual cards' own labels behind one leaf node; the summary
              // reaches a screen reader through A11yStatus instead.
              <View accessibilityLabel={handA11yLabel}>
                <A11yStatus label={handA11yLabel} />
                <StraightHand
                  faceDown={spectating}
                  cards={sortedHand}
                  selectedIds={selectedIds}
                  onPress={handleCardPress}
                  disabled={isFinished || spectating}
                  availW={frame.handAvailW}
                  isMyTurn={isMyTurn && !isFinished}
                />
              </View>
            )}

            {!spectating && (
              <GiocaButton
                valid={playBtnValid}
                reduceMotion={reduceMotion}
                rejectX={giocaRejectX}
                flashStyle={giocaFlashStyle}
                glowStyle={giocaGlowStyle}
                onPress={handlePlay}
                a11yLabel={
                  playBtnValid
                    ? t("gameTable.playA11yValid")
                    : t("gameTable.playA11yUnavailable", { reason: dimReasonText })
                }
                dimLabel={dimLabel}
                startCardRank={startCardRank}
                selectedCount={selectedIds.length}
              />
            )}
          </View>
        </View>
      </View>

      {flyInfo && (
        <FlyingCards
          key={flyInfo.key}
          cards={flyInfo.cards}
          direction={flyInfo.dir}
          onDone={() => {
            setFlyInfo(null);
            setPileBounceTrigger((t) => t + 1);
          }}
        />
      )}

      {/* Gated on the exchange announcement so the two banners sequence rather
          than stack on top of each other. topOffset clears TOP_SECTION_H —
          the top opponent's avatar, name and card fan live in that band, and
          card count is the single most important tactical signal on the
          table, so the banner must never sit over it. */}
      {gameState.startReason && !exchangeAnnouncement?.visible && (
        <StartReasonBanner
          key={`reason-${gameState.startReason.type}-${gameState.startReason.playerIdx}`}
          reason={gameState.startReason}
          players={players}
          topOffset={frame.topPad + TOP_BAR_H + TABLE_M + TOP_SECTION_H + 8}
        />
      )}

      {exchange.active && exchange.viewerIsWinner && exchange.loser && exchange.winner && (
        <ExchangeModal
          phase={gameState.exchangePhase!}
          winnerHand={exchange.winner.hand}
          loserName={exchange.loser.name}
          winnerName={exchange.winner.name}
          onSelectCard={(cardId) => {
            playCardPlay();
            onExchangeGive(cardId);
          }}
        />
      )}

      {rematchPrompt?.visible && (
        <RematchPromptPanel
          prompt={rematchPrompt}
          top={frame.topPad + TOP_BAR_H + TABLE_M + Spacing.sm}
          left={frame.leftPad + Spacing.sm}
        />
      )}

      {exchangeAnnouncement?.data && (
        <ExchangeAnnouncement
          visible={exchangeAnnouncement.visible}
          winnerName={exchangeAnnouncement.data.winnerName}
          loserName={exchangeAnnouncement.data.loserName}
          bothJokersException={exchangeAnnouncement.data.bothJokersException}
          cardGiven={exchangeAnnouncement.data.cardGiven}
          cardReceived={exchangeAnnouncement.data.cardReceived}
          onDismiss={exchangeAnnouncement.onDismiss}
        />
      )}

      {/* Sits just above the hand row, at the GIOCA end of it — the button
          wears two words, this is the whole sentence, next to the control the
          player just pressed rather than at the far side of the screen. */}
      {rejectHint && (
        <Animated.View
          key={rejectHint.key}
          entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.fast)}
          pointerEvents="none"
          style={[
            styles.rejectHint,
            {
              bottom: frame.bottomPad + TABLE_M + HAND_SECTION_H + Spacing.xs,
              left: frame.tableLeft,
              right: frame.tableRight,
            },
          ]}
        >
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX}
            style={styles.rejectHintText}
            numberOfLines={2}
            accessibilityLiveRegion="polite"
          >
            {rejectHint.text}
          </Text>
        </Animated.View>
      )}

      {overlays}

      {/* A Modal, not a scrim: covering the pixels leaves every control
          beneath it in the tab order. Rotating back is the only way out, so
          onRequestClose is inert. */}
      {W < H && (
      <Modal
        transparent
        visible
        accessibilityLabel={t("gameTable.rotateTitle")}
        supportedOrientations={["portrait", "landscape"]}
        onRequestClose={() => {}}
      >
        <View style={portraitOverlayStyles.overlay}>
          <View style={portraitOverlayStyles.card}>
            <Ionicons name="phone-landscape-outline" size={56} color={Colors.gold} />
            <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={portraitOverlayStyles.title}>{t("gameTable.rotateTitle")}</Text>
            <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={portraitOverlayStyles.sub}>
              {t("gameTable.rotateBody")}
            </Text>
          </View>
        </View>
      </Modal>
      )}
    </Animated.View>
  );
}

// PASS_BG/PASS_BORDER are deliberate table furniture — a muted danger that
// reads against the felt without competing with the gold — with no matching
// token. PASS_LABEL's red coincides with Colors.bombText.
const PASS_BG = "#5C1212";
const PASS_BORDER = "#8B1A1A";
const PASS_LABEL = Colors.bombText;
// Same raked-light technique as GIOCA_GRADIENT, tuned to PASSA's own red
// rather than gold — the button gets the table's standard depth treatment
// without adopting gold's colour identity.
const PASS_GRADIENT = [PASS_BORDER, PASS_BG] as const;
const PASS_GRADIENT_PRESSED = [PASS_BG, "#3A0C0C"] as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  bannerBand: {
    position: "absolute",
    alignItems: "center",
    zIndex: BANNER_BAND_Z,
    pointerEvents: "box-none",
  },

  topBar: {
    position: "absolute",
    height: TOP_BAR_H,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    gap: Spacing.sm,
    zIndex: 10,
  },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  quitBtn: {
    width: TOUCH_TARGET_MIN, height: TOUCH_TARGET_MIN, borderRadius: TOUCH_TARGET_MIN / 2,
    backgroundColor: Scrim.medium,
    alignItems: "center", justifyContent: "center",
  },
  timerGroup: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  timerNum: {
    fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm,
    color: Colors.gold, minWidth: 20, textAlign: "right",
  },
  timerUrgent: { color: Colors.red },
  cardCountBadge: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Scrim.medium,
    alignItems: "center", justifyContent: "center",
  },
  cardCountText: {
    fontFamily: "Rajdhani_700Bold", fontSize: FontSize.md, color: Colors.gold,
  },

  startCardBanner: {
    alignItems: "center", gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: 14,
    backgroundColor: Scrim.medium,
    borderWidth: 1, borderColor: Colors.goldSoft,
  },
  startCardGlyph: { fontSize: 28, color: Colors.text },
  startCardText: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm,
    color: Colors.text, textAlign: "center", letterSpacing: 0.5,
  },

  finishedRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  finishedText: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm, color: Colors.gold,
  },

  // overflow stays visible here — Shadow.dark lives on this view, and a
  // native shadow is clipped by its own view's bounds. Corner-clipping the
  // gradient happens one level in, on passBtnInner, same split as
  // playBtn/playBtnGrad below.
  passBtn: {
    width: SIDE_BTN_W, height: CARD_H, borderRadius: Radius.md,
    borderWidth: 2, borderColor: PASS_BORDER,
    marginHorizontal: 3,
    ...Shadow.dark,
  },
  // Matches playBtnDim's technique: fade the whole surface (gradient, border,
  // label) uniformly rather than swapping in flat colours that fight the
  // gradient now underneath them.
  passBtnDim: { opacity: 0.55 },
  passBtnInner: {
    flex: 1, alignItems: "center", justifyContent: "center",
    borderRadius: Radius.md - 2, overflow: "hidden",
  },
  // One hairline of light along the top edge — the cue that the surface has a
  // thickness and is facing up. Same treatment as MenuButton's topHighlight.
  btnTopHighlight: {
    position: "absolute",
    top: 0, left: "12%", right: "12%",
    height: 1,
    backgroundColor: Highlight.clear,
  },
  // Sits behind the label, never over it: a wash on top of text would eat the
  // very contrast the flash is meant to draw attention to.
  btnFlash: { backgroundColor: Highlight.clear },
  passBtnLabel: {
    fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm,
    color: PASS_LABEL, letterSpacing: 0.5,
  },
  // Fades the same label colour rather than swapping to an unrelated token —
  // Colors.bombFill is a translucent fill meant for backgrounds, not text,
  // and rendered as near-invisible red-on-red here.
  passBtnLabelDim: { opacity: 0.6 },

  playBtn: {
    width: SIDE_BTN_W + 6, height: CARD_H,
    borderRadius: Radius.md, marginHorizontal: 3,
    ...Shadow.dark,
  },
  // The armed bloom, as a childless sibling behind the button: the glow is
  // fixed and only this view's opacity is animated. The fill is what the
  // shadow is cast from — a layer with transparent contents has nothing for
  // iOS to blur and gives Android's elevation no outline — and the button's
  // own gradient covers it exactly, so only the spill is ever seen.
  playBtnGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.md,
    backgroundColor: Colors.gold,
    ...Shadow.gold,
  },
  playBtnDim: { opacity: 0.55 },
  playBtnInner: { flex: 1 },
  playBtnGrad: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 2, borderRadius: Radius.md, overflow: "hidden",
  },
  playBtnGradDim: {
    // Dark gold-brown wash with no matching token.
    backgroundColor: "rgba(40,30,5,0.7)",
    borderWidth: 2, borderColor: Colors.goldSoft, borderRadius: Radius.md,
  },
  playBtnLabel: {
    fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm,
    color: Colors.bgCard, letterSpacing: 0.5,
  },
  playBtnSub: {
    fontFamily: "Rajdhani_500Medium", fontSize: FontSize.xs,
    color: Colors.bgCard, opacity: 0.7,
  },
  rejectHint: {
    position: "absolute",
    zIndex: REJECT_HINT_Z,
    alignItems: "flex-end",
  },
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
  rematchPanel: {
    position: "absolute",
    width: SIDE_BTN_W + Spacing.lg,
    zIndex: 20,
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs + 2,
    borderRadius: Radius.md,
    backgroundColor: Scrim.heavy,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    alignItems: "center",
  },
  rematchTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.gold,
    letterSpacing: 1,
  },
  rematchSubtitle: {
    ...Type.caption,
    fontSize: FontSize.xs - 2,
    textAlign: "center",
  },
  rematchButtons: { alignSelf: "stretch", gap: Spacing.xs },
  rematchChoice: {
    minHeight: TOUCH_TARGET_MIN,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rematchChoiceYes: {
    backgroundColor: Colors.goldMuted,
    borderColor: Colors.goldStrong,
  },
  rematchChoiceLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  rematchChoiceYesLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.goldLight,
    letterSpacing: 1,
  },
  rematchTally: {
    ...Type.caption,
    fontSize: FontSize.xs - 2,
  },

  // Solid color: this is the only text explaining why a move was refused,
  // and must clear 4.5:1 contrast.
  playBtnLabelDim: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm,
    color: Colors.goldLight, letterSpacing: 0.5, textAlign: "center",
  },
});

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
  Pressable,
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
  type SharedValue,
  type AnimatedStyle,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as ScreenOrientation from "expo-screen-orientation";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  buildCombination,
  canPlay,
  getCardDisplayRank,
  getSuitSymbol,
  getValidGivebackCards,
  givebackIsFallback,
  sortHand,
  type Card,
  type Combination,
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
  arrivingCard,
  describeTableForA11y,
  displayedHandCount,
  EMPTY_PILE,
  flightOrigin,
  handCountOf,
  impactDelayMs,
  lightPosition,
  passedSeats,
  playButtonLabel,
  readExchange,
  roundClosedWithWinner,
  seatDirection,
  straightTopRankChar,
  turnTimerActive,
  urgentThresholdSeconds,
  URGENT_TICK_SECONDS,
  viewerOwnsSeat,
  type FlyDirection,
  type OpponentSide,
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
  CHIP_NAME_MAX_W,
  ChipDot,
  ChipText,
  ControlRail,
  useHandLift,
  RailKnob,
  sharedTableStyles,
  StartReasonBanner,
  TableChip,
} from "@/components/table/chrome";
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
  playUrgentTick,
  playDeal,
  preloadSounds,
  unloadSounds,
} from "@/lib/sounds";
import { hapticError, hapticLight, hapticMedium, hapticSelection } from "@/lib/haptics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, FontSize, Garnet, Highlight, makeShadow, Motion, Radius, Scrim, Shadow, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { useTableFelt } from "@/lib/cosmetics";
import { A11yStatus, a11yGroup, a11yHidden, a11yState, a11yVeiled } from "@/lib/a11y";

// How long the round-winner tag stays over the pile. A domain beat, not a
// generic UI transition, so it is not a Motion token.
const ROUND_WINNER_MS = 1800;
// Whole-pixel travel, mirroring components/MenuButton.tsx: PASSA/GIOCA hold
// text labels, and React Native rasterises text before transforming it, so a
// fractional offset resamples the glyphs. 2px down is the smallest offset
// that still reads as a press.
// The bevelled key: a lit top edge, a face darkening downward, and a corner
// radius that grows with the table. Pressing it shrinks the whole key rather
// than dropping it a pixel or two — at 56pt square a travel that small reads
// as a jitter, and the shrink is what the prototype does.
const BTN_PRESS_SCALE = 0.94;
const BTN_RADIUS = 14;
const BTN_LABEL_FS = 12;
const BTN_SUB_FS = 10;
const BTN_TRACKING = 1.9;
const BTN_GLOW = 26;
/** The rematch question's own column down the side of the table. */
const REMATCH_PANEL_W = 86;

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
const REJECT_HINT_Z = 30;
/** The banner band sits over the felt, under the reject hint. */
const BANNER_BAND_Z = 50;
/**
 * The felt is decoration and everything else is the game, so the game is
 * always on top. Stated rather than left to sibling order: the pool paints
 * over the seats, the pile and the hand on the iOS renderer, which draws that
 * subtree above them however the tree is written (#209).
 */
const FELT_Z = { zIndex: 0 } as const;
const TABLE_Z = { zIndex: 1 } as const;

// Raked light across the gold surface — bright at the top-left corner,
// dropping to goldDark at the bottom-right — same treatment and same rake
// angle as components/MenuButton.tsx's primary variant, so the table's most-
// pressed control reads as struck metal like every other primary action.
const GIOCA_GRADIENT = [Colors.goldLit, Colors.gold, Colors.goldDark] as const;
const GIOCA_GRADIENT_PRESSED = [Colors.gold, Colors.goldDark, Colors.goldDim] as const;
const GIOCA_GRADIENT_LOCATIONS = [0, 0.48, 1] as const;

// gameTableModel.ts's `playButtonLabel` returns a rejection reason, not copy.
/**
 * A sentence the browser harness reads, as `data-<hyphenated key>`. `dataSet` is
 * react-native-web's own escape hatch and reaches the DOM; React Native has no such
 * prop and no types for it, which is what the cast is for. It is deliberately not an
 * `accessibilityLabel`: these containers cannot be `accessible` without collapsing
 * their controls into one leaf, so a name on them would reach no reader at all.
 * `tests/e2e/helpers/selectors.ts` holds the other end.
 */
const harnessState = (state: Record<string, string>) => ({ dataSet: state }) as ViewProps;

// The translation boundary for why a play is refused. Total, so a new reason
// cannot reach a screen reader without a sentence of its own.
const PLAY_A11Y_SPOKEN_KEYS: Record<PlayButtonLabel, TranslationKey> = {
  play: "gameTable.playA11ySpokenNothingSelected",
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
// pre-translated; this is the translation boundary that builds them.
/**
 * Spoken form of a played combination — richer than getComboLabel's chip text,
 * which a sighted player pairs with the cards they can see: "pair of 8s", not
 * "Pair". For a straight only the top card is named, since that is what decides
 * whether a reply beats it.
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

// ─── Turn countdown ───────────────────────────────────────────────────────────
//
// Its own component so the once-a-second tick re-renders a single <TableText> and
// not the whole board — which, with hands of up to 18 cards, matters.

function TurnTimer({
  seconds,
  active,
  resetKey,
  onExpire,
  scale,
}: {
  seconds: number;
  active: boolean;
  /** Restarts the countdown whenever it changes — one full clock per turn. */
  resetKey: string;
  onExpire?: () => void;
  scale: number;
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
  return (
    <ChipText
      scale={scale}
      strong
      urgent={urgent}
      accessibilityLiveRegion="polite"
      accessibilityLabel={tn("gameTable.a11ySecondsLeft", timeLeft)}
    >
      {timeLeft}
    </ChipText>
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
  veiled,
}: {
  prompt: RematchPromptSlot;
  top: number;
  left: number;
  veiled: AccessibilityProps;
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
      entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.travel)}
      style={[styles.rematchPanel, { top, left }]}
      {...veiled}
    >
      {answered ? (
        <TableText style={styles.rematchTally} accessibilityLiveRegion="polite">
          {tally}
        </TableText>
      ) : (
        <>
          <TableText style={styles.rematchTitle}>{t("gameTable.rematchPromptTitle")}</TableText>
          <TableText style={styles.rematchSubtitle}>{t("gameTable.rematchPromptSubtitle")}</TableText>
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
              <TableText style={styles.rematchChoiceYesLabel} {...a11yHidden()}>{t("gameTable.rematchYes")}</TableText>
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
              <TableText style={styles.rematchChoiceLabel} {...a11yHidden()}>{t("gameTable.rematchNo")}</TableText>
            </Pressable>
          </View>
          <TableText style={styles.rematchTally}>{tally}</TableText>
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
  lit,
  valid,
  reduceMotion,
  rejectX,
  flashStyle,
  glowStyle,
  onPress,
  a11yLabel,
  label,
  exchange,
  selectedCount,
  size,
  scale,
}: {
  /** The turn is the viewer's — the key is brass whether or not a play is staged. */
  lit: boolean;
  /** …and a legal combination is staged, so a press will be accepted. */
  valid: boolean;
  reduceMotion: boolean;
  /** Owned by GameTable — driven by handlePlay's reject shake, not by press. */
  rejectX: SharedValue<number>;
  flashStyle: AnimatedStyle<ViewStyle>;
  glowStyle: AnimatedStyle<ViewStyle>;
  onPress: () => void;
  a11yLabel: string;
  /** What the key reads. The exchange borrows this button, so not always PLAY. */
  label: string;
  /**
   * Set while the exchange has borrowed this key, naming who the card goes to
   * and which one is picked. Named here rather than by the caller: the table
   * already computes several translated strings per render, and one more with
   * a parameter object costs it the React Compiler's memoization outright
   * (scripts/react-compiler-probe.mjs).
   */
  exchange?: { toName: string; picked: Card | null };
  selectedCount: number;
  /** The button is square, and never smaller than a comfortable thumb. */
  size: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);
  const pressVal = useSharedValue(0);

  // Must precede the effect that reads `pressVal` — the React Compiler skips any component that mutates a value an effect captured.
  const setPress = (down: boolean) => {
    // Gated on the turn, not on the staged play: a press with nothing legal
    // selected is answered by the reject shake and the hint, so it has to feel
    // like a press first.
    if (!lit) return;
    setPressed(down);
    pressVal.value = reduceMotion
      ? down ? 1 : 0
      : withTiming(down ? 1 : 0, { duration: Motion.duration.tap });
  };

  useEffect(() => () => cancelAnimation(pressVal), [pressVal]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: rejectX.value },
      { scale: 1 - pressVal.value * (1 - BTN_PRESS_SCALE) },
    ],
  }));

  return (
    // Named so a device hierarchy can say whether the wrapper or the control
    // inside it is what went missing (#685).
    <Animated.View
      testID="btn-gioca-box"
      style={[
        styles.actionBtn,
        { width: size, height: size, borderRadius: BTN_RADIUS * scale },
        pressStyle,
      ]}
    >
      {lit && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.playBtnGlow,
            { borderRadius: BTN_RADIUS * scale },
            makeShadow(Colors.goldLit, 0, 0, 0.55, BTN_GLOW * scale, 0),
            glowStyle,
          ]}
        />
      )}
      <Pressable
        testID="btn-gioca"
        onPress={onPress}
        onPressIn={() => setPress(true)}
        onPressOut={() => setPress(false)}
        style={[styles.actionBtnInner, styles.playBtnFront]}
        accessibilityLabel={
          exchange
            ? exchange.picked
              ? t("exchange.confirmA11yReady", {
                  card: cardSpokenName(exchange.picked, t),
                  name: exchange.toName,
                })
              : t("exchange.confirmA11yWaiting", { name: exchange.toName })
            : a11yLabel
        }
        // No `disabled` state, on either platform: an illegal play is answered
        // with the shake and the spoken reason rather than ignored, so the
        // control is operable and its name is what carries the refusal.
        {...a11yState({ role: "button" })}
      >
        {lit ? (
          <LinearGradient
            colors={pressed ? GIOCA_GRADIENT_PRESSED : GIOCA_GRADIENT}
            locations={GIOCA_GRADIENT_LOCATIONS}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.35, y: 1 }}
            style={[styles.actionBtnFace, styles.playBtnFace, { borderRadius: BTN_RADIUS * scale }]}
          >
            <View pointerEvents="none" style={styles.btnTopHighlight} />
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.btnFlash, flashStyle]}
            />
            <TableText
              {...a11yHidden()}
              style={[
                styles.actionBtnLabel,
                styles.playBtnLabel,
                { fontSize: BTN_LABEL_FS * scale, letterSpacing: BTN_TRACKING * scale },
              ]}
            >
              {label}
            </TableText>
            {selectedCount > 1 && (
              <TableText {...a11yHidden()} style={[styles.playBtnSub, { fontSize: BTN_SUB_FS * scale }]}>
                {t("gameTable.selectedCountSuffix", { n: selectedCount })}
              </TableText>
            )}
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.actionBtnFace,
              styles.btnDimFace,
              { borderRadius: BTN_RADIUS * scale },
            ]}
          >
            <TableText
              {...a11yHidden()}
              style={[
                styles.actionBtnLabel,
                styles.btnDimLabel,
                { fontSize: BTN_LABEL_FS * scale, letterSpacing: BTN_TRACKING * scale },
              ]}
            >
              {label}
            </TableText>
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
  size,
  scale,
}: {
  canPass: boolean;
  reduceMotion: boolean;
  flashStyle: AnimatedStyle<ViewStyle>;
  onPress: () => void;
  a11yLabel: string;
  /** The button is square, and never smaller than a comfortable thumb. */
  size: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);
  const pressVal = useSharedValue(0);

  // Must precede the effect that reads `pressVal` — the React Compiler skips any component that mutates a value an effect captured.
  const setPress = (down: boolean) => {
    if (!canPass) return;
    setPressed(down);
    pressVal.value = reduceMotion
      ? down ? 1 : 0
      : withTiming(down ? 1 : 0, { duration: Motion.duration.tap });
  };

  useEffect(() => () => cancelAnimation(pressVal), [pressVal]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressVal.value * (1 - BTN_PRESS_SCALE) }],
  }));

  return (
    <Animated.View
      testID="btn-passa-box"
      style={[
        styles.actionBtn,
        { width: size, height: size, borderRadius: BTN_RADIUS * scale },
        pressStyle,
      ]}
    >
      <Pressable
        testID="btn-passa"
        onPress={onPress}
        onPressIn={() => setPress(true)}
        onPressOut={() => setPress(false)}
        disabled={!canPass}
        style={[styles.actionBtnInner, { borderRadius: BTN_RADIUS * scale, overflow: "hidden" }]}
        accessibilityLabel={a11yLabel}
        {...a11yState({ role: "button", disabled: !canPass })}
      >
        {canPass ? (
          <>
            <LinearGradient
              colors={pressed ? PASS_GRADIENT_PRESSED : PASS_GRADIENT}
              locations={PASS_GRADIENT_LOCATIONS}
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={styles.btnTopHighlight} />
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.btnFlash, flashStyle]}
            />
          </>
        ) : (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.btnDimFace]} />
        )}
        <View style={styles.actionBtnFace}>
          <TableText
            {...a11yHidden()}
            style={[
              styles.actionBtnLabel,
              canPass ? styles.passBtnLabel : styles.btnDimLabel,
              { fontSize: BTN_LABEL_FS * scale, letterSpacing: BTN_TRACKING * scale },
            ]}
          >
            {t("gameTable.passLabel")}
          </TableText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The pre-first-play banner naming who opens and with what card. A component
 * of its own rather than inline JSX: `card` is only read here, so `rank` and
 * `suit` derive once instead of once per interpolation.
 */
function StartCardBanner({
  card,
  starterIsViewer,
  starterName,
  t,
}: {
  card: Card;
  starterIsViewer: boolean;
  starterName: string;
  t: TFn;
}) {
  const rank = getCardDisplayRank(card.rank);
  const suit = getSuitSymbol(card.suit);
  return (
    <View style={styles.startCardBanner}>
      <TableText style={styles.startCardGlyph}>{suit}</TableText>
      <TableText style={styles.startCardText}>
        {starterIsViewer
          ? t("gameTable.startCardBannerSelf", { rank, suit })
          : t("gameTable.startCardBannerOther", { name: starterName, rank, suit })}
      </TableText>
    </View>
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
  // The exchange commits in the tick that raises its ceremony, so the hand
  // holds the traded card before the flight carrying it has left. Held back
  // here rather than by deferring the state itself: online the state is the
  // server's, and freezing a whole snapshot for the length of an animation
  // would swallow every other thing that arrives in that window.
  //
  // Only until the card lands, not for the whole notice — the tags beside each
  // seat stay up another `Reading.notice` to be read, and a hand short of a
  // card for four seconds after it arrived is a different defect.
  //
  // Arranging first and filtering second, so the card lands in the place the
  // player arranged for it instead of re-entering an order computed without it.
  const tradedCardsLanded = useTradedCardsLanded(
    exchangeAnnouncement?.visible === true,
    exchangeAnnouncement?.data?.bothJokersException
  );
  //
  // Nothing is held back under reduced motion: with no flight to wait for,
  // the row would step for a card that is already there and hold an empty slot
  // open for a frame nobody asked to see.
  const arriving =
    tradedCardsLanded || reduceMotion
      ? undefined
      : arrivingCard(
          exchangeAnnouncement?.visible ? exchangeAnnouncement.data : null,
          spectating ? null : viewerSeat
        );
  const handOnTable =
    arriving === undefined ? shownHand : shownHand.filter((c) => c.id !== arriving.id);
  // Where the card ends up, so the row parts *there* rather than at an end.
  // `shownHand` is the player's own arrangement over the engine's sort, and the
  // card's place in it is the place it will take.
  const arrivingIndex =
    arriving === undefined ? undefined : shownHand.findIndex((c) => c.id === arriving.id);
  // The same card once it has landed. Naming it for the rest of the ceremony
  // costs nothing — it mounts on the one render it lands, and that is the
  // render this has to reach it on.
  const descendingId = reduceMotion
    ? undefined
    : arrivingCard(
        exchangeAnnouncement?.visible ? exchangeAnnouncement.data : null,
        spectating ? null : viewerSeat
      )?.id;
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

  // ── The exchange, on the table ──────────────────────────────────────────────
  //
  // The winner picks from their own hand rather than from a filtered row in a
  // dialog, so the legality the engine enforces has to be readable in the fan:
  // `getValidGivebackCards` is the same call `processExchangeChoice` validates
  // against, asked here only to decide which cards light up.
  const exchangeIsMine = exchange.active && exchange.viewerIsWinner;
  const giveable = React.useMemo(
    () =>
      exchangeIsMine
        ? getValidGivebackCards(sortedHand, gameState.exchangePhase?.cardFromLoser?.id)
        : undefined,
    [exchangeIsMine, sortedHand, gameState.exchangePhase?.cardFromLoser?.id]
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
  // reason reads the card. At 2 players the opening card can be the fallback
  // "lowest dealt card" rather than the 3♠ (docs/RULES.md §4).
  const startCardDisplayRank = gameState.startCard ? getCardDisplayRank(gameState.startCard.rank) : "";
  const startCardSuitSymbol = gameState.startCard ? getSuitSymbol(gameState.startCard.suit) : "";
  const startCardSpokenName = gameState.startCard ? cardSpokenName(gameState.startCard, t) : "";
  // `playButtonLabel` answers "play" to three different questions — not your turn,
  // your hand is over, nothing selected — and only the last is about the selection.
  const dimReasonKey = !isMyTurn
    ? "gameTable.playA11ySpokenNotYourTurn"
    : isFinished
      ? "gameTable.playA11ySpokenYouAreDone"
      : PLAY_A11Y_SPOKEN_KEYS[dimLabel];
  const dimReasonText = t(dimReasonKey, {
    rank: startCardDisplayRank,
    suit: startCardSuitSymbol,
    card: startCardSpokenName,
  });

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

  const arrangedA11yLabel = React.useMemo(() => {
    if (arranged === null) return null;
    const card = shownHand.find((c) => c.id === arranged.id);
    if (card === undefined) return null;
    return t("gameTable.a11yCardMoved", {
      card: cardSpokenName(card, t),
      position: arranged.to + 1,
      total: handOnTable.length,
    });
  }, [arranged, shownHand, handOnTable.length, t]);

  const handA11yLabel = React.useMemo(() => {
    const count = tn("gameTable.a11yHandCount", handOnTable.length);
    const selected = selectedIds.length > 0 ? tn("gameTable.a11yHandSelected", selectedIds.length) : null;
    return selected ? `${count} ${selected}` : count;
  }, [tn, handOnTable.length, selectedIds.length]);

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
  } = useTableFeedback({
    isMyTurn,
    isFinished,
    exchangeActive: exchange.active,
    canPass,
    playBtnValid,
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

    // The card is thrown here and arrives ~312ms later, so everything that
    // reads as *impact* waits for it. Announced for every seat, not only the
    // viewer's: the sound belongs to a card landing, not to a tap.
    const heavy = combo.type === "bomb" || combo.type === "royal_straight";
    // The flush: this play emptied the throwing seat's hand. `players` is
    // already this render's post-play state — same commit `combo` came from.
    const playedByPlayer = players[gameState.lastPlayedBy];
    const emptiedHand = !!playedByPlayer && handCountOf(playedByPlayer) === 0;
    impactTimerRef.current = setTimeout(() => {
      playImpact(heavy);
      if (emptiedHand) celebrateFlush();
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

    const dir = seatDirection(gameState.lastPlayedBy, viewerSeat, players.length);
    // The pile sits in whatever vertical room the top seat's own column
    // leaves, whichever seat is actually throwing — so its origin needs the
    // top seat's *displayed* count, held at its pre-play value for the length
    // of a flight from that seat specifically.
    const topPlayer = opponents.top?.player;
    const topDisplayedCount = topPlayer
      ? displayedHandCount(handCountOf(topPlayer), dir === "top" ? combo.cards.length : 0)
      : 0;

    const sidePlayer = dir === "left" || dir === "right" ? opponents[dir]?.player : undefined;
    const sideDisplayedCount = sidePlayer
      ? displayedHandCount(handCountOf(sidePlayer), combo.cards.length)
      : 0;

    setFlyInfo({
      key,
      dir,
      cards: combo.cards,
      origin: flightOrigin({
        dir,
        scale,
        windowWidth: W,
        windowHeight: H,
        tableLeft: frame.tableLeft,
        tableRight: frame.tableRight,
        tableTop: frame.tableTop,
        surplus: frame.surplus,
        handZoneH: HAND_ZONE_H(handCardH, frame.bottomPad),
        topDisplayedCount,
        sideDisplayedCount,
      }),
    });
  }, [
    gameState.lastPlayedCombination,
    gameState.lastPlayedBy,
    gameState.roundWinner,
    viewerSeat,
    players.length,
    reduceMotion,
    playImpact,
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
  // Only the *submission* is gated on the turn: `playBtnValid` already requires
  // it, so GIOCA lights on its own the moment the turn arrives.
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
    if (!playBtnValid) {
      hapticError();
      setRejectHint((prev) => ({ key: (prev?.key ?? 0) + 1, text: dimReasonText }));
      rejectPlay();
      return;
    }
    // Haptic only: the throw is acknowledged in the hand, and card_play sounds
    // when the card actually reaches the pile.
    hapticMedium();
    // The validated set, not the raw selection: `playBtnValid` is computed from
    // `selectedObjs`, and the server rejects — silently — any request naming a
    // card the hand does not hold.
    onPlay(selectedObjs.map((c) => c.id));
  }, [playBtnValid, onPlay, selectedObjs, dimReasonText, rejectPlay, setRejectHint]);
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

  const topBarA11yLabel =
    pileState.current === null
      ? t("gameTable.a11yEmptyTable")
      : playedByViewer
        ? t("gameTable.a11yYouPlayed", { label: lastPlayA11yLabel(pileState.current, t) })
        : t("gameTable.a11yPlayerPlayed", {
            name: lastPlayName,
            label: lastPlayA11yLabel(pileState.current, t),
          });

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
          cloth falls into shadow when it is not yours. */}
      <View testID="table-felt" style={[StyleSheet.absoluteFill, FELT_Z]} pointerEvents="none" {...a11yHidden()}>
        <FeltPool
          width={feltW}
          height={feltH}
          stops={felt}
          lightX={light.x}
          lightY={light.y}
        />
      </View>

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
                  t={t}
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
                reduceMotion={reduceMotion}
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
                  // Off while a card is still in the air: the fan is drawn
                  // without it, but `arrange` moves within the whole hand, so a
                  // drop during the flight would land a slot from where the
                  // finger let go.
                  onReorder={spectating || arriving !== undefined ? undefined : arrange}
                  arrivingIndex={arrivingIndex}
                  descendingId={descendingId}
                />
              </View>
            )}

            {!spectating && (
              <GiocaButton
                lit={exchangeIsMine || (isMyTurn && !isFinished)}
                valid={exchangeIsMine ? !!exchangePick : playBtnValid}
                label={exchangeIsMine ? t("exchange.confirm") : t("gameTable.playLabelGioca")}
                reduceMotion={reduceMotion}
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
                  playBtnValid
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

// PASSA takes GIOCA's own construction — a lit top lip, a face darkening
// downward, a seated shadow — at lower luminance with the hue pulled to
// garnet, and no glow. Glow is reserved for the primary action, which is the
// whole reason red can sit here without shouting.
const PASS_GRADIENT = [Garnet.lip, Garnet.face, Garnet.deep, Garnet.base] as const;
const PASS_GRADIENT_PRESSED = [Garnet.face, Garnet.deep, Garnet.base, Garnet.base] as const;
const PASS_GRADIENT_LOCATIONS = [0, 0.22, 0.6, 1] as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, overflow: "hidden" },

  bannerBand: {
    position: "absolute",
    alignItems: "center",
    zIndex: BANNER_BAND_Z,
    pointerEvents: "box-none",
  },

  hudLeft: { position: "absolute", zIndex: 10 },
  hudRight: { position: "absolute", alignItems: "flex-end", zIndex: 10 },
  handSectionReversed: { flexDirection: "row-reverse" },

  startCardBanner: {
    alignItems: "center", gap: Spacing.slim,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.snug, borderRadius: Radius.md,
    backgroundColor: Scrim.medium,
    borderWidth: 1, borderColor: Colors.goldSoft,
  },
  startCardGlyph: { fontSize: FontSize.xxl, color: Colors.text },
  startCardText: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm,
    color: Colors.text, textAlign: "center", letterSpacing: 0.5,
  },

  finishedRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  finishedText: {
    fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm, color: Colors.gold,
  },

  // overflow stays visible here — the seated shadow lives on this view, and a
  // native shadow is clipped by its own view's bounds. Corner-clipping the
  // gradient happens one level in, on the face.
  actionBtn: { ...Shadow.dark },
  // Off the viewer's turn a key is dark rather than a faded version of its lit
  // self: the prototype's resting `.btn` (#199) is its own ink at a third over
  // a third of black, with no gradient and no border behind it to fight.
  btnDimFace: { backgroundColor: "rgba(0,0,0,0.3)" },
  btnDimLabel: { color: "rgba(239,234,219,0.3)" },
  actionBtnInner: { flex: 1 },
  actionBtnFace: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xxs,
    overflow: "hidden",
  },
  // Tracking is `.16em` in the prototype, so it rides the font size and every
  // caller sets it beside `fontSize`.
  actionBtnLabel: {
    fontFamily: "Rajdhani_700Bold",
    textTransform: "uppercase",
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
  passBtnLabel: { color: Garnet.label },

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
    backgroundColor: Colors.gold,
    zIndex: 0,
  },
  // The one lit object on the table, and only on the player's own turn.
  playBtnFace: { borderWidth: 1, borderColor: Colors.goldLit },
  // Over the glow, which fills this button and paints.
  playBtnFront: { zIndex: 1 },
  playBtnLabel: { color: Colors.bgCard },
  playBtnSub: {
    fontFamily: "Rajdhani_500Medium",
    color: Colors.bgCard, opacity: 0.7,
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
  rematchPanel: {
    position: "absolute",
    width: REMATCH_PANEL_W,
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

});

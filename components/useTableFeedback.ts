import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewStyle } from "react-native";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  withRepeat,
  cancelAnimation,
  Easing,
  type AnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import type { Combination } from "@/lib/gameEngine";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { roundClosedWithWinner } from "@/components/gameTableModel";
import {
  playBomb,
  playCardPass,
  playCardPlay,
  playExchange,
  playGameLose,
  playGameWin,
  playYourTurn,
} from "@/lib/sounds";
import { hapticHeavy, hapticSuccess, hapticWarn } from "@/lib/haptics";
import { cancelMusicDuck, duckMusicFor } from "@/lib/music";
import { Motion } from "@/lib/theme";

// The refusal shake on GIOCA: deliberately a third of the bomb's amplitude —
// it is a "no", not an event. One leg duration for all four legs.
const BTN_REJECT_TRAVEL = 3;
const BTN_REJECT_LEG_MS = 40;

// The bomb's "kick": the whole table jolting off the impact, verbatim off the
// prototype's own `kick` keyframe — a punch-in scale held briefly, then a
// decaying series of jolts back to rest. `x`/`y` are `* scale`; `ms` never is.
const KICK_MS = 1600;
const KICK_EASING = Easing.bezier(0.33, 0.09, 0.2, 0.98);
const KICK_PUNCH_MS = 144;
const KICK_SETTLE_MS = 112;
const KICK_SCALE_PEAK = 1.012;
const KICK_SCALE_SETTLE = 1.006;
/**
 * Each jolt's stop and how long the table takes to reach it — the gaps between
 * the keyframe's own percents (0, 9, 16, 26, 36, 48, 60, 74, 100 of KICK_MS).
 * The first covers two of them: the table holds square through the punch-in,
 * so the jolt only starts once the scale has settled.
 */
const KICK_JOLTS = [
  { x: -9, y: 5, ms: KICK_PUNCH_MS + KICK_SETTLE_MS },
  { x: 9, y: -5, ms: 160 },
  { x: -6, y: -3, ms: 160 },
  { x: 5, y: 3, ms: 192 },
  { x: -3, y: -1, ms: 192 },
  { x: 2, y: 1, ms: 224 },
  { x: 0, y: 0, ms: 416 },
] as const;

interface TableFeedbackState {
  isMyTurn: boolean;
  isFinished: boolean;
  exchangeActive: boolean;
  canPass: boolean;
  playBtnValid: boolean;
  selectedCount: number;
  passCount: number;
  lastPlayedCombination: Combination | null;
  roundWinner: number | null;
  gameOver: boolean;
  rankings: string[];
  viewerId: string | undefined;
  /** The table's own scale — the kick's travel and the burst's size read off it. */
  scale: number;
}

interface TableFeedback {
  giocaFlashStyle: AnimatedStyle<ViewStyle>;
  passaFlashStyle: AnimatedStyle<ViewStyle>;
  giocaGlowStyle: AnimatedStyle<ViewStyle>;
  kickStyle: AnimatedStyle<ViewStyle>;
  /** Driven by `rejectPlay`; GiocaButton folds it into its own press style. */
  giocaRejectX: SharedValue<number>;
  /** The thrown card has landed. Timing it against the flight is the caller's. */
  playImpact: (heavy: boolean) => void;
  rejectPlay: () => void;
  /**
   * Increments on every bomb impact — BombBurst (components/table/moments.tsx)
   * re-fires its flare/wave/spark off the change, the same trigger-counter
   * pattern PlayedPile's own `bounceTrigger` already uses.
   */
  boomTrigger: number;
  /** Increments when a play empties a hand — Sweep and PlayedPile's `catchTrigger` read it the same way. */
  flushTrigger: number;
  /** Call once, at the same landing moment as `playImpact`, when that play emptied a hand. */
  celebrateFlush: () => void;
}

export function useTableFeedback({
  isMyTurn,
  isFinished,
  exchangeActive,
  canPass,
  playBtnValid,
  selectedCount,
  passCount,
  lastPlayedCombination,
  roundWinner,
  gameOver,
  rankings,
  viewerId,
  scale,
}: TableFeedbackState): TableFeedback {
  const reduceMotion = usePrefersReducedMotion();
  const prevMyTurnRef = useRef(false);
  const prevExchangeActiveRef = useRef(false);
  const prevGameOverRef = useRef(false);
  // Seeded from the state the table mounts on, so rejoining mid-round does not
  // replay the passes that happened before the viewer arrived.
  const prevPassCountRef = useRef(passCount);
  const prevRoundClosedRef = useRef(
    roundClosedWithWinner({ lastPlayedCombination, roundWinner })
  );
  // Read fresh inside playImpact without putting `scale` in its own deps —
  // GameTable's play effect lists playImpact as a dependency, and a table
  // rotation/resize must not re-run it.
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Steady-state emphasis is opacity and glow, never scale: a fractional scale
  // on a view containing text makes React Native resample the already-rasterised
  // glyphs, and PASSA/GIOCA read as blurry for as long as it is applied.
  //
  // The two scales on the table are both moments no one reads through — the
  // buttons' own press (BTN_PRESS_SCALE, GameTable.tsx), which lasts as long as
  // a finger is down, and the bomb's punch-in below, which peaks at 1.012 and
  // decays back to 1 within the one beat.
  const giocaFlashVal = useSharedValue(0);
  const passaFlashVal = useSharedValue(0);
  const giocaGlowVal = useSharedValue(0);
  const kickX = useSharedValue(0);
  const kickY = useSharedValue(0);
  const kickScale = useSharedValue(1);
  const giocaRejectX = useSharedValue(0);
  // BombBurst and Sweep own their animations; these just say "again" —
  // PlayedPile's `bounceTrigger` is the same pattern.
  const [boomTrigger, setBoomTrigger] = useState(0);
  const [flushTrigger, setFlushTrigger] = useState(0);

  useEffect(() => {
    if (isMyTurn && !isFinished && !prevMyTurnRef.current) playYourTurn();
    prevMyTurnRef.current = isMyTurn;
  }, [isMyTurn, isFinished]);

  useEffect(() => {
    if (exchangeActive && !prevExchangeActiveRef.current) playExchange();
    prevExchangeActiveRef.current = exchangeActive;
  }, [exchangeActive]);

  // A pass moves nothing on the felt, so the sound is the whole event. Keyed
  // on the state the pass produced, not the tap, so a bot, an opponent and the
  // server moving for a seat all announce themselves identically.
  //
  // `processPass` zeroes `passCount` on the pass that closes a round, so the
  // round closing stands in for that edge — heads-up, every legal pass closes
  // one, and without this a two-player game would hear nothing.
  useEffect(() => {
    const prevCount = prevPassCountRef.current;
    prevPassCountRef.current = passCount;
    const closed = roundClosedWithWinner({ lastPlayedCombination, roundWinner });
    const wasClosed = prevRoundClosedRef.current;
    prevRoundClosedRef.current = closed;
    if (passCount > prevCount || (closed && !wasClosed)) playCardPass();
  }, [passCount, lastPlayedCombination, roundWinner]);

  useEffect(() => {
    // Reset on the way back down so a rematch — which never unmounts the
    // table — gets its own win/lose sting instead of staying silent.
    if (!gameOver) {
      prevGameOverRef.current = false;
      return;
    }
    if (prevGameOverRef.current) return;
    prevGameOverRef.current = true;
    // `rankings` holds engine player ids (`player_0`), never display names.
    const myRank = viewerId ? rankings.indexOf(viewerId) : -1;
    if (myRank === 0) {
      hapticSuccess();
      playGameWin();
      duckMusicFor(2200);
    } else if (myRank >= 0 && myRank === rankings.length - 1) {
      hapticWarn();
      playGameLose();
      duckMusicFor(2200);
    }
  }, [gameOver, rankings, viewerId]);

  // A duck outlives the play that started it by a second or two, so leaving
  // the table mid-bomb would otherwise leave the music down until something
  // else moved it.
  useEffect(() => cancelMusicDuck, []);

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
    const hasSelection = selectedCount > 0 && isMyTurn && !isFinished;
    if (hasSelection && prevSelectedLen.current !== selectedCount && !reduceMotion) {
      giocaFlashVal.value = withSequence(
        withTiming(1, { duration: Motion.duration.fast }),
        withTiming(0, { duration: Motion.duration.base })
      );
    }
    prevSelectedLen.current = selectedCount;
  }, [selectedCount, isMyTurn, isFinished, reduceMotion, giocaFlashVal]);

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
      cancelAnimation(kickX);
      cancelAnimation(kickY);
      cancelAnimation(kickScale);
      cancelAnimation(giocaRejectX);
    },
    [giocaFlashVal, passaFlashVal, kickX, kickY, kickScale, giocaRejectX]
  );

  const giocaFlashStyle = useAnimatedStyle(() => ({ opacity: giocaFlashVal.value }));
  const passaFlashStyle = useAnimatedStyle(() => ({ opacity: passaFlashVal.value }));
  const kickStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: kickX.value },
      { translateY: kickY.value },
      { scale: kickScale.value },
    ],
  }));
  // Opacity only, on the childless sibling behind the button. A shadow written
  // per frame is main-thread paint the browser cannot composite.
  const giocaGlowStyle = useAnimatedStyle(() => ({ opacity: giocaGlowVal.value }));

  const playImpact = useCallback(
    (heavy: boolean) => {
      if (heavy) {
        playBomb();
        hapticHeavy();
        // The biggest play in the game should not have to share the mix.
        duckMusicFor(1100);
        if (!reduceMotion) {
          const s = scaleRef.current;
          const e = KICK_EASING;
          const jolt = (axis: "x" | "y") =>
            withSequence(
              ...KICK_JOLTS.map((j) => withTiming(j[axis] * s, { duration: j.ms, easing: e }))
            );
          kickScale.value = withSequence(
            withTiming(KICK_SCALE_PEAK, { duration: KICK_PUNCH_MS, easing: e }),
            withTiming(KICK_SCALE_SETTLE, { duration: KICK_SETTLE_MS, easing: e }),
            withTiming(1, { duration: KICK_MS - KICK_PUNCH_MS - KICK_SETTLE_MS, easing: e })
          );
          kickX.value = jolt("x");
          kickY.value = jolt("y");
          setBoomTrigger((t) => t + 1);
        }
      } else {
        playCardPlay();
      }
    },
    [reduceMotion, kickX, kickY, kickScale]
  );

  const celebrateFlush = useCallback(() => {
    if (reduceMotion) return;
    setFlushTrigger((t) => t + 1);
  }, [reduceMotion]);

  const rejectPlay = useCallback(() => {
    if (reduceMotion) return;
    giocaRejectX.value = withSequence(
      withTiming(BTN_REJECT_TRAVEL, { duration: BTN_REJECT_LEG_MS }),
      withTiming(-BTN_REJECT_TRAVEL, { duration: BTN_REJECT_LEG_MS }),
      withTiming(BTN_REJECT_TRAVEL, { duration: BTN_REJECT_LEG_MS }),
      withTiming(0, { duration: BTN_REJECT_LEG_MS })
    );
  }, [reduceMotion, giocaRejectX]);

  return {
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
  };
}

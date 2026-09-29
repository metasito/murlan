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
import type { Combination } from "@/lib/game/gameEngine";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useScreenShakeEnabled } from "@/lib/screenShake";
import { scheduleOnRN } from "react-native-worklets";
import {
  roundClosedWithWinner,
  traumaFor,
  shakeOffset,
  shakeAmplitudeFor,
} from "@/components/flightPhysics";
import { cancelLandingPulses, runLandingPulses } from "@/lib/device/feedback";
import { celebratesViewer, handOutcomeFor } from "@/lib/game/matchState";
import { Motion, motionMs } from "@/lib/theme";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { useLandingReaction } from "@/components/table/useLandingReaction";
import type { LandingSignal } from "@/components/table/useFlightClock";
import type { TableTimeline } from "@/components/table/tableTimeline";

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
export const KICK_JOLTS = [
  { x: -9, y: 5, ms: KICK_PUNCH_MS + KICK_SETTLE_MS },
  { x: 9, y: -5, ms: 160 },
  { x: -6, y: -3, ms: 160 },
  { x: 5, y: 3, ms: 192 },
  { x: -3, y: -1, ms: 192 },
  { x: 2, y: 1, ms: 224 },
  { x: 0, y: 0, ms: 416 },
] as const;

const NO_WINNERS: readonly string[] = [];

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
  /** Only `id` and `team` are read — enough to resolve `handOutcomeFor`. */
  players: readonly { id: string; team?: string }[];
  isTeamMode: boolean;
  /** What the manche just played awarded, by engine player id — `handOutcomeFor`'s draw check. */
  handScores: Record<string, number>;
  viewerId: string | undefined;
  /** The table's own scale — the kick's travel and the burst's size read off it. */
  scale: number;
  /** The partita is decided; its sting replaces the manche's. */
  matchOver?: boolean;
  /** Engine player ids, as `MatchVerdict.winners`. */
  matchWinners?: readonly string[];
  /** Written by the flight clock on the contact frame; the shake, the kick and the landing pulses react to it. */
  landing: SharedValue<LandingSignal>;
  /** Every cue goes out through it, at its flight's reported times. */
  timeline: Pick<TableTimeline, "moment">;
}

/**
 * `currentTurnIndex`, held back until `handsOffAt` of the card that handed the turn over — the
 * lamp and the seat rings follow this. Call it after `usePileFlight`, whose effect awaits the throw.
 */
export function useShownTurn(currentTurnIndex: number, timeline: Pick<TableTimeline, "handsOffAt" | "pending">): number {
  const { handsOffAt, pending } = timeline;
  const [turn, setTurn] = useState({ seat: currentTurnIndex, shown: currentTurnIndex });
  if (turn.seat !== currentTurnIndex) setTurn({ seat: currentTurnIndex, shown: turn.shown });
  useEffect(() => {
    if (turn.shown === turn.seat || pending()) return;
    const reveal = () => {
      traceOnset("moment", "handoff");
      setTurn((t) => ({ ...t, shown: t.seat }));
    };
    const wait = (handsOffAt ?? 0) - performance.now();
    if (wait <= 0) return reveal();
    const id = setTimeout(reveal, wait);
    return () => clearTimeout(id);
  }, [turn, handsOffAt, pending]);
  return turn.shown;
}

interface TableFeedback {
  giocaFlashStyle: AnimatedStyle<ViewStyle>;
  passaFlashStyle: AnimatedStyle<ViewStyle>;
  giocaGlowStyle: AnimatedStyle<ViewStyle>;
  kickStyle: AnimatedStyle<ViewStyle>;
  /** Driven by `rejectPlay`; GiocaButton folds it into its own press style. */
  giocaRejectX: SharedValue<number>;
  rejectPlay: () => void;
  /** Increments when a play empties a hand — Sweep and PlayedPile's `catchTrigger` read it the same way. */
  flushTrigger: number;
  /** Call once, at the flight's contact, when that play emptied a hand. */
  celebrateFlush: () => void;
  /** The escalation's own shake (#763): a translate, decaying to rest. */
  shakeStyle: AnimatedStyle<ViewStyle>;
}

/**
 * The kick and reject animations: the values, the style that reads them, the
 * two callbacks that write them, and the cancellation that follows them on
 * unmount — all in the one hook.
 *
 * They are together because the compiler will not compile them apart, and each
 * of the four other arrangements is refused for a different reason: writing a
 * value the same function used in an effect, writing one another hook returned,
 * writing one passed to a hook — which a dependency array is. What is left is
 * the shape the compiler names itself, *modify it where it is constructed*,
 * with the writers as plain closures. `components/table/hand.tsx` arrives at
 * the same place from the other side, with its gesture.
 */
function useImpactFeedback(landing: SharedValue<LandingSignal>, reduceMotion: boolean, screenShake: boolean, scale: number) {
  const kickX = useSharedValue(0);
  const kickY = useSharedValue(0);
  const kickScale = useSharedValue(1);
  const giocaRejectX = useSharedValue(0);
  // The escalation's own shake (#763): a trauma peak, an elapsed clock and the
  // decay window that landed with it — `shakeOffset` reads all four back
  // every frame, riding the table #101 settled — never a second amplitude
  // authored here. `shakeAmpX`/`Y` carry `shakeAmplitudeFor(tier)` (#796):
  // which peak a landing reads is decided once, when it fires, not
  // re-derived every frame from a tier this hook does not otherwise keep.
  const shakeTrauma = useSharedValue(0);
  const shakeElapsed = useSharedValue(0);
  const shakeDecayMs = useSharedValue(0);
  const shakeAmpX = useSharedValue(0);
  const shakeAmpY = useSharedValue(0);
  const shakeAmpRotate = useSharedValue(0);

  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  // The pulses are not motion, so reduced motion keeps them (ADR-0009 §2). `traumaFor` answers 0
  // under reduced motion or with the shake off, and `motionMs` collapses the decay the same way.
  const decayMs = motionMs("shake", reduceMotion);
  const kicks = !reduceMotion && screenShake;
  useLandingReaction(landing, (l) => {
    "worklet";
    runLandingPulses(l.pulses);
    if (l.heavy && kicks) {
      const e = KICK_EASING;
      const jolt = (axis: "x" | "y") =>
        withSequence(...KICK_JOLTS.map((j) => withTiming(j[axis] * scale, { duration: j.ms, easing: e })));
      kickScale.set(
        withSequence(
          withTiming(KICK_SCALE_PEAK, { duration: KICK_PUNCH_MS, easing: e }),
          withTiming(KICK_SCALE_SETTLE, { duration: KICK_SETTLE_MS, easing: e }),
          withTiming(1, { duration: KICK_MS - KICK_PUNCH_MS - KICK_SETTLE_MS, easing: e })
        )
      );
      kickX.set(jolt("x"));
      kickY.set(jolt("y"));
    }
    const trauma = traumaFor(l.tier, reduceMotion, !screenShake);
    const amplitude = shakeAmplitudeFor(l.tier);
    shakeTrauma.set(trauma);
    shakeDecayMs.set(decayMs);
    shakeAmpX.set(amplitude.x);
    shakeAmpY.set(amplitude.y);
    shakeAmpRotate.set(amplitude.rotate);
    cancelAnimation(shakeElapsed);
    shakeElapsed.set(0);
    if (trauma === 0) return;
    scheduleOnRN(traceOnset, "moment", l.tier);
    shakeElapsed.set(withTiming(decayMs, { duration: decayMs, easing: Easing.linear }));
  });

  const reject = () => {
    if (reduceMotionRef.current) return;
    giocaRejectX.value = withSequence(
      withTiming(BTN_REJECT_TRAVEL, { duration: BTN_REJECT_LEG_MS }),
      withTiming(-BTN_REJECT_TRAVEL, { duration: BTN_REJECT_LEG_MS }),
      withTiming(BTN_REJECT_TRAVEL, { duration: BTN_REJECT_LEG_MS }),
      withTiming(0, { duration: BTN_REJECT_LEG_MS })
    );
  };

  const kickStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: kickX.value },
      { translateY: kickY.value },
      { scale: kickScale.value },
    ],
  }));

  const shakeStyle = useAnimatedStyle(() => {
    const { x, y, rotate } = shakeOffset(shakeTrauma.value, shakeElapsed.value, shakeDecayMs.value, scale, {
      x: shakeAmpX.value,
      y: shakeAmpY.value,
      rotate: shakeAmpRotate.value,
    });
    return { transform: [{ translateX: x }, { translateY: y }, { rotate: `${rotate}deg` }] };
  });
  useTraceSource("shake", () =>
    shakeOffset(shakeTrauma.value, shakeElapsed.value, shakeDecayMs.value, scale, {
      x: shakeAmpX.value,
      y: shakeAmpY.value,
      rotate: shakeAmpRotate.value,
    })
  );

  // Reanimated keeps driving shared values after unmount unless cancelled.
  useEffect(
    () => () => {
      cancelAnimation(kickX);
      cancelAnimation(kickY);
      cancelAnimation(kickScale);
      cancelAnimation(giocaRejectX);
      cancelAnimation(shakeElapsed);
    },
    [kickX, kickY, kickScale, giocaRejectX, shakeElapsed]
  );

  // A plain closure: the compiler refuses a function that writes a shared value if that function
  // was passed to a hook. The ref holds the first render's, which reads its input through a ref.
  const writers = useRef({ reject });
  const rejectPlay = useCallback(() => writers.current.reject(), []);

  return { kickStyle, giocaRejectX, rejectPlay, shakeStyle };
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
  players,
  isTeamMode,
  handScores,
  viewerId,
  scale,
  matchOver = false,
  matchWinners = NO_WINNERS,
  landing,
  timeline,
}: TableFeedbackState): TableFeedback {
  const reduceMotion = usePrefersReducedMotion();
  const screenShake = useScreenShakeEnabled();
  const prevMyTurnRef = useRef(false);
  const prevExchangeActiveRef = useRef(false);
  const prevGameOverRef = useRef(false);
  // Seeded from the state the table mounts on, so rejoining mid-round does not
  // replay the passes that happened before the viewer arrived.
  const prevPassCountRef = useRef(passCount);
  const prevRoundClosedRef = useRef(
    roundClosedWithWinner({ lastPlayedCombination, roundWinner })
  );
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
  const { kickStyle, giocaRejectX, rejectPlay, shakeStyle } = useImpactFeedback(landing, reduceMotion, screenShake, scale);
  // Sweep and the pile's catch own their animations; this just says "again".
  const [flushTrigger, setFlushTrigger] = useState(0);

  const { moment } = timeline;
  useEffect(() => () => cancelLandingPulses(), []);

  useEffect(() => {
    if (isMyTurn && !isFinished && !gameOver && !prevMyTurnRef.current) moment({ kind: "turn" }, "handoff");
    prevMyTurnRef.current = isMyTurn;
  }, [isMyTurn, isFinished, gameOver, moment]);

  useEffect(() => {
    if (exchangeActive && !prevExchangeActiveRef.current) moment({ kind: "exchange" });
    prevExchangeActiveRef.current = exchangeActive;
  }, [exchangeActive, moment]);

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
    const closedNow = closed && !wasClosed;
    if (passCount > prevCount || closedNow) moment({ kind: "pass" });
    if (closedNow) moment({ kind: "roundWon" });
  }, [passCount, lastPlayedCombination, roundWinner, moment]);

  useEffect(() => {
    // Reset on the way back down so a rematch — which never unmounts the
    // table — gets its own win/lose sting instead of staying silent.
    if (!gameOver) {
      prevGameOverRef.current = false;
      return;
    }
    if (prevGameOverRef.current) return;
    // The manche/partita shake itself is NOT fired here: it reacts to the
    // winning card's own landing signal, on its contact frame.
    // `rankings` holds engine player ids (`player_0`), never display names.
    // Routed through the one function the results board's own haptic reads
    // for the same question (`lib/game/matchState.ts`), fed the same `handScores`
    // the caller already holds rather than a second `scoreHand` of its own,
    // so a teams-mode 3-3 manche (GAME-RULES.md §11) stays neutral here exactly as
    // it does there, instead of this effect deciding the same question again.
    const outcome = handOutcomeFor(players, rankings, handScores, viewerId, isTeamMode);
    // Online, `gameOver` reaches this effect (`game:state`) a render ahead of
    // the scores that decide it (`game:over`, unawaited server-side and
    // strictly later) — `"pending"` is that gap. Latching here would freeze
    // the decision on data that was never real; returning without touching
    // the ref lets the next render, carrying the real `handScores`, run this
    // same effect again instead.
    // The sting is placed in the engine a beat after the hand-off, so leaving the
    // table cannot cancel it (#5); every ranked id must carry a score, which is
    // also when an online partita's winners have arrived.
    if (outcome === "pending" || rankings.some((id) => !(id in handScores))) return;
    prevGameOverRef.current = true;
    const after = motionMs("shift", reduceMotion);
    if (matchOver && matchWinners.length > 0) {
      moment({ kind: "partitaOver", won: celebratesViewer(players, [matchWinners[0]], viewerId, isTeamMode) }, "handoff", after);
    } else {
      moment({ kind: "mancheOver", outcome }, "handoff", after);
    }
  }, [gameOver, rankings, players, isTeamMode, handScores, viewerId, reduceMotion, matchOver, matchWinners, moment]);

  // GIOCA bloom — a slow gold pulse while the button is armed.
  useEffect(() => {
    if (playBtnValid && !reduceMotion) {
      const breath = (to: number) =>
        withTiming(to, { duration: Motion.duration.dwell, easing: Easing.inOut(Easing.sin) });
      giocaGlowVal.value = withRepeat(withSequence(breath(1.0), breath(0.35)), -1, false);
    } else {
      cancelAnimation(giocaGlowVal);
      giocaGlowVal.value =
        reduceMotion && playBtnValid
          ? 0.6
          : withTiming(0, { duration: Motion.duration.tap });
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
        withTiming(1, { duration: Motion.duration.tap }),
        withTiming(0, { duration: Motion.duration.shift })
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
        withTiming(1, { duration: Motion.duration.shift }),
        withTiming(0, { duration: Motion.duration.travel })
      );
    }
  }, [canPass, reduceMotion, passaFlashVal]);

  // Reanimated keeps driving shared values after unmount unless cancelled.
  // GiocaButton/PassaButton own and cancel their own press values; the impact
  // values cancel themselves, in the hook that owns them.
  useEffect(
    () => () => {
      cancelAnimation(giocaFlashVal);
      cancelAnimation(passaFlashVal);
    },
    [giocaFlashVal, passaFlashVal]
  );

  const giocaFlashStyle = useAnimatedStyle(() => ({ opacity: giocaFlashVal.value }));
  const passaFlashStyle = useAnimatedStyle(() => ({ opacity: passaFlashVal.value }));
  // Opacity only, on the childless sibling behind the button. A shadow written
  // per frame is main-thread paint the browser cannot composite.
  const giocaGlowStyle = useAnimatedStyle(() => ({ opacity: giocaGlowVal.value }));

  const celebrateFlush = useCallback(() => {
    if (reduceMotion) return;
    traceOnset("moment", "flush");
    setFlushTrigger((t) => t + 1);
  }, [reduceMotion]);

  return {
    giocaFlashStyle,
    passaFlashStyle,
    giocaGlowStyle,
    kickStyle,
    giocaRejectX,
    rejectPlay,
    flushTrigger,
    celebrateFlush,
    shakeStyle,
  };
}

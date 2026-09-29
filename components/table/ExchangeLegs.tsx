import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type FrameInfo,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { CardView } from "@/components/CardView";
import { BACK_SCALE, CARD_H, CARD_W, FIELD_SCALE } from "@/components/cardFaceModel";
import { FAN_CARD_SCALE, JOKERS, readExchangeLegs, tradeKey, type SeatGeometry, type TradeStages } from "@/components/flightPhysics";
import type { CardFrom } from "@/components/flightPose";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { A11yStatus, a11yHidden } from "@/lib/a11y";
import { cardSpokenName } from "@/lib/cardNames";
import { event } from "@/lib/device/feedback";
import type { Card } from "@/lib/game/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import { legPose, legStage, legTimes, type LegPoints, type LegStage } from "@/lib/game/exchangeTimeline";
import { useTranslation } from "@/lib/i18n";
import { Motion } from "@/lib/theme";
import { inBackground } from "./useFlightClock";

export interface RingFlash { seq: number; seat: number }
export type LegName = "receive" | "give";

const X = Motion.exchange;
const STAGES: LegStage[] = ["waiting", "flying", "rest", "tuck", "landed"];
const BACK_CARD: Card = { id: "exchange-back", suit: null, rank: "3", isJoker: false };
/** The points of the receive, the give and the two Jokers, in that order. */
type Points = LegPoints[];

interface Run { origin: number; stage: number[]; ready: boolean; done: boolean }
interface Report { cue: (at: number) => void; stage: (leg: number, stage: number) => void; ready: () => void; done: () => void }

/**
 * One clock for the trade: the receive (or both Jokers) shows `beat` after the go, the give
 * `giveWait` after the choice and never before the receive has landed and been read.
 */
function stepper(
  run: SharedValue<Run>,
  goAt: SharedValue<number>,
  choiceAt: SharedValue<number>,
  clock: SharedValue<number>,
  shows: SharedValue<number[]>,
  reduced: SharedValue<boolean>,
  ends: SharedValue<number[]>,
  flash: SharedValue<RingFlash>,
  jokers: boolean,
  report: Report
) {
  const ping = (seat: number) => {
    "worklet";
    if (seat >= 0) flash.value = { seq: flash.value.seq + 1, seat };
  };
  return (frame: FrameInfo) => {
    "worklet";
    const r = run.value;
    if (r.done || goAt.value < 0) return;
    const times = legTimes(reduced.value);
    if (r.origin < 0) {
      // On the go's clock, not the first frame's: web hands a new frame callback its first frame two frames late.
      r.origin = Math.min(frame.timestamp, goAt.value);
      shows.value = [X.beat, Infinity];
      scheduleOnRN(report.cue, r.origin + X.beat);
    }
    const t = frame.timestamp - r.origin;
    const readyAt = shows.value[0] + times.end + X.read;
    if (!jokers && shows.value[1] === Infinity && choiceAt.value >= 0) {
      const give = Math.max(Math.min(frame.timestamp, choiceAt.value) - r.origin + X.giveWait, readyAt);
      shows.value = [shows.value[0], give];
      scheduleOnRN(report.cue, r.origin + give);
    }
    clock.value = t;
    for (let leg = 0; leg < 2; leg++) {
      const s = STAGES.indexOf(legStage(t - shows.value[leg], times));
      if (s === r.stage[leg]) continue;
      if (r.stage[leg] < 1 && s >= 1) ping(ends.value[leg * 2]);
      if (r.stage[leg] < 2 && s >= 2) ping(ends.value[leg * 2 + 1]);
      r.stage[leg] = s;
      scheduleOnRN(report.stage, leg, s);
    }
    if (!jokers && !r.ready && t >= readyAt) {
      r.ready = true;
      scheduleOnRN(report.ready);
    }
    if (t >= shows.value[jokers ? 0 : 1] + times.end + X.read) {
      r.done = true;
      scheduleOnRN(report.done);
    }
  };
}

function useLegClock(...args: Parameters<typeof stepper>) {
  const [step] = useState(() => stepper(...args));
  return useFrameCallback(step, true);
}

function LegCard({ card, leg, show, points, clock, shows, reduced, scale, testID }: {
  card: Card; leg: number; show: number; points: SharedValue<Points>; clock: SharedValue<number>;
  shows: SharedValue<number[]>; reduced: SharedValue<boolean>; scale: number; testID: string;
}) {
  const w = CARD_W(scale * FIELD_SCALE);
  const h = CARD_H(scale * FIELD_SCALE);
  const pose = useDerivedValue(() => legPose(clock.value - shows.value[show], points.value[leg], reduced.value));
  const style = useAnimatedStyle(() => {
    const p = pose.value;
    return {
      opacity: p.visible ? 1 : 0,
      transform: [{ translateX: p.x }, { translateY: p.y }, { rotate: `${p.rot}deg` }, { scale: p.scale }, { scaleX: p.flip }],
    };
  });
  const face = useAnimatedStyle(() => ({ opacity: pose.value.face ? 1 : 0 }));
  const back = useAnimatedStyle(() => ({ opacity: pose.value.face ? 0 : 1 }));
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.box, { width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2 }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, face]}>
        <CardView card={card} scale={scale * FIELD_SCALE} noLift decorative light="flat" />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.centred, back]}>
        <CardView card={BACK_CARD} faceDown scale={(scale * BACK_SCALE) / FAN_CARD_SCALE} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The trade on the table, giver → pile → receiver (tests/e2e/fixtures/exchange-legs, "Through the
 * pile"). Mounted from the phase opening; `go` is the deal having landed. It reports each leg's
 * stage, the choice opening (`onReady`) and the ceremony's end, all off its own frame clock.
 */
export function ExchangeLegs({
  trade,
  stages,
  geometry,
  handOrigins,
  go,
  viewerSeat,
  scale,
  flash,
  onStage,
  onReady,
  onDismiss,
  holdMsOverride,
}: {
  trade: ExchangeAnnounceData;
  stages: TradeStages;
  geometry: SeatGeometry;
  handOrigins: { readonly current: ReadonlyMap<string, CardFrom> };
  go: boolean;
  viewerSeat: number | null;
  scale: number;
  flash: SharedValue<RingFlash>;
  onStage: (key: string, leg: LegName, stage: LegStage) => void;
  onReady: (key: string) => void;
  onDismiss: () => void;
  /** Replaces the ceremony's end: this long after the choice, or after mount for both Jokers (#915, offline e2e only). */
  holdMsOverride?: number;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const jokers = trade.bothJokersException;
  const key = tradeKey(trade);
  const calls = useRef({ onStage, onReady, onDismiss, key });
  useEffect(() => {
    calls.current = { onStage, onReady, onDismiss, key };
  });

  const run = useSharedValue<Run>({ origin: -1, stage: [0, 0], ready: false, done: false });
  const goAt = useSharedValue(-1);
  const choiceAt = useSharedValue(-1);
  const clock = useSharedValue(0);
  const shows = useSharedValue([Infinity, Infinity]);
  const reduced = useSharedValue(reduceMotion);
  const own = (seat: number) => (seat === viewerSeat ? -1 : seat);
  const ends = useSharedValue(
    jokers ? [own(trade.loserIdx), -1, -1, -1] : [own(trade.loserIdx), own(trade.winnerIdx), own(trade.winnerIdx), own(trade.loserIdx)]
  );
  const [initial] = useState(() => {
    const legs = readExchangeLegs({ ...geometry, trade });
    return [legs.receive, legs.give, ...legs.jokers];
  });
  const pointsValue = useSharedValue<Points>(initial);
  const holdRef = useRef(holdMsOverride);
  const cue = useCallback((at: number) => event([{ kind: "exchange" }], at), []);
  const stage = useCallback(
    (leg: number, s: number) => calls.current.onStage(calls.current.key, leg === 0 ? "receive" : "give", STAGES[s]),
    []
  );
  const ready = useCallback(() => calls.current.onReady(calls.current.key), []);
  const done = useCallback(() => {
    if (holdRef.current === undefined) calls.current.onDismiss();
  }, []);
  const frames = useLegClock(run, goAt, choiceAt, clock, shows, reduced, ends, flash, jokers, { cue, stage, ready, done });

  useEffect(() => {
    reduced.set(reduceMotion);
  }, [reduced, reduceMotion]);
  useEffect(() => {
    if (go && goAt.get() < 0) goAt.set(inBackground() ? Infinity : performance.now());
  }, [go, goAt]);
  const chosen = trade.cardGiven !== undefined;
  useEffect(() => {
    if (chosen && choiceAt.get() < 0) choiceAt.set(inBackground() ? Infinity : performance.now());
  }, [chosen, choiceAt]);
  // Read after commit: the hand publishes where it drew each card then. A leg keeps the points it left with.
  useEffect(() => {
    const next = readExchangeLegs({ ...geometry, trade }, handOrigins.current);
    const cur = pointsValue.get();
    const fresh = (stage: LegStage) => stage === "waiting";
    pointsValue.set([
      fresh(stages.receive) ? next.receive : cur[0],
      fresh(stages.give) ? next.give : cur[1],
      ...(fresh(stages.receive) ? next.jokers : cur.slice(2)),
    ]);
  });
  useEffect(() => {
    if (run.get().done) frames.setActive(false);
  });

  useEffect(() => {
    holdRef.current = holdMsOverride;
    if (holdMsOverride === undefined || !(chosen || jokers)) return;
    const done = setTimeout(() => calls.current.onDismiss(), holdMsOverride);
    return () => clearTimeout(done);
  }, [holdMsOverride, chosen, jokers]);

  const nameOf = (seat: number) =>
    seat === viewerSeat ? t("gameShared.you") : seat === trade.winnerIdx ? trade.winnerName : trade.loserName;
  const shown = (stage: LegStage) => stage !== "waiting" && stage !== "flying";
  const giveLine = (card: Card, from: number, to: number) =>
    t("exchangeAnnouncement.giveLine", { from: nameOf(from), card: cardSpokenName(card, t), to: nameOf(to) });
  const a11yLabel = jokers
    ? shown(stages.receive) ? t("exchangeAnnouncement.a11yNoSwap", { loserName: trade.loserName }) : ""
    : [
        trade.cardReceived && shown(stages.receive) && giveLine(trade.cardReceived, trade.loserIdx, trade.winnerIdx),
        trade.cardGiven && shown(stages.give) && giveLine(trade.cardGiven, trade.winnerIdx, trade.loserIdx),
      ]
        .filter(Boolean)
        .join(". ");

  const card = (c: Card, leg: number, show: number, testID: string) => (
    <LegCard key={testID} card={c} leg={leg} show={show} points={pointsValue} clock={clock} shows={shows} reduced={reduced} scale={scale} testID={testID} />
  );
  return (
    <View testID="exchange-announce" pointerEvents="none" style={StyleSheet.absoluteFill}>
      <A11yStatus label={a11yLabel} role="alert" live="assertive" />
      <View style={StyleSheet.absoluteFill} {...a11yHidden()}>
        {jokers
          ? JOKERS.map((j, i) => card(j, 2 + i, 0, `exchange-joker-${i}`))
          : [
              trade.cardReceived && card(trade.cardReceived, 0, 0, "exchange-flier-to-winner"),
              trade.cardGiven && card(trade.cardGiven, 1, 1, "exchange-flier-to-loser"),
            ]}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: "absolute", left: "50%", top: "50%" },
  centred: { alignItems: "center", justifyContent: "center" },
});

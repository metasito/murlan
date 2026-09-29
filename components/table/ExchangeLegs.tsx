import { useEffect, useRef, useState } from "react";
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
import { FAN_CARD_SCALE } from "@/components/flightPhysics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { A11yStatus, a11yHidden } from "@/lib/a11y";
import { cardSpokenName } from "@/lib/cardNames";
import type { Card } from "@/lib/game/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import {
  GIVE_LEAD,
  GIVE_MS,
  RECEIVE_LEAD,
  RECEIVE_MS,
  REST_AT_MS,
  REST_END_MS,
  givePose,
  receivePose,
  restPoint,
  type ExchangePose,
  type LegPoints,
} from "@/lib/game/exchangeTimeline";
import { useTranslation } from "@/lib/i18n";
import { Reading, Spacing } from "@/lib/theme";
import { ExchangeTag } from "./ExchangeTag";

type PoseAt = (t: number, leg: LegPoints) => ExchangePose;
interface LegClock { pose: PoseAt; lead: number; end: number }
const RECEIVE: LegClock = { pose: receivePose, lead: RECEIVE_LEAD, end: RECEIVE_MS };
const GIVE: LegClock = { pose: givePose, lead: GIVE_LEAD, end: GIVE_MS };
const BACK_CARD: Card = { id: "exchange-back", suit: null, rank: "3", isJoker: false };

function stepper(started: SharedValue<number>, elapsed: SharedValue<number>, landed: () => void) {
  return (frame: FrameInfo) => {
    "worklet";
    if (started.value === -2) return;
    if (started.value === -1) started.value = frame.timestamp;
    elapsed.value = frame.timestamp - started.value;
    if (elapsed.value >= GIVE_MS) {
      started.value = -2;
      scheduleOnRN(landed);
    }
  };
}

/** Reduced motion skips the travel: the card is shown at its rest from its lead. */
function timeAt(t: number, clock: LegClock, reduceMotion: boolean): number {
  "worklet";
  return reduceMotion && t >= clock.lead ? clock.lead + REST_AT_MS : t;
}

function LegCard({ card, leg, clock, elapsed, scale, reduceMotion, testID }: {
  card: Card; leg: LegPoints; clock: LegClock; elapsed: SharedValue<number>; scale: number; reduceMotion: boolean; testID: string;
}) {
  const w = CARD_W(scale * FIELD_SCALE);
  const h = CARD_H(scale * FIELD_SCALE);
  // Held at its last pose past its own end: the hand draws it only once both legs have landed.
  const pose = useDerivedValue(() => clock.pose(Math.min(timeAt(elapsed.value, clock, reduceMotion), clock.end - 1), leg));
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

function LegTag({ name, leg, clock, elapsed, scale, reduceMotion, testID }: {
  name: string; leg: LegPoints; clock: LegClock; elapsed: SharedValue<number>; scale: number; reduceMotion: boolean; testID: string;
}) {
  const [tag, setTag] = useState({ w: 0, h: 0 });
  const w = CARD_W(scale * FIELD_SCALE);
  const h = CARD_H(scale * FIELD_SCALE);
  const towardPile = leg.rest.y > 0;
  const style = useAnimatedStyle(() => {
    const p = clock.pose(Math.min(timeAt(elapsed.value, clock, reduceMotion), clock.lead + REST_END_MS), leg);
    const rad = (p.rot * Math.PI) / 180;
    const half = ((Math.abs(Math.cos(rad)) * h + Math.abs(Math.sin(rad)) * w) * p.scale) / 2 + Spacing.xxs;
    return {
      opacity: elapsed.value >= clock.lead ? 1 : 0,
      transform: [{ translateX: p.x - tag.w / 2 }, { translateY: towardPile ? p.y - half - tag.h : p.y + half }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.anchor, style]}
      onLayout={(e) => setTag({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <ExchangeTag name={name} scale={scale} testID={testID} />
    </Animated.View>
  );
}

function NoSwapTag({ at, scale, text }: { at: { x: number; y: number }; scale: number; text: string }) {
  const [tagW, setTagW] = useState(0);
  return (
    <View
      pointerEvents="none"
      style={[styles.anchor, { transform: [{ translateX: at.x - tagW / 2 }, { translateY: at.y }] }]}
      onLayout={(e) => setTagW(e.nativeEvent.layout.width)}
    >
      <ExchangeTag name={text} scale={scale} testID="exchange-no-swap" />
    </View>
  );
}

/**
 * The trade on the table: each card flies seat to seat, face up, rests beside its receiver and
 * tucks in, carrying who gave it to whom (lib/game/exchangeTimeline.ts). One frame clock runs
 * both legs; `onLanded` is its end, and the ceremony holds a notice's reading past it.
 */
export function ExchangeLegs({
  data,
  legs,
  viewerSeat,
  scale,
  onLanded,
  onDismiss,
  holdMsOverride,
}: {
  data: ExchangeAnnounceData;
  legs: { receive: LegPoints; give: LegPoints };
  viewerSeat: number | null;
  scale: number;
  onLanded: () => void;
  onDismiss: () => void;
  /** Replaces the reading hold as this ceremony's whole length (#915, offline e2e only). */
  holdMsOverride?: number;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const [landed, setLanded] = useState(false);
  const landedRef = useRef(onLanded);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    landedRef.current = onLanded;
    dismissRef.current = onDismiss;
  });
  const started = useSharedValue(-1);
  const elapsed = useSharedValue(0);
  const [step] = useState(() => stepper(started, elapsed, () => setLanded(true)));
  const frames = useFrameCallback(step, !data.bothJokersException);
  useEffect(() => {
    if (!landed) return;
    frames.setActive(false);
    landedRef.current();
  }, [landed, frames]);

  const waitingOnFlight = holdMsOverride === undefined && !data.bothJokersException && !landed;
  useEffect(() => {
    if (waitingOnFlight) return;
    const done = setTimeout(() => dismissRef.current(), holdMsOverride ?? Reading.notice);
    return () => clearTimeout(done);
  }, [waitingOnFlight, holdMsOverride]);

  const nameOf = (seat: number) =>
    seat === viewerSeat ? t("gameShared.you") : seat === data.winnerIdx ? data.winnerName : data.loserName;
  const tag = (from: number, to: number) => t("exchange.tag", { from: nameOf(from), to: nameOf(to) });
  const giveLine = (card: Card, from: string, to: string) =>
    t("exchangeAnnouncement.giveLine", { from, card: cardSpokenName(card, t), to });
  const a11yLabel = data.bothJokersException
    ? t("exchangeAnnouncement.a11yNoSwap", { loserName: data.loserName })
    : [
        data.cardReceived && giveLine(data.cardReceived, data.loserName, data.winnerName),
        data.cardGiven && giveLine(data.cardGiven, data.winnerName, data.loserName),
      ]
        .filter(Boolean)
        .join(". ");

  return (
    <View testID="exchange-announce" pointerEvents="none" style={StyleSheet.absoluteFill}>
      <A11yStatus label={a11yLabel} role="alert" live="assertive" />
      <View style={StyleSheet.absoluteFill} {...a11yHidden()}>
        {data.bothJokersException ? (
          <NoSwapTag at={restPoint(legs.receive.from)} scale={scale} text={t("exchangeAnnouncement.noSwapText")} />
        ) : (
          <>
            {data.cardReceived && (
              <>
                {!landed && <LegCard card={data.cardReceived} leg={legs.receive} clock={RECEIVE} elapsed={elapsed} scale={scale} reduceMotion={reduceMotion} testID="exchange-flier-to-winner" />}
                <LegTag name={tag(data.loserIdx, data.winnerIdx)} leg={legs.receive} clock={RECEIVE} elapsed={elapsed} scale={scale} reduceMotion={reduceMotion} testID="exchange-tag-to-winner" />
              </>
            )}
            {data.cardGiven && (
              <>
                {!landed && <LegCard card={data.cardGiven} leg={legs.give} clock={GIVE} elapsed={elapsed} scale={scale} reduceMotion={reduceMotion} testID="exchange-flier-to-loser" />}
                <LegTag name={tag(data.winnerIdx, data.loserIdx)} leg={legs.give} clock={GIVE} elapsed={elapsed} scale={scale} reduceMotion={reduceMotion} testID="exchange-tag-to-loser" />
              </>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: "absolute", left: "50%", top: "50%" },
  anchor: { position: "absolute", left: "50%", top: "50%" },
  centred: { alignItems: "center", justifyContent: "center" },
});

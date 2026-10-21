import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type FrameInfo,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { CardView } from "@/components/CardView";
import { BACK_SCALE, CARD_BACK_H, CARD_BACK_W, CARD_H, CARD_W, FIELD_SCALE } from "@/components/cardFaceModel";
import { FAN_CARD_SCALE } from "@/components/impact";
import type { Seating, TableLayout } from "@/components/tableLayout";
import { JOKERS, readExchangeLegs, type ExchangeStages } from "@/components/table/exchangeModel";
import type { CardFrom } from "@/components/flightPose";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { A11yStatus, a11yHidden } from "@/lib/a11y";
import { cardSpokenName } from "@/lib/cardNames";
import { event, withdraw } from "@/lib/device/feedback";
import type { Card } from "@/lib/game/gameEngine";
import type { ExchangeAnnounceData, ExchangeHold } from "@/lib/game/sharedGameFlow";
import { ceremonyEndsAt, choiceOpensAt, legPose, legShows, legStage, legTimes, type LegPoints, type LegStage } from "@/lib/timeline/exchangeTimeline";
import { useTranslation } from "@/lib/i18n";
import { armGateWatchdog, gateForced } from "./gateForced";
import { inBackground } from "./useFlightClock";
import { designRect, legCard } from "./cardRects";
import { useCardRect, useCardTable } from "./useCardRects";

export interface RingFlash { seq: number; seat: number }
export type LegName = "receive" | "give";

const STAGES: LegStage[] = ["waiting", "flying", "rest", "tuck", "landed"];
const BACK_CARD: Card = { id: "exchange-back", suit: null, rank: "3", isJoker: false };
/** The points of the receive, the give and the two Jokers, in that order. */
type Points = LegPoints[];

interface Run { origin: number; stage: number[]; ready: boolean; done: boolean }
interface Report { cue: (at: number) => void; stage: (leg: number, stage: number) => void; ready: () => void; done: () => void }

/**
 * One clock for the exchange: the receive (or both Jokers) shows `beat` after the go, the give
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
  lifted: SharedValue<string[]>,
  outgoing: SharedValue<string[][]>,
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
      shows.value = legShows(null, reduced.value);
      scheduleOnRN(report.cue, r.origin + shows.value[0]);
    }
    const t = frame.timestamp - r.origin;
    if (!jokers && shows.value[1] === Infinity && choiceAt.value >= 0) {
      shows.value = legShows(Math.min(frame.timestamp, choiceAt.value) - r.origin, reduced.value);
      scheduleOnRN(report.cue, r.origin + shows.value[1]);
    }
    clock.value = t;
    for (let leg = 0; leg < 2; leg++) {
      const s = STAGES.indexOf(legStage(t - shows.value[leg], times));
      if (s === r.stage[leg]) continue;
      if (r.stage[leg] < 1 && s >= 1) {
        ping(ends.value[leg * 2]);
        lifted.value = [...lifted.value, ...outgoing.value[leg]];
      }
      if (r.stage[leg] < 2 && s >= 2) ping(ends.value[leg * 2 + 1]);
      r.stage[leg] = s;
      scheduleOnRN(report.stage, leg, s);
    }
    if (!jokers && !r.ready && t >= choiceOpensAt(reduced.value)) {
      r.ready = true;
      scheduleOnRN(report.ready);
    }
    if (t >= ceremonyEndsAt(shows.value, reduced.value, jokers)) {
      r.done = true;
      scheduleOnRN(report.done);
    }
  };
}

/** A gate released off the frame clock: on the UI thread, through the same latch, so it fires at most once whoever gets there first. */
function release(run: SharedValue<Run>, gate: "ready" | "done", then: () => void) {
  "worklet";
  const r = run.value;
  if (r[gate]) return;
  r[gate] = true;
  scheduleOnRN(then);
}

function useLegClock(...args: Parameters<typeof stepper>) {
  const [step] = useState(() => stepper(...args));
  return useFrameCallback(step, true);
}

function LegCard({ card, leg, show, points, clock, shows, reduced, drawn, scale, testID }: {
  card: Card; leg: number; show: number; points: SharedValue<Points>; clock: SharedValue<number>;
  shows: SharedValue<number[]>; reduced: SharedValue<boolean>; drawn: SharedValue<boolean[]>; scale: number; testID: string;
}) {
  const w = CARD_W(scale * FIELD_SCALE);
  const h = CARD_H(scale * FIELD_SCALE);
  const pose = useDerivedValue(() => {
    const at = clock.value - shows.value[show];
    return legPose(drawn.value[show] ? at : Math.min(at, legTimes(reduced.value).end - 1), points.value[leg], reduced.value);
  });
  const style = useAnimatedStyle(() => {
    const p = pose.value;
    return {
      opacity: p.visible ? 1 : 0,
      transform: [{ translateX: p.x }, { translateY: p.y }, { rotate: `${p.rot}deg` }, { scale: p.scale }, { scaleX: p.flip }],
    };
  });
  const table = useCardTable();
  const backScale = (scale * BACK_SCALE) / FAN_CARD_SCALE;
  const backW = CARD_BACK_W(backScale);
  const backH = CARD_BACK_H(backScale);
  const pile = table?.pile;
  const felt = table?.felt;
  const motion = table?.motion;
  const ownRects = useCardRect(
    table,
    `leg:${testID}`,
    true,
    [pose, motion],
    () => {
      "worklet";
      const p = pose.value;
      if (!pile || !felt || !motion || !p.visible) return null;
      return designRect(legCard(pile, p, p.face ? w : backW, p.face ? h : backH), felt, motion.value);
    }
  );
  const face = useAnimatedStyle(() => ({ opacity: pose.value.face ? 1 : 0 }));
  const back = useAnimatedStyle(() => ({ opacity: pose.value.face ? 0 : 1 }));
  return (
    <Animated.View testID={testID} nativeID={`card-leg:${testID}`} pointerEvents="none" style={[styles.box, { width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2 }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, face]}>
        <CardView card={card} scale={scale * FIELD_SCALE} decorative rectKey={`leg:${testID}`} rects={ownRects} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.centred, back]}>
        <CardView card={BACK_CARD} faceDown scale={backScale} rectKey={`leg:${testID}`} rects={ownRects} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The exchange on the table, giver → pile → receiver (tests/e2e/fixtures/exchange-legs, "Through the
 * pile"). Mounted from the phase opening; `go` is the deal having landed. It reports each leg's
 * stage, the choice opening (`onReady`) and the ceremony's end, all off its own frame clock.
 */
export function ExchangeLegs({
  announced,
  stages,
  layout,
  seating,
  handOrigins,
  go,
  viewerSeat,
  scale,
  flash,
  lifted,
  onStage,
  onReady,
  onDismiss,
  holdMsOverride,
}: {
  announced: ExchangeAnnounceData;
  stages: ExchangeStages;
  layout: TableLayout;
  seating: Seating;
  handOrigins: { readonly current: ReadonlyMap<string, CardFrom> };
  go: boolean;
  viewerSeat: number | null;
  scale: number;
  flash: SharedValue<RingFlash>;
  /** The viewer's hand cards a leg has lifted out, from the frame its flier first shows until the leg lands. */
  lifted: SharedValue<string[]>;
  onStage: (key: string, leg: LegName, stage: LegStage) => void;
  onReady: (key: string) => void;
  onDismiss: () => void;
  /** Replaces the ceremony's end, from the choice or from mount for both Jokers: this many ms, or until the overlay is tapped (offline e2e only). */
  holdMsOverride?: ExchangeHold;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const jokers = announced.twoJokers;
  const key = stages.key;
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
    jokers ? [own(announced.loserIdx), -1, -1, -1] : [own(announced.loserIdx), own(announced.winnerIdx), own(announced.winnerIdx), own(announced.loserIdx)]
  );
  const [initial] = useState(() => {
    const legs = readExchangeLegs(announced, layout, seating);
    return [legs.receive, legs.give, ...legs.jokers];
  });
  const pointsValue = useSharedValue<Points>(initial);
  const holdRef = useRef(holdMsOverride);
  const cue = useCallback((at: number) => event([{ kind: "exchange" }], at), []);
  const stage = useCallback(
    (leg: number, s: number) => calls.current.onStage(calls.current.key, leg === 0 ? "receive" : "give", STAGES[s]),
    []
  );
  const [opened, setOpened] = useState(false);
  const ready = useCallback(() => {
    setOpened(true);
    calls.current.onReady(calls.current.key);
  }, []);
  const done = useCallback(() => {
    if (holdRef.current === undefined) calls.current.onDismiss();
  }, []);
  const forcedReady = useCallback(() => {
    gateForced("exchangeReady");
    ready();
  }, [ready]);
  const forcedDone = useCallback(() => {
    gateForced("exchangeDone");
    done();
  }, [done]);
  const mine = (seat: number, card: Card | undefined) => (seat === viewerSeat && card ? [card.id] : []);
  const out = jokers
    ? [announced.loserIdx === viewerSeat ? JOKERS.map((j) => j.id) : [], []]
    : [mine(announced.loserIdx, announced.cardReceived), mine(announced.winnerIdx, announced.cardGiven)];
  const outgoing = useSharedValue(out);
  const drawn = useSharedValue([false, false]);
  const frames = useLegClock(run, goAt, choiceAt, clock, shows, reduced, ends, flash, lifted, outgoing, jokers, { cue, stage, ready, done });

  useEffect(() => {
    outgoing.set(out);
  });
  // In the commit that draws a landed card in the hand, so the flier is gone on the frame it appears there.
  useLayoutEffect(() => {
    const landed = [stages.receive === "landed", stages.give === "landed"];
    if (landed.every((l, i) => l === drawn.get()[i])) return;
    drawn.set(landed);
    const back = outgoing.get().flatMap((ids, i) => (landed[i] ? ids : []));
    lifted.set(lifted.get().filter((id) => !back.includes(id)));
  });
  useEffect(
    () => () => {
      lifted.set([]);
      withdraw("exchange");
    },
    [lifted]
  );

  useEffect(() => {
    reduced.set(reduceMotion);
  }, [reduced, reduceMotion]);
  useEffect(() => {
    if (go && goAt.get() < 0) goAt.set(inBackground() ? Infinity : performance.now());
  }, [go, goAt]);
  const chosen = announced.cardGiven !== undefined;
  useEffect(() => {
    if (chosen && choiceAt.get() < 0) choiceAt.set(inBackground() ? Infinity : performance.now());
  }, [chosen, choiceAt]);
  // Read after commit: the hand publishes where it drew each card then. A leg keeps the points it left with.
  useEffect(() => {
    const next = readExchangeLegs(announced, layout, seating, handOrigins.current);
    const cur = pointsValue.get();
    const fresh = (stage: LegStage) => stage === "waiting";
    pointsValue.set([
      fresh(stages.receive) ? next.receive : cur[0],
      fresh(stages.give) ? next.give : cur[1],
      ...(fresh(stages.receive) ? next.jokers : cur.slice(2)),
    ]);
  });
  useEffect(() => {
    if (!go || !(goAt.get() < Infinity)) return;
    return armGateWatchdog(() => scheduleOnUI(release, run, jokers ? "done" : "ready", jokers ? forcedDone : forcedReady));
  }, [go, goAt, jokers, run, forcedReady, forcedDone]);
  useEffect(() => {
    // From the later of the choice and its opening: a choice made before the choice opens still gives only after it.
    if (jokers || !opened || !chosen || !(choiceAt.get() < Infinity)) return;
    return armGateWatchdog(() => scheduleOnUI(release, run, "done", forcedDone));
  }, [jokers, opened, chosen, choiceAt, run, forcedDone]);
  useEffect(() => {
    if (run.get().done) frames.setActive(false);
  });

  useEffect(() => {
    holdRef.current = holdMsOverride;
    if (typeof holdMsOverride !== "number" || !(chosen || jokers)) return;
    const done = setTimeout(() => calls.current.onDismiss(), holdMsOverride);
    return () => clearTimeout(done);
  }, [holdMsOverride, chosen, jokers]);
  const tapToRelease = holdMsOverride === "untilTapped" && (chosen || jokers);

  const nameOf = (seat: number) => (seat === announced.winnerIdx ? announced.winnerName : announced.loserName);
  const shown = (stage: LegStage) => stage !== "waiting" && stage !== "flying";
  const giveLine = (card: Card, from: number, to: number) =>
    t("exchangeAnnouncement.giveLine", { from: nameOf(from), card: cardSpokenName(card, t), to: nameOf(to) });
  const a11yLabel = jokers
    ? shown(stages.receive) ? t("exchangeAnnouncement.a11yNoExchange", { loserName: announced.loserName }) : ""
    : [
        announced.cardReceived && shown(stages.receive) && giveLine(announced.cardReceived, announced.loserIdx, announced.winnerIdx),
        announced.cardGiven && shown(stages.give) && giveLine(announced.cardGiven, announced.winnerIdx, announced.loserIdx),
      ]
        .filter(Boolean)
        .join(". ");

  const card = (c: Card, leg: number, show: number, testID: string) => (
    <LegCard key={testID} card={c} leg={leg} show={show} points={pointsValue} clock={clock} shows={shows} reduced={reduced} drawn={drawn} scale={scale} testID={testID} />
  );
  return (
    <View
      testID="exchange-announce"
      pointerEvents={tapToRelease ? "auto" : "none"}
      onStartShouldSetResponder={() => tapToRelease}
      onResponderRelease={() => calls.current.onDismiss()}
      style={StyleSheet.absoluteFill}
    >
      <A11yStatus label={a11yLabel} role="alert" live="assertive" />
      <View style={StyleSheet.absoluteFill} {...a11yHidden()}>
        {jokers
          ? JOKERS.map((j, i) => card(j, 2 + i, 0, `exchange-joker-${i}`))
          : [
              announced.cardReceived && card(announced.cardReceived, 0, 0, "exchange-flier-to-winner"),
              announced.cardGiven && card(announced.cardGiven, 1, 1, "exchange-flier-to-loser"),
            ]}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: "absolute", left: "50%", top: "50%" },
  centred: { alignItems: "center", justifyContent: "center" },
});

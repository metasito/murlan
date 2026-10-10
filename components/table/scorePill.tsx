import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import {
  MANCHE_IDLE,
  MANCHE_STEPS,
  mancheGlow,
  mancheOpen,
  mancheRerank,
  mancheRowCount,
  mancheRowPop,
  type EndingSteps,
} from "@/lib/game/mancheEnding";
import { PARTITA_STEPS, partitaActions, partitaBoard, partitaWinnerBox } from "@/lib/game/partitaEnding";
import {
  BOARD_ACTIONS_AT,
  PartitaBoardButtons,
  PartitaWinnerBox,
  partitaWinnerSpoken,
  type PartitaBoardActions,
  type PartitaWinner,
} from "./partitaBoard";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Rect } from "react-native-svg";
import { TableText } from "./TableText";
import {
  Colors,
  FontSize,
  Gradient,
  Layer,
  motionMs,
  TOUCH_TARGET_MIN,
  withAlpha,
} from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { a11yGroup, a11yHidden, a11yState } from "@/lib/a11y";
import { useTraceSource } from "@/lib/e2eTrace";
import type { PillRow, PillStandings } from "@/lib/game/scorePill";
import { tableFontSize } from "@/components/cardFaceModel";
import {
  BOARD_H,
  PILL_HEADER,
  PILL_PLATE_STOPS,
  PILL_ROW,
  PILL_SHADOW,
  scorePillBox,
  scorePillFades,
  scorePillHeader,
  scorePillHitBox,
  scorePillLift,
  scorePillRow,
  type PillAnchor,
} from "./scorePillModel";

// ─── Score pill ───────────────────────────────────────────────────────────────
//
// Your points toward the target and your place, at the top right; a tap springs it open into
// the standings. Drawn 23.7 pt tall, pressed through a box at least TOUCH_TARGET_MIN tall
// around it. The mockup's `#score` is the specification (#1265).

const OPEN_EASING = Easing.out(Easing.back(1.70158));
const CLOSE_EASING = Easing.out(Easing.cubic);
const SHADOW = withAlpha(Colors.shadow, PILL_SHADOW.alpha);
const GLOW = withAlpha(Colors.goldLit, 0.55);
const GLOW_BLUR = 18;
const GAIN_FROM_SCALE = 0.5;
const DISC_GLOW = withAlpha(Colors.goldLit, 0.6);

// The mockup's px, multiplied by `anchor.unit`.
const PX = {
  padH: 10,
  between: 6,
  icon: 11,
  youTracking: 1.6,
  sepH: 11,
  badgeRadius: 4,
  badgePadH: 4,
  badgePadV: 2,
  chevW: 7,
  chevH: 5,
  progInset: 11,
  progBottom: 2.5,
  progH: 1.5,
  headTracking: 2,
  subTracking: 1.5,
  headRule: 7,
  rowRadius: 6,
  rowPadL: 6,
  rowPadR: 7,
  place: 10,
  disc: 16,
  discGlow: 8,
  bar: 54,
  barH: 4,
  tickH: 8,
  cell: 20,
  meBar: 2,
};

export function ScorePill({
  standings,
  target,
  open,
  onPress,
  anchor,
  ending,
  partita = null,
}: {
  standings: PillStandings;
  target: number;
  open: boolean;
  /** Toggles `open`. A tap elsewhere on the table closing it is the table's job. */
  onPress: () => void;
  anchor: PillAnchor;
  /** The ending's clock (`lib/game/mancheEnding.ts`), which opens, counts in, re-ranks and closes the pill. */
  ending?: SharedValue<number>;
  /** The partita is over: `ending` runs `lib/game/partitaEnding.ts`, and the pill becomes the board. */
  partita?: { winner: PartitaWinner; winnerKeys: readonly string[]; actions: PartitaBoardActions } | null;
}) {
  const { t, tn } = useTranslation();
  const reduce = usePrefersReducedMotion();
  const progress = useSharedValue(0);
  const idle = useSharedValue(MANCHE_IDLE);
  const clock = ending ?? idle;
  const steps = partita ? PARTITA_STEPS : MANCHE_STEPS;
  const boarding = partita !== null;
  const boardProgress = useDerivedValue(() => (boarding ? partitaBoard(clock.value) : 0));
  const shownOpen = useDerivedValue(() => Math.max(progress.value, mancheOpen(clock.value, steps)));
  const [boardFilled, setBoardFilled] = useState(false);
  const [actionsLive, setActionsLive] = useState(false);
  useAnimatedReaction(
    () => [boardProgress.value > 0, boarding && partitaActions(clock.value) >= 1] as const,
    ([filled, live], prev) => {
      if (filled !== prev?.[0]) scheduleOnRN(setBoardFilled, filled);
      if (live !== prev?.[1]) scheduleOnRN(setActionsLive, live);
    }
  );
  const u = anchor.unit;
  const mineRow = standings.rows.find((r) => r.mine);
  const glows = (mineRow?.gain ?? 0) > 0;

  const counts = standings.rows.map(({ before, total, order, beforePlace, place }) => ({ before, total, order, beforePlace, place }));
  const [countedKey, setCountedKey] = useState("");
  useAnimatedReaction(
    () => {
      const e = clock.value;
      const reranked = mancheRerank(e, steps) >= 0.5;
      return counts
        .map((r) => `${Math.round(r.before + (r.total - r.before) * mancheRowCount(e, r.order, steps))}:${reranked ? r.place : r.beforePlace}`)
        .join(",");
    },
    (key, prev) => {
      if (key !== prev) scheduleOnRN(setCountedKey, key);
    }
  );
  const counted = countedKey.split(",").map((cell) => cell.split(":").map(Number));
  const shownOf = (i: number) => {
    const row = standings.rows[i];
    const [total, place] = counted.length === standings.rows.length ? counted[i] : [row.total, row.place];
    return { total, place };
  };
  const mineShown = mineRow ? shownOf(standings.rows.indexOf(mineRow)) : null;

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, {
      duration: motionMs("shift", reduce),
      easing: open ? OPEN_EASING : CLOSE_EASING,
      reduceMotion: ReduceMotion.Never,
    });
  }, [open, reduce, progress]);

  const traceRead = useCallback(() => {
    const box = scorePillBox(shownOpen.value, boardProgress.value, anchor);
    return { x: box.x, y: box.y, w: box.w, h: box.h, open: shownOpen.value };
  }, [shownOpen, boardProgress, anchor]);
  useTraceSource("scorePill", traceRead);

  const hitStyle = useAnimatedStyle(() => {
    const hit = scorePillHitBox(shownOpen.value, boardProgress.value, anchor, TOUCH_TARGET_MIN);
    return { left: hit.x, top: hit.y, width: hit.w, height: hit.h };
  });
  const pillStyle = useAnimatedStyle(() => {
    const box = scorePillBox(shownOpen.value, boardProgress.value, anchor);
    const hit = scorePillHitBox(shownOpen.value, boardProgress.value, anchor, TOUCH_TARGET_MIN);
    return { top: box.y - hit.y, width: box.w, height: box.h, borderRadius: box.radius };
  });
  const liftStyle = useAnimatedStyle(() => ({ opacity: scorePillLift(shownOpen.value, boardProgress.value) }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: mancheGlow(clock.value, glows, steps) }));
  const winnerBoxStyle = useAnimatedStyle(() => ({ opacity: partitaWinnerBox(clock.value) }));
  const actionsStyle = useAnimatedStyle(() => {
    const box = scorePillBox(shownOpen.value, boardProgress.value, anchor);
    const hit = scorePillHitBox(shownOpen.value, boardProgress.value, anchor, TOUCH_TARGET_MIN);
    return {
      left: box.x - hit.x + BOARD_ACTIONS_AT.x * u,
      top: box.y - hit.y + BOARD_ACTIONS_AT.y * u,
      opacity: partitaActions(clock.value),
    };
  });
  const shadowOf = ({ offsetY, blur }: { offsetY: number; blur: number }) => ({
    boxShadow: `0px ${offsetY * u}px ${blur * u}px ${PILL_SHADOW.spread * u}px ${SHADOW}`,
  });
  const chipStyle = useAnimatedStyle(() => ({ opacity: scorePillFades(shownOpen.value, boardProgress.value).chip }));
  // Transparent is not enough: the rows would still be laid out past the pill, off the screen's right edge.
  const panelStyle = useAnimatedStyle(() => {
    const panel = scorePillFades(shownOpen.value, boardProgress.value).panel;
    return { opacity: panel, display: panel > 0 ? "flex" : "none" };
  });
  const headerStyle = useAnimatedStyle(() => {
    const at = scorePillHeader(boardProgress.value, u);
    return { transform: [{ translateX: at.x }, { translateY: at.y }] };
  });

  const nameOf = (row: PillRow) =>
    standings.teams ? t("lobby.team", { team: row.name }) : row.mine ? t("scorePill.you") : row.name;
  const mine = standings.mine;
  const label = mine
    ? tn("scorePill.a11yLabel", mine.total, { target, place: mine.place })
    : t("scorePill.standings");
  const spokenStandings = [
    ...(partita && boardFilled ? [partitaWinnerSpoken(partita.winner, t)] : []),
    t("scorePill.standings"),
    ...standings.rows.map((row) => tn("scorePill.a11yRow", row.total, { place: row.place, name: nameOf(row) })),
  ].join(" ");

  const small = tableFontSize(FontSize.xxs, u);
  const progress01 = (total: number) => `${(Math.min(total, target) / target) * 100}%` as const;

  return (
    <Animated.View style={[styles.hit, hitStyle]}>
      {!boarding && (
        <Pressable
          testID="score-pill"
          onPress={onPress}
          accessibilityLabel={label}
          {...a11yState({ role: "button", expanded: open })}
          style={StyleSheet.absoluteFill}
        />
      )}
      <Animated.View pointerEvents="none" style={[styles.shadow, shadowOf(PILL_SHADOW.rest), pillStyle]} />
      <Animated.View pointerEvents="none" style={[styles.shadow, shadowOf(PILL_SHADOW.lifted), pillStyle, liftStyle]} />
      <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]}>
        <LinearGradient
          colors={[Colors.scorePillTop, Colors.scorePillFoot, Colors.scorePillFoot]}
          locations={PILL_PLATE_STOPS}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          {...a11yHidden()}
          style={[styles.chip, { height: anchor.restH - 2, paddingHorizontal: PX.padH * u, gap: PX.between * u }, chipStyle]}
        >
          <Svg width={PX.icon * u} height={PX.icon * u} viewBox="0 0 11 11" fill={Colors.gold}>
            <Rect x={0} y={5} width={3} height={6} rx={0.6} />
            <Rect x={4} y={1.5} width={3} height={9.5} rx={0.6} />
            <Rect x={8} y={3.5} width={3} height={7.5} rx={0.6} opacity={0.7} />
          </Svg>
          {mineShown ? (
            <>
              <TableText style={[styles.you, { fontSize: small, letterSpacing: PX.youTracking * u }]}>
                {t("scorePill.you")}
              </TableText>
              <TableText testID="score-pill-total" style={[styles.total, { fontSize: tableFontSize(FontSize.sm, u) }]}>
                {mineShown.total}
                <TableText style={[styles.of, { fontSize: small }]}>/{target}</TableText>
              </TableText>
              <View style={[styles.sep, { height: PX.sepH * u }]} />
              <View style={[styles.badge, { borderRadius: PX.badgeRadius * u }]}>
                <LinearGradient
                  colors={Gradient.playButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <TableText
                  style={[
                    styles.badgeText,
                    { fontSize: small, paddingHorizontal: PX.badgePadH * u, paddingVertical: PX.badgePadV * u },
                  ]}
                >
                  {t("scorePill.place", { place: mineShown.place })}
                </TableText>
              </View>
            </>
          ) : (
            <TableText style={[styles.you, { fontSize: small, letterSpacing: PX.youTracking * u }]}>
              {t("scorePill.standings")}
            </TableText>
          )}
          <Chevron up={false} unit={u} />
        </Animated.View>
        {mineShown && (
          <Animated.View
            style={[
              styles.track,
              { left: PX.progInset * u, right: PX.progInset * u, bottom: PX.progBottom * u, height: PX.progH * u },
              chipStyle,
            ]}
          >
            <LinearGradient
              colors={[Colors.goldDark, Colors.goldLit]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.trackFill, { width: progress01(mineShown.total) }]}
            />
          </Animated.View>
        )}
        <Animated.View
          testID="score-pill-panel"
          {...(open || boarding ? a11yGroup(spokenStandings) : a11yHidden())}
          style={[StyleSheet.absoluteFill, panelStyle]}
        >
          {partita && boardFilled && (
            <Animated.View style={[StyleSheet.absoluteFill, winnerBoxStyle]}>
              <PartitaWinnerBox winner={partita.winner} unit={u} height={BOARD_H * u} />
            </Animated.View>
          )}
          <Animated.View {...a11yHidden()} style={[styles.header, { width: PILL_HEADER.w * u }, headerStyle]}>
            <TableText style={[styles.head, { fontSize: small, letterSpacing: PX.headTracking * u }]}>
              {t("scorePill.standings")}
            </TableText>
            <View style={[styles.headSub, { gap: PX.between * u }]}>
              <TableText style={[styles.sub, { fontSize: small, letterSpacing: PX.subTracking * u }]}>
                {t("scorePill.race", { target })}
              </TableText>
              <Chevron up unit={u} />
            </View>
            <LinearGradient
              colors={[Colors.goldBorder, Colors.goldGhost]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.headRule, { bottom: -PX.headRule * u }]}
            />
          </Animated.View>
          {standings.rows.map((row, pos) => (
            <StandingRowView
              key={row.key}
              row={row}
              shown={shownOf(pos)}
              name={nameOf(row)}
              initial={row.mine && !standings.teams ? t("scorePill.you") : row.initial}
              pos={pos}
              board={boardProgress}
              ending={clock}
              steps={steps}
              won={boardFilled && (partita?.winnerKeys.includes(row.key) ?? false)}
              unit={u}
              target={target}
            />
          ))}
        </Animated.View>
      </Animated.View>
      {partita && boardFilled && (
        <Animated.View style={[styles.actions, actionsStyle]} pointerEvents="box-none">
          <PartitaBoardButtons actions={partita.actions} unit={u} live={actionsLive} />
        </Animated.View>
      )}
      <Animated.View testID="score-pill-glow" pointerEvents="none" style={[styles.shadow, styles.glow, { boxShadow: `0px 0px ${GLOW_BLUR * u}px ${GLOW}` }, pillStyle, glowStyle]} />
    </Animated.View>
  );
}

function StandingRowView({
  row,
  name,
  initial,
  pos,
  board,
  ending,
  steps,
  won,
  unit: u,
  target,
  shown: { total, place },
}: {
  row: PillRow;
  name: string;
  initial: string;
  pos: number;
  board: SharedValue<number>;
  ending: SharedValue<number>;
  steps: EndingSteps;
  won: boolean;
  unit: number;
  target: number;
  shown: { total: number; place: number };
}) {
  const w = PILL_ROW.w * u;
  const h = PILL_ROW.h * u;
  const { before, total: after, order, beforePos } = row;
  const placed = useAnimatedStyle(() => {
    const at = scorePillRow(beforePos + (pos - beforePos) * mancheRerank(ending.value, steps), board.value, u);
    return {
      transform: [
        { translateX: at.x + (w * (at.scale - 1)) / 2 },
        { translateY: at.y + (h * (at.scale - 1)) / 2 },
        { scale: at.scale },
      ],
    };
  });
  const popStyle = useAnimatedStyle(() => {
    const pop = mancheRowPop(ending.value, order, steps);
    return { opacity: Math.min(1, pop), transform: [{ scale: GAIN_FROM_SCALE + (1 - GAIN_FROM_SCALE) * pop }] };
  });
  const fillStyle = useAnimatedStyle(() => {
    const counted = before + (after - before) * mancheRowCount(ending.value, order, steps);
    return { width: `${(Math.min(counted, target) / target) * 100}%` };
  });
  const text = tableFontSize(FontSize.xs, u);
  return (
    <Animated.View
      {...a11yHidden()}
      style={[
        styles.row,
        { width: w, height: h, borderRadius: PX.rowRadius * u, paddingLeft: PX.rowPadL * u, paddingRight: PX.rowPadR * u, gap: PX.between * u },
        row.mine && styles.rowMine,
        placed,
      ]}
    >
      {row.mine && <View style={[styles.rowMineBar, { width: PX.meBar * u }]} />}
      <TableText testID={won ? "score-pill-winner-row" : undefined} style={[styles.place, won && styles.placeWon, { width: PX.place * u, fontSize: text }]}>
        {place}
      </TableText>
      <LinearGradient
        colors={[Colors.seatDisc, Colors.seatDiscDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.disc,
          { width: PX.disc * u, height: PX.disc * u, borderRadius: (PX.disc * u) / 2 },
          won && [styles.discWon, { boxShadow: `0px 0px ${PX.discGlow * u}px ${DISC_GLOW}` }],
        ]}
      >
        <TableText numberOfLines={1} style={[styles.discText, { fontSize: tableFontSize(FontSize.xxs, u) }]}>
          {initial}
        </TableText>
      </LinearGradient>
      <TableText numberOfLines={1} style={[styles.name, row.mine && styles.nameMine, { fontSize: text }]}>
        {name}
      </TableText>
      <View style={[styles.bar, { width: PX.bar * u, height: PX.barH * u, borderRadius: (PX.barH * u) / 2 }]}>
        <Animated.View style={[styles.barFill, { borderRadius: (PX.barH * u) / 2 }, fillStyle]}>
          <LinearGradient
            colors={[Colors.goldDark, Colors.gold]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <View style={[styles.tick, { height: PX.tickH * u, top: ((PX.barH - PX.tickH) / 2) * u }]} />
      </View>
      <Animated.View style={popStyle}>
        <TableText
          style={[styles.gain, row.gain === 0 && styles.gainNone, { width: PX.cell * u, fontSize: tableFontSize(FontSize.xxs, u) }]}
        >
          +{row.gain}
        </TableText>
      </Animated.View>
      <TableText style={[styles.rowTotal, { width: PX.cell * u, fontSize: tableFontSize(FontSize.sm, u) }]}>
        {total}
      </TableText>
    </Animated.View>
  );
}

function Chevron({ up, unit }: { up: boolean; unit: number }) {
  return (
    <Svg width={PX.chevW * unit} height={PX.chevH * unit} viewBox="0 0 7 5">
      <Path
        d={up ? "M.8 4l2.7-2.6L6.2 4" : "M.8 1l2.7 2.6L6.2 1"}
        fill="none"
        stroke={Colors.textMuted}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  hit: { position: "absolute", zIndex: Layer.moment },
  shadow: { position: "absolute", right: 0 },
  pill: {
    position: "absolute",
    right: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.goldStrong,
  },
  chip: { position: "absolute", left: 0, top: 0, right: 0, flexDirection: "row", alignItems: "center" },
  you: { fontFamily: "Rajdhani_600SemiBold", color: Colors.textMuted },
  total: { fontFamily: "Rajdhani_700Bold", color: Colors.goldLit, fontVariant: ["tabular-nums"] },
  of: { fontFamily: "Rajdhani_600SemiBold", color: Colors.textMuted },
  sep: { width: StyleSheet.hairlineWidth, backgroundColor: Colors.goldBorder },
  badge: { overflow: "hidden" },
  badgeText: { fontFamily: "Rajdhani_700Bold", color: Colors.badgeInk },
  track: { position: "absolute", backgroundColor: Colors.track, overflow: "hidden" },
  trackFill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  header: { position: "absolute", left: 0, top: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  head: { fontFamily: "Rajdhani_700Bold", color: Colors.gold, textTransform: "uppercase" },
  headSub: { flexDirection: "row", alignItems: "center" },
  sub: { fontFamily: "Rajdhani_600SemiBold", color: Colors.textMuted, textTransform: "uppercase" },
  headRule: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  row: { position: "absolute", left: 0, top: 0, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  rowMine: { backgroundColor: Colors.goldMuted },
  rowMineBar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: Colors.gold },
  place: { fontFamily: "Rajdhani_700Bold", color: Colors.textSecondary, textAlign: "center" },
  placeWon: { color: Colors.goldLit },
  disc: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.goldBorder },
  discWon: { borderColor: Colors.goldLit },
  actions: { position: "absolute" },
  discText: { fontFamily: "Rajdhani_700Bold", color: Colors.text },
  name: { flex: 1, fontFamily: "Rajdhani_600SemiBold", color: Colors.textSecondary, textTransform: "uppercase" },
  nameMine: { color: Colors.goldLit },
  bar: { backgroundColor: Colors.track },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, overflow: "hidden" },
  glow: { borderWidth: 1, borderColor: Colors.goldLit },
  tick: { position: "absolute", right: -1, width: 1, backgroundColor: Colors.goldStrong },
  gain: { fontFamily: "Rajdhani_700Bold", color: Colors.goldLit, textAlign: "right" },
  gainNone: { color: Colors.textSecondary },
  rowTotal: { fontFamily: "Rajdhani_700Bold", color: Colors.text, textAlign: "right", fontVariant: ["tabular-nums"] },
});

// What a manche ends with: who won it, where the match stands, the standings,
// and the way onward. Offline reaches it as a screen (app/result.tsx), online
// as an overlay over the table (components/GameOverOverlay.tsx).
//
// Every glyph is a literal here rather than a prop the callers pass: the icon
// subset resolver follows a prop back to its call sites, and a name it cannot
// resolve ships as a blank box with no error (tests/iconSubset.test.ts).
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { useIsLandscape, useOrientedWindow } from "@/lib/orientation";
import { ControlRail, RailKnob } from "@/components/table/chrome";
import { cardScale, railWidth } from "@/components/gameTableModel";
import { physicalTouchTarget } from "@/components/cardFaceModel";
import { useRailSide } from "@/components/useRailSide";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { hapticSuccess } from "@/lib/haptics";
import {
  Colors,
  FontSize,
  Motion,
  motionMs,
  Opacity,
  Radius,
  Spacing,
  TOUCH_TARGET_MIN,
  Type,
} from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden, a11yState } from "@/lib/a11y";
import { placementColor, positionLabelKey } from "@/lib/placement";

const POSITION_ICONS = ["trophy", "medal", "ribbon", "remove-circle"] as const;

// Home states a width so the primary beside it gets a known remainder, and the
// pair keeps its proportions rather than shifting with the locale's word for
// "Home". 120 leaves the longest of the three primaries a line to itself at
// 375pt, the narrowest supported width.
const HOME_BTN_W = 120;
const ACTION_ICON = 18;
const STAT_ICON = 14;
const MEDAL_ICON = 16;
const RANK_STAGGER_MS = 70;
const TROPHY_D = 72;
const TROPHY_D_COMPACT = 56;
const TROPHY_ICON = 36;
const TROPHY_ICON_COMPACT = 28;
const RANK_LEAD_IN_MS = 150;

export interface ResultRow {
  /** Engine player id — the identity the rankings and the winners are in. */
  id: string;
  name: string;
  team?: "A" | "B";
  total: number;
  points: number;
}

/** What the primary action is offering, which is also what it looks like. */
export type ContinueKind = "nextHand" | "newMatch" | "waiting";

export interface ContinueAction {
  kind: ContinueKind;
  label: string;
  a11yLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

function RankCard({
  rank,
  row,
  showTeam,
}: {
  rank: number;
  row: ResultRow;
  showTeam: boolean;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const delay = rank * RANK_STAGGER_MS + RANK_LEAD_IN_MS;
  const opacity = useSharedValue(0);
  const tx = useSharedValue(30);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: motionMs("travel", reduceMotion) })
    );
    tx.value = reduceMotion ? 0 : withDelay(delay, withSpring(0, Motion.spring.entrance));
  }, [delay, opacity, reduceMotion, tx]);
  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }],
  }));
  const isWinner = rank === 0;
  const color = placementColor(rank + 1);
  const icon = POSITION_ICONS[rank] ?? "person";
  const labelKey = positionLabelKey(rank + 1);
  const label = labelKey ? t(labelKey) : `${rank + 1}°`;

  return (
    <Animated.View style={[styles.rankCard, isWinner && styles.rankCardWinner, anim]}>
      {isWinner && (
        <LinearGradient
          colors={[Colors.goldMuted, "transparent"]}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[styles.posBadge, { borderColor: color }]}>
        <Text style={[styles.posLabel, { color }]}>{label}</Text>
      </View>
      <Ionicons
        name={icon as React.ComponentProps<typeof Ionicons>["name"]}
        size={MEDAL_ICON}
        color={color}
      />
      <View style={styles.rankName}>
        <Text style={styles.playerName} numberOfLines={1}>
          {row.name}
        </Text>
        {showTeam && row.team && (
          <Text
            style={[
              styles.teamLabel,
              { color: row.team === "A" ? Colors.accent : Colors.gold },
            ]}
          >
            {t("lobby.team", { team: row.team })}
          </Text>
        )}
      </View>
      <View style={styles.scoreBlock}>
        <Text
          testID="rank-total"
          style={[styles.totalScore, isWinner && styles.totalScoreWinner]}
        >
          {row.total}
        </Text>
        <Text style={styles.scoreSub}>{t("result.pointsDelta", { n: row.points })}</Text>
      </View>
    </Animated.View>
  );
}

function WinnerCelebration({
  name,
  subtitle,
  compact,
  viewerCelebrated,
}: {
  name: string;
  subtitle: string;
  compact: boolean;
  viewerCelebrated: boolean;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const glow = useSharedValue(0.5);
  const glowScale = useSharedValue(1.0);
  // The verdict lands once, even though `viewerCelebrated` itself can flip
  // false-to-true after mount — the team's win arriving after this seat's own
  // placement did. Kept off the motion effect below, which re-runs whenever
  // `usePrefersReducedMotion` settles asynchronously after first paint.
  const celebrated = useRef(false);
  useEffect(() => {
    if (viewerCelebrated && !celebrated.current) {
      celebrated.current = true;
      hapticSuccess();
    }
  }, [viewerCelebrated]);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: motionMs("reveal", reduceMotion) });
    if (reduceMotion) {
      // The swell and the endless glow behind it are the parts with nothing to
      // say; the result itself still arrives.
      scale.value = 1;
      return;
    }
    scale.value = withSpring(1, Motion.spring.reveal);
    const breath = (to: number) =>
      withTiming(to, {
        duration: Motion.duration.dwell,
        easing: Easing.inOut(Easing.sin),
      });
    glow.value = withRepeat(withSequence(breath(1), breath(0.5)), -1, false);
    glowScale.value = withRepeat(withSequence(breath(1.15), breath(1.0)), -1, false);
  }, [glow, glowScale, opacity, reduceMotion, scale]);
  const containerAnim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  const glowAnim = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: glowScale.value }],
  }));
  const trophySize = compact ? TROPHY_D_COMPACT : TROPHY_D;
  const iconSize = compact ? TROPHY_ICON_COMPACT : TROPHY_ICON;

  return (
    <Animated.View
      style={[styles.celebration, compact && styles.celebrationCompact, containerAnim]}
    >
      <Animated.View
        style={[styles.celebGlow, compact && styles.celebGlowCompact, glowAnim]}
      />
      <View
        style={[
          styles.trophyCircle,
          { width: trophySize, height: trophySize, borderRadius: trophySize / 2 },
        ]}
      >
        <LinearGradient colors={[Colors.gold, Colors.goldDark]} style={styles.trophyGrad}>
          <Ionicons name="trophy" size={iconSize} color={Colors.bgCard} />
        </LinearGradient>
      </View>
      <Text
        testID="winner-celebration-name"
        style={[styles.winnerName, compact && styles.winnerNameCompact]}
        numberOfLines={1}
      >
        {name}
      </Text>
      <Text style={styles.winnerSub}>{subtitle}</Text>
    </Animated.View>
  );
}

export function ResultBoard({
  headerTitle,
  formatLine,
  celebratedName,
  celebrationSubtitle,
  viewerCelebrated,
  rows,
  handCount,
  target,
  teams,
  verdictLine,
  home,
  primary,
  footer,
  topPad,
  bottomPad,
  leftPad = 0,
  rightPad = 0,
}: {
  headerTitle: string;
  /** How long the match is, or how far along it is. */
  formatLine: string;
  celebratedName: string;
  celebrationSubtitle: string;
  /** Whether the viewing seat is among those `celebratedName` names. */
  viewerCelebrated: boolean;
  /** Already in finishing order. */
  rows: ResultRow[];
  handCount: number;
  /** Absent for a single hand, which has no target to reach. */
  target?: number;
  teams: boolean;
  /** What the table decided about another match, once it has decided. */
  verdictLine?: string;
  home: { label: string; a11yLabel?: string; onPress: () => void; testID?: string };
  /** Absent where the table has closed the match and nobody may reopen it. */
  primary?: ContinueAction;
  /** Sits under the standings, inside their scroll. */
  footer?: React.ReactNode;
  topPad: number;
  bottomPad: number;
  leftPad?: number;
  rightPad?: number;
}) {
  const { t } = useTranslation();
  const isLandscape = useIsLandscape();
  const { width, height } = useOrientedWindow();
  const scale = cardScale(Math.min(width, height));
  const railSide = useRailSide(Math.max(leftPad, rightPad));
  // The same column, the same width, on the same edge as the table's own rail
  // (#191): a screen that reads the inset as padding shifts its content and
  // still loses whatever the cutout is wide enough to cover.
  const rail = railWidth(railSide === "left" ? leftPad : rightPad, scale);
  const bodyLeft = railSide === "left" ? rail : leftPad;
  const bodyRight = railSide === "right" ? rail : rightPad;
  const knobSize = physicalTouchTarget(scale);

  const header = (
    <View style={styles.headerMulti}>
      <Text style={styles.headerTitle}>{headerTitle}</Text>
      <Text style={styles.headerFormat}>{formatLine}</Text>
    </View>
  );

  // A row apiece rather than a strip of tiles: the strip only fitted because
  // the column it sits in is narrow, and the same anatomy has to read the same
  // in portrait, where there is width to spare. The player count is not among
  // them — the standings already show one row per player.
  const statRow = (glyph: React.ReactNode, value: string | number, label: string) => (
    <View style={styles.statItem}>
      {glyph}
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );

  const stats = (
    <View style={styles.statList}>
      {statRow(
        <Ionicons name="layers" size={STAT_ICON} color={Colors.gold} {...a11yHidden()} />,
        handCount,
        t("result.statHands")
      )}
      {target !== undefined &&
        statRow(
          <Ionicons name="flag" size={STAT_ICON} color={Colors.gold} {...a11yHidden()} />,
          target,
          t("result.statTarget")
        )}
      {statRow(
        teams ? (
          <Ionicons
            name="people-circle"
            size={STAT_ICON}
            color={Colors.gold}
            {...a11yHidden()}
          />
        ) : (
          <Ionicons
            name="person-circle"
            size={STAT_ICON}
            color={Colors.gold}
            {...a11yHidden()}
          />
        ),
        teams ? t("result.modeTeams") : t("result.modeFreeForAll"),
        t("result.statMode")
      )}
    </View>
  );

  const rankRows = rows.map((row, idx) => (
    <RankCard key={row.id} rank={idx} row={row} showTeam={teams} />
  ));

  const primaryGlyph = (kind: ContinueKind, color: string) => {
    if (kind === "waiting")
      return (
        <Ionicons name="checkmark-circle" size={ACTION_ICON} color={color} {...a11yHidden()} />
      );
    if (kind === "newMatch")
      return <Ionicons name="refresh" size={ACTION_ICON} color={color} {...a11yHidden()} />;
    return (
      <Ionicons name="play-forward" size={ACTION_ICON} color={color} {...a11yHidden()} />
    );
  };

  // One block in both orientations: a quiet exit of a stated width beside a
  // primary that takes the rest. Both stretch to the taller of the two, so the
  // pair cannot come out ragged whatever the locale does to the label.
  // Landscape is the orientation with a cutout beside it, and the rail is
  // where that column's control lives: the same knob, at the same head of the
  // same edge, the table's own menu sat at a moment ago.
  const homeKnob = (
    <RailKnob
      testID={home.testID}
      onPress={home.onPress}
      a11yLabel={home.a11yLabel ?? home.label}
      size={knobSize}
    >
      <Ionicons name="home" size={ACTION_ICON} color={Colors.textSecondary} />
    </RailKnob>
  );

  const actions = (
    <View style={styles.actions}>
      {!isLandscape && (
        <Pressable
          testID={home.testID}
          onPress={home.onPress}
          style={styles.homeBtn}
          accessibilityRole="button"
          accessibilityLabel={home.a11yLabel ?? home.label}
        >
          <Ionicons
            name="home"
            size={ACTION_ICON}
            color={Colors.textSecondary}
            {...a11yHidden()}
          />
          <Text style={styles.homeBtnText} numberOfLines={1} {...a11yHidden()}>
            {home.label}
          </Text>
        </Pressable>
      )}
      {primary && (
        <Pressable
          testID={primary.testID}
          onPress={primary.onPress}
          disabled={primary.disabled}
          style={[styles.rematchBtn, primary.disabled === true && styles.rematchBtnDim]}
          accessibilityLabel={primary.a11yLabel ?? primary.label}
          {...a11yState({ role: "button", disabled: primary.disabled === true })}
        >
          <LinearGradient
            colors={
              primary.kind === "waiting"
                ? [Colors.bgSurface, Colors.bgSurface]
                : [Colors.gold, Colors.goldDark]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.rematchGrad}
          >
            {primaryGlyph(
              primary.kind,
              primary.kind === "waiting" ? Colors.accent : Colors.bgCard
            )}
            <Text
              style={[
                styles.rematchText,
                primary.kind === "waiting" && styles.rematchTextWaiting,
              ]}
              numberOfLines={1}
              {...a11yHidden()}
            >
              {primary.label}
            </Text>
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );

  const closing = (
    <>
      {verdictLine !== undefined && <Text style={styles.verdictLine}>{verdictLine}</Text>}
      {actions}
    </>
  );

  if (isLandscape) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[Colors.bg, Colors.bgCard, Colors.bg]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />

        <ControlRail
          width={rail}
          side={railSide}
          topPad={topPad}
          bottomPad={bottomPad}
          top={homeKnob}
        />

        <View
          testID="result-body"
          style={[
            styles.landscapeInner,
            {
              paddingTop: topPad,
              paddingBottom: bottomPad,
              marginLeft: bodyLeft,
              marginRight: bodyRight,
            },
          ]}
        >
          <View style={[styles.header, styles.headerLandscape]}>{header}</View>

          <View style={styles.landscapeBody}>
            <View style={styles.landscapeLeft}>
              <WinnerCelebration
                name={celebratedName}
                subtitle={celebrationSubtitle}
                compact
                viewerCelebrated={viewerCelebrated}
              />
              {stats}
            </View>

            {/* The actions close this column rather than the other one: the
                standings are what the eye reads, so this is where it finishes. */}
            <View style={styles.landscapeRight}>
              <Text style={styles.sectionTitle}>{t("result.rankingsTitle")}</Text>
              <ScrollView
                testID="result-rankings"
                showsVerticalScrollIndicator={false}
                style={styles.landscapeRankScroll}
                contentContainerStyle={styles.landscapeRankList}
              >
                {rankRows}
                {footer}
              </ScrollView>
              {closing}
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard, Colors.bg]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.header}>{header}</View>

      <ScrollView
        contentContainerStyle={[
          styles.portraitScroll,
          { paddingBottom: bottomPad + Spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <WinnerCelebration
          name={celebratedName}
          subtitle={celebrationSubtitle}
          compact={false}
          viewerCelebrated={viewerCelebrated}
        />
        {stats}
        <View style={styles.rankSection}>
          <Text style={styles.sectionTitle}>{t("result.rankingsTitle")}</Text>
          <View testID="result-rankings" style={styles.rankList}>
            {rankRows}
          </View>
          {footer}
        </View>
        {closing}
      </ScrollView>
    </View>
  );
}

const CELEB_GLOW_D = 120;
const CELEB_GLOW_D_COMPACT = 80;
const CELEB_GLOW_TOP = -10;
const CELEB_GLOW_TOP_COMPACT = -5;
const CELEB_GLOW_OPACITY = 0.07;
const TROPHY_RING = 2;
const BADGE_D = 26;
const BADGE_RING = 1.5;
const WINNER_NAME_MAX_W = 200;
const WINNER_NAME_MAX_W_COMPACT = 180;
const LEFT_COL_W = 170;
const LEFT_COL_MIN_W = 130;
const LEFT_COL_MAX_W = 200;
const TOTAL_LINE_H = 22;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLandscape: { paddingHorizontal: Spacing.cosy },
  headerMulti: { alignItems: "center", gap: Spacing.xs },
  headerTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.lg,
    color: Colors.text,
    letterSpacing: 2,
  },
  headerFormat: { ...Type.caption, color: Colors.gold, letterSpacing: 1 },

  portraitScroll: { padding: Spacing.wide, gap: Spacing.md },

  landscapeInner: { flex: 1 },
  landscapeBody: {
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: Spacing.slim,
    paddingTop: Spacing.slim,
    paddingBottom: Spacing.sm,
    gap: Spacing.snug,
  },
  landscapeLeft: {
    width: LEFT_COL_W,
    minWidth: LEFT_COL_MIN_W,
    maxWidth: LEFT_COL_MAX_W,
    paddingVertical: Spacing.xs,
    gap: Spacing.snug,
  },
  landscapeRight: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.xs,
    gap: Spacing.slim,
  },
  landscapeRankScroll: { flex: 1 },
  landscapeRankList: { gap: Spacing.xs },
  rankSection: { gap: Spacing.sm },

  celebration: {
    alignItems: "center",
    gap: Spacing.sm,
    position: "relative",
    paddingTop: Spacing.snug,
    paddingBottom: Spacing.slim,
  },
  celebrationCompact: {
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xxs,
    gap: Spacing.xs,
  },
  celebGlow: {
    position: "absolute",
    width: CELEB_GLOW_D,
    height: CELEB_GLOW_D,
    borderRadius: Radius.full,
    backgroundColor: Colors.gold,
    top: CELEB_GLOW_TOP,
    opacity: CELEB_GLOW_OPACITY,
  },
  celebGlowCompact: {
    width: CELEB_GLOW_D_COMPACT,
    height: CELEB_GLOW_D_COMPACT,
    borderRadius: Radius.full,
    top: CELEB_GLOW_TOP_COMPACT,
  },
  trophyCircle: { overflow: "hidden", borderWidth: TROPHY_RING, borderColor: Colors.gold },
  trophyGrad: { flex: 1, alignItems: "center", justifyContent: "center" },
  winnerName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xl,
    color: Colors.text,
    letterSpacing: 2,
    maxWidth: WINNER_NAME_MAX_W,
    textAlign: "center",
  },
  winnerNameCompact: { fontSize: FontSize.lg, maxWidth: WINNER_NAME_MAX_W_COMPACT },
  winnerSub: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xxs,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
  },

  statList: { gap: Spacing.slim },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.slim,
    paddingHorizontal: Spacing.snug,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm, color: Colors.text },
  statLabel: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },

  // `stretch`, not the default: it is what makes the two the same height when
  // one of them is taller, which is the pairing this screen was missing.
  actions: { flexDirection: "row", alignItems: "stretch", gap: Spacing.sm },
  homeBtn: {
    width: HOME_BTN_W,
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.slim,
    paddingVertical: Spacing.wide,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  homeBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  rematchBtn: {
    flex: 1,
    minHeight: TOUCH_TARGET_MIN,
    borderRadius: Radius.md,
    overflow: "hidden",
  },
  rematchBtnDim: { opacity: Opacity.disabled },
  rematchGrad: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.wide,
    paddingHorizontal: Spacing.sm,
  },
  rematchText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.bgCard,
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  rematchTextWaiting: { color: Colors.textMuted },
  verdictLine: { ...Type.caption, textAlign: "center" },

  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  rankList: { gap: Spacing.xs },
  rankCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.slim,
    paddingHorizontal: Spacing.snug,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  rankCardWinner: { borderColor: Colors.gold },
  posBadge: {
    width: BADGE_D,
    height: BADGE_D,
    borderRadius: Radius.full,
    borderWidth: BADGE_RING,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  posLabel: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.xs },
  rankName: { flex: 1, minWidth: 0 },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  teamLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xxs,
    marginTop: Spacing.xxs,
  },
  scoreBlock: { alignItems: "flex-end", gap: 0, flexShrink: 0 },
  totalScore: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
    lineHeight: TOTAL_LINE_H,
  },
  totalScoreWinner: { color: Colors.gold },
  scoreSub: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
  },
});

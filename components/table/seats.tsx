import { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Highlight, Motion, Radius, Scrim, Shadow, Spacing, TABLE_FONT_SCALE_MAX } from "@/lib/theme";
import { useTableFelt } from "@/lib/cosmetics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import type { Player } from "@/lib/gameEngine";
import { a11yHidden } from "@/lib/a11y";

// ─── CardFan ──────────────────────────────────────────────────────────────────

function CardFan({
  count,
  maxCards = 7,
}: {
  count: number;
  maxCards?: number;
}) {
  const n = Math.min(count, maxCards);
  if (n === 0) return null;
  const step = 15;
  const maxAngle = 22;
  const totalW = step * (n - 1) + 40;

  return (
    <View style={{ width: totalW, height: 66 }}>
      {Array.from({ length: n }, (_, i) => {
        const c = (n - 1) / 2;
        const angle = ((i - c) / Math.max(c, 1)) * maxAngle;
        const rise = Math.abs(i - c) * 4;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: i * step,
              bottom: rise,
              transform: [{ rotate: `${angle}deg` }],
              zIndex: i,
            }}
          >
            <CardView
              card={{ id: `bk${i}`, suit: null, rank: "3", isJoker: false }}
              faceDown
              small
            />
          </View>
        );
      })}
    </View>
  );
}

// ─── AvatarCircle ─────────────────────────────────────────────────────────────

function AvatarCircle({
  name,
  isActive,
  cardCount,
  finishPos,
  size = 44,
}: {
  name: string;
  isActive: boolean;
  cardCount: number;
  finishPos?: number;
  size?: number;
}) {
  // The avatar itself never scales: it contains the initials, and React Native
  // rasterises text before transforming it, so a scaled avatar is a blurred
  // avatar. The turn signal is carried entirely by two textless sibling rings —
  // a steady one that fades in, and a one-shot ping that expands and vanishes.
  const ringOpacity = useSharedValue(0);
  const pingScale = useSharedValue(1);
  const pingOpacity = useSharedValue(0);
  const reduceMotion = usePrefersReducedMotion();
  // The avatar sits on the felt, so it takes the felt's colour: a green bubble
  // on a bordeaux table reads as an oversight rather than a choice.
  const felt = useTableFelt();

  useEffect(() => {
    ringOpacity.value = withTiming(isActive ? 1 : 0, {
      duration: reduceMotion ? 0 : Motion.duration.base,
    });
    if (!isActive || reduceMotion) return;
    pingScale.value = 1;
    pingOpacity.value = 0.9;
    pingScale.value = withTiming(1.75, { duration: Motion.duration.slow, easing: Easing.out(Easing.cubic) });
    pingOpacity.value = withTiming(0, { duration: Motion.duration.slow, easing: Easing.out(Easing.quad) });
  }, [isActive, reduceMotion, ringOpacity, pingScale, pingOpacity]);

  useEffect(
    () => () => {
      cancelAnimation(ringOpacity);
      cancelAnimation(pingScale);
      cancelAnimation(pingOpacity);
    },
    [ringOpacity, pingScale, pingOpacity]
  );

  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOpacity.value }));
  const pingStyle = useAnimatedStyle(() => ({
    opacity: pingOpacity.value,
    transform: [{ scale: pingScale.value }],
  }));
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const outerSize = size + 6;
  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[
          seatStyles.avatarPing,
          { width: outerSize, height: outerSize, borderRadius: outerSize / 2 },
          pingStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          seatStyles.avatarRing,
          { width: outerSize, height: outerSize, borderRadius: outerSize / 2 },
          ringStyle,
        ]}
      />
      <View
        style={[
          seatStyles.avatarOuter,
          { width: outerSize, height: outerSize, borderRadius: outerSize / 2 },
        ]}
      >
        <LinearGradient
          colors={[felt[1], felt[3]]}
          style={[
            seatStyles.avatarInner,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={[seatStyles.avatarInitials, { fontSize: size * 0.36 }]}>
            {initials}
          </Text>
        </LinearGradient>
        <View style={[
          seatStyles.countBubble,
          finishPos !== undefined && seatStyles.countBubbleFinished,
        ]}>
          {finishPos !== undefined ? (
            <Ionicons name="trophy" size={8} color={Colors.gold} />
          ) : (
            <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={seatStyles.countBubbleText}>{cardCount}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── BotSeatBadge ─────────────────────────────────────────────────────────────

// Persistent marker for a seat currently played by the computer — a vacated
// human seat and one dealt in as AI from the start render identically, on
// purpose: the name already carries who the seat used to be. Unlike the
// one-shot `game:seat_bot_takeover` banner, this renders for as long as
// `player.type === "ai"` holds.
function BotSeatBadge() {
  const { t } = useTranslation();
  return (
    <View style={seatStyles.botBadge}>
      <Ionicons
        name="hardware-chip-outline"
        size={FontSize.xs}
        color={Colors.gold}
        {...a11yHidden()}
      />
      <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={seatStyles.botBadgeText}>{t("onlineGame.botSeatLabel")}</Text>
    </View>
  );
}

// ─── SeatBadges ───────────────────────────────────────────────────────────────

// A pass leaves no trace on the felt, so this chip is the only thing that says
// a seat is out of the current round. It stands until somebody plays, which is
// when `passedSeats` (gameTableModel.ts) stops returning that seat. Deliberately
// quieter than the gold bot badge and the gold turn ring: a seat that has
// withdrawn from the round must not out-shout whose turn it is.
function PassedChip() {
  const { t } = useTranslation();
  return (
    <View style={seatStyles.passedChip}>
      <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={seatStyles.passedChipText}>{t("gameShared.passedLabel")}</Text>
    </View>
  );
}

// Both markers share one wrapping row. A seat carrying both would otherwise add
// two badge heights to a column laid out inside the fixed TOP_SECTION_H.
function SeatBadges({ passed, isBot }: { passed: boolean; isBot: boolean }) {
  if (!passed && !isBot) return null;
  return (
    <View style={seatStyles.seatBadgeRow}>
      {passed && <PassedChip />}
      {isBot && <BotSeatBadge />}
    </View>
  );
}

// ─── TopOppSlot ───────────────────────────────────────────────────────────────

export function TopOppSlot({
  player,
  isActive,
  cardCount,
  passed = false,
}: {
  player: Player;
  isActive: boolean;
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
}) {
  const count = cardCount ?? player.hand.length;
  return (
    <View style={seatStyles.topOppSlot}>
      <View style={seatStyles.topOppRow}>
        <View style={seatStyles.topOppAvatarCol}>
          <AvatarCircle
            name={player.name}
            isActive={isActive}
            cardCount={count}
            finishPos={player.finishPosition}
            size={42}
          />
          <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={seatStyles.oppName} numberOfLines={1}>
            {player.name}
          </Text>
          <SeatBadges passed={passed} isBot={player.type === "ai"} />
        </View>
        {player.finishPosition === undefined && count > 0 && (
          <CardFan count={count} maxCards={7} />
        )}
      </View>
    </View>
  );
}

// ─── SideOppSlot ──────────────────────────────────────────────────────────────

export function SideOppSlot({
  player,
  isActive,
  side,
  cardCount,
  passed = false,
}: {
  player: Player;
  isActive: boolean;
  side: "left" | "right";
  cardCount?: number;
  /** This seat has passed in the round on the table. */
  passed?: boolean;
}) {
  const count = cardCount ?? player.hand.length;
  const isLeft = side === "left";
  return (
    <View
      style={[
        seatStyles.sideOppSlot,
        isLeft ? seatStyles.sideLeft : seatStyles.sideRight,
      ]}
    >
      <View style={seatStyles.sideOppAvatarCol}>
        <AvatarCircle
          name={player.name}
          isActive={isActive}
          cardCount={count}
          finishPos={player.finishPosition}
          size={40}
        />
        <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={seatStyles.oppName} numberOfLines={1}>
          {player.name}
        </Text>
        <SeatBadges passed={passed} isBot={player.type === "ai"} />
      </View>
      {count > 0 && player.finishPosition === undefined && (
        <CardFan count={count} maxCards={5} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const OPP_LABEL_MAX_W = 70 + Spacing.xs * 2;

const seatStyles = StyleSheet.create({
  topOppSlot: { alignItems: "center", justifyContent: "center", paddingVertical: Spacing.slim },
  topOppRow: { flexDirection: "row", alignItems: "center", gap: Spacing.cosy },
  topOppAvatarCol: { alignItems: "center", gap: Spacing.xxs },

  sideOppSlot: { alignItems: "center", justifyContent: "center", gap: Spacing.slim },
  sideLeft: { flexDirection: "row" },
  sideRight: { flexDirection: "row-reverse" },
  sideOppAvatarCol: { alignItems: "center", gap: Spacing.xxs, marginHorizontal: 6 },

  // The count bubble's plate. The top seat renders in the felt gradient's
  // lightest band, where textMuted alone does not clear AA.
  oppName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.textMuted,
    maxWidth: OPP_LABEL_MAX_W,
    textAlign: "center",
    backgroundColor: Colors.overlayStrong,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    overflow: "hidden",
  },

  // Wraps rather than growing, because the column it sits in has no room to
  // spare below the avatar and the name.
  seatBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.xs,
    maxWidth: OPP_LABEL_MAX_W,
  },
  // Neutral, not red: red is the PASSA control and the bomb, and this is
  // neither a control nor a dramatic play — it is a seat that has receded.
  passedChip: {
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: Scrim.medium,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  passedChipText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    letterSpacing: 1,
  },

  botBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: Scrim.heavy,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
  },
  botBadgeText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.gold,
  },

  avatarOuter: {
    borderWidth: 2,
    borderColor: Highlight.clear,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarRing: {
    position: "absolute",
    borderWidth: 2,
    borderColor: Colors.gold,
    ...Shadow.gold,
  },
  avatarPing: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: Colors.goldStrong,
  },
  avatarInner: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.goldSoft,
  },
  avatarInitials: {
    fontFamily: "Rajdhani_700Bold",
    color: Colors.text,
    letterSpacing: 0.5,
  },
  countBubble: {
    position: "absolute",
    bottom: -3,
    right: -3,
    backgroundColor: Colors.overlayStrong,
    borderRadius: Radius.full,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xxs,
    borderWidth: 1,
    borderColor: Colors.goldStrong,
  },
  countBubbleFinished: {
    backgroundColor: Colors.goldMuted,
    borderColor: Colors.gold,
  },
  countBubbleText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xxs,
    color: Colors.gold,
  },
});
